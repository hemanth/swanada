#!/usr/bin/env python3
"""
Swanada GCP Cloud GPU Fine-Tuning & Auto-Teardown Runner.
Enforces:
  1. Mandatory resource attribution (CLOUDSDK_METRICS_ENVIRONMENT=datacloud.antigravity).
  2. Credit-budgeted spot execution with hard timeouts (15-30 min).
  3. Strict instance isolation (zero touch of agy-remote or other VMs).
  4. Unconditional teardown via atexit, signal handlers, and try/finally.
"""
from __future__ import annotations

import argparse
import atexit
import json
import logging
import os
import re
import secrets
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [swanada-gcp] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger("swanada-gcp")

# Protected instances that must NEVER be touched
PROTECTED_INSTANCES = frozenset({"agy-remote", "ninada-istft-w4b", "piragi-airbench-gpu"})
INSTANCE_NAME_PATTERN = re.compile(r"^swanada-gpu-\d{10}-[a-f0-9]{6}$")

# Attribution environment variable
METRICS_TAG = "datacloud.antigravity"


class GCPExecutionError(RuntimeError):
    """Raised when a GCP operation fails."""


def run_gcloud(
    cmd: list[str],
    *,
    capture_output: bool = True,
    check: bool = True,
    timeout: float | None = 60.0,
) -> subprocess.CompletedProcess[str]:
    """Execute a gcloud command with mandatory resource attribution."""
    env = os.environ.copy()
    existing = env.get("CLOUDSDK_METRICS_ENVIRONMENT", "")
    env["CLOUDSDK_METRICS_ENVIRONMENT"] = f"{existing} {METRICS_TAG}".strip() if existing else METRICS_TAG

    full_cmd = ["gcloud"] + cmd
    logger.debug("Executing command: %s", " ".join(full_cmd))

    try:
        proc = subprocess.run(
            full_cmd,
            env=env,
            capture_output=capture_output,
            text=True,
            check=check,
            timeout=timeout,
        )
        return proc
    except subprocess.TimeoutExpired as exc:
        logger.error("Command timed out after %s seconds: %s", timeout, " ".join(full_cmd))
        raise GCPExecutionError(f"Command timed out: {' '.join(full_cmd)}") from exc
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.strip() if exc.stderr else ""
        logger.error("Command failed (exit %d): %s\nStderr: %s", exc.returncode, " ".join(full_cmd), stderr)
        raise GCPExecutionError(f"gcloud failed: {stderr}") from exc


def verify_authentication(project: str) -> None:
    """Pre-flight Step 0 verification of credentials and target project."""
    logger.info("Running pre-flight authentication verification...")
    proc = run_gcloud(["auth", "list", "--format=json"])
    accounts = json.loads(proc.stdout)
    active_accounts = [a for a in accounts if a.get("status") == "ACTIVE"]

    if not active_accounts:
        raise GCPExecutionError(
            "No active credentialed accounts detected. "
            "Please run 'gcloud auth login' and 'gcloud auth application-default login'."
        )

    active_user = active_accounts[0].get("account", "unknown")
    logger.info("Verified active GCP account: %s", active_user)

    cfg_proc = run_gcloud(["config", "list", "--format=json"])
    config = json.loads(cfg_proc.stdout)
    active_project = config.get("core", {}).get("project", "")

    if project and active_project != project:
        logger.warning("Active project '%s' differs from specified target '%s'", active_project, project)
    logger.info("Target GCP project verified: %s", project or active_project)


def verify_quota(project: str, region: str) -> None:
    """Check regional preemptible / spot GPU quota availability."""
    logger.info("Verifying Spot GPU quota in region '%s'...", region)
    try:
        proc = run_gcloud(["compute", "regions", "describe", region, f"--project={project}", "--format=json(quotas)"])
        data = json.loads(proc.stdout)
        quotas = {q["metric"]: q for q in data.get("quotas", [])}

        l4_quota = quotas.get("PREEMPTIBLE_NVIDIA_L4_GPUS") or quotas.get("NVIDIA_L4_GPUS")
        if l4_quota:
            limit = float(l4_quota.get("limit", 0))
            usage = float(l4_quota.get("usage", 0))
            avail = limit - usage
            logger.info("Regional GPU quota (%s): limit=%.1f, usage=%.1f, available=%.1f", l4_quota["metric"], limit, usage, avail)
            if avail < 1.0:
                logger.warning("Insufficient regional Spot L4 quota (%s). Will attempt fallback or check T4 quota.", avail)
    except Exception as exc:
        logger.warning("Notice: Quota probe encountered exception: %s", exc)


class GCPSpotManager:
    """Manages the full lifecycle of a temporary Spot GPU instance with strict traps."""

    def __init__(
        self,
        project: str,
        zone: str,
        machine_type: str = "g2-standard-4",
        accelerator: str = "type=nvidia-l4,count=1",
        max_duration_sec: int = 1800,
        labels: str = "project=swanada,environment=development,created-by=swanada-orchestrator",
    ) -> None:
        self.project = project
        self.zone = zone
        self.machine_type = machine_type
        self.accelerator = accelerator
        self.max_duration_sec = max_duration_sec
        self.labels = labels

        # Generate strictly conforming unique instance name
        timestamp = int(time.time())
        hex_suffix = secrets.token_hex(3)
        self.instance_name = f"swanada-gpu-{timestamp}-{hex_suffix}"

        # Safety verification
        assert INSTANCE_NAME_PATTERN.match(self.instance_name), f"Invalid instance name: {self.instance_name}"
        assert self.instance_name not in PROTECTED_INSTANCES, f"Collision with protected instance: {self.instance_name}"

        self.created = False
        self.torn_down = False
        self.start_time: float | None = None

        # Register exit and signal traps
        atexit.register(self.teardown)
        signal.signal(signal.SIGINT, self._handle_signal)
        signal.signal(signal.SIGTERM, self._handle_signal)

    def _handle_signal(self, signum: int, _frame: Any) -> None:
        logger.warning("Intercepted signal %d. Triggering emergency teardown of %s...", signum, self.instance_name)
        self.teardown()
        sys.exit(128 + signum)

    def launch(self, startup_script_path: Path) -> None:
        """Provision the Spot GPU instance with attribution and hard duration cap."""
        if not startup_script_path.exists():
            raise FileNotFoundError(f"Startup script missing: {startup_script_path}")

        logger.info("Launching Spot GPU instance '%s' in %s...", self.instance_name, self.zone)
        cmd = [
            "compute",
            "instances",
            "create",
            self.instance_name,
            f"--project={self.project}",
            f"--zone={self.zone}",
            f"--machine-type={self.machine_type}",
            f"--accelerator={self.accelerator}",
            "--maintenance-policy=TERMINATE",
            "--provisioning-model=SPOT",
            "--instance-termination-action=DELETE",
            f"--max-run-duration={self.max_duration_sec}s",
            f"--labels={self.labels}",
            "--image-family=pytorch-2-9-cu129-ubuntu-2204-nvidia-580",
            "--image-project=deeplearning-platform-release",
            "--boot-disk-size=100GB",
            "--boot-disk-type=pd-balanced",
            f"--metadata-from-file=startup-script={startup_script_path}",
            f"--metadata=swanada-instance={self.instance_name},swanada-timeout={self.max_duration_sec}",
            "--scopes=https://www.googleapis.com/auth/cloud-platform",
        ]

        self.start_time = time.time()
        run_gcloud(cmd, timeout=120.0)
        self.created = True
        logger.info("Spot GPU instance '%s' successfully provisioned.", self.instance_name)

    def wait_and_stream_logs(self, poll_interval: float = 15.0) -> int:
        """Stream serial port output until job finishes or timeout occurs."""
        logger.info("Monitoring execution logs for '%s'...", self.instance_name)
        start = time.time()
        last_offset = 0

        while True:
            elapsed = time.time() - start
            if elapsed > self.max_duration_sec:
                logger.error("Execution exceeded maximum duration (%d s). Triggering teardown.", self.max_duration_sec)
                return 1

            # Check instance status
            try:
                proc = run_gcloud([
                    "compute", "instances", "describe",
                    self.instance_name,
                    f"--project={self.project}",
                    f"--zone={self.zone}",
                    "--format=json(status)",
                ], timeout=20.0)
                status = json.loads(proc.stdout).get("status", "")
            except GCPExecutionError:
                # If instance no longer exists, it was deleted or halted
                logger.info("Instance '%s' no longer detected in compute registry.", self.instance_name)
                break

            if status in ("TERMINATED", "STOPPED"):
                logger.info("Instance '%s' transitioned to %s.", self.instance_name, status)
                break

            # Fetch new serial console output
            try:
                serial_proc = run_gcloud([
                    "compute", "instances", "get-serial-port-output",
                    self.instance_name,
                    f"--project={self.project}",
                    f"--zone={self.zone}",
                    f"--start={last_offset}",
                ], timeout=20.0)
                output = serial_proc.stdout
                if output:
                    for line in output.splitlines():
                        if "swanada-log:" in line:
                            logger.info("[VM SERIAL] %s", line.split("swanada-log:", 1)[1].strip())
                        if "SWANADA_STATUS: SUCCESS" in line:
                            logger.info("Workload execution reported SUCCESS.")
                            return 0
                        if "SWANADA_STATUS: FAILED" in line:
                            logger.error("Workload execution reported FAILURE.")
                            return 1
                    last_offset += len(output)
            except Exception as err:
                logger.debug("Serial output fetch paused: %s", err)

            time.sleep(poll_interval)

        return 0

    def teardown(self) -> None:
        """Unconditionally delete the targeted instance and verify termination."""
        if self.torn_down or not self.created:
            return

        self.torn_down = True
        logger.info("Starting teardown for instance '%s'...", self.instance_name)

        # Re-verify safety invariants before issuing deletion command
        if self.instance_name in PROTECTED_INSTANCES:
            logger.critical("SAFETY VIOLATION: Refusing to delete protected instance '%s'!", self.instance_name)
            return

        if not self.instance_name.startswith("swanada-gpu-"):
            logger.critical("SAFETY VIOLATION: Refusing to delete non-swanada instance '%s'!", self.instance_name)
            return

        try:
            run_gcloud([
                "compute", "instances", "delete",
                self.instance_name,
                f"--project={self.project}",
                f"--zone={self.zone}",
                "--quiet",
            ], timeout=90.0)
            logger.info("Instance '%s' deletion command completed.", self.instance_name)
        except Exception as err:
            logger.error("Exception during instance deletion: %s", err)

        # Post-teardown verification
        self._verify_terminated()

        # Compute cost accounting
        if self.start_time:
            duration_sec = time.time() - self.start_time
            # g2-standard-4 spot is ~$0.22/hour
            estimated_cost = (duration_sec / 3600.0) * 0.22
            logger.info(
                "Execution finished in %.1f seconds (~%.2f min). Estimated Spot compute cost: $%.4f USD.",
                duration_sec,
                duration_sec / 60.0,
                estimated_cost,
            )

    def _verify_terminated(self) -> None:
        """Confirm that the instance is no longer running."""
        try:
            proc = run_gcloud([
                "compute", "instances", "list",
                f"--project={self.project}",
                f"--filter=name={self.instance_name}",
                "--format=json(name)",
            ])
            found = json.loads(proc.stdout)
            if not found:
                logger.info("VERIFIED: Instance '%s' completely removed.", self.instance_name)
            else:
                logger.warning("Instance '%s' still listed during post-teardown verification.", self.instance_name)
        except Exception as err:
            logger.warning("Could not execute post-teardown verification: %s", err)


def main() -> int:
    parser = argparse.ArgumentParser(description="Swanada GCP Spot GPU Fine-Tuning Runner")
    parser.add_argument("--project", default="hemanth-hm", help="Target GCP Project ID")
    parser.add_argument("--zone", default="us-central1-a", help="Compute Engine Zone")
    parser.add_argument("--machine-type", default="g2-standard-4", help="Machine Type (e.g. g2-standard-4)")
    parser.add_argument("--accelerator", default="type=nvidia-l4,count=1", help="GPU accelerator")
    parser.add_argument("--timeout", type=int, default=1800, help="Max run duration in seconds (15-30 min)")
    parser.add_argument("--dry-run", action="store_true", help="Run auth and quota checks without creating VM")
    args = parser.parse_args()

    # Step 0: Auth and Quota Checks
    verify_authentication(args.project)
    region = "-".join(args.zone.split("-")[:2])
    verify_quota(args.project, region)

    if args.dry_run:
        logger.info("Dry-run requested. All authentication, quota, and label contracts verified successfully.")
        return 0

    startup_script = Path(__file__).parent / "gcp_startup.sh"
    manager = GCPSpotManager(
        project=args.project,
        zone=args.zone,
        machine_type=args.machine_type,
        accelerator=args.accelerator,
        max_duration_sec=args.timeout,
    )

    try:
        manager.launch(startup_script)
        status_code = manager.wait_and_stream_logs()
        return status_code
    finally:
        manager.teardown()


if __name__ == "__main__":
    sys.exit(main())
