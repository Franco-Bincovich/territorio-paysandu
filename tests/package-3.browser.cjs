// All responses below are explicitly SYNTHETIC QA fixtures. No real API/database calls.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = { locality: 'Paysandú', parcel: '17718', address: 'SYNTHETIC QA', contacts: [], images: [] };
const verifiedFixture = (code) => ({ code, evidence: { source: 'institutional', verified: true, reference: 'SYNTHETIC-QA-ONLY' } });
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const width of [375, 583, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      let classification;
      const queries = [];
      await page.route('**/api/**', async (route) => {
        const url = new URL(route.request().url());
        let body;
        if (url.pathname === '/api/session') body = { user: { id: 'qa', username: 'QA' }, mustChangePassword: false, synthetic: true };
        else if (url.pathname === '/api/search') {
          queries.push(Object.fromEntries(url.searchParams));
          body = { results: [{ ...base, classification }, { ...base, parcel: '17719' }] };
        } else if (url.pathname.startsWith('/api/parcels/')) body = base;
        else throw Error('Unexpected real API request: ' + url.pathname);
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
      });
      await page.goto('http://127.0.0.1:3102');
      const locality = page.getByLabel('Localidad', { exact: true });
      await locality.waitFor({ state: 'visible' });
      assert.deepEqual(await locality.locator('option').allTextContents(), ['Paysandú', 'Paysandú Chacras']);
      assert.deepEqual(await locality.locator('option').evaluateAll((nodes) => nodes.map((node) => node.value)), ['Paysandú', 'Paysandú Chacras']);
      await locality.selectOption('Paysandú Chacras');
      await page.getByLabel('Número de padrón').fill('17718');
      const search = page.getByRole('button', { name: 'Buscar padrón', exact: true });
      const dialog = page.getByRole('dialog', { name: 'Información del padrón' });
      const runSearch = async () => {
        await search.click();
        await page.locator('.padron-card').first().waitFor();
      };
      await runSearch();
      assert.deepEqual(queries.at(-1), { locality: 'Paysandú Chacras', parcel: '17718' });
      assert.equal(await dialog.count(), 0);
      await locality.selectOption('Paysandú');
      for (const code of ['PH', 'UH', 'RURAL']) {
        classification = verifiedFixture(code);
        await runSearch();
        await dialog.waitFor({ state: 'visible' });
        assert.equal(await dialog.getByText('Este tipo de padrón aún no ha sido relevado.', { exact: true }).count(), 1);
        assert.equal(await page.locator('.padron-card').count(), 2);
        const understood = dialog.getByRole('button', { name: 'Entendido', exact: true });
        assert.equal(await understood.evaluate((node) => node === document.activeElement), true);
        await page.keyboard.press('Tab');
        assert.equal(await dialog.evaluate((node) => node.contains(document.activeElement)), true);
        await page.keyboard.press('Shift+Tab');
        assert.equal(await understood.evaluate((node) => node === document.activeElement), true);
        assert.equal(await dialog.evaluate((node) => { const box = node.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight; }), true);
        if (code === 'PH') {
          fs.mkdirSync('tests/artifacts', { recursive: true });
          await page.screenshot({ path: `tests/artifacts/search-notice-${width}.png` });
        }
        if (code === 'UH') await page.keyboard.press('Escape'); else await understood.click();
        await dialog.waitFor({ state: 'hidden' });
        await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Buscar padrón');
        assert.equal(await search.evaluate((node) => node === document.activeElement), true);
        assert.equal(await page.locator('.padron-card').count(), 2);
      }
      for (const value of [undefined, { code: 'PH' }, verifiedFixture('URBANO'), verifiedFixture('UNKNOWN'),
        { ...verifiedFixture('PH'), evidence: { source: 'institutional', verified: false, reference: 'SYNTHETIC-QA' } },
        { ...verifiedFixture('PH'), evidence: { source: 'synthetic', verified: true, reference: 'SYNTHETIC-QA' } }]) {
        classification = value;
        await runSearch();
        assert.equal(await dialog.count(), 0);
        assert.equal(await page.locator('.padron-card').count(), 2);
      }
      // Existing person searches must never trigger BUS-02, even with the synthetic classified response.
      classification = verifiedFixture('PH');
      for (const kind of ['name', 'ci', 'rut']) {
        await page.getByLabel('Buscar mediante').selectOption(kind);
        await page.getByLabel('Dato de la persona').fill('SYNTHETIC QA');
        await page.getByRole('button', { name: 'Buscar persona', exact: true }).click();
        await page.locator('.padron-card').first().waitFor();
        assert.deepEqual(queries.at(-1), { kind, q: 'SYNTHETIC QA' });
        assert.equal(await dialog.count(), 0);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.getByRole('button', { name: /Padrón 17718/ }).click();
      await page.getByRole('heading', { name: 'Padrón 17718', exact: true }).waitFor();
      console.log(`PASS ${width}px: exact localities, verified PH/UH/RURAL only, button/Escape/focus, retained results, person searches, result selection, responsive`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
