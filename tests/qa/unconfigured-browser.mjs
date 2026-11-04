import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

// Integration check against the actual local server, with no mocked auth/data.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.request.get("http://127.0.0.1:3000/api/session");
  assert.equal(response.status(), 503);
  assert.match(response.headers()["cache-control"], /no-store/);
  assert.equal((await response.json()).error.code, "CONFIGURATION");
  await page.goto("http://127.0.0.1:3000/");
  await page.getByRole("heading", { name: "Bienvenido" }).waitFor();
  await page
    .getByRole("alert")
    .filter({ hasText: "todavía no está configurado" })
    .waitFor();
  assert.equal(
    await page.getByRole("navigation", { name: "Principal" }).count(),
    0,
  );
  await page.getByLabel("Usuario", { exact: true }).fill("USUARIO SINTÉTICO");
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill("synthetic-only-not-a-credential");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await page.getByRole("button", { name: "Ingresar", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("navigation", { name: "Principal" }).count(),
    0,
  );
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  console.log(
    JSON.stringify({
      status: "PASS",
      checks: [
        "real API 503/no-store",
        "UI explains missing configuration",
        "login cannot unlock business UI",
        "no uncaught page exceptions",
        "mobile login no horizontal overflow",
      ],
      mocked: false,
    }),
  );
} finally {
  await browser.close();
}
