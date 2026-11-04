import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://synthetic.invalid/*.svg", (r) =>
    r.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#2863e5"/><text x="30" y="50" fill="white">IMAGEN SINTETICA QA</text></svg>',
    }),
  );
  await page.route("**/api/**", (r) => {
    const path = new URL(r.request().url()).pathname;
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
            url: "https://synthetic.invalid/historical.svg",
            metadata: { SECRETO_HISTORICO: "NO MOSTRAR" },
          },
          {
            kind: "survey",
            source: "Relevamiento sintético",
            url: "https://synthetic.invalid/survey.svg",
            metadata: { Fecha: "2026-11-04" },
          },
        ],
      };
    return r.fulfill({ json: data });
  });
  await page.goto("http://127.0.0.1:3000/");
  await page.getByLabel("Localidad", { exact: true }).fill("QA");
  await page.getByLabel("Número de padrón").fill("900001");
  await page
    .getByRole("button", { name: "Buscar padrón", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: /Padrón 900001/ }).click();
  await page
    .getByRole("heading", { name: "Padrón 900001", exact: true })
    .waitFor();
  assert.equal(
    await page.getByText("No disponible", { exact: true }).count(),
    3,
  );
  assert.equal(
    await page.getByText("SECRETO_HISTORICO", { exact: true }).count(),
    0,
  );
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
  await page.keyboard.press("Escape");
  assert.equal(await dialog.isVisible(), false);
  assert.equal(await open.evaluate((e) => e === document.activeElement), true);
  await page.getByText("2026-11-04", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      status: "PASS",
      mocked: true,
      checks: [
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
