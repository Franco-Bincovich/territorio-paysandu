import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const items = Array.from({ length: 30 }, (_, i) => ({
    id: `qa-${i}`,
    locality: "QA",
    parcel: String(900001 + i),
    type: "General",
    description: "CONTENIDO SINTÉTICO DE PRUEBA",
    person: {
      name: `PERSONA SINTÉTICA ${i}`,
      documentType: "CI",
      document: "00000001",
      relationship: "Titular",
      phones: ["00000001"],
      emails: ["qa@example.test"],
    },
    creatorUserId: "qa",
    createdAt: "2026-11-04T00:00:00Z",
    version: 1,
  }));
  await page.route("https://synthetic.invalid/*.svg", (r) =>
    r.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="blue"/></svg>',
    }),
  );
  await page.route("**/api/**", (r) => {
    const u = new URL(r.request().url());
    let data = {};
    if (u.pathname === "/api/session")
      data = {
        user: { id: "qa", username: "QA SINTÉTICO" },
        mustChangePassword: false,
        synthetic: true,
      };
    else if (u.pathname === "/api/search")
      data = {
        results: [
          {
            locality: "QA UNO",
            parcel: "900001",
            address: "DOMICILIO SINTÉTICO UNO",
          },
          {
            locality: "QA DOS",
            parcel: "900002",
            address: "DOMICILIO SINTÉTICO DOS",
          },
        ],
      };
    else if (u.pathname === "/api/consultations")
      data = {
        items,
        total: 60,
        page: Number(u.searchParams.get("page") || 1),
        pageSize: 30,
      };
    else if (u.pathname.startsWith("/api/consultations/"))
      data = items.find((x) => x.id === u.pathname.split("/").pop());
    else if (u.pathname.startsWith("/api/parcels/"))
      data = {
        locality: "QA DOS",
        parcel: "900002",
        address: "SINTÉTICO",
        contacts: [],
        images: [
          {
            kind: "historical",
            source: "Google Earth",
            url: "https://synthetic.invalid/one.svg",
          },
          {
            kind: "survey",
            source: "SINTÉTICO",
            url: "https://synthetic.invalid/two.svg",
          },
        ],
      };
    return r.fulfill({ json: data });
  });
  const noOverflow = async () =>
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  await page.goto(process.env.QA_BASE_URL ?? "http://127.0.0.1:3000");
  await page.getByLabel("Dato de la persona").fill("PERSONA SINTÉTICA");
  await page.getByLabel("Dato de la persona").press("Enter");
  await page.getByRole("button", { name: /Padrón 900002/ }).waitFor();
  assert.equal(await page.locator(".padron-card").count(), 2);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await noOverflow();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const first = page.getByRole("button", { name: /Padrón 900001/ }),
    second = page.getByRole("button", { name: /Padrón 900002/ });
  await first.focus();
  await page.keyboard.press("Tab");
  assert.equal(
    await second.evaluate((e) => e === document.activeElement),
    true,
  );
  await page.keyboard.press("Enter");
  await page
    .getByRole("heading", { name: "Padrón 900002", level: 1, exact: true })
    .waitFor();
  await noOverflow();
  await page.getByRole("tab", { name: "Imágenes", exact: true }).click();
  const opener = page.getByRole("button", {
    name: "Ampliar imagen",
    exact: true,
  });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Visualizador de imágenes" });
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Acercar", exact: true }).tap();
  await dialog.getByText("125%", { exact: true }).waitFor();
  await dialog
    .getByRole("button", { name: "Cambiar imagen", exact: true })
    .tap();
  await dialog
    .getByRole("heading", { name: "Imagen de relevamiento" })
    .waitFor();
  await dialog.getByText("100%", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Acercar", exact: true }).tap();
  await dialog.getByText("125%", { exact: true }).waitFor();
  await noOverflow();
  for (const key of ["Tab", "Shift+Tab"])
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press(key);
      assert.equal(
        await dialog.evaluate((e) => e.contains(document.activeElement)),
        true,
        `${key} escaped modal: ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 200))}`,
      );
    }
  await page.keyboard.press("Escape");
  assert.equal(await dialog.isVisible(), false);
  assert.equal(
    await opener.evaluate((e) => e === document.activeElement),
    true,
  );
  const menu = page.getByRole("button", { name: "Menú", exact: true });
  await menu.click();
  assert.equal(await menu.getAttribute("aria-expanded"), "true");
  assert.equal(await page.getByRole("button", { name: "Cerrar menú", exact: true }).evaluate(e => e === document.activeElement), true);
  await page.keyboard.press("Escape");
  assert.equal(await menu.getAttribute("aria-expanded"), "false");
  assert.equal(await menu.evaluate(e => e === document.activeElement), true);
  await menu.click();
  await page.getByRole("button", { name: /Historial de consultas/ }).click();
  assert.equal(await menu.getAttribute("aria-expanded"), "false");
  await page
    .getByRole("button", { name: /Ver consulta/ })
    .last()
    .waitFor();
  await noOverflow();
  await page.evaluate(() => window.scrollTo(0, 800));
  const target = page.getByRole("button", { name: /Ver consulta/ }).nth(10);
  await target.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => scrollY);
  assert.ok(before > 100);
  await target.click();
  await page.getByRole("button", { name: "Guardar corrección" }).waitFor();
  await page.getByRole("button", { name: /Volver al historial/ }).click();
  await page
    .getByRole("button", { name: /Ver consulta/ })
    .last()
    .waitFor();
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => scrollY);
  assert.ok(Math.abs(after - before) < 3, `scroll ${before}->${after}`);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      status: "PASS",
      mocked: true,
      viewport: "390x844",
      checks: [
        "responsive search results/record/history no overflow",
        "two person results keyboard traversal and opening",
        "mobile zoom125%",
        "modal focus contained both tab directions and Escape returns focus",
        "history scroll restoration",
        "mobile menu focus, Escape and close after navigation",
      ],
      before,
      after,
      pageErrors: errors,
    }),
  );
} finally {
  await browser.close();
}
