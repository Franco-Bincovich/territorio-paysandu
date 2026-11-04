import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";

const evidenceDirectory = "docs/evidence";
mkdirSync(evidenceDirectory, { recursive: true });
const lockText = readFileSync("package-lock.json", "utf8");
const lock = JSON.parse(lockText);
const lockSha256 = createHash("sha256").update(lockText).digest("hex");
const cachePath = `${evidenceDirectory}/npm-license-metadata.json`;
let metadata = {};
try {
  metadata = JSON.parse(readFileSync(cachePath, "utf8")).packages ?? {};
} catch {}
const licenseText = (value) =>
  typeof value === "string"
    ? value
    : typeof value?.type === "string"
      ? value.type
      : undefined;
const entries = Object.entries(lock.packages).filter(([path]) => path);
const pending = [];
const packages = entries.map(([path, entry]) => {
  const name = path.split("node_modules/").at(-1);
  let installed;
  try {
    installed = JSON.parse(readFileSync(`${path}/package.json`, "utf8"));
  } catch {}
  if (
    installed &&
    (installed.name !== name || installed.version !== entry.version)
  )
    throw new Error(`Installed manifest does not match lock: ${path}`);
  const localLicense =
    licenseText(installed?.license) ?? licenseText(entry.license);
  const record = {
    path,
    name,
    version: entry.version,
    development: !!entry.dev,
    optional: !!entry.optional,
    integrity: entry.integrity ?? null,
    registry: entry.resolved?.startsWith("https://registry.npmjs.org/")
      ? "npmjs.org"
      : "REVIEW_REQUIRED",
    license: localLicense ?? "UNKNOWN",
    installed: !!installed,
    licenseSource: localLicense
      ? installed?.license
        ? `${path}/package.json`
        : "package-lock.json"
      : null,
  };
  if (!localLicense) pending.push(record);
  return record;
});
if (process.argv.includes("--refresh-metadata")) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (cursor < pending.length) {
        const record = pending[cursor++];
        if (record.registry !== "npmjs.org") continue; // Never forward credentials or query an inferred private registry.
        const url = `https://registry.npmjs.org/${encodeURIComponent(record.name)}/${encodeURIComponent(record.version)}`;
        const response = await fetch(url, {
          redirect: "error",
          signal: AbortSignal.timeout(15000),
          headers: { Accept: "application/json" },
        });
        if (!response.ok)
          throw new Error(
            `Registry metadata HTTP ${response.status}: ${record.name}@${record.version}`,
          );
        const raw = await response.text();
        const body = JSON.parse(raw);
        if (body.name !== record.name || body.version !== record.version)
          throw new Error("Registry identity mismatch");
        if (record.integrity && body.dist?.integrity !== record.integrity)
          throw new Error(
            `Registry integrity mismatch: ${record.name}@${record.version}`,
          );
        metadata[`${record.name}@${record.version}`] = {
          name: body.name,
          version: body.version,
          license: body.license ?? null,
          integrity: body.dist?.integrity ?? null,
          source: url,
          retrievedAt: new Date().toISOString(),
          responseSha256: createHash("sha256").update(raw).digest("hex"),
        };
      }
    }),
  );
  writeFileSync(
    cachePath,
    JSON.stringify(
      { format: "exact-version-npm-license-evidence-v1", packages: metadata },
      null,
      2,
    ) + "\n",
  );
}
for (const record of pending) {
  const item = metadata[`${record.name}@${record.version}`];
  const expectedSource = `https://registry.npmjs.org/${encodeURIComponent(record.name)}/${encodeURIComponent(record.version)}`;
  if (
    item?.name === record.name &&
    item.version === record.version &&
    item.integrity === record.integrity &&
    item.source === expectedSource
  ) {
    record.license = licenseText(item.license) ?? "UNKNOWN";
    record.licenseSource = item.source;
  }
}
const inventory = {
  format: "territorio-dependency-inventory-v2",
  lockSha256,
  scope:
    "All locked packages including optional platform packages. Declared licenses from exact manifests/registry metadata, not legal approval or installed-artifact verification.",
  packages,
};
writeFileSync(
  `${evidenceDirectory}/dependency-inventory.json`,
  JSON.stringify(inventory, null, 2) + "\n",
);

const ref = (path) => `npm-lock:${path || "root"}`;
const purl = (name, version) =>
  `pkg:npm/${name.split("/").map(encodeURIComponent).join("/")}@${encodeURIComponent(version)}`;
const properties = (record) =>
  Object.entries({
    "paysandu:lockPath": record.path,
    "paysandu:installed": String(record.installed),
    "paysandu:development": String(record.development),
    "paysandu:optional": String(record.optional),
    "paysandu:licenseSource": record.licenseSource ?? "UNKNOWN",
  }).map(([name, value]) => ({ name, value }));
const components = packages.map((record) => {
  const item = {
    type: "library",
    "bom-ref": ref(record.path),
    name: record.name,
    version: record.version,
    purl: purl(record.name, record.version),
    properties: properties(record),
  };
  if (record.license !== "UNKNOWN")
    item.licenses = /^SEE LICENSE|^UNLICENSED$/.test(record.license)
      ? [{ license: { name: record.license } }]
      : [{ expression: record.license }];
  const integrity = /^(sha256|sha384|sha512)-([A-Za-z0-9+/=]+)$/.exec(
    record.integrity ?? "",
  );
  if (integrity)
    item.hashes = [
      {
        alg: `SHA-${integrity[1].slice(3)}`,
        content: Buffer.from(integrity[2], "base64").toString("hex"),
      },
    ];
  return item;
});
function resolveDependency(path, name) {
  let base = path;
  for (;;) {
    const candidate = `${base ? base + "/" : ""}node_modules/${name}`;
    if (lock.packages[candidate]) return candidate;
    if (!base) return null;
    const index = base.lastIndexOf("node_modules/");
    base = index > 0 ? base.slice(0, index - 1) : "";
  }
}
const unresolved = [];
const dependencies = Object.entries(lock.packages).map(([path, entry]) => {
  const names = new Set(
    Object.keys({
      ...entry.dependencies,
      ...entry.devDependencies,
      ...entry.optionalDependencies,
      ...entry.peerDependencies,
    }),
  );
  const dependsOn = new Set();
  for (const name of names) {
    const resolved = resolveDependency(path, name);
    if (resolved) dependsOn.add(ref(resolved));
    else
      unresolved.push({
        path,
        name,
        optional:
          !!entry.optionalDependencies?.[name] ||
          !!entry.peerDependenciesMeta?.[name]?.optional,
      });
  }
  return { ref: ref(path), dependsOn: [...dependsOn].sort() };
});
const project = JSON.parse(readFileSync("package.json", "utf8"));
const sbom = {
  $schema: "http://cyclonedx.org/schema/bom-1.6.schema.json",
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  serialNumber: `urn:uuid:${randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    lifecycles: [{ phase: "pre-build" }],
    component: {
      type: "application",
      "bom-ref": ref(""),
      name: project.name,
      version: project.version,
      properties: [
        { name: "paysandu:lockSha256", value: lockSha256 },
        {
          name: "paysandu:scope",
          value:
            "Complete lock inventory including development and optional platform packages; not a deployed-runtime inventory.",
        },
      ],
    },
  },
  components,
  dependencies,
};
writeFileSync(
  `${evidenceDirectory}/sbom.cyclonedx.json`,
  JSON.stringify(sbom, null, 2) + "\n",
);
writeFileSync(
  `${evidenceDirectory}/sbom-unresolved-dependencies.json`,
  JSON.stringify({ lockSha256, unresolved }, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    packages: packages.length,
    unknownLicenses: packages.filter((p) => p.license === "UNKNOWN").length,
    registryEnriched: pending.filter((p) => p.license !== "UNKNOWN").length,
    unresolvedEdges: unresolved.length,
    lockSha256,
  }),
);

if (
  packages.some((p) => p.license === "UNKNOWN") ||
  unresolved.some((edge) => !edge.optional)
)
  process.exitCode = 1;
