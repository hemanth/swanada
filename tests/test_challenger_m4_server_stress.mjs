/**
 * Challenger M4 Iteration 2: Static Server Stress & RFC 9110 Compliance Suite.
 * Zero-pronoun test harness validating serve-playground.mjs security, headers, and range parsing.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SERVER_SCRIPT = path.resolve(ROOT_DIR, 'serve-playground.mjs');
const TEST_PORT = 4192;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function makeRequest(pathName, options = {}) {
  return new Promise((resolve, reject) => {
    const reqOptions = {
      method: options.method || 'GET',
      headers: options.headers || {},
    };
    const targetUrl = `${BASE_URL}${pathName}`;
    const req = http.request(targetUrl, reqOptions, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  console.log('=== STARTING CHALLENGER M4 SERVER STRESS SUITE ===');

  const serverProc = spawn(process.execPath, [SERVER_SCRIPT], {
    cwd: ROOT_DIR,
    env: { ...process.env, PORT: String(TEST_PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProc.stderr.on('data', (d) => process.stderr.write(`[server stderr] ${d}`));

  let serverReady = false;
  serverProc.stdout.on('data', (d) => {
    const text = d.toString();
    if (text.includes('Swanada speech studio listening')) {
      serverReady = true;
    }
  });

  // Poll until server is ready
  for (let attempt = 0; attempt < 40; attempt++) {
    if (serverReady) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(serverReady, 'Server failed to start within 4 seconds');

  const fileStat = fs.statSync(path.resolve(ROOT_DIR, 'docs', 'index.html'));
  const fileSize = fileStat.size;
  const fileBytes = fs.readFileSync(path.resolve(ROOT_DIR, 'docs', 'index.html'));

  const suiteResults = [];

  async function check(desc, fn) {
    try {
      await fn();
      console.log(`  PASS: ${desc}`);
      suiteResults.push({ desc, status: 'PASS' });
    } catch (err) {
      console.error(`  FAIL: ${desc} -> ${err.message}`);
      suiteResults.push({ desc, status: 'FAIL', error: err.message });
    }
  }

  try {
    // -------------------------------------------------------------
    // Suite 1: Malformed URI Sequences & Robust Decoding
    // -------------------------------------------------------------
    console.log('\n--- 1. Malformed URI Sequence Tests ---');

    await check('Malformed URI %e0%a0 yields 400 Bad Request', async () => {
      const res = await makeRequest('/%e0%a0');
      assert.equal(res.statusCode, 400);
      assert.ok(res.body.toString().includes('Bad Request'));
    });

    await check('Malformed URI %c0%af yields 400 Bad Request', async () => {
      const res = await makeRequest('/%c0%af');
      assert.equal(res.statusCode, 400);
      assert.ok(res.body.toString().includes('Bad Request'));
    });

    await check('Malformed URI %ff yields 400 Bad Request', async () => {
      const res = await makeRequest('/%ff');
      assert.equal(res.statusCode, 400);
      assert.ok(res.body.toString().includes('Bad Request'));
    });

    await check('Malformed URI incomplete percent % yields 400 Bad Request', async () => {
      const res = await makeRequest('/%');
      assert.equal(res.statusCode, 400);
      assert.ok(res.body.toString().includes('Bad Request'));
    });

    await check('Double-encoded traversal %252e%252e%252f resolves safely without crash', async () => {
      const res = await makeRequest('/%252e%252e%252fpackage.json');
      // Double encoded %25 decodes to %, resulting in safe 404
      assert.ok(res.statusCode === 404 || res.statusCode === 403);
    });

    // -------------------------------------------------------------
    // Suite 2: Path Traversal Defenses
    // -------------------------------------------------------------
    console.log('\n--- 2. Path Traversal Defense Tests ---');

    await check('Encoded traversal /..%2fpackage.json yields 403 Forbidden', async () => {
      const res = await makeRequest('/..%2fpackage.json');
      assert.equal(res.statusCode, 403);
      assert.ok(res.body.toString().includes('Forbidden'));
    });

    await check('Encoded traversal /dist/..%2f..%2fpackage.json yields 403 Forbidden', async () => {
      const res = await makeRequest('/dist/..%2f..%2fpackage.json');
      assert.equal(res.statusCode, 403);
      assert.ok(res.body.toString().includes('Forbidden'));
    });

    await check('Encoded traversal /models/..%2fpackage.json yields 403 Forbidden', async () => {
      const res = await makeRequest('/models/..%2fpackage.json');
      assert.equal(res.statusCode, 403);
      assert.ok(res.body.toString().includes('Forbidden'));
    });

    await check('Raw path traversal /../../etc/passwd yields 404 and prevents outside access', async () => {
      const res = await makeRequest('/../../etc/passwd');
      // Collapsed to /etc/passwd under docs root, safely returning 404
      assert.equal(res.statusCode, 404);
      assert.ok(!res.body.toString().includes('root:'));
    });

    await check('Raw path traversal /dist/../../../package.json yields 404 and prevents outside access', async () => {
      const res = await makeRequest('/dist/../../../package.json');
      // Collapsed to /package.json under docs root, safely returning 404
      assert.equal(res.statusCode, 404);
      assert.ok(!res.body.toString().includes('"name": "swanada"'));
    });

    await check('Path traversal attempt via root /.. safely returns 200 or 404 for index', async () => {
      const res = await makeRequest('/..');
      assert.ok(res.statusCode === 200 || res.statusCode === 404 || res.statusCode === 403);
    });

    // -------------------------------------------------------------
    // Suite 3: RFC 9110 HTTP Range Requests
    // -------------------------------------------------------------
    console.log('\n--- 3. RFC 9110 Range Request Tests ---');

    await check('Suffix Range bytes=-50 yields 206 with exact last 50 bytes', async () => {
      const res = await makeRequest('/index.html', {
        headers: { Range: 'bytes=-50' },
      });
      assert.equal(res.statusCode, 206);
      assert.equal(res.headers['content-range'], `bytes ${fileSize - 50}-${fileSize - 1}/${fileSize}`);
      assert.equal(res.headers['content-length'], '50');
      assert.equal(res.body.length, 50);
      assert.deepEqual(res.body, fileBytes.subarray(fileSize - 50));
    });

    await check('Oversized suffix range bytes=-9999999 clamps to entire file', async () => {
      const res = await makeRequest('/index.html', {
        headers: { Range: 'bytes=-9999999' },
      });
      assert.equal(res.statusCode, 206);
      assert.equal(res.headers['content-range'], `bytes 0-${fileSize - 1}/${fileSize}`);
      assert.equal(res.headers['content-length'], String(fileSize));
      assert.equal(res.body.length, fileSize);
      assert.deepEqual(res.body, fileBytes);
    });

    await check('Zero suffix range bytes=-0 yields 416 Range Not Satisfiable', async () => {
      const res = await makeRequest('/index.html', {
        headers: { Range: 'bytes=-0' },
      });
      assert.equal(res.statusCode, 416);
      assert.equal(res.headers['content-range'], `bytes */${fileSize}`);
    });

    await check('Standard range bytes=0-49 yields 206 with exact 50 bytes', async () => {
      const res = await makeRequest('/index.html', {
        headers: { Range: 'bytes=0-49' },
      });
      assert.equal(res.statusCode, 206);
      assert.equal(res.headers['content-range'], `bytes 0-49/${fileSize}`);
      assert.equal(res.headers['content-length'], '50');
      assert.equal(res.body.length, 50);
      assert.deepEqual(res.body, fileBytes.subarray(0, 50));
    });

    await check('Open-ended range bytes=100- yields 206 from byte 100 to end', async () => {
      const res = await makeRequest('/index.html', {
        headers: { Range: 'bytes=100-' },
      });
      assert.equal(res.statusCode, 206);
      assert.equal(res.headers['content-range'], `bytes 100-${fileSize - 1}/${fileSize}`);
      assert.equal(res.headers['content-length'], String(fileSize - 100));
      assert.equal(res.body.length, fileSize - 100);
      assert.deepEqual(res.body, fileBytes.subarray(100));
    });

    await check('Inverted range bytes=50-20 yields 416 Range Not Satisfiable', async () => {
      const res = await makeRequest('/index.html', {
        headers: { Range: 'bytes=50-20' },
      });
      assert.equal(res.statusCode, 416);
      assert.equal(res.headers['content-range'], `bytes */${fileSize}`);
    });

    await check('Out-of-bounds start range bytes=9999999- yields 416', async () => {
      const res = await makeRequest('/index.html', {
        headers: { Range: 'bytes=9999999-' },
      });
      assert.equal(res.statusCode, 416);
      assert.equal(res.headers['content-range'], `bytes */${fileSize}`);
    });

    await check('Empty range bytes=- yields 416 Range Not Satisfiable', async () => {
      const res = await makeRequest('/index.html', {
        headers: { Range: 'bytes=-' },
      });
      assert.equal(res.statusCode, 416);
      assert.equal(res.headers['content-range'], `bytes */${fileSize}`);
    });

    await check('Malformed range syntax bytes=abc-xyz falls back to 200 OK', async () => {
      const res = await makeRequest('/index.html', {
        headers: { Range: 'bytes=abc-xyz' },
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.length, fileSize);
    });

    // -------------------------------------------------------------
    // Suite 4: Security Headers (COOP / COEP / CORS)
    // -------------------------------------------------------------
    console.log('\n--- 4. Security & Isolation Headers ---');

    await check('COOP, COEP, CORP, and CORS headers are emitted', async () => {
      const res = await makeRequest('/index.html');
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['cross-origin-opener-policy'], 'same-origin');
      assert.equal(res.headers['cross-origin-embedder-policy'], 'require-corp');
      assert.equal(res.headers['cross-origin-resource-policy'], 'cross-origin');
      assert.equal(res.headers['access-control-allow-origin'], '*');
      assert.equal(res.headers['accept-ranges'], 'bytes');
    });

    // -------------------------------------------------------------
    // Suite 5: HTTP Methods & HEAD Handling
    // -------------------------------------------------------------
    console.log('\n--- 5. HTTP Methods & HEAD Handling ---');

    await check('OPTIONS preflight returns 204 No Content', async () => {
      const res = await makeRequest('/index.html', { method: 'OPTIONS' });
      assert.equal(res.statusCode, 204);
      assert.equal(res.body.length, 0);
    });

    await check('POST request returns 405 Method Not Allowed', async () => {
      const res = await makeRequest('/index.html', { method: 'POST' });
      assert.equal(res.statusCode, 405);
    });

    await check('DELETE request returns 405 Method Not Allowed', async () => {
      const res = await makeRequest('/index.html', { method: 'DELETE' });
      assert.equal(res.statusCode, 405);
    });

    await check('HEAD request returns 200 with headers and zero body', async () => {
      const res = await makeRequest('/index.html', { method: 'HEAD' });
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['content-length'], String(fileSize));
      assert.equal(res.body.length, 0);
    });

    await check('HEAD request with Range returns 206 with Content-Length 50 and zero body', async () => {
      const res = await makeRequest('/index.html', {
        method: 'HEAD',
        headers: { Range: 'bytes=0-49' },
      });
      assert.equal(res.statusCode, 206);
      assert.equal(res.headers['content-length'], '50');
      assert.equal(res.headers['content-range'], `bytes 0-49/${fileSize}`);
      assert.equal(res.body.length, 0);
    });

  } finally {
    serverProc.kill();
  }

  const failedCount = suiteResults.filter((r) => r.status === 'FAIL').length;
  console.log(`\n=== SERVER STRESS SUITE: ${suiteResults.length - failedCount} PASSED, ${failedCount} FAILED ===`);
  if (failedCount > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
