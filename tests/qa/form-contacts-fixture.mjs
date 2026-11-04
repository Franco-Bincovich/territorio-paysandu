import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [],
    posts = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const contacts = [
    {
      id: "other",
      name: "OTRO SINTÉTICO",
      relationship: "Representante",
      phones: [],
      emails: [],
    },
    {
      id: "owner",
      name: "TITULAR SINTÉTICO",
      relationship: "Titular",
      phones: ["00000001", "00000002"],
      emails: ["one@example.test", "two@example.test"],
    },
  ];
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
        results: [{ locality: "QA", parcel: "900001", address: "SINTÉTICO" }],
      };
    else if (u.pathname.startsWith("/api/parcels/"))
      data = {
        locality: "QA",
        parcel: "900001",
        address: "SINTÉTICO",
        contacts,
        images: [],
      };
    else if (r.request().method() === "POST") {
      posts.push(r.request().postDataJSON());
      return r.fulfill({
        status: 503,
        json: { error: { message: "Fallo sintético de persistencia" } },
      });
    }
    return r.fulfill({ json: data });
  });
  await page.goto(process.env.QA_BASE_URL ?? "http://127.0.0.1:3000");
  await page.getByLabel("Localidad", { exact: true }).fill("QA");
  await page.getByLabel("Número de padrón").fill("900001");
  await page
    .getByRole("button", { name: "Buscar padrón", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: /Padrón 900001/ }).click();
  assert.deepEqual(
    await page.locator("details.contact summary").allTextContents(),
    ["TITULAR SINTÉTICO", "OTRO SINTÉTICO"],
  );
  const owner = page.locator("details.contact").first();
  await owner.locator("summary").focus();
  await page.keyboard.press("Enter");
  assert.equal(await owner.getAttribute("open"), "");
  for (const text of [
    "00000001",
    "00000002",
    "one@example.test",
    "two@example.test",
  ])
    assert.equal(
      await owner.getByText(text, { exact: true }).isVisible(),
      true,
    );
  await page.locator("details.contact").last().locator("summary").click();
  assert.equal(
    await page
      .locator("details.contact")
      .last()
      .getByText("Sin informar", { exact: true })
      .count(),
    2,
  );
  await page
    .getByRole("button", { name: "+ Registrar consulta", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Registrar consulta", exact: true })
    .click();
  const summary = page.getByRole("region", { name: "Revisá la consulta" });
  await summary.waitFor();
  assert.equal(
    await summary.evaluate((e) => e === document.activeElement),
    true,
  );
  assert.equal(posts.length, 0);
  assert.equal(await page.locator("[aria-invalid=true]").count(), 6);
  await summary.getByRole("link", { name: /Nombre completo/ }).click();
  assert.equal(
    await page
      .getByLabel("Nombre completo", { exact: true })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  for (const [label, value] of Object.entries({
    "Nombre completo": "PERSONA QA",
    "Vínculo con el padrón": "Titular",
    Documento: "00000001",
    "Teléfono 1": "00000001",
    "Correo electrónico 1": "qa@example.test",
    Descripción: "Descripción sintética",
  }))
    await page.getByLabel(label, { exact: true }).fill(value);
  await page
    .getByRole("button", { name: "+ Agregar correo electrónico", exact: true })
    .click();
  await page
    .getByLabel("Correo electrónico 2", { exact: true })
    .fill("invalido");
  await page
    .getByRole("button", { name: "Registrar consulta", exact: true })
    .click();
  assert.equal(posts.length, 0);
  assert.equal(
    await page
      .getByLabel("Correo electrónico 2", { exact: true })
      .getAttribute("aria-invalid"),
    "true",
  );
  await page
    .getByRole("button", {
      name: "Quitar correo electrónico 2 del formulario",
      exact: true,
    })
    .click();
  assert.equal(
    await page.getByRole("link", { name: /Correo electrónico 2/ }).count(),
    0,
  );
  await page
    .getByRole("button", { name: "+ Agregar teléfono", exact: true })
    .click();
  await page.getByLabel("Teléfono 2", { exact: true }).fill("00000002");
  await page
    .getByRole("button", { name: "+ Agregar correo electrónico", exact: true })
    .click();
  await page
    .getByLabel("Correo electrónico 2", { exact: true })
    .fill("second@example.test");
  await page.getByLabel("Descripción", { exact: true }).fill("a".repeat(19));
  await page
    .getByRole("button", { name: "Registrar consulta", exact: true })
    .click();
  assert.equal(posts.length, 0);
  assert.equal(
    await page
      .getByLabel("Descripción", { exact: true })
      .getAttribute("aria-invalid"),
    "true",
  );
  await summary.getByRole("link", { name: /Descripción/ }).click();
  assert.equal(
    await page
      .getByLabel("Descripción", { exact: true })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  await page.getByLabel("Descripción", { exact: true }).fill("😀".repeat(20));
  await page
    .getByRole("button", { name: "Registrar consulta", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Fallo sintético de persistencia" })
    .waitFor();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].description, "😀".repeat(20));
  assert.deepEqual(posts[0].person.phones, ["00000001", "00000002"]);
  assert.deepEqual(posts[0].person.emails, [
    "qa@example.test",
    "second@example.test",
  ]);
  assert.equal(
    await page.getByLabel("Nombre completo", { exact: true }).inputValue(),
    "PERSONA QA",
  );
  assert.equal(
    await summary.evaluate((e) => e === document.activeElement),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      status: "PASS",
      mocked: true,
      checks: [
        "titular first despite source order",
        "keyboard expandable multiple contacts/media and missing fields",
        "invalid submit blocks network with linked focused summary",
        "second email error removal clears stale link",
        "multiple media preserved in payload",
        "server failure preserves draft and focuses summary",
      ],
      pageErrors: errors,
    }),
  );
} finally {
  await browser.close();
}
