// Frontend boundaries only; intercepted API fixture always rejects with 503.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let posts = 0;
await page.route("**/api/**", (r) => {
  const u = new URL(r.request().url());
  let data = {};
  if (u.pathname === "/api/session")
    data = {
      user: { id: "qa-synthetic", username: "QA sintético" },
      mustChangePassword: false,
      synthetic: true,
    };
  else if (u.pathname === "/api/search")
    data = {
      results: [
        { locality: "QA", parcel: "900001", address: "DOMICILIO SINTÉTICO" },
      ],
    };
  else if (u.pathname.startsWith("/api/parcels/"))
    data = {
      locality: "QA",
      parcel: "900001",
      address: "DOMICILIO SINTÉTICO",
      contacts: [],
      images: [],
    };
  else if (
    u.pathname === "/api/consultations" &&
    r.request().method() === "POST"
  ) {
    posts++;
    return r.fulfill({
      status: 503,
      json: { error: { message: "Fallo sintético; borrador conservado." } },
    });
  }
  return r.fulfill({ json: data });
});
try {
  await page.goto(process.env.QA_BASE_URL ?? "http://127.0.0.1:3001");
  await page.getByLabel("Localidad", { exact: true }).fill("QA");
  await page.getByLabel("Número de padrón").fill("900001");
  await page
    .getByRole("button", { name: "Buscar padrón", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: /Padrón 900001/ }).click();
  await page.getByRole("button", { name: "+ Registrar consulta" }).click();
  for (const [label, value] of Object.entries({
    "Nombre completo": "PERSONA SINTÉTICA",
    "Vínculo con el padrón": "Titular",
    Documento: "00000001",
    "Teléfono 1": "00000000",
    "Correo electrónico 1": "qa@example.test",
  }))
    await page.getByLabel(label, { exact: true }).fill(value);
  const input = page.getByLabel("Descripción", { exact: true });
  assert.equal(await input.getAttribute("maxlength"), null);
  const cases = [
    ["whitespace", " \t\n\r\u00a0 ", false],
    ["19", "a".repeat(19), false],
    ["trim19", " \t\n\r\u00a0" + "a".repeat(19) + "\u00a0 ", false],
    ["20", "a".repeat(20), true],
    ["21", "a".repeat(21), true],
    ["10000", "a".repeat(10000), true],
    ["10001", "a".repeat(10001), false],
    ["emoji19", "😀".repeat(19), false],
    ["trimEmoji20", " \t\n\r\u00a0" + "😀".repeat(20) + "\u00a0 ", true],
    ["emoji10000", "😀".repeat(10000), true],
    ["emoji10001", "😀".repeat(10001), false],
  ];
  const checks = [];
  for (const [name, value, valid] of cases) {
    const before = posts;
    await input.fill(value);
    assert.equal(
      Array.from((await input.inputValue()).trim()).length,
      Array.from(value.trim()).length,
    );
    await page
      .getByRole("button", { name: "Registrar consulta", exact: true })
      .click();
    await page.getByRole("heading", { name: "Revisá la consulta" }).waitFor();
    if (valid) {
      await page
        .getByRole("alert")
        .filter({ hasText: "Fallo sintético; borrador conservado." })
        .waitFor();
      assert.equal(posts, before + 1);
      assert.equal(await input.getAttribute("aria-invalid"), "false");
    } else {
      await page.waitForFunction(
        () =>
          document
            .querySelector("textarea[name=description]")
            ?.getAttribute("aria-invalid") === "true",
      );
      assert.equal(posts, before);
      assert.equal(
        await page
          .getByRole("link", {
            name: /Descripción: Ingresá una descripción de 20/,
          })
          .count(),
        1,
      );
    }
    checks.push({ name, valid, postDelta: posts - before });
  }
  assert.deepEqual(errors, []);
  const result = {
    status: "PASS",
    scope: "synthetic intercepted frontend validation only",
    checks,
    totalPosts: posts,
    pageErrors: errors,
  };
  await writeFile(
    "docs/evidence/frontend-description-boundaries-result.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
