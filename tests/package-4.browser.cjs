// Local visual QA with the EXISTING catalogue fixtures; every API is intercepted.
require('./register-ts.cjs');
process.env.DATA_MODE = 'synthetic';
const { catalogue } = require('../Backend/server/catalogue.ts');
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const existing = await catalogue().findPerson({ field: 'name', exact: 'PERSONA SINTÉTICA UNO' });
  const refs = existing.map((row) => ({ ...row.key, address: row.address }));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const width of [375, 583, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      let rows = [...refs, refs[0]];
      let mode = 'normal';
      let release;
      let loadingGate;
      const queries = [];
      const writes = [];
      await page.route('**/api/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        let body;
        if (url.pathname === '/api/session') body = { user: { id: 'qa', username: 'QA' }, mustChangePassword: false, synthetic: true };
        else if (url.pathname === '/api/search') {
          queries.push(Object.fromEntries(url.searchParams));
          if (mode === 'loading') await loadingGate;
          if (mode === 'error') {
            await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Fuente no disponible — QA' } }) });
            return;
          }
          body = { results: rows };
        } else if (url.pathname.startsWith('/api/parcels/')) {
          const [, , , locality, parcel] = url.pathname.split('/').map(decodeURIComponent);
          const found = refs.find((row) => row.locality === locality && row.parcel === parcel);
          assert.ok(found);
          body = { ...found, contacts: [], images: [] };
        } else if (url.pathname === '/api/consultations' && request.method() === 'POST') {
          const input = request.postDataJSON(); writes.push(input);
          body = { ...input, id: 'qa-consultation', creatorUserId: 'qa', version: 1, createdAt: '2026-11-06T12:00:00Z' };
        } else throw Error('Unexpected API request: ' + url.pathname);
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
      });
      await page.goto('http://127.0.0.1:3102');
      await page.getByLabel('Dato de la persona').fill('PERSONA SINTÉTICA UNO');
      const search = page.getByRole('button', { name: 'Buscar persona', exact: true });
      loadingGate = new Promise((resolve) => { release = resolve; });
      mode = 'loading'; await search.click();
      await page.getByText('Buscando…', { exact: true }).waitFor();
      assert.equal(await search.isDisabled(), true);
      mode = 'normal'; release();
      await page.locator('.padron-card').first().waitFor();
      assert.equal(await page.locator('.padron-card').count(), 3);
      assert.deepEqual(queries.at(-1), { kind: 'name', q: 'PERSONA SINTÉTICA UNO' });
      assert.equal(await page.getByText('Una coincidencia de nombre puede corresponder a personas distintas. Cada padrón se abre por separado.', { exact: true }).count(), 1);
      for (const row of refs) {
        const card = page.getByRole('button', { name: new RegExp('Padrón ' + row.parcel) });
        assert.ok((await card.innerText()).includes(row.locality));
        assert.ok((await card.innerText()).includes(row.address));
      }
      assert.equal(await page.getByText('2 coincidencias para este padrón', { exact: true }).count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      fs.mkdirSync('tests/artifacts', { recursive: true });
      await page.locator('.search-results').evaluate((node) => node.scrollIntoView({ block: 'start' }));
      await page.evaluate(() => window.scrollBy(0, -100));
      await page.screenshot({ path: `tests/artifacts/package-4-results-${width}.png` });
      // Existing three properties at a short viewport exercise scroll/keyboard without creating new data.
      await page.setViewportSize({ width, height: 480 });
      const region = page.getByRole('region', { name: 'Padrones encontrados', exact: true });
      await region.focus();
      if (width > 550) {
        assert.equal(await region.evaluate((node) => node.scrollHeight > node.clientHeight), true);
        await page.keyboard.press('End');
        await page.waitForFunction(() => document.querySelector('.search-results-scroll').scrollTop > 0);
      }
      await page.setViewportSize({ width, height: 900 });
      rows = []; await search.click();
      await page.getByText('No se encontraron coincidencias.', { exact: true }).waitFor();
      assert.equal(await page.locator('.padron-card').count(), 0);
      mode = 'error'; await search.click();
      await page.locator('.search-results').getByRole('alert').waitFor();
      assert.ok((await page.locator('.search-results').getByRole('alert').innerText()).includes('Fuente no disponible — QA'));
      mode = 'normal'; rows = refs; await search.click();
      await page.locator('.padron-card').first().waitFor();
      // Each existing homonym's parcel remains individually selectable with the keyboard.
      const selected = page.getByRole('button', { name: /Padrón 900003/ });
      await selected.focus(); await page.keyboard.press('Enter');
      await page.getByRole('heading', { name: 'Padrón 900003', exact: true }).waitFor();
      await page.getByRole('button', { name: '+ Registrar consulta', exact: true }).click();
      const form = page.locator('.consultation-form');
      const domicile = form.getByRole('region', { name: 'Domicilio', exact: true });
      assert.equal(await domicile.locator('input,select,textarea,button').count(), 0);
      assert.equal(await domicile.getByText('Opcional', { exact: true }).count(), 1);
      await form.getByLabel('Nombre completo').fill('PERSONA SINTÉTICA UNO');
      await form.getByLabel('Vínculo con el padrón').fill('Titular');
      await form.getByLabel('Documento', { exact: true }).fill('00000002');
      await form.getByLabel('Teléfono 1', { exact: true }).fill('099123456');
      await form.getByLabel('Tipo de teléfono 1', { exact: true }).selectOption('Celular');
      await form.getByLabel('Correo electrónico 1', { exact: true }).fill('qa@example.test');
      await form.getByLabel('Descripción', { exact: true }).fill('Prueba visual del contenedor opcional sin datos de domicilio.');
      await domicile.evaluate((node) => node.scrollIntoView({ block: 'start' }));
      await page.evaluate(() => window.scrollBy(0, -100));
      await page.screenshot({ path: `tests/artifacts/package-4-domicile-${width}.png` });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await form.getByRole('button', { name: 'Registrar consulta', exact: true }).click();
      await page.getByRole('button', { name: 'Guardar corrección', exact: true }).waitFor();
      assert.equal(writes.length, 1);
      assert.deepEqual(Object.keys(writes[0].person).sort(), ['name','documentType','document','relationship','phones','phoneTypes','emails'].sort());
      assert.deepEqual(Object.keys(writes[0]).sort(), ['locality','parcel','type','description','person','idempotencyKey'].sort());
      console.log(`PASS ${width}px: states, existing homonyms, dedup, scroll, keyboard selection, optional domicile, unchanged save payload`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
