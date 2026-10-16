// Read-only hosted/local loading probe; intercepted fixtures never write inventory.
const { createRequire } = require('node:module');
const req = createRequire(process.cwd() + '/package.json');
const { chromium } = req('@playwright/test');
const fs = require('node:fs');
const seed = JSON.parse(fs.readFileSync(process.env.MAP_PERFORMANCE_SEED));
const target = process.env.MAP_PERFORMANCE_URL;
if (!['http://127.0.0.1:3114', 'https://wheretoo-staging.vercel.app'].includes(target) || !process.env.MAP_PERFORMANCE_OUTPUT)
    throw Error('Supply approved target, public seed and output paths');
(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: false });
    const results = [];
    try {
        for (const mobile of [false, true])
            for (const count of [9, 500, 2000]) {
                const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 720 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
                const page = await ctx.newPage();
                let delay = 100, mode = 'rows', phase = 'initial';
                const requests = [];
                const rows = Array.from({ length: count }, (_, i) => ({ ...seed[i % 9], event_id: `39000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, title: `Isolated loading audit ${i + 1}`, longitude: -122.263 + (i % 5 - 2) * .0001, latitude: 37.804 + (Math.floor(i / 5) % 5 - 2) * .0001 }));
                const bytes = Buffer.byteLength(JSON.stringify(rows));
                await page.addInitScript(() => { window.audit = {}; new MutationObserver(() => { const c = document.querySelector('.living-map__canvas'), ready = document.querySelector('[data-renderer-state="ready"]'); if (ready && !window.audit.ready)
                    window.audit.ready = performance.now(); if (ready && !document.querySelector('.map-startup') && !window.audit.usable)
                    window.audit.usable = performance.now(); if (c && Number(c.dataset.wheretooEventCount) > 0 && !window.audit.dataCommit)
                    window.audit.dataCommit = performance.now(); }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-renderer-state', 'data-wheretoo-event-count'] }); });
                await page.route('**/rest/v1/**', async (route) => { const path = new URL(route.request().url()).pathname; if (path.endsWith('get_public_map_events')) {
                    const r = { phase, started: Date.now(), mode, delay, query: route.request().postDataJSON() };
                    requests.push(r);
                    await new Promise(resolve => setTimeout(resolve, r.delay));
                    const body = r.mode === 'empty' ? [] : r.mode === 'capped' ? rows.slice(0, 1000) : rows;
                    r.bytes = Buffer.byteLength(JSON.stringify(body));
                    r.rows = body.length;
                    try {
                        if (r.mode === 'fail')
                            await route.abort();
                        else
                            await route.fulfill({ json: body, headers: { 'content-range': body.length ? `0-${body.length - 1}/${r.mode === 'capped' ? count : body.length}` : '*/0', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' } });
                    }
                    catch {
                        r.cancelled = true;
                    }
                    r.finished = Date.now();
                    return;
                } if (path.endsWith('get_public_map_icon_versions'))
                    return route.continue(); return route.abort(); });
                const nav = Date.now();
                await page.goto(target + '/map', { waitUntil: 'domcontentloaded' });
                await page.waitForFunction(() => { let f = Object.entries(document.querySelector('.living-map__canvas') || {}).find(([k]) => k.startsWith('__reactFiber'))?.[1]; while (f) {
                    let h = f.memoizedState;
                    while (h) {
                        const m = h.memoizedState?.current;
                        if (m && typeof m.getSource === 'function' && typeof m.project === 'function') {
                            window.map = m;
                            return true;
                        }
                        h = h.next;
                    }
                    f = f.return;
                } return false; });
                await page.evaluate(() => { const check = () => { if (window.audit.firstVisible)
                    return; const layers = ['wheretoo-event-circle', 'wheretoo-cluster-circle'].filter(id => window.map.getLayer(id)); if (layers.length && window.map.queryRenderedFeatures({ layers }).length)
                    window.audit.firstVisible = performance.now(); }; window.map.on('render', check); check(); });
                await page.waitForFunction(n => Number(document.querySelector('.living-map__canvas')?.dataset.wheretooEventCount) === n && window.audit.firstVisible, count, { timeout: 60000 });
                await page.waitForTimeout(500);
                const initial = await page.evaluate(() => ({ ...window.audit, center: [window.map.getCenter().lng, window.map.getCenter().lat], zoom: window.map.getZoom(), width: window.map.getBounds().getEast() - window.map.getBounds().getWest(), timeOrigin: performance.timeOrigin }));
                const waitRequests = async (n) => { for (let i = 0; i < 150; i++) {
                    if (requests.length >= n && requests[n - 1].finished)
                        return;
                    await page.waitForTimeout(50);
                } throw Error(`Request ${n} missing`); };
                phase = 'overlap-B';
                await page.evaluate(v => { window.map.jumpTo({ center: [v.center[0] + v.width * .3, v.center[1]] }); }, initial);
                await waitRequests(2);
                phase = 'return-A';
                await page.evaluate(v => { window.map.jumpTo({ center: v.center }); }, initial);
                await page.waitForTimeout(650);
                phase = 'rapid';
                await page.evaluate(async (v) => { for (let i = 0; i < 10; i++) {
                    window.map.jumpTo({ center: [v.center[0] + v.width * (.3 + (i % 2) * .02), v.center[1]] });
                    await new Promise(r => setTimeout(r, 50));
                } }, initial);
                await page.waitForTimeout(650);
                const beforeSlow = requests.length;
                phase = 'slow';
                delay = 1500;
                await page.evaluate(v => { window.map.jumpTo({ center: [v.center[0] - v.width * .3, v.center[1]] }); }, initial);
                await page.waitForTimeout(700);
                const slow = await page.evaluate(() => ({ markers: Number(document.querySelector('.living-map__canvas').dataset.wheretooEventCount), feedback: [...document.querySelectorAll('[role="status"]')].map(x => x.textContent), renderer: document.querySelector('[data-renderer-state]').dataset.rendererState }));
                await waitRequests(beforeSlow + 1);
                phase = 'failure';
                delay = 100;
                mode = 'fail';
                await page.evaluate(v => { window.map.jumpTo({ center: v.center }); }, initial);
                await page.getByRole('button', { name: 'Retry events', exact: true }).waitFor();
                const failure = await page.getByRole('status').filter({ hasText: 'Events couldn’t' }).innerText();
                phase = 'empty-retry';
                mode = 'empty';
                await page.getByRole('button', { name: 'Retry events', exact: true }).click();
                await page.waitForFunction(() => document.querySelector('.living-map__canvas')?.dataset.wheretooEventCount === '0');
                const empty = await page.evaluate(() => ({ renderer: document.querySelector('[data-renderer-state]').dataset.rendererState, feedback: [...document.querySelectorAll('[role="status"]')].map(x => x.textContent), count: document.querySelector('.living-map__canvas').dataset.wheretooEventCount }));
                let capped = null;
                if (count === 2000) {
                    phase = 'capped';
                    mode = 'capped';
                    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
                    await page.waitForFunction(() => document.querySelector('.living-map__canvas')?.dataset.wheretooEventCount === '1000');
                    capped = await page.evaluate(() => ({ rows: Number(document.querySelector('.living-map__canvas').dataset.wheretooEventCount), feedback: [...document.querySelectorAll('[role="status"]')].map(x => x.textContent) }));
                }
                results.push({ mobile, count, bytes, initial, slow, failure, empty, capped, requests, nav, rapidRequests: requests.filter(x => x.phase === 'rapid').length });
                fs.writeFileSync(process.env.MAP_PERFORMANCE_OUTPUT, JSON.stringify(results, null, 2));
                console.log(JSON.stringify({ mobile, count, firstVisible: initial.firstVisible, dataCommit: initial.dataCommit, bytes, rapidRequests: results.at(-1).rapidRequests, slow, empty, capped }));
                await ctx.close();
            }
    }
    finally {
        await browser.close();
    }
})().catch(e => { console.error(e.message); process.exit(1); });
