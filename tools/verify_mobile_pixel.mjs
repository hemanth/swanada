#!/usr/bin/env node
/**
 * Real physical mobile browser verification on Google Pixel 10 Pro XL over Wireless ADB + CDP.
 */

import { spawn, execSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const PORT = 8080;
const TARGET_URL = `http://127.0.0.1:${PORT}/`;
const DEVICE_ID = '192.168.1.237:44687';

function connectCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    };
    ws.onerror = reject;
    ws.onopen = () =>
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          ws.send(JSON.stringify({ id, method, params }));
          return new Promise((res, rej) => pending.set(id, { res, rej }));
        },
        close() {
          ws.close();
        },
      });
  });
}

async function waitForServer(url, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server at ${url} did not start within ${timeoutMs}ms`);
}

async function main() {
  console.log('=== Physical Mobile Verification: Pixel 10 Pro XL ===');
  console.log(`Device: ${DEVICE_ID}`);

  // 1. Ensure server is running on port 8080
  let serverProc = null;
  try {
    const check = await fetch(TARGET_URL);
    if (!check.ok) throw new Error('Not OK');
    console.log(`Port ${PORT} server already running.`);
  } catch {
    console.log(`Launching server on port ${PORT}...`);
    serverProc = spawn(process.execPath, ['serve-playground.mjs'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForServer(TARGET_URL);
  }

  // 2. Open dedicated tab on Chrome Mobile
  console.log(`Opening ${TARGET_URL} in Chrome on Pixel 10 Pro XL...`);
  execSync(`adb -s ${DEVICE_ID} shell am start -a android.intent.action.VIEW -d "${TARGET_URL}" com.android.chrome`, { stdio: 'inherit' });
  await new Promise((r) => setTimeout(r, 2500));

  // 3. Find target in CDP list
  const listResp = await fetch('http://127.0.0.1:9225/json/list');
  const targets = await listResp.json();
  const testTab = targets.find((t) => t.url && t.url.includes(`127.0.0.1:${PORT}`));

  if (!testTab) {
    throw new Error(`Could not find test tab with URL matching 127.0.0.1:${PORT} in Chrome CDP target list`);
  }

  console.log(`Found test tab: ${testTab.title} (${testTab.id})`);
  const cdp = await connectCdp(testTab.webSocketDebuggerUrl);

  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.bringToFront');

    // 4. Query hardware, secure context, and isolate state
    const evalEnv = await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        return {
          ua: navigator.userAgent,
          cores: navigator.hardwareConcurrency,
          deviceMemoryGB: navigator.deviceMemory,
          isSecureContext: window.isSecureContext,
          crossOriginIsolated: window.crossOriginIsolated,
          hasSAB: typeof SharedArrayBuffer === 'function',
          ready: Boolean(window.__swanadaReady),
          loadedLang: window.__swanadaLoadedLang,
        };
      })()`,
    });

    const envInfo = evalEnv.result.value;
    console.log('Mobile Hardware & Secure Context Diagnostics:', envInfo);
    assert.equal(envInfo.isSecureContext, true, 'Expected window.isSecureContext === true on loopback origin');
    assert.equal(envInfo.crossOriginIsolated, true, 'Expected window.crossOriginIsolated === true under COOP/COEP');
    assert.equal(envInfo.hasSAB, true, 'Expected SharedArrayBuffer to be available on mobile');

    // 5. Wait for engine ready
    console.log('Waiting for Swanada engine to initialize on Tensor G5...');
    let ready = envInfo.ready;
    const startWait = Date.now();
    while (!ready && Date.now() - startWait < 30000) {
      const check = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: 'Boolean(window.__swanadaReady)',
      });
      ready = check.result.value;
      if (!ready) await new Promise((r) => setTimeout(r, 300));
    }
    assert.equal(ready, true, 'Engine failed to initialize within 30s on mobile device');
    console.log('Swanada engine ready on mobile!');

    // 6. Trigger preset stream via programmatic call or touch
    console.log('Streaming Sanskrit preset utterance on hardware...');
    await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      expression: `(async () => {
        const chip = document.querySelector('#presetChips .chip');
        if (chip) chip.click();
      })()`,
    });

    // Wait for completion
    let completed = false;
    const startStream = Date.now();
    while (!completed && Date.now() - startStream < 25000) {
      const check = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: 'document.querySelector("#liveBadge")?.textContent',
      });
      const badge = check.result.value;
      if (badge === 'Completed') completed = true;
      else await new Promise((r) => setTimeout(r, 300));
    }

    assert.equal(completed, true, 'Streaming transcription did not complete within 25s');
    await new Promise((r) => setTimeout(r, 400));

    // 7. Extract final transcript and mobile telemetry
    const evalResult = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        return {
          committed: document.querySelector('#committedText')?.textContent || '',
          iast: document.querySelector('#iastBox')?.textContent || '',
          metrics: window.__swanadaMetrics,
          badge: document.querySelector('#liveBadge')?.textContent,
        };
      })()`,
    });

    const res = evalResult.result.value;
    console.log('Mobile Hardware Transcription Result:', res);
    assert.ok(res.committed.trim().length > 0, 'Mobile transcription yielded empty text!');

    // 8. Capture physical screen PNG
    const screenPath = path.join(ROOT, 'docs', 'mobile_pixel_verification.png');
    console.log(`Capturing physical screen capture to ${screenPath}...`);
    execSync(`adb -s ${DEVICE_ID} exec-out screencap -p > "${screenPath}"`);
    console.log(`Saved screenshot: ${screenPath} (${fs.statSync(screenPath).size} bytes)`);

    console.log('\n=== MOBILE HARDWARE VERIFICATION SUCCEEDED ===');
  } finally {
    cdp.close();
    if (serverProc) serverProc.kill('SIGTERM');
    // Reset battery settings
    execSync(`adb -s ${DEVICE_ID} shell dumpsys battery reset`, { stdio: 'ignore' });
  }
}

main().catch((err) => {
  console.error('\nFAIL verify_mobile_pixel:', err);
  process.exit(1);
});
