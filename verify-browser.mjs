#!/usr/bin/env node
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = __dirname;
const PORT = Number(process.env.PORT || 4192);
const TARGET_URL = process.env.TARGET_URL || `http://127.0.0.1:${PORT}/`;
const USE_LOCAL_SERVER = !process.env.TARGET_URL;
const LOCK_FILE = '/tmp/swanada_verify_browser.lock';
let activeLockRelease = null;

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireBrowserLock(lockPath = LOCK_FILE, timeoutMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
      fs.writeSync(fd, `${process.pid}\n`);
      fs.closeSync(fd);
      let released = false;
      return () => {
        if (!released) {
          released = true;
          try { fs.unlinkSync(lockPath); } catch {}
        }
      };
    } catch (e) {
      if (e.code === 'EEXIST') {
        try {
          const content = fs.readFileSync(lockPath, 'utf8').trim();
          const pid = Number(content);
          if (pid && !isProcessAlive(pid)) {
            try { fs.unlinkSync(lockPath); } catch {}
            continue;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 500));
      } else {
        throw e;
      }
    }
  }
  throw new Error(`Timed out waiting for verify-browser lock: ${lockPath} after ${timeoutMs}ms`);
}

process.on('exit', () => {
  if (activeLockRelease) {
    try { activeLockRelease(); } catch {}
  }
});
process.on('SIGINT', () => {
  if (activeLockRelease) {
    try { activeLockRelease(); } catch {}
  }
  process.exit(130);
});
process.on('SIGTERM', () => {
  if (activeLockRelease) {
    try { activeLockRelease(); } catch {}
  }
  process.exit(143);
});

async function waitForServer(url, timeoutMs = 15000) {
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
  console.log('=== Swanada Automated Headless Browser Verification ===');
  const releaseLock = await acquireBrowserLock();
  activeLockRelease = releaseLock;

  const server = USE_LOCAL_SERVER
    ? spawn(process.execPath, ['serve-playground.mjs'], {
        cwd: ROOT_DIR,
        env: { ...process.env, PORT: String(PORT) },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    : null;

  let browser = null;

  try {
    if (server) {
      console.log(`Starting local server on port ${PORT}...`);
      await waitForServer(TARGET_URL);
      console.log(`Server healthy at ${TARGET_URL}`);
    }

    const launchOpts = {
      headless: true,
      args: [
        '--autoplay-policy=no-user-gesture-required',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
      ],
    };
    if (process.env.BROWSER_CHANNEL) {
      launchOpts.channel = process.env.BROWSER_CHANNEL;
    }

    browser = await chromium.launch(launchOpts);
    const context = await browser.newContext({ viewport: { width: 1280, height: 920 } });
    const page = await context.newPage();

    const errors = [];
    const onnxRequests = [];

    await context.route('**/*.onnx*', async (route) => {
      onnxRequests.push(route.request().url());
      await route.continue();
    });

    page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`CONSOLE_ERROR: ${msg.text()}`);
    });

    console.log('Navigating to playground...');
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });

    // Step 1: Verify Cross-Origin Isolation (COOP/COEP)
    const coi = await page.evaluate(() => Boolean(window.crossOriginIsolated));
    assert.equal(coi, true, 'Expected window.crossOriginIsolated === true under COOP/COEP isolation');
    console.log('Step 1 Passed: Cross-Origin Isolation verified.');

    // Step 2: Cold boot verification (Sanskrit model loads by default)
    console.log('Waiting for engine cold boot (sa)...');
    await page.waitForFunction(() => window.__swanadaReady === true, null, { timeout: 30000 });

    const postLoadState = await page.evaluate(() => ({
      ready: Boolean(window.__swanadaReady),
      loadedLang: window.__swanadaLoadedLang,
      langBtnCount: document.querySelectorAll('.lang-btn').length,
      hasWorker: Boolean(window.__swanadaWorkerClient),
      statusText: document.getElementById('statusText')?.textContent || '',
    }));

    assert.equal(postLoadState.ready, true);
    assert.equal(postLoadState.loadedLang, 'sa');
    assert.equal(postLoadState.langBtnCount, 12, 'Expected all 12 language tabs in playground UI');
    assert.ok(postLoadState.statusText.includes('(SA)'));
    console.log('Step 2 Passed: Cold engine initialization and language tabs verified.');

    // Step 3: Preset audio streaming and Double-FINAL regression verification
    console.log('Clicking preset audio chip and streaming chunks...');
    await page.locator('#presetChips .chip').first().click();

    // Verify oscilloscope activates
    await page.waitForFunction(() => {
      const badge = document.querySelector('#liveBadge')?.textContent;
      return badge === 'Streaming...' || badge === 'Completed';
    }, null, { timeout: 10000 });

    // Wait for completion
    await page.waitForFunction(() => document.querySelector('#liveBadge')?.textContent === 'Completed', null, { timeout: 25000 });

    // Double-FINAL regression assertion: wait 400ms to guarantee no delayed second empty FINAL triggers
    await new Promise((r) => setTimeout(r, 400));

    const streamingResult = await page.evaluate(() => ({
      committedText: document.querySelector('#committedText')?.textContent || '',
      volatileText: document.querySelector('#volatileText')?.textContent || '',
      iastDisplay: document.querySelector('#iastBox')?.style.display,
      iastContent: document.querySelector('#iastBox')?.textContent || '',
      badge: document.querySelector('#liveBadge')?.textContent,
      metrics: window.__swanadaMetrics,
      pillCount: document.querySelectorAll('#tokenRibbon .token-pill').length,
    }));

    console.log('Streaming Transcription Result:', streamingResult);
    assert.ok(
      streamingResult.committedText.trim().length > 0,
      'Double-FINAL Regression Failed: committed text was erased to empty string!'
    );
    assert.equal(streamingResult.iastDisplay, 'block', 'IAST transliteration box should be visible for Sanskrit');
    assert.ok(streamingResult.iastContent.trim().length > 0, 'IAST transliterated text should not be empty');
    assert.ok(streamingResult.metrics, 'Metrics object must be populated on completion');
    console.log('Step 3 Passed: Audio streaming, non-empty transcript, and double-FINAL regression resolved.');

    // Step 4: Multi-language tab switching verification
    console.log('Testing language tab switching (kn, hi, en)...');
    
    // Switch to Kannada
    await page.locator('.lang-btn[data-lang="kn"]').click();
    await page.waitForFunction(() => window.__swanadaLoadedLang === 'kn', null, { timeout: 25000 });
    const knStatus = await page.locator('#statusText').innerText();
    const knIastDisplay = await page.evaluate(() => document.querySelector('#iastBox')?.style.display);
    assert.ok(knStatus.toUpperCase().includes('(KN)'), `Status should contain (KN), got ${knStatus}`);
    assert.ok(!knStatus.toUpperCase().includes('(SA)'), `Status should not retain (SA) on tab switch`);
    assert.equal(knIastDisplay, 'none', 'IAST box must be hidden when active language is not Sanskrit');

    // Switch to Hindi
    await page.locator('.lang-btn[data-lang="hi"]').click();
    await page.waitForFunction(() => window.__swanadaLoadedLang === 'hi', null, { timeout: 25000 });
    const hiStatus = await page.locator('#statusText').innerText();
    assert.ok(hiStatus.toUpperCase().includes('(HI)'), `Status should contain (HI), got ${hiStatus}`);

    // Switch to English
    await page.locator('.lang-btn[data-lang="en"]').click();
    await page.waitForFunction(() => window.__swanadaLoadedLang === 'en', null, { timeout: 25000 });
    const enStatus = await page.locator('#statusText').innerText();
    assert.ok(enStatus.toUpperCase().includes('(EN)'), `Status should contain (EN), got ${enStatus}`);

    console.log('Step 4 Passed: Multi-language tab switching and activeLanguage closure verified.');

    // Step 5: CacheStorage persistence check
    const cacheReady = await page.evaluate(async () => {
      if (!('caches' in window)) return false;
      const cache = await caches.open('swanada-onnx-v1.0.0');
      const keys = await cache.keys();
      return keys.length > 0;
    });
    assert.equal(cacheReady, true, 'Expected swanada-onnx-v1.0.0 CacheStorage to be populated');
    console.log('Step 5 Passed: Offline CacheStorage persistence verified.');

    // Step 6: Code snippet tabs and syntax highlighting
    const snippetCheck = await page.evaluate(() => {
      const tabs = document.querySelectorAll('.code-tab');
      const kw = document.querySelectorAll('.tok-kw').length;
      const str = document.querySelectorAll('.tok-str').length;
      return { tabCount: tabs.length, kwCount: kw, strCount: str };
    });
    assert.equal(snippetCheck.tabCount, 4, 'Expected 4 developer code snippet tabs');
    assert.ok(snippetCheck.kwCount > 0 && snippetCheck.strCount > 0, 'Syntax highlighting tokens should exist');
    console.log('Step 6 Passed: Code snippet tabs and high-contrast syntax tokens verified.');

    // Step 7: Viewport responsiveness without horizontal overflow
    const viewports = [
      { width: 360, height: 740 },
      { width: 390, height: 844 },
      { width: 412, height: 915 },
      { width: 1280, height: 800 },
    ];
    for (const vp of viewports) {
      await page.setViewportSize(vp);
      const overflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth - document.documentElement.clientWidth;
      });
      assert.ok(overflow <= 1, `Horizontal scroll overflow detected at ${vp.width}x${vp.height}: ${overflow}px`);
    }
    console.log('Step 7 Passed: Mobile and desktop viewport responsiveness verified.');

    // Assert strictly zero console errors and zero page errors
    assert.equal(errors.length, 0, `Strict zero console/page errors violated: ${errors.join('; ')}`);
    console.log('Step 8 Passed: Strictly 0 unhandled console/page errors.');

    console.log('\n=== ALL BROWSER VERIFICATIONS PASSED (Exit 0) ===');
  } finally {
    if (browser) await browser.close();
    if (server) {
      server.kill('SIGTERM');
    }
    if (activeLockRelease) {
      activeLockRelease();
      activeLockRelease = null;
    }
  }
}

main().catch((err) => {
  console.error('\nFAIL verify-browser:', err);
  process.exit(1);
});
