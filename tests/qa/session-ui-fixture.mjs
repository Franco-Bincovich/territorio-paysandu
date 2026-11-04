import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

// UI boundary checks ONLY: session responses below are intercepted synthetic fixtures.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  let passwordRequired = true;
  await page.route("**/api/session", (route) =>
    route.fulfill({
      json: {
        user: { id: "synthetic-user", username: "COLABORADOR SINTÉTICO" },
        mustChangePassword: passwordRequired,
        synthetic: true,
      },
    }),
  );
  await page.route("**/api/consultations?**", (route) =>
    route.fulfill({
      status: 401,
      json: { error: { message: "La sesión expiró." } },
    }),
  );
  await page.goto("http://127.0.0.1:3000/");
  await page.getByRole("heading", { name: "Cambiá tu contraseña" }).waitFor();
  assert.equal(
    await page.getByRole("navigation", { name: "Principal" }).count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Buscar padrón", exact: true })
      .count(),
    0,
  );
  passwordRequired = false;
  await page.reload();
  await page.getByRole("navigation", { name: "Principal" }).waitFor();
  await page.getByRole("button", { name: /Historial de consultas/ }).click();
  await page.getByRole("heading", { name: "Bienvenido" }).waitFor();
  assert.equal(
    await page.getByRole("navigation", { name: "Principal" }).count(),
    0,
  );
  assert.equal(
    await page.getByText("COLABORADOR SINTÉTICO", { exact: true }).count(),
    0,
  );
  console.log(
    JSON.stringify({
      status: "PASS",
      mocked: true,
      checks: [
        "password-change UI hides business functions",
        "401 on business API clears authenticated UI",
      ],
    }),
  );
} finally {
  await browser.close();
}
