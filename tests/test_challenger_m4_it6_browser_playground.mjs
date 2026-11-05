/**
 * Challenger M4 Iteration 6: Headless Chromium Browser Playground End-to-End Test.
 * Validates serve-playground.mjs serving docs/index.html, Web Worker initialization,
 * window.__swanadaReady, and preset audio streaming in real browser environment.
 * Strictly zero first-person pronouns.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SERVER_SCRIPT = path.resolve(ROOT_DIR, 'serve-playground.mjs');
const TEST_PORT = 4198;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

async function runBrowserPlaygroundTest() {
  console.log('=== STARTING BROWSER PLAYGROUND PLAYWRIGHT E2E SUITE ===');

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

  const pageErrors = [];
  const consoleLogs = [];

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    page.on('pageerror', (err) => {
      console.error(`[Page Error]: ${err.message}`);
      pageErrors.push(err.message);
    });

    page.on('console', (msg) => {
      consoleLogs.push({ type: msg.type(), text: msg.text() });
      if (msg.type() === 'error') {
        console.error(`[Page Console Error]: ${msg.text()}`);
      }
    });

    console.log(`Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

    console.log('Waiting for window.__swanadaReady === true...');
    await page.waitForFunction(() => window.__swanadaReady === true, null, { timeout: 15000 });
    console.log('PASS: window.__swanadaReady is true');

    const statusText = await page.locator('#statusText').innerText();
    console.log(`Status text: ${statusText}`);
    assert.ok(statusText.toUpperCase().includes('SWANADA ENGINE READY'), `Unexpected status text: ${statusText}`);

    // Verify preset chips are present
    const presetChips = page.locator('#presetChips .chip');
    const chipCount = await presetChips.count();
    console.log(`Found ${chipCount} preset chip(s)`);
    assert.ok(chipCount > 0, 'No preset chips found');

    // Click the first preset chip to trigger real speech streaming
    console.log('Clicking first preset chip to initiate audio streaming...');
    await presetChips.first().click();

    // Wait for streaming partial or committed text to populate
    await page.waitForFunction(
      () => {
        const committed = document.querySelector('#committedText')?.textContent?.trim() || '';
        const volatile = document.querySelector('#volatileText')?.textContent?.trim() || '';
        return committed.length > 0 || volatile.length > 0;
      },
      null,
      { timeout: 10000 }
    );

    const committedText = await page.locator('#committedText').innerText();
    const volatileText = await page.locator('#volatileText').innerText();
    const rtfText = await page.locator('#rtfVal').innerText();

    console.log(`Result Committed Text: ${committedText}`);
    console.log(`Result Volatile Text: ${volatileText}`);
    console.log(`Result RTF Value: ${rtfText}`);

    assert.ok(
      committedText.length > 0 || volatileText.length > 0,
      'Both committed and volatile text are empty after streaming preset audio'
    );

    assert.equal(pageErrors.length, 0, `Encountered unexpected page errors: ${pageErrors.join('; ')}`);
    console.log('=== BROWSER PLAYGROUND PLAYWRIGHT E2E SUITE: ALL CHECKS PASSED ===');
  } finally {
    await browser.close();
    serverProc.kill();
  }
}

runBrowserPlaygroundTest().catch((err) => {
  console.error('Fatal browser test error:', err);
  process.exit(1);
});
