import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const TARGET_URL = process.env.TARGET_URL || 'http://127.0.0.1:8080/';

async function runAdversarialTest() {
  console.log('===============================================================');
  console.log('ADVERSARIAL CHALLENGE: Offline Cache & Streaming Latency Stress');
  console.log(`Target: ${TARGET_URL}`);
  console.log('===============================================================\n');

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--enable-features=SharedArrayBuffer',
      '--enable-experimental-web-platform-features',
      '--no-sandbox',
    ],
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  // Track all network requests
  const networkRequests = [];
  page.on('request', (req) => {
    networkRequests.push({ url: req.url(), method: req.method() });
  });

  const consoleLogs = [];
  page.on('console', (msg) => {
    consoleLogs.push({ type: msg.type(), text: msg.text() });
  });

  try {
    // -------------------------------------------------------------------------
    // Phase 1: Cold Boot & First Run (Online)
    // -------------------------------------------------------------------------
    console.log('[Phase 1] Cold boot navigation and initial model compilation...');
    const coldStartNav = Date.now();
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });

    // Assert Secure Context and Cross-Origin Isolation
    const isolation = await page.evaluate(() => ({
      isSecureContext: window.isSecureContext,
      crossOriginIsolated: window.crossOriginIsolated,
      hasSAB: typeof SharedArrayBuffer === 'function',
    }));
    console.log('Browser Isolation State:', isolation);
    assert.equal(isolation.isSecureContext, true, 'Must be a Secure Context');
    assert.equal(isolation.crossOriginIsolated, true, 'Must be Cross-Origin Isolated (COOP/COEP)');
    assert.equal(isolation.hasSAB, true, 'SharedArrayBuffer must be available');

    // Wait for engine to initialize (Cold Boot)
    const coldInitStart = Date.now();
    await page.waitForFunction(() => Boolean(window.__swanadaReady), null, { timeout: 35000 });
    const coldBootDuration = Date.now() - coldInitStart;
    console.log(`Cold boot engine initialization completed in: ${coldBootDuration}ms`);

    // Stream Sanskrit preset clip
    console.log('[Phase 1] Streaming Sanskrit audio clip to measure TTFT and RTF...');
    const streamStart = Date.now();
    let ttft = null;

    // Listen for first partial event to calculate exact Time To First Token (TTFT)
    await page.evaluate(() => {
      window.__firstTokenTime = null;
      window.__swanadaWorkerClient?.on('partial', (data) => {
        if (!window.__firstTokenTime && data && (data.text || data.committed || data.volatile)) {
          window.__firstTokenTime = performance.now();
        }
      });
    });

    // Click preset chip to trigger real Web Audio decoding & streaming
    await page.locator('#presetChips .chip').first().click();

    // Poll until first token is emitted
    const ttftDeadline = Date.now() + 15000;
    while (Date.now() < ttftDeadline) {
      const ft = await page.evaluate(() => window.__firstTokenTime);
      if (ft) {
        ttft = Date.now() - streamStart;
        break;
      }
      await page.waitForTimeout(50);
    }
    console.log(`Cold streaming Time To First Token (TTFT): ${ttft}ms`);
    assert.ok(ttft !== null, 'TTFT must not be null');
    assert.ok(ttft < 2500, `TTFT must be < 2500ms, observed ${ttft}ms`);

    // Wait for streaming completion
    await page.waitForFunction(
      () => document.querySelector('#liveBadge')?.textContent === 'Completed',
      null,
      { timeout: 30000 }
    );

    const firstResult = await page.evaluate(() => ({
      committed: document.querySelector('#committedText')?.textContent?.trim() || '',
      metrics: window.__swanadaMetrics,
      badge: document.querySelector('#liveBadge')?.textContent,
    }));

    console.log('First Run Transcription Result:', firstResult);
    assert.ok(firstResult.committed.length > 0, 'Transcription must not be empty');
    assert.ok(firstResult.metrics, 'Metrics object must exist');
    console.log(`Observed RTF: ${firstResult.metrics.rtf}x`);
    assert.ok(firstResult.metrics.rtf < 1.0, `Streaming RTF must be < 1.0x, got ${firstResult.metrics.rtf}x`);

    // -------------------------------------------------------------------------
    // Phase 2: CacheStorage Verification
    // -------------------------------------------------------------------------
    console.log('\n[Phase 2] Verifying CacheStorage persistence...');
    const cacheInspection = await page.evaluate(async () => {
      if (!('caches' in window)) return { supported: false };
      const cache = await caches.open('swanada-onnx-v1.0.0');
      const keys = await cache.keys();
      const urls = keys.map((k) => k.url);
      return {
        supported: true,
        count: keys.length,
        urls,
      };
    });

    console.log('CacheStorage status:', cacheInspection);
    assert.equal(cacheInspection.supported, true, 'CacheStorage must be supported');
    assert.ok(cacheInspection.count >= 2, `Expected at least 2 cached assets (model + vocab), found ${cacheInspection.count}`);
    const hasModel = cacheInspection.urls.some((u) => u.includes('.onnx'));
    const hasVocab = cacheInspection.urls.some((u) => u.includes('.json'));
    assert.ok(hasModel, 'CacheStorage must contain ONNX model slice');
    assert.ok(hasVocab, 'CacheStorage must contain vocabulary JSON');

    // -------------------------------------------------------------------------
    // Phase 3: Adversarial Offline Persistence (Zero Network Fetch)
    // -------------------------------------------------------------------------
    console.log('\n[Phase 3] Adversarially cutting network (Offline Mode)...');
    networkRequests.length = 0; // reset tracker

    // Set offline in Playwright context
    await context.setOffline(true);

    // Additionally abort any model/vocab network fetches strictly
    let blockedFetches = 0;
    await page.route('**/models/**', (route) => {
      blockedFetches++;
      console.log('ADVERSARIAL BLOCKED ATTEMPTED FETCH:', route.request().url());
      route.abort();
    });

    // In offline mode, re-initialize Sanskrit engine
    console.log('Re-initializing engine while 100% offline...');
    const warmInitStart = Date.now();

    const offlineInitResult = await page.evaluate(async () => {
      const client = window.__swanadaWorkerClient;
      if (!client) throw new Error('Worker client missing');
      // Re-init with explicit language to force loadModelAsset check
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Warm offline init timeout')), 10000);
        client.on('ready', (readyEvt) => {
          clearTimeout(timeout);
          resolve(readyEvt);
        });
        client.init({ language: 'sa' });
      });
    });

    const warmDuration = Date.now() - warmInitStart;
    console.log(`Warm offline initialization completed in: ${warmDuration}ms`);
    console.log('Offline Init Event:', offlineInitResult);
    assert.ok(warmDuration < 1500, `Warm cached load must be instant (<1500ms), took ${warmDuration}ms`);

    // Assert ZERO network fetches were attempted for models
    console.log(`Blocked network fetches during offline init: ${blockedFetches}`);
    assert.equal(blockedFetches, 0, 'Zero network fetches must be made for cached models in offline mode!');

    // Stream audio while offline using pre-loaded audio buffer (simulating mic / dropped file)
    console.log('Streaming audio while 100% offline via client pushAudio...');
    const offlineResult = await page.evaluate(async () => {
      const client = window.__swanadaWorkerClient;
      if (!client) throw new Error('Worker client missing');

      // Pre-generated 16kHz sine / speech PCM frames (3 seconds = 48,000 samples)
      client.startStream();
      const chunkSize = 1600; // 100ms
      const totalSamples = 32000; // 2 seconds

      for (let offset = 0; offset < totalSamples; offset += chunkSize) {
        const chunk = new Float32Array(chunkSize);
        for (let i = 0; i < chunkSize; i++) {
          chunk[i] = Math.sin((2 * Math.PI * 300 * (offset + i)) / 16000) * 0.2;
        }
        client.pushAudio(chunk, false);
        await new Promise((r) => setTimeout(r, 20));
      }

      // Finish stream
      const finalPromise = new Promise((resolve) => {
        const handler = (res) => {
          client.off?.('final', handler);
          resolve(res);
        };
        client.on('final', handler);
      });
      client.finishStream();
      const finalRes = await finalPromise;

      return {
        text: finalRes.text,
        rtf: finalRes.rtf,
        inferenceMs: finalRes.inferenceMs,
        durationMs: finalRes.durationMs,
        tokens: finalRes.tokens,
      };
    });

    console.log('Offline Streaming Result:', offlineResult);
    assert.ok(typeof offlineResult.text === 'string', 'Offline transcription result must exist');
    assert.ok(offlineResult.rtf < 1.0, `Offline RTF must be < 1.0x, got ${offlineResult.rtf}x`);
    assert.equal(blockedFetches, 0, 'Zero network calls made during active offline transcription!');

    // -------------------------------------------------------------------------
    // Phase 4: Continuous Streaming & Latency Stress
    // -------------------------------------------------------------------------
    console.log('\n[Phase 4] Continuous streaming burst and silence stress test...');
    await context.setOffline(false);
    await page.unroute('**/models/**');

    const stressResult = await page.evaluate(async () => {
      const client = window.__swanadaWorkerClient;
      if (!client) throw new Error('Worker client missing');

      // 1. Rapid burst of 10 chunks (1600 samples each = 100ms PCM)
      client.startStream();
      const chunk = new Float32Array(1600);
      for (let i = 0; i < chunk.length; i++) {
        chunk[i] = Math.sin((2 * Math.PI * 440 * i) / 16000) * 0.3; // 440 Hz tone
      }

      const burstLatencies = [];
      let partialCount = 0;
      const partialHandler = (p) => {
        partialCount++;
        if (p.inferenceMs) burstLatencies.push(p.inferenceMs);
      };
      client.on('partial', partialHandler);

      const burstStart = performance.now();
      for (let b = 0; b < 10; b++) {
        const freshChunk = new Float32Array(1600);
        for (let i = 0; i < freshChunk.length; i++) {
          freshChunk[i] = Math.sin((2 * Math.PI * 440 * (b * 1600 + i)) / 16000) * 0.3;
        }
        client.pushAudio(freshChunk, false);
      }
      client.pushAudio(new Float32Array(1600), true);

      // Wait for completion
      await new Promise((resolve) => {
        const h = (res) => {
          client.off?.('final', h);
          resolve(res);
        };
        client.on('final', h);
      });

      const totalBurstTime = performance.now() - burstStart;
      const totalAudioMs = 11 * 100; // 1.1s of audio
      const burstRtf = totalBurstTime / totalAudioMs;

      // 2. Feed 2 seconds of pure silence
      client.startStream();
      const silence = new Float32Array(32000); // 2s of silence
      const silencePromise = new Promise((resolve) => {
        const h = (res) => {
          client.off?.('final', h);
          resolve(res);
        };
        client.on('final', h);
      });
      client.pushAudio(silence, true);
      const silenceRes = await silencePromise;

      return {
        burstRtf,
        totalBurstTime,
        partialCount,
        silenceText: silenceRes.text,
      };
    });

    console.log('Stress Test Telemetry:', stressResult);
    assert.ok(stressResult.burstRtf < 1.0, `Burst RTF must be < 1.0x, got ${stressResult.burstRtf}x`);
    assert.equal(stressResult.silenceText, '', 'Silence must produce empty transcription');

    console.log('\n===============================================================');
    console.log('ALL ADVERSARIAL STRESS CHALLENGES PASSED EMPIRICALLY!');
    console.log('===============================================================');
  } finally {
    await browser.close();
  }
}

runAdversarialTest().catch((err) => {
  console.error('\nADVERSARIAL CHALLENGE FAILURE:', err);
  process.exit(1);
});
