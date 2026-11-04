import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { routes } from "../../src/server/observability";

test("OpenAPI documents each implemented route and method with resolvable schema references", () => {
  const document = JSON.parse(
    readFileSync(
      new URL("../../docs/api-openapi.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(document.openapi, "3.1.0");
  assert.deepEqual(
    Object.keys(document.paths).sort(),
    Object.keys(routes).sort(),
  );
  for (const [path, methods] of Object.entries(routes)) {
    assert.deepEqual(
      Object.keys(document.paths[path]).sort(),
      methods.map((method) => method.toLowerCase()).sort(),
    );
  }
  const inspect = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if ("$ref" in value) {
      const ref = String(value.$ref);
      assert.ok(ref.startsWith("#/components/schemas/"));
      assert.ok(
        document.components.schemas[ref.slice("#/components/schemas/".length)],
        ref,
      );
    }
    for (const child of Object.values(value)) inspect(child);
  };
  inspect(document);
});
