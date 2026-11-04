import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const lockText = readFileSync('package-lock.json', 'utf8');
const lock = JSON.parse(lockText);
const packages = Object.entries(lock.packages).filter(([path]) => path).map(([path, entry]) => {
  let installed;
  try { installed = JSON.parse(readFileSync(`${path}/package.json`, 'utf8')); } catch {}
  return { path, name: installed?.name ?? path.split('node_modules/').at(-1), version: entry.version,
    development: !!entry.dev, optional: !!entry.optional, integrity: entry.integrity ?? null,
    registry: entry.resolved?.startsWith('https://registry.npmjs.org/') ? 'npmjs.org' : 'REVIEW_REQUIRED',
    license: installed?.license ?? entry.license ?? 'UNKNOWN', installed: !!installed };
});
const inventory = { format: 'territorio-dependency-inventory-v1', lockSha256: createHash('sha256').update(lockText).digest('hex'),
  scope: 'All locked packages including optional platform packages; license UNKNOWN requires review. Not a certified SPDX/CycloneDX SBOM.', packages };
writeFileSync('docs/evidence/dependency-inventory.json', JSON.stringify(inventory, null, 2) + '\n');
console.log(JSON.stringify({packages: packages.length, unknownLicenses: packages.filter(p => p.license === 'UNKNOWN').length}));
