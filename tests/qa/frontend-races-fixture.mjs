// Browser regression using only intercepted synthetic API responses.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1200, height: 900 },
  timezoneId: "America/Montevideo",
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const ref = (n) => ({
  locality: "LOCALIDAD SINTÉTICA",
  parcel: n,
  address: "DOMICILIO SINTÉTICO",
});
const parcel = (n) => ({
  ...ref(n),
  originalLandArea: null,
  originalBuiltArea: 100,
  detectedBuiltArea: 120,
  contacts: [],
  images: [
    {
      kind: "historical",
      source: "Google Earth",
      url: "https://images.example.test/synthetic.svg",
      metadata: { secret: "must not appear" },
    },
    { kind: "survey", source: "Relevamiento", url: null },
  ],
});
const consultation = {
  id: "synthetic-consultation",
  ...ref("900002"),
  type: "General",
  description: "Descripción sintética.",
  person: {
    name: "PERSONA SINTÉTICA",
    documentType: "CI",
    document: "00000001",
    relationship: "Titular",
    phones: ["00000000"],
    emails: ["test@example.test"],
  },
  creatorUserId: "synthetic-user",
  createdAt: "2026-11-04T00:30:00Z",
  version: 1,
};
let releaseParcel, releaseDetail;
let delayFirst = true,
  delayDetail = false;
let loggedOut = false;
await page.route("https://images.example.test/**", (r) =>
  r.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#dce5f5"/><text x="40" y="100">IMAGEN SINTETICA QA</text></svg>',
  }),
);
await page.route("**/api/**", async (r) => {
  const url = new URL(r.request().url());
  let data = {};
  if (url.pathname === "/api/session")
    data = {
      user: loggedOut
        ? null
        : { id: "synthetic-user", username: "Colaborador sintético" },
      mustChangePassword: false,
      synthetic: true,
    };
  else if (url.pathname === "/api/search")
    data = { results: [ref("900001"), ref("900002")] };
  else if (url.pathname.startsWith("/api/parcels/")) {
    const n = url.pathname.split("/").at(-1);
    if (n === "900001" && delayFirst) {
      delayFirst = false;
      await new Promise((resolve) => {
        releaseParcel = resolve;
      });
    }
    data = parcel(n);
  } else if (url.pathname === "/api/consultations")
    data = { items: [consultation], total: 1, page: 1, pageSize: 20 };
  else if (url.pathname === "/api/consultations/synthetic-consultation") {
    if (delayDetail)
      await new Promise((resolve) => {
        releaseDetail = resolve;
      });
    data = consultation;
  } else if (url.pathname === "/api/auth/logout") {
    loggedOut = true;
    data = { ok: true };
  }
  await r
    .fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(data),
    })
    .catch(() => {});
});
const findings = [];
try {
  await page.goto(process.env.QA_BASE_URL ?? "http://127.0.0.1:3000");
  await page
    .getByLabel("Localidad", { exact: true })
    .fill("LOCALIDAD SINTÉTICA");
  await page.getByLabel("Número de padrón").fill("900001");
  await page
    .getByRole("button", { name: "Buscar padrón", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: /Padrón 900001/ }).click();
  await page.getByRole("button", { name: /Padrón 900002/ }).click();
  await page
    .getByRole("heading", { name: "Padrón 900002", level: 1, exact: true })
    .waitFor();
  releaseParcel();
  await page.waitForTimeout(150);
  assert.equal(
    await page
      .getByRole("heading", { name: "Padrón 900001", level: 1, exact: true })
      .count(),
    0,
  );
  findings.push("late parcel response cannot replace latest selection");
  assert.equal(
    await page.getByText("must not appear", { exact: true }).count(),
    0,
  );
  await page.getByRole("tab", { name: "Imágenes", exact: true }).click();
  const opener = page.getByRole("button", { name: "Ampliar imagen" });
  await opener.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "Acercar", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByText("125%", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(
    await opener.evaluate((e) => e === document.activeElement),
    true,
  );
  findings.push(
    "keyboard opens/zooms/closes image and restores focus; no historical metadata",
  );
  await page.getByRole("tab", { name: "Consultas", exact: true }).click();
  await page.getByRole("button", { name: /Ver consulta/ }).click();
  await page
    .getByRole("button", { name: "← Volver a las consultas del padrón" })
    .click();
  await page.getByRole("heading", { name: "Consultas del padrón" }).waitFor();
  findings.push("detail returns to originating parcel consultations");
  await page
    .getByRole("button", { name: /Historial de consultas/ })
    .first()
    .click();
  await page.getByRole("cell", { name: "4/11/2026", exact: true }).waitFor();
  findings.push("UTC date remains November 4 in Montevideo browser");
  delayDetail = true;
  await page.getByRole("button", { name: /Ver consulta/ }).click();
  await page
    .getByRole("button", { name: "Cerrar sesión", exact: true })
    .click();
  await page.getByRole("heading", { name: "Bienvenido" }).waitFor();
  releaseDetail();
  await page.waitForTimeout(150);
  assert.equal(
    await page.getByText("PERSONA SINTÉTICA", { exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: "Guardar corrección" }).count(),
    0,
  );
  assert.equal(new URL(page.url()).searchParams.has("historyFilters"), false);
  findings.push(
    "logout removes data and history filters; late detail cannot restore them",
  );
  assert.deepEqual(errors, []);
  const result = {
    scope: "synthetic intercepted UI only; no real authentication/persistence",
    checks: findings,
    pageErrors: errors,
    status: "PASS",
  };
  await writeFile(
    "docs/evidence/frontend-races-result.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
} finally {
  releaseParcel?.();
  releaseDetail?.();
  await browser.close();
}
