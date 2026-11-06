/**
 * Milestone 5 Gate Verification: Adversarial Browser Playground Streaming E2E Harness.
 * Validates that playAndStreamPreset() in docs/index.html preserves final transcribed text
 * upon stream completion across multiple languages and does NOT erase #committedText.
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
const TEST_PORT = 4195;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

async function runBrowserStreamingPreservationTest() {
  console.log('=== STARTING BROWSER PLAYGROUND STREAMING PRESERVATION HARNESS ===');

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
  const consoleErrors = [];

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
      if (msg.type() === 'error') {
        console.error(`[Page Console Error]: ${msg.text()}`);
        consoleErrors.push(msg.text());
      }
    });

    console.log(`Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

    console.log('Waiting for engine initial cold boot...');
    await page.waitForFunction(() => window.__swanadaReady === true, null, { timeout: 20000 });
    console.log('PASS: Engine initialized and window.__swanadaReady is true');

    const testLanguages = ['sa', 'hi', 'en'];

    for (const lang of testLanguages) {
      console.log(`\n--- Testing Streaming Preset for Language: [${lang}] ---`);

      // Switch language tab if needed
      const tabButton = page.locator(`.lang-btn[data-lang="${lang}"]`);
      await tabButton.click();

      // Wait for language to be active and engine ready
      await page.waitForFunction(
        (targetLang) => window.__swanadaLoadedLang === targetLang && window.__swanadaReady === true,
        lang,
        { timeout: 15000 }
      );

      const presetChip = page.locator('#presetChips .chip').first();
      await page.waitForTimeout(500);

      // Read chip label text
      const chipLabel = (await presetChip.innerText()).trim();
      console.log(`Clicking preset chip: "${chipLabel}"`);
      await presetChip.click();

      // Monitor streaming activity
      console.log('Waiting for #liveBadge to transition to Completed...');
      await page.waitForFunction(
        () => {
          const badge = document.querySelector('#liveBadge')?.textContent?.trim() || '';
          return badge === 'Completed';
        },
        null,
        { timeout: 25000 }
      );

      const committedTextAfterComplete = (await page.locator('#committedText').innerText()).trim();
      const volatileTextAfterComplete = (await page.locator('#volatileText').innerText()).trim();
      const liveBadgeText = (await page.locator('#liveBadge').innerText()).trim();

      console.log(`At completion for [${lang}]:`);
      console.log(`  liveBadge: "${liveBadgeText}"`);
      console.log(`  committedText: "${committedTextAfterComplete}"`);
      console.log(`  volatileText: "${volatileTextAfterComplete}"`);

      assert.equal(liveBadgeText.toUpperCase(), 'COMPLETED', `Live badge is not Completed for ${lang}`);
      assert.ok(
        committedTextAfterComplete.length > 0,
        `FAILURE: #committedText was erased to empty string upon stream completion for language [${lang}]!`
      );
      assert.equal(
        volatileTextAfterComplete,
        '',
        `FAILURE: #volatileText is not empty after stream completion for language [${lang}]`
      );

      // Verify that after an additional 1500ms delay, #committedText is NOT erased by delayed callbacks
      console.log('Checking stability 1500ms after completion...');
      await page.waitForTimeout(1500);

      const committedTextDelayed = (await page.locator('#committedText').innerText()).trim();
      console.log(`After 1500ms delay for [${lang}]: committedText: "${committedTextDelayed}"`);

      assert.equal(
        committedTextDelayed,
        committedTextAfterComplete,
        `FAILURE: #committedText mutated or erased after completion delay for [${lang}]`
      );
    }

    assert.equal(pageErrors.length, 0, `Page errors encountered: ${pageErrors.join('; ')}`);
    assert.equal(consoleErrors.length, 0, `Console errors encountered: ${consoleErrors.join('; ')}`);
    console.log('\n=== BROWSER PLAYGROUND STREAMING PRESERVATION: ALL CHECKS PASSED ===');
  } finally {
    await browser.close();
    serverProc.kill();
  }
}

runBrowserStreamingPreservationTest().catch((err) => {
  console.error('Fatal browser streaming test failure:', err);
  process.exit(1);
});
