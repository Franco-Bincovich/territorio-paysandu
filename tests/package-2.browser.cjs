// Local UI integration QA. Every API request is intercepted: this does NOT test Supabase persistence.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const parcel = { locality: 'Paysandú', parcel: '17718', address: 'Dirección QA', contacts: [
  { id: 'legacy', name: 'CONTACTO QA', relationship: 'Titular', phones: ['099123456'], emails: ['qa@example.test'] },
], images: [] };
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const width of [375, 583, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const writes = [];
      await page.route('**/api/**', async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        let body;
        if (path === '/api/session') body = { user: { id: 'qa', username: 'QA' }, mustChangePassword: false, synthetic: true };
        else if (path === '/api/search') body = { results: [parcel] };
        else if (path.startsWith('/api/parcels/')) body = parcel;
        else if (path === '/api/consultations' && request.method() === 'POST') {
          const input = request.postDataJSON(); writes.push(input);
          body = { ...input, id: 'qa-consultation', creatorUserId: 'qa', version: 1, createdAt: '2026-11-05T12:00:00Z' };
        } else if (path === '/api/consultations') body = { items: [], total: 0, page: 1, pageSize: 20 };
        else throw Error(`Unexpected API request: ${request.method()} ${path}`);
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
      });
      await page.goto('http://127.0.0.1:3102');
      await page.getByLabel('Localidad', { exact: true }).fill('Paysandú');
      await page.getByLabel('Número de padrón').fill('17718');
      await page.getByRole('button', { name: 'Buscar padrón', exact: true }).click();
      await page.getByRole('button', { name: /Padrón 17718/ }).click();
      await page.getByRole('tab', { name: 'Contactos', exact: true }).click();
      await page.getByText('CONTACTO QA', { exact: true }).click();
      assert.equal(await page.getByText('· Sin clasificar', { exact: true }).count(), 1);
      await page.getByRole('button', { name: '+ Registrar consulta', exact: true }).click();
      const form = page.locator('.consultation-form');
      for (const kind of ['teléfono', 'correo electrónico']) {
        const add = form.getByRole('button', { name: `+ Agregar ${kind}`, exact: true });
        await add.click(); await add.click();
        assert.equal(await add.isDisabled(), true);
        await form.getByRole('button', { name: `Quitar ${kind} 2 del formulario`, exact: true }).click();
        assert.equal(await add.isEnabled(), true);
        await add.click();
      }
      for (let index = 1; index <= 3; index++) {
        assert.equal(await form.getByLabel(`Tipo de teléfono ${index}`, { exact: true }).isDisabled(), true);
        assert.deepEqual(await form.getByLabel(`Tipo de teléfono ${index}`, { exact: true }).locator('option').allTextContents(), ['Sin clasificar', 'Fijo', 'Celular']);
        await form.getByLabel(`Teléfono ${index}`, { exact: true }).fill(`09912345${index}`);
        await form.getByLabel(`Correo electrónico ${index}`, { exact: true }).fill(`qa${index}@example.test`);
      }
      await form.getByLabel('Nombre completo').fill('PERSONA QA');
      await form.getByLabel('Vínculo con el padrón').fill('Titular');
      await form.getByLabel('Descripción', { exact: true }).fill('Consulta sintética para verificar el formulario.');
      const document = form.getByLabel('Documento', { exact: true });
      const documentType = form.getByLabel('Tipo de documento');
      const save = form.getByRole('button', { name: 'Registrar consulta', exact: true });
      await document.fill('123'); await save.click();
      assert.equal(await document.getAttribute('aria-invalid'), 'true');
      await document.fill('0.000.001-2');
      await form.getByLabel('Correo electrónico 2', { exact: true }).fill('qa@@example.test');
      await save.click();
      assert.equal(await form.getByLabel('Correo electrónico 2', { exact: true }).getAttribute('aria-invalid'), 'true');
      await form.getByLabel('Correo electrónico 2', { exact: true }).fill('qa2@example.test');
      await documentType.selectOption('RUT'); await document.fill('12345678901'); await save.click();
      assert.equal(await document.getAttribute('aria-invalid'), 'true');
      await document.fill('001234567890');
      await documentType.selectOption('Otros'); await document.fill('PAS-ABC.123'); await save.click();
      assert.equal(await document.getAttribute('inputmode'), 'text');
      assert.equal(writes.length, 0);
      assert.equal(await documentType.getAttribute('aria-invalid'), 'true');
      const overflows = await form.evaluate((node) => Array.from(node.querySelectorAll('input,select,textarea,button')).filter((el) => {
        const rect = el.getBoundingClientRect(); return rect.left < 0 || rect.right > innerWidth + 1;
      }).map((el) => el.outerHTML));
      assert.deepEqual(overflows, [], `overflow at ${width}px`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      fs.mkdirSync('tests/artifacts', { recursive: true });
      await page.screenshot({ path: `tests/artifacts/form-${width}.png`, fullPage: true });
      await documentType.selectOption('CI'); await document.fill('0.000.001-2'); await save.click();
      await page.waitForTimeout(200);
      assert.equal(writes.length, 1);
      assert.equal(writes[0].person.phones.length, 3);
      assert.equal(writes[0].person.emails.length, 3);
      assert.equal('phoneTypes' in writes[0].person, false);
      console.log(`PASS ${width}px: add/remove/max3, errors, Otros blocked, legacy contact, save to intercepted API, no overflow`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
