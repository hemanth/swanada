/**
 * Challenger M4 Iteration 6: Playground Server Stress & RFC 9110 Compliance Suite.
 * Adversarially validates serve-playground.mjs security, headers, and range parsing.
 * Strictly zero first-person pronouns.
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
const TEST_PORT = 4195;
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
  console.log('=== STARTING CHALLENGER M4 ITERATION 6 SERVER STRESS SUITE ===');

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

  for (let attempt = 0; attempt < 50; attempt++) {
    if (serverReady) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(serverReady, 'Server failed to start within 5 seconds');

  const indexStat = fs.statSync(path.resolve(ROOT_DIR, 'docs', 'index.html'));
  const indexSize = indexStat.size;
  const indexBytes = fs.readFileSync(path.resolve(ROOT_DIR, 'docs', 'index.html'));

  const preprocessorStat = fs.statSync(path.resolve(ROOT_DIR, 'models', 'preprocessor.onnx'));
  const preprocessorSize = preprocessorStat.size;
  const preprocessorBytes = fs.readFileSync(path.resolve(ROOT_DIR, 'models', 'preprocessor.onnx'));

  const swanadaStat = fs.statSync(path.resolve(ROOT_DIR, 'docs', 'swanada.mjs'));
  const swanadaSize = swanadaStat.size;
  const swanadaBytes = fs.readFileSync(path.resolve(ROOT_DIR, 'docs', 'swanada.mjs'));

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
    // Suite 1: Security and Isolation Headers (COOP / COEP / CORS)
    // -------------------------------------------------------------
    console.log('\n--- 1. Security & Cross-Origin Isolation Headers ---');

    await check('COOP, COEP, CORP, and CORS headers on root /', async () => {
      const res = await makeRequest('/');
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['cross-origin-opener-policy'], 'same-origin');
      assert.equal(res.headers['cross-origin-embedder-policy'], 'require-corp');
      assert.equal(res.headers['cross-origin-resource-policy'], 'cross-origin');
      assert.equal(res.headers['access-control-allow-origin'], '*');
      assert.equal(res.headers['accept-ranges'], 'bytes');
    });

    await check('COOP, COEP, CORP, and CORS headers on /models/preprocessor.onnx', async () => {
      const res = await makeRequest('/models/preprocessor.onnx');
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['cross-origin-opener-policy'], 'same-origin');
      assert.equal(res.headers['cross-origin-embedder-policy'], 'require-corp');
      assert.equal(res.headers['cross-origin-resource-policy'], 'cross-origin');
      assert.equal(res.headers['accept-ranges'], 'bytes');
    });

    await check('COOP, COEP, CORP, and CORS headers on /dist/index.mjs', async () => {
      const res = await makeRequest('/dist/index.mjs');
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['cross-origin-opener-policy'], 'same-origin');
      assert.equal(res.headers['cross-origin-embedder-policy'], 'require-corp');
      assert.equal(res.headers['cross-origin-resource-policy'], 'cross-origin');
    });

    // -------------------------------------------------------------
    // Suite 2: RFC 9110 HTTP Range Requests (206 & 416)
    // -------------------------------------------------------------
    console.log('\n--- 2. RFC 9110 HTTP Range Requests ---');

    await check('Suffix Range bytes=-500 on index.html returns 206 with exact last 500 bytes', async () => {
      const res = await makeRequest('/index.html', {
        headers: { Range: 'bytes=-500' },
      });
      assert.equal(res.statusCode, 206);
      assert.equal(res.headers['content-range'], `bytes ${indexSize - 500}-${indexSize - 1}/${indexSize}`);
      assert.equal(res.headers['content-length'], '500');
      assert.equal(res.body.length, 500);
      assert.deepEqual(res.body, indexBytes.subarray(indexSize - 500));
    });

    await check('Suffix Range bytes=-500 on /models/preprocessor.onnx returns 206 with exact last 500 bytes', async () => {
      const res = await makeRequest('/models/preprocessor.onnx', {
        headers: { Range: 'bytes=-500' },
      });
      assert.equal(res.statusCode, 206);
      assert.equal(res.headers['content-range'], `bytes ${preprocessorSize - 500}-${preprocessorSize - 1}/${preprocessorSize}`);
      assert.equal(res.headers['content-length'], '500');
      assert.equal(res.body.length, 500);
      assert.deepEqual(res.body, preprocessorBytes.subarray(preprocessorSize - 500));
    });

    await check('Suffix Range bytes=-500 on /swanada.mjs returns 206 with exact last 500 bytes', async () => {
      const res = await makeRequest('/swanada.mjs', {
        headers: { Range: 'bytes=-500' },
      });
      assert.equal(res.statusCode, 206);
      assert.equal(res.headers['content-range'], `bytes ${swanadaSize - 500}-${swanadaSize - 1}/${swanadaSize}`);
      assert.equal(res.headers['content-length'], '500');
      assert.equal(res.body.length, 500);
      assert.deepEqual(res.body, swanadaBytes.subarray(swanadaSize - 500));
    });

    await check('Standard Range bytes=0-499 on index.html returns 206 with first 500 bytes', async () => {
      const res = await makeRequest('/index.html', {
        headers: { Range: 'bytes=0-499' },
      });
      assert.equal(res.statusCode, 206);
      assert.equal(res.headers['content-range'], `bytes 0-499/${indexSize}`);
      assert.equal(res.headers['content-length'], '500');
      assert.equal(res.body.length, 500);
      assert.deepEqual(res.body, indexBytes.subarray(0, 500));
    });

    await check('Middle Range bytes=1000-1499 on /models/preprocessor.onnx returns 206 with exact slice', async () => {
      const res = await makeRequest('/models/preprocessor.onnx', {
        headers: { Range: 'bytes=1000-1499' },
      });
      assert.equal(res.statusCode, 206);
      assert.equal(res.headers['content-range'], `bytes 1000-1499/${preprocessorSize}`);
      assert.equal(res.headers['content-length'], '500');
      assert.equal(res.body.length, 500);
      assert.deepEqual(res.body, preprocessorBytes.subarray(1000, 1500));
    });

    await check('Single-byte Range bytes=0-0 returns 206 with first byte', async () => {
      const res = await makeRequest('/index.html', {
        headers: { Range: 'bytes=0-0' },
      });
      assert.equal(res.statusCode, 206);
      assert.equal(res.headers['content-range'], `bytes 0-0/${indexSize}`);
      assert.equal(res.headers['content-length'], '1');
      assert.equal(res.body.length, 1);
      assert.equal(res.body[0], indexBytes[0]);
    });

    await check('Last single-byte Range bytes=-1 returns 206 with last byte', async () => {
      const res = await makeRequest('/index.html', {
        headers: { Range: 'bytes=-1' },
      });
      assert.equal(res.statusCode, 206);
      assert.equal(res.headers['content-range'], `bytes ${indexSize - 1}-${indexSize - 1}/${indexSize}`);
      assert.equal(res.headers['content-length'], '1');
      assert.equal(res.body.length, 1);
      assert.equal(res.body[0], indexBytes[indexSize - 1]);
    });

    await check('Open-ended Range bytes=50000- returns 206 to EOF', async () => {
      const res = await makeRequest('/index.html', {
        headers: { Range: 'bytes=50000-' },
      });
      if (50000 < indexSize) {
        assert.equal(res.statusCode, 206);
        assert.equal(res.headers['content-range'], `bytes 50000-${indexSize - 1}/${indexSize}`);
        assert.equal(res.headers['content-length'], String(indexSize - 50000));
        assert.equal(res.body.length, indexSize - 50000);
      } else {
        assert.equal(res.statusCode, 416);
      }
    });

    await check('Suffix Range bytes=-0 yields 416 Range Not Satisfiable', async () => {
      const res = await makeRequest('/index.html', {
        headers: { Range: 'bytes=-0' },
      });
      assert.equal(res.statusCode, 416);
      assert.equal(res.headers['content-range'], `bytes */${indexSize}`);
    });

    await check('Out-of-bounds start range bytes=99999999- yields 416', async () => {
      const res = await makeRequest('/index.html', {
        headers: { Range: 'bytes=99999999-' },
      });
      assert.equal(res.statusCode, 416);
      assert.equal(res.headers['content-range'], `bytes */${indexSize}`);
    });

    await check('Inverted range bytes=500-200 yields 416', async () => {
      const res = await makeRequest('/index.html', {
        headers: { Range: 'bytes=500-200' },
      });
      assert.equal(res.statusCode, 416);
      assert.equal(res.headers['content-range'], `bytes */${indexSize}`);
    });

    await check('Empty range bytes=- yields 416', async () => {
      const res = await makeRequest('/index.html', {
        headers: { Range: 'bytes=-' },
      });
      assert.equal(res.statusCode, 416);
      assert.equal(res.headers['content-range'], `bytes */${indexSize}`);
    });

    await check('Malformed range syntax bytes=invalid-range falls back to 200 OK', async () => {
      const res = await makeRequest('/index.html', {
        headers: { Range: 'bytes=invalid-range' },
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.length, indexSize);
    });

    // -------------------------------------------------------------
    // Suite 3: Malformed URIs and Decoding Resiliency
    // -------------------------------------------------------------
    console.log('\n--- 3. Malformed URIs and Decoding Resiliency ---');

    await check('Malformed URI sequence /%E0%A4% yields 400 Bad Request', async () => {
      const res = await makeRequest('/%E0%A4%');
      assert.equal(res.statusCode, 400);
      assert.ok(res.body.toString().includes('Bad Request'));
    });

    await check('Malformed URI sequence /%e0%a0 yields 400 Bad Request', async () => {
      const res = await makeRequest('/%e0%a0');
      assert.equal(res.statusCode, 400);
      assert.ok(res.body.toString().includes('Bad Request'));
    });

    await check('Malformed URI sequence /%c0%af yields 400 Bad Request', async () => {
      const res = await makeRequest('/%c0%af');
      assert.equal(res.statusCode, 400);
      assert.ok(res.body.toString().includes('Bad Request'));
    });

    await check('Malformed URI sequence /%ff yields 400 Bad Request', async () => {
      const res = await makeRequest('/%ff');
      assert.equal(res.statusCode, 400);
      assert.ok(res.body.toString().includes('Bad Request'));
    });

    await check('Malformed URI incomplete percent /% yields 400 Bad Request', async () => {
      const res = await makeRequest('/%');
      assert.equal(res.statusCode, 400);
      assert.ok(res.body.toString().includes('Bad Request'));
    });

    await check('Malformed URI single hex digit /%2 yields 400 Bad Request', async () => {
      const res = await makeRequest('/%2');
      assert.equal(res.statusCode, 400);
      assert.ok(res.body.toString().includes('Bad Request'));
    });

    // -------------------------------------------------------------
    // Suite 4: Path Traversal Defenses
    // -------------------------------------------------------------
    console.log('\n--- 4. Path Traversal Defenses ---');

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

    await check('Encoded dot traversal /%2e%2e%2fpackage.json yields 403 Forbidden', async () => {
      const res = await makeRequest('/%2e%2e%2fpackage.json');
      assert.equal(res.statusCode, 403);
      assert.ok(res.body.toString().includes('Forbidden'));
    });

    await check('Raw path traversal /../../etc/passwd yields 404 without data leak', async () => {
      const res = await makeRequest('/../../etc/passwd');
      assert.equal(res.statusCode, 404);
      assert.ok(!res.body.toString().includes('root:'));
    });

    await check('Raw path traversal /dist/../../../package.json yields 404 without data leak', async () => {
      const res = await makeRequest('/dist/../../../package.json');
      assert.equal(res.statusCode, 404);
      assert.ok(!res.body.toString().includes('"name": "swanada"'));
    });

    await check('Raw path traversal /models/../../etc/passwd yields 404 without data leak', async () => {
      const res = await makeRequest('/models/../../etc/passwd');
      assert.equal(res.statusCode, 404);
      assert.ok(!res.body.toString().includes('root:'));
    });

    // -------------------------------------------------------------
    // Suite 5: HTTP Methods and HEAD Handling
    // -------------------------------------------------------------
    console.log('\n--- 5. HTTP Methods and HEAD Handling ---');

    await check('OPTIONS returns 204 No Content with CORS headers', async () => {
      const res = await makeRequest('/index.html', { method: 'OPTIONS' });
      assert.equal(res.statusCode, 204);
      assert.equal(res.headers['access-control-allow-origin'], '*');
      assert.equal(res.body.length, 0);
    });

    await check('POST returns 405 Method Not Allowed', async () => {
      const res = await makeRequest('/index.html', { method: 'POST' });
      assert.equal(res.statusCode, 405);
      assert.ok(res.body.toString().includes('Method Not Allowed'));
    });

    await check('PUT returns 405 Method Not Allowed', async () => {
      const res = await makeRequest('/index.html', { method: 'PUT' });
      assert.equal(res.statusCode, 405);
      assert.ok(res.body.toString().includes('Method Not Allowed'));
    });

    await check('DELETE returns 405 Method Not Allowed', async () => {
      const res = await makeRequest('/index.html', { method: 'DELETE' });
      assert.equal(res.statusCode, 405);
      assert.ok(res.body.toString().includes('Method Not Allowed'));
    });

    await check('HEAD returns 200 with Content-Length and 0-byte body', async () => {
      const res = await makeRequest('/index.html', { method: 'HEAD' });
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['content-length'], String(indexSize));
      assert.equal(res.body.length, 0);
    });

    await check('HEAD with Range: bytes=0-499 returns 206 with Content-Length: 500 and 0-byte body', async () => {
      const res = await makeRequest('/index.html', {
        method: 'HEAD',
        headers: { Range: 'bytes=0-499' },
      });
      assert.equal(res.statusCode, 206);
      assert.equal(res.headers['content-range'], `bytes 0-499/${indexSize}`);
      assert.equal(res.headers['content-length'], '500');
      assert.equal(res.body.length, 0);
    });

  } finally {
    serverProc.kill();
  }

  const failedCount = suiteResults.filter((r) => r.status === 'FAIL').length;
  console.log(`\n=== SERVER STRESS SUITE RESULTS: ${suiteResults.length - failedCount} PASSED, ${failedCount} FAILED ===`);
  if (failedCount > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
