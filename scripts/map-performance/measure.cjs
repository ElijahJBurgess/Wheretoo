const { createRequire } = require('node:module');
const req = createRequire(process.cwd() + '/package.json');
const { chromium } = req('@playwright/test');
const fs = require('node:fs');
(async () => {
    const target = process.env.MAP_PERFORMANCE_URL;
    if (!['http://127.0.0.1:3113', 'http://127.0.0.1:3114', 'https://wheretoo-staging.vercel.app'].includes(target))
        throw new Error('Unsupported performance target');
    const output = process.env.MAP_PERFORMANCE_OUTPUT;
    if (!output || !process.env.MAP_PERFORMANCE_SEED)
        throw new Error('Supply output and isolated seed paths');
    let seed = fs.existsSync(process.env.MAP_PERFORMANCE_SEED) ? JSON.parse(fs.readFileSync(process.env.MAP_PERFORMANCE_SEED)) : null;
    if (!process.env.LIVE && !seed)
        throw new Error('Capture a public seed with LIVE=1 before fixture measurements');
    if (seed && (!Array.isArray(seed) || seed.length === 0))
        throw new Error('Expected a nonempty public event seed');
    const browser = await chromium.launch({ channel: "chrome", headless: false });
    const gpuSession = await browser.newBrowserCDPSession();
    const gpu = (await gpuSession.send('SystemInfo.getInfo')).gpu.devices;
    const results = [];
    try {
        for (const mobile of [process.env.MOBILE === "1"])
            for (const count of [Number(process.env.COUNT || 9)]) {
                if (![9, 500, 2000].includes(count))
                    throw new Error('Expected 9, 500 or 2000 events');
                const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 720 }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
                const page = await context.newPage();
                const calls = [];
                const failures = [];
                let phase = 'startup';
                await page.addInitScript(() => {
                    window.audit = { commits: [], frames: [], renders: [], updates: [], images: [], maps: 0 };
                    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, inject: () => 1, onCommitFiberRoot: () => window.audit.commits.push(performance.now()), onCommitFiberUnmount: () => { } };
                    const obs = new MutationObserver(() => {
                        const c = document.querySelector('[data-renderer-state="ready"]');
                        if (c && !window.audit.ready)
                            window.audit.ready = performance.now();
                        if (c && !document.querySelector('.map-startup') && !window.audit.usable)
                            window.audit.usable = performance.now();
                    });
                    obs.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-renderer-state'] });
                });
                await page.route('**/rest/v1/**', async (route) => {
                    const r = route.request(), path = new URL(r.url()).pathname;
                    if (!['/rest/v1/rpc/get_public_map_events', '/rest/v1/rpc/get_public_map_icon_versions'].includes(path)) {
                        await route.abort();
                        return;
                    }
                    const start = Date.now();
                    const row = { type: path.split('/').pop(), phase, start, body: r.postDataJSON() };
                    calls.push(row);
                    if (path.endsWith('get_public_map_events')) {
                        if (process.env.LIVE) {
                            const response = await route.fetch();
                            const rows = await response.json();
                            row.records = rows.length;
                            if (!seed) {
                                seed = rows;
                                fs.writeFileSync(process.env.MAP_PERFORMANCE_SEED, JSON.stringify(seed), { mode: 0o600 });
                            }
                            row.range = response.headers()['content-range'];
                            await route.fulfill({ response });
                        }
                        else {
                            const rows = Array.from({ length: count }, (_, i) => ({ ...seed[i % seed.length], event_id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, title: `Isolated audit event ${i + 1}`, longitude: -122.263 + ((i % 25) - 12) * .00025, latitude: 37.804 + (Math.floor(i / 25) % 25 - 12) * .00025 }));
                            await new Promise(r => setTimeout(r, 100));
                            await route.fulfill({ json: rows, headers: { 'content-range': `0-${rows.length - 1}/${rows.length}`, 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' } });
                        }
                    }
                    else {
                        const response = await route.fetch();
                        await response.body();
                        await route.fulfill({ response });
                    }
                    row.ms = Date.now() - start;
                });
                page.on('requestfailed', r => failures.push({ host: new URL(r.url()).hostname, error: r.failure()?.errorText }));
                const start = Date.now();
                await page.goto(target + '/map', { waitUntil: 'domcontentloaded' });
                await page.waitForSelector('[data-renderer-state="ready"]', { timeout: 60000 });
                await page.evaluate(() => {
                    let f = Object.entries(document.querySelector('.living-map__canvas')).find(([k]) => k.startsWith('__reactFiber'))?.[1];
                    while (f) {
                        let h = f.memoizedState;
                        while (h) {
                            const v = h.memoizedState?.current;
                            if (v && typeof v.getSource === 'function' && typeof v.project === 'function') {
                                window.map = v;
                                return;
                            }
                            h = h.next;
                        }
                        f = f.return;
                    }
                    throw Error('map ref missing');
                });
                await page.waitForFunction(() => window.map.getSource('wheretoo-events')?._data?.features?.length > 0);
                await page.waitForTimeout(2500);
                const cdp = await context.newCDPSession(page);
                await cdp.send('Performance.enable');
                if (process.env.MAP_PERFORMANCE_GC)
                    await cdp.send('HeapProfiler.collectGarbage');
                const before = await cdp.send('Performance.getMetrics');
                await page.evaluate(() => {
                    const m = window.map;
                    window.audit.reconciles = [];
                    let f = Object.entries(document.querySelector('.living-map__canvas')).find(([k]) => k.startsWith('__reactFiber'))?.[1];
                    findController: while (f) {
                        let h = f.memoizedState;
                        while (h) {
                            const v = h.memoizedState?.current;
                            if (v && typeof v.reconcile === 'function' && typeof v.setEvents === 'function') {
                                window.perfController = v;
                                const old = v.reconcile;
                                v.reconcile = function (...args) {
                                    const t = performance.now();
                                    try {
                                        return old.apply(this, args);
                                    }
                                    finally {
                                        window.audit.reconciles.push(performance.now() - t);
                                    }
                                };
                                break findController;
                            }
                            h = h.next;
                        }
                        f = f.return;
                    }
                    window.audit.initialFeatures = m.getSource('wheretoo-events')._data.features.length;
                    window.audit.initialImages = m.listImages().filter(x => x.startsWith('wheretoo')).length;
                    for (const id of ['wheretoo-events', 'wheretoo-selected-event']) {
                        const s = m.getSource(id), old = s.setData;
                        s.setData = function (d) {
                            const t = performance.now(), n = d.features.length;
                            window.audit.updates.push({ id, t, n });
                            const handler = e => {
                                if (e.sourceId === id && e.isSourceLoaded) {
                                    window.audit.updates.push({ id, done: performance.now(), n });
                                    m.off('sourcedata', handler);
                                }
                            };
                            m.on('sourcedata', handler);
                            return old.call(this, d);
                        };
                    }
                    for (const method of ['addImage', 'removeImage']) {
                        const old = m[method];
                        m[method] = function (...a) { window.audit.images.push({ method, id: a[0], t: performance.now() }); return old.apply(this, a); };
                    }
                    m.on('render', () => window.audit.renders.push(performance.now()));
                });
                phase = 'interaction';
                await page.evaluate(async () => {
                    window.audit.interactionStart = performance.now();
                    let running = true, last = performance.now();
                    const tick = t => {
                        if (!running)
                            return;
                        window.audit.frames.push(t - last);
                        last = t;
                        requestAnimationFrame(tick);
                    };
                    requestAnimationFrame(tick);
                    const m = window.map;
                    for (const [dx, z] of [[.001, 15.2], [-.001, 14.8], [.001, 15.4], [-.001, 14.6]]) {
                        await new Promise(resolve => { m.once('moveend', resolve); m.easeTo({ center: [-122.263 + dx, 37.804], zoom: z, duration: 800 }); });
                        await new Promise(r => setTimeout(r, 600));
                    }
                    running = false;
                    window.audit.interactionEnd = performance.now();
                });
                phase = 'noop';
                await page.evaluate(() => {
                    for (let i = 0; i < 3; i++)
                        window.map.fire('moveend');
                });
                await page.waitForTimeout(1000);
                phase = 'focus';
                await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
                await page.waitForTimeout(1000);
                phase = 'cluster';
                const cluster = await page.evaluate(async () => {
                    const m = window.map;
                    m.jumpTo({ zoom: 13 });
                    await new Promise(r => setTimeout(r, 800));
                    const features = m.querySourceFeatures('wheretoo-events', { filter: ['has', 'point_count'] });
                    const c = features.sort((a, b) => b.properties.point_count - a.properties.point_count)[0];
                    if (!c)
                        return null;
                    const s = m.getSource('wheretoo-events'), t = performance.now();
                    const z = await new Promise((res, rej) => s.getClusterExpansionZoom(c.properties.cluster_id, (e, z) => e ? rej(e) : res(z)));
                    const leaves = await new Promise((res, rej) => s.getClusterLeaves(c.properties.cluster_id, c.properties.point_count, 0, (e, l) => e ? rej(e) : res(l)));
                    return { count: c.properties.point_count, leaves: leaves.length, ms: performance.now() - t, zoom: z };
                });
                if (process.env.MAP_PERFORMANCE_GC)
                    await cdp.send('HeapProfiler.collectGarbage');
                const after = await cdp.send('Performance.getMetrics');
                const data = await page.evaluate(() => { const a = window.audit, s = [...a.frames].sort((x, y) => x - y); return { ...a, frames: undefined, frameSummary: { n: s.length, p50: s[Math.floor(s.length * .5)], p95: s[Math.floor(s.length * .95)], over33: s.filter(x => x > 33.4).length, max: Math.max(...s) }, imagesNow: window.map.listImages().filter(x => x.startsWith('wheretoo')).length, canvasCount: document.querySelectorAll('.mapboxgl-canvas').length, overflow: document.documentElement.scrollWidth > innerWidth, webgl: window.map.getCanvas().getContext('webgl2')?.getParameter(7937) }; });
                const resources = await page.evaluate(() => { const c = window.perfController; return c ? { versions: c.entries.size, decodedBytes: [...c.entries.values()].reduce((sum, e) => sum + (e.image ? e.descriptor.metadata.widthPx * e.descriptor.metadata.heightPx * 4 : 0), 0), reservedBytes: c.reservedBytes, activeRequests: c.active } : null; });
                results.push({ target, mobile, count, gpu, resources, forcedGC: Boolean(process.env.MAP_PERFORMANCE_GC), elapsedMs: Date.now() - start, cluster, data, calls, failures, metricsBefore: before.metrics, metricsAfter: after.metrics });
                fs.writeFileSync(output, JSON.stringify(results, null, 2));
                console.log(JSON.stringify({ mobile, count, ready: data.ready, frames: data.frameSummary, calls: calls.map(x => ({ type: x.type, phase: x.phase, ms: x.ms })), updates: data.updates.length, commits: data.commits.length, images: data.images.length, canvasCount: data.canvasCount }));
                await context.close();
            }
    }
    finally {
        await browser.close();
    }
})().catch(e => { console.error(e); process.exit(1); });
