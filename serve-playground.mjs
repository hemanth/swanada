#!/usr/bin/env node
/**
 * swanada: Local Static Playground Server (serve-playground.mjs).
 * Pure Node.js zero-dependency HTTP server with mandatory COOP/COEP isolation,
 * HTTP Range requests (206), CORS headers, and zero-copy /models/ routing.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.resolve(__dirname, 'docs');
const MODELS_DIR = path.resolve(__dirname, 'models');
const JS_DIST_DIR = path.resolve(__dirname, 'js', 'dist');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const gzipCache = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.onnx': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
};

const server = http.createServer((req, res) => {
  // CORS & Security Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept-Encoding');
  res.setHeader('Accept-Ranges', 'bytes');

  if (process.env.COOP_COEP !== '0') {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader(
      'Cross-Origin-Embedder-Policy',
      process.env.COEP_CREDENTIALLESS === '1' ? 'credentialless' : 'require-corp'
    );
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }

  const urlObj = new URL(req.url || '/', `http://localhost:${PORT}`);
  let pathname;
  try {
    pathname = decodeURIComponent(urlObj.pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request: Malformed URI sequence');
    return;
  }
  if (pathname === '/' || pathname === '') {
    pathname = '/index.html';
  }

  let filePath;
  if (pathname.startsWith('/models/')) {
    filePath = path.join(MODELS_DIR, pathname.slice(8));
  } else if (pathname.startsWith('/dist/')) {
    filePath = path.join(JS_DIST_DIR, pathname.slice(6));
  } else {
    filePath = path.join(DOCS_DIR, pathname);
  }

  const resolved = path.resolve(filePath);

  // Path Traversal Security Verification
  const isAllowed =
    resolved.startsWith(DOCS_DIR) ||
    resolved.startsWith(MODELS_DIR) ||
    resolved.startsWith(JS_DIST_DIR);

  if (!isAllowed) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden: Access outside authorized workspace root');
    return;
  }

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Not Found: ${pathname}`);
    return;
  }

  const stat = fs.statSync(resolved);
  const ext = path.extname(resolved).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';

  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-cache');

  // HTTP Range Request Handling (206 Partial Content)
  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    if (match) {
      let start;
      let end;
      if (match[1] === '') {
        // Suffix range: bytes=-N
        const suffix = parseInt(match[2], 10);
        start = Math.max(0, stat.size - suffix);
        end = stat.size - 1;
      } else {
        start = parseInt(match[1], 10);
        end = match[2] !== '' ? parseInt(match[2], 10) : stat.size - 1;
      }

      if (isNaN(start) || isNaN(end) || start > end || start >= stat.size) {
        res.writeHead(416, {
          'Content-Range': `bytes */${stat.size}`,
          'Content-Type': 'text/plain; charset=utf-8',
        });
        res.end('Requested Range Not Satisfiable');
        return;
      }

      if (end >= stat.size) {
        end = stat.size - 1;
      }

      const contentLength = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': contentLength,
      });

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      fs.createReadStream(resolved, { start, end }).pipe(res);
      return;
    }
  }

  // Gzip compression for ONNX / JSON / WASM if requested
  const acceptEnc = String(req.headers['accept-encoding'] || '');
  if ((ext === '.onnx' || ext === '.wasm' || ext === '.json') && acceptEnc.includes('gzip')) {
    const gzKey = `${resolved}:${stat.mtimeMs}:${stat.size}`;
    let gz = gzipCache.get(gzKey);
    if (!gz) {
      for (const k of gzipCache.keys()) {
        if (k.startsWith(`${resolved}:`)) gzipCache.delete(k);
      }
      gz = zlib.gzipSync(fs.readFileSync(resolved), { level: 1 });
      gzipCache.set(gzKey, gz);
    }
    res.writeHead(200, {
      'Content-Encoding': 'gzip',
      'Content-Length': gz.byteLength,
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(gz);
    return;
  }

  // Standard 200 Streaming Response
  res.writeHead(200, { 'Content-Length': stat.size });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(resolved).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`Swanada speech studio listening on http://127.0.0.1:${PORT}`);
  console.log(`Cross-Origin Isolation: COOP=same-origin, COEP=require-corp`);
});

export default server;
