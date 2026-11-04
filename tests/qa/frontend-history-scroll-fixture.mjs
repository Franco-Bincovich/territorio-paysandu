// Synthetic intercepted UI regression: scoped history survives detail round trip.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const queries = [];
const person = {
  name: "PERSONA SINTÉTICA",
  documentType: "CI",
  document: "00000001",
  relationship: "Titular",
  phones: ["00000000"],
  emails: ["qa@example.test"],
};
const record = (id) => ({
  id,
  locality: "LOCALIDAD SINTÉTICA",
  parcel: "900001",
  type: "Reclamo",
  description: "Descripción sintética de prueba.",
  person: { ...person, name: `PERSONA SINTÉTICA ${id}` },
  creatorUserId: "synthetic-user",
  createdAt: "2026-11-04T12:00:00Z",
  version: 1,
});
await page.route("**/api/**", (r) => {
  const u = new URL(r.request().url());
  let data = {};
  if (u.pathname === "/api/session")
    data = {
      user: { id: "synthetic-user", username: "QA sintético" },
      mustChangePassword: false,
      synthetic: true,
    };
  else if (u.pathname === "/api/search")
    data = {
      results: [
        {
          locality: "LOCALIDAD SINTÉTICA",
          parcel: "900001",
          address: "DOMICILIO SINTÉTICO",
        },
      ],
    };
  else if (u.pathname.startsWith("/api/parcels/"))
    data = {
      locality: "LOCALIDAD SINTÉTICA",
      parcel: "900001",
      address: "DOMICILIO SINTÉTICO",
      contacts: [],
      images: [],
    };
  else if (u.pathname === "/api/consultations") {
    queries.push(u.searchParams.toString());
    const p = Number(u.searchParams.get("page") ?? 1);
    data = {
      items: Array.from({ length: 30 }, (_, i) => record(`p${p}-${i}`)),
      total: 60,
      page: p,
      pageSize: 30,
    };
  } else if (u.pathname.startsWith("/api/consultations/"))
    data = record(u.pathname.split("/").at(-1));
  return r.fulfill({ json: data });
});
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
  await page.getByRole("tab", { name: "Consultas", exact: true }).click();
  await page.locator("select[name=type]").selectOption("Reclamo");
  await page.getByLabel("Desde (UTC)").fill("2026-11-01");
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await page.getByRole("button", { name: "Siguiente", exact: true }).click();
  await page.getByText("Página 2 · 60 consultas", { exact: true }).waitFor();
  const target = page.locator('button[data-consultation-id="p2-12"]');
  await target.scrollIntoViewIfNeeded();
  await target.focus();
  const before = await page.evaluate(() => ({
    y: scrollY,
    x: document.querySelector(".tablewrap").scrollLeft,
  }));
  assert.ok(before.y > 500);
  assert.ok(before.x > 0);
  await target.click();
  await page
    .getByRole("button", { name: /Volver a las consultas del padrón/ })
    .click();
  await page.getByText("Página 2 · 60 consultas", { exact: true }).waitFor();
  await page.waitForFunction(
    (expected) =>
      Math.abs(scrollY - expected.y) < 2 &&
      Math.abs(document.querySelector(".tablewrap").scrollLeft - expected.x) <
        2,
    before,
  );
  assert.equal(
    await target.evaluate((e) => e === document.activeElement),
    true,
  );
  assert.equal(await page.locator("select[name=type]").inputValue(), "Reclamo");
  assert.equal(await page.getByLabel("Desde (UTC)").inputValue(), "2026-11-01");
  const q = new URLSearchParams(queries.at(-1));
  for (const [key, value] of Object.entries({
    page: "2",
    type: "Reclamo",
    from: "2026-11-01",
    locality: "LOCALIDAD SINTÉTICA",
    parcel: "900001",
  }))
    assert.equal(q.get(key), value);
  assert.deepEqual(errors, []);
  const result = {
    status: "PASS",
    scope: "synthetic browser fixtures only",
    before,
    after: await page.evaluate(() => ({
      y: scrollY,
      x: document.querySelector(".tablewrap").scrollLeft,
    })),
    checks: [
      "scoped filters/page restored",
      "window and horizontal table scroll restored",
      "focus restored to original consultation",
    ],
    pageErrors: errors,
  };
  await writeFile(
    "docs/evidence/frontend-history-scroll-result.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
