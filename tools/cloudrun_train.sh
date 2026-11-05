#!/usr/bin/env bash
set -e

echo "=== Swanada NVIDIA L4 GPU Fine-Tuning Execution on GCP Cloud Run ==="
pip install -q google-cloud-storage google-crc32c

echo "Fetching input data and script from GCS..."
python3 -c "from google.cloud import storage; c = storage.Client().bucket('training-gemina'); c.blob('swanada/en_features_cache.pt').download_to_filename('/tmp/en_features_cache.pt'); c.blob('swanada/cloudrun_gpu_train.py').download_to_filename('/tmp/cloudrun_gpu_train.py')"

echo "Starting GPU fine-tuning process..."
python3 /tmp/cloudrun_gpu_train.py

echo "=== Execution Finished Successfully ==="
