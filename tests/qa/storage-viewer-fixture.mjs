import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  let failImages = true, failedRequests = 0;
  page.on("pageerror", (e) => errors.push(e.message));
  const serveFixture = (r) => r.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#2863e5"/><text x="30" y="50" fill="white">IMAGEN SINTETICA QA</text></svg>',
    });
  await page.route("**/api/**", (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path.startsWith("/api/parcel-image/")) {
      if (failImages) { failedRequests++; return r.fulfill({status:503,headers:{"Cache-Control":"no-store"},json:{error:{code:"STORAGE_UNAVAILABLE"}}}); }
      return serveFixture(r);
    }
    let data = {};
    if (path === "/api/session")
      data = {
        user: { id: "synthetic", username: "QA SINTÉTICO" },
        mustChangePassword: false,
        synthetic: true,
      };
    else if (path === "/api/search")
      data = {
        results: [{ locality: "QA", parcel: "900001", address: "SINTÉTICO" }],
      };
    else if (path === "/api/consultations") data = {items:[],total:0,page:1,pageSize:30};
    else if (path.startsWith("/api/parcels/"))
      data = {
        locality: "QA",
        parcel: "900001",
        address: "SINTÉTICO",
        originalLandArea: null,
        originalBuiltArea: null,
        detectedBuiltArea: null,
        contacts: [],
        images: [
          {
            kind: "historical",
            source: "Google Earth",
            url: "/api/parcel-image/historical",
            metadata: { SECRETO_HISTORICO: "NO MOSTRAR" },
          },
          {
            kind: "survey",
            source: "Relevamiento sintético",
            url: "/api/parcel-image/survey",
            metadata: { Fecha: "2026-11-04" },
          },
        ],
      };
    return r.fulfill({ json: data });
  });
  await page.goto(process.env.QA_BASE_URL ?? "http://127.0.0.1:3000/");
  await page.getByLabel("Localidad", { exact: true }).fill("QA");
  await page.getByLabel("Número de padrón").fill("900001");
  await page
    .getByRole("button", { name: "Buscar padrón", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: /Padrón 900001/ }).click();
  await page
    .getByRole("heading", { name: "Padrón 900001", level: 1, exact: true })
    .waitFor();
  assert.equal(await page.getByRole("button", { name: "Tasa", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: /Registrar consulta/ }).isEnabled(), true);
  assert.equal(
    await page.getByRole("tabpanel").getByText("No disponible", { exact: true }).count(),
    3,
  );
  assert.equal(
    await page.getByText("SECRETO_HISTORICO", { exact: true }).count(),
    0,
  );
  const labels = ["Datos catastrales", "Imágenes", "Contactos", "Consultas", "Adjuntos"];
  assert.equal(await page.getByRole("tab").count(), 5);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("tab", { name: labels[0], exact: true }).click();
    for (let i = 0; i < labels.length; i++) {
      const tab = page.getByRole("tab", { name: labels[i], exact: true });
      assert.equal(await tab.getAttribute("aria-selected"), "true");
      assert.equal(await tab.evaluate(e => e === document.activeElement), true);
      const panel = page.getByRole("tabpanel");
      assert.equal(await panel.count(), 1);
      assert.equal(await panel.getAttribute("aria-labelledby"), await tab.getAttribute("id"));
      assert.equal(await panel.getAttribute("id"), await tab.getAttribute("aria-controls"));
      for (const [name, expected] of [["Información catastral",0],["Imágenes del padrón",1],["Contactos del padrón",2],["Consultas del padrón",3],["Archivos adjuntos",4]])
        assert.equal(await panel.getByRole("heading", {name,exact:true}).count(), Number(i === expected));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (i === 1) {
        if (width === 1440) {
          const retry = page.getByRole("button", {name:"Reintentar imagen",exact:true});
          await retry.waitFor();
          assert.ok(failedRequests > 0);
          failImages = false;
          await retry.click();
        }
        const img = panel.locator(".image-preview img");
        await img.evaluate(e => e.decode());
        assert.ok(await img.evaluate(e => e.naturalWidth > 0));
      }
      await tab.focus();
      await page.keyboard.press("ArrowRight");
    }
    assert.equal(await page.getByRole("tab", {name:labels[0],exact:true}).getAttribute("aria-selected"), "true");
    await page.keyboard.press("End");
    assert.equal(await page.getByRole("tab", {name:labels[4],exact:true}).getAttribute("aria-selected"), "true");
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowLeft");
    assert.equal(await page.getByRole("tab", {name:labels[4],exact:true}).getAttribute("aria-selected"), "true");
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole("tab", { name: "Imágenes", exact: true }).click();
  const open = page.getByRole("button", {
    name: "Ampliar imagen",
    exact: true,
  });
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Visualizador de imágenes" });
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Acercar", exact: true }).click();
  await dialog.getByText("125%", { exact: true }).waitFor();
  await dialog
    .getByRole("button", { name: "Cambiar imagen", exact: true })
    .click();
  await dialog
    .getByRole("heading", { name: "Imagen de relevamiento" })
    .waitFor();
  await dialog.getByText("100%", { exact: true }).waitFor();
  await dialog.locator("img").evaluate(e => e.decode());
  assert.ok(await dialog.locator("img").evaluate(e => e.naturalWidth > 0));
  await page.keyboard.press("Escape");
  assert.equal(await dialog.isVisible(), false);
  assert.equal(await open.evaluate((e) => e === document.activeElement), true);
  await page.getByText("2026-11-04", { exact: true }).waitFor();
  await page.screenshot({path:"docs/evidence/tasa-removed-viewer-synthetic.png",fullPage:true});
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      status: "PASS",
      mocked: true,
      checks: [
        "five tabs, keyboard wrap/Home/End, single relevant panel and no overflow at1440/390/320",
        "historical and survey fixture images decode with naturalWidth > 0",
        "503 image failure exposes retry and successful retry decodes",
        "Tasa absent and consultation action enabled",
        "null surfaces handled",
        "historical metadata suppressed",
        "zoom 125%",
        "carousel resets zoom",
        "Escape closes and restores focus",
        "survey metadata visible",
      ],
    }),
  );
} finally {
  await browser.close();
}
