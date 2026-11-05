/**
 * Dual-tier model caching (CacheStorage + IndexedDB) with protobuf validation
 * and streaming download progress reporting.
 */

import type { ModelAssetProgress } from './types.ts';

export const CACHE_STORAGE_NAME = 'swanada-onnx-v1.0.0';
export const IDB_DATABASE_NAME = 'swanada-onnx-idb-v1';
export const IDB_STORE_NAME = 'models';

/**
 * Validates that binary buffer is a valid serialized ONNX ModelProto.
 * Field 1 of ONNX ModelProto is ir_version (varint tag 0x08).
 */
export function isValidOnnxBuffer(buf: Uint8Array, minBytes: number = 50_000): boolean {
  if (!buf || buf.byteLength < minBytes) {
    return false;
  }
  return buf[0] === 0x08;
}

/**
 * Retrieves buffer from CacheStorage if available.
 */
async function getFromCacheStorage(cacheName: string, url: string): Promise<Uint8Array | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(cacheName);
    const response = await cache.match(url);
    if (response && response.ok) {
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      if (isValidOnnxBuffer(bytes)) {
        return bytes;
      }
    }
  } catch {
    // CacheStorage not accessible in current context
  }
  return null;
}

/**
 * Stores buffer into CacheStorage.
 */
async function putToCacheStorage(cacheName: string, url: string, data: Uint8Array): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(cacheName);
    const response = new Response(data, {
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    await cache.put(url, response);
  } catch {
    // Non-critical cache write failure
  }
}

/**
 * Retrieves buffer from IndexedDB fallback if available.
 */
async function getFromIndexedDB(url: string): Promise<Uint8Array | null> {
  if (typeof indexedDB === 'undefined') return null;
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_DATABASE_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(IDB_STORE_NAME);
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(IDB_STORE_NAME, 'readonly');
        const store = tx.objectStore(IDB_STORE_NAME);
        const getReq = store.get(url);
        getReq.onsuccess = () => {
          const res = getReq.result;
          if (res instanceof Uint8Array && isValidOnnxBuffer(res)) {
            resolve(res);
          } else {
            resolve(null);
          }
        };
        getReq.onerror = () => resolve(null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Stores buffer into IndexedDB fallback.
 */
async function putToIndexedDB(url: string, data: Uint8Array): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_DATABASE_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(IDB_STORE_NAME);
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
        const store = tx.objectStore(IDB_STORE_NAME);
        store.put(data, url);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      };
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Universal model asset loader.
 * Checks CacheStorage -> IndexedDB -> HTTP fetch (with streaming progress callback).
 */
export async function loadModelAsset(
  urlOrPath: string,
  cacheName: string = CACHE_STORAGE_NAME,
  onProgress?: (p: ModelAssetProgress) => void
): Promise<Uint8Array> {
  // 1. Check CacheStorage
  const cached = await getFromCacheStorage(cacheName, urlOrPath);
  if (cached) {
    onProgress?.({
      phase: 'cache',
      loadedBytes: cached.byteLength,
      totalBytes: cached.byteLength,
      pct: 100,
      fromCache: true,
    });
    return cached;
  }

  // 2. Check IndexedDB
  const idbCached = await getFromIndexedDB(urlOrPath);
  if (idbCached) {
    onProgress?.({
      phase: 'cache',
      loadedBytes: idbCached.byteLength,
      totalBytes: idbCached.byteLength,
      pct: 100,
      fromCache: true,
    });
    // Populate CacheStorage for next time
    await putToCacheStorage(cacheName, urlOrPath, idbCached);
    return idbCached;
  }

  // 3. Node.js direct filesystem check
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const candidates = [
        urlOrPath,
        path.resolve(process.cwd(), urlOrPath),
        path.resolve(process.cwd(), '..', urlOrPath),
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          const buffer = fs.readFileSync(cand);
          const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
          if (isValidOnnxBuffer(bytes)) {
            onProgress?.({
              phase: 'ready',
              loadedBytes: bytes.byteLength,
              totalBytes: bytes.byteLength,
              pct: 100,
              fromCache: true,
            });
            return bytes;
          }
        }
      }
    } catch {
      // Not a local filesystem path, continue to fetch
    }
  }

  // 4. Offline Check
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error(`Model not found in CacheStorage and client is offline: ${urlOrPath}`);
  }

  // 5. Streaming HTTP Fetch (only if http/https or browser environment)
  const isNode = typeof process !== 'undefined' && Boolean(process.versions?.node);
  if (!urlOrPath.startsWith('http://') && !urlOrPath.startsWith('https://') && isNode) {
    throw new Error(`Model not found at path: ${urlOrPath}`);
  }

  let fetchUrl = urlOrPath;
  if (!isNode && !urlOrPath.startsWith('http://') && !urlOrPath.startsWith('https://')) {
    try {
      const baseHref =
        (typeof self !== 'undefined' && self.location?.href) ||
        (typeof window !== 'undefined' && window.location?.href) ||
        '';
      if (baseHref) {
        fetchUrl = new URL(urlOrPath, baseHref).href;
      }
    } catch {}
  }

  const response = await fetch(fetchUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch model from ${fetchUrl}: HTTP ${response.status} ${response.statusText}`);
  }

  const contentLength = Number(response.headers.get('content-length') || 0);
  let totalBytes = contentLength > 0 ? contentLength : 0;
  let loadedBytes = 0;

  let buffer: Uint8Array;

  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loadedBytes += value.byteLength;
        const pct = totalBytes > 0 ? Math.min(100, (loadedBytes / totalBytes) * 100) : 0;
        onProgress?.({
          phase: 'download',
          loadedBytes,
          totalBytes: totalBytes || loadedBytes,
          pct: Math.round(pct),
          fromCache: false,
        });
      }
    }

    buffer = new Uint8Array(loadedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } else {
    const arrayBuffer = await response.arrayBuffer();
    buffer = new Uint8Array(arrayBuffer);
    onProgress?.({
      phase: 'download',
      loadedBytes: buffer.byteLength,
      totalBytes: buffer.byteLength,
      pct: 100,
      fromCache: false,
    });
  }

  if (!isValidOnnxBuffer(buffer)) {
    throw new Error(`Corrupted model file received from ${urlOrPath}: protobuf 0x08 header verification failed`);
  }

  // Save to persistent caches asynchronously
  putToCacheStorage(cacheName, urlOrPath, buffer).catch(() => {});
  putToIndexedDB(urlOrPath, buffer).catch(() => {});

  return buffer;
}
