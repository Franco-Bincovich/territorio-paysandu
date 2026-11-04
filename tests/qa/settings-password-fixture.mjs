import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

// Synthetic intercepted API only. Never supply real passwords or authenticated cookies.
const base = process.env.QA_BASE_URL ?? 'http://127.0.0.1:3037';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'local QA only');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], checks = [], posts = [];
let signedIn = false, mustChange = true;
page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (url.origin !== new URL(base).origin) return route.abort();
  if (!url.pathname.startsWith('/api/')) return route.continue();
  if (request.method() === 'POST') posts.push({ path: url.pathname, body: request.postDataJSON() });
  if (url.pathname === '/api/session') return route.fulfill({ json: { user: signedIn ? { id: 'synthetic-qa', username: 'QA SINTÉTICO' } : null, mustChangePassword: mustChange, synthetic: true } });
  if (url.pathname === '/api/auth/login') { signedIn = true; return route.fulfill({ json: { mustChangePassword: true } }); }
  if (url.pathname === '/api/auth/password') { mustChange = false; return route.fulfill({ json: { ok: true, mustChangePassword: false } }); }
  return route.fulfill({ status: 500, json: { error: { message: 'Unexpected synthetic QA request' } } });
});
const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
async function toggle(label) {
  const input = page.getByLabel(label, { exact: true });
  const show = page.getByRole('button', { name: `Mostrar ${label.toLowerCase()}`, exact: true });
  const before = posts.length;
  assert.equal(await show.getAttribute('type'), 'button');
  assert.equal(await show.getAttribute('aria-controls'), await input.getAttribute('id'));
  await show.focus(); await page.keyboard.press('Enter');
  assert.equal(await input.getAttribute('type'), 'text');
  const hide = page.getByRole('button', { name: `Ocultar ${label.toLowerCase()}`, exact: true });
  assert.equal(await hide.getAttribute('aria-pressed'), 'true');
  await hide.focus(); await page.keyboard.press('Space');
  assert.equal(await input.getAttribute('type'), 'password');
  assert.equal(posts.length, before, 'visibility toggle must never submit');
}
async function screenshot(name) {
  assert.equal(await page.locator('input[name=password], input[name=confirm]').evaluateAll(inputs => inputs.some(i => i.value.length > 0)), false, 'capture only empty password fields');
  await page.screenshot({ path: `docs/evidence/${name}.png`, fullPage: true });
}
try {
  await mkdir('docs/evidence', { recursive: true });
  await page.goto(base);
  await page.getByRole('heading', { name: 'Bienvenido' }).waitFor();
  const logo = page.getByRole('img', { name: 'Paysandú Tierra Heroica' });
  await logo.evaluate(img => img.decode());
  assert.ok(await logo.evaluate(img => img.complete && img.naturalWidth > 0));
  await toggle('Contraseña');
  await screenshot('qa-settings-login-empty');
  await page.getByLabel('Usuario', { exact: true }).fill('QA SINTÉTICO');
  await page.getByLabel('Contraseña', { exact: true }).fill('synthetic-initial-only');
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await page.getByRole('heading', { name: 'Cambiá tu contraseña' }).waitFor();
  assert.equal(await page.getByRole('navigation', { name: 'Principal' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Configuración', exact: true }).count(), 0);
  await toggle('Nueva contraseña'); await toggle('Repetir nueva contraseña');
  checks.push('accessible keyboard visibility toggles never submit; first-change gate hides business/settings');
  await page.getByLabel('Nueva contraseña', { exact: true }).fill('synthetic-new-only-A');
  await page.getByLabel('Repetir nueva contraseña', { exact: true }).fill('synthetic-different-B');
  const beforeMismatch = posts.length;
  await page.getByRole('button', { name: 'Guardar contraseña personal' }).click();
  await page.getByText('Las contraseñas no coinciden.', { exact: true }).waitFor();
  assert.equal(posts.length, beforeMismatch);
  await page.getByLabel('Repetir nueva contraseña', { exact: true }).fill('synthetic-new-only-A');
  await page.getByRole('button', { name: 'Guardar contraseña personal' }).click();
  await page.getByRole('navigation', { name: 'Principal' }).waitFor();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 }); await noOverflow();
    assert.equal(await page.locator('.hero .art').isVisible(), width > 800);
    if (width === 1440 || width === 390) await screenshot(`qa-settings-search-${width}`);
  }
  checks.push('original logo decodes; map visible desktop and hidden by responsive rule; no page overflow at1440/768/390/320');
  await page.getByRole('button', { name: 'QA SINTÉTICO', exact: true }).click();
  await page.getByRole('button', { name: 'Configuración', exact: true }).click();
  await page.getByRole('heading', { name: 'Configuración', exact: true }).waitFor();
  assert.equal(await page.locator('main input').count(), 2);
  await toggle('Nueva contraseña'); await toggle('Repetir nueva contraseña');
  await noOverflow();
  await screenshot('qa-settings-password-empty-mobile');
  await page.getByLabel('Nueva contraseña', { exact: true }).fill('synthetic-settings-only');
  await page.getByLabel('Repetir nueva contraseña', { exact: true }).fill('synthetic-settings-only');
  await page.getByRole('button', { name: 'Guardar contraseña personal' }).click();
  await page.getByLabel('Número de padrón').waitFor();
  const changes = posts.filter(p => p.path === '/api/auth/password');
  assert.equal(changes.length, 2);
  for (const change of changes) assert.deepEqual(Object.keys(change.body), ['password']);
  checks.push('mismatch blocks network; initial and settings changes use same password-only endpoint without email/userId; success returns to search');
  assert.deepEqual(errors, []);
  const result = { status: 'PASS', scope: 'local UI with intercepted synthetic API; no real authentication or credentials', checks, pageErrors: errors, passwordChanges: changes.length };
  await writeFile('docs/evidence/settings-password-fixture-result.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
