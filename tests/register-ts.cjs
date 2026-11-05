// Test-only loader: execute the existing shared TypeScript parser without a new runner.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const suffix = process.platform === 'win32' ? '-msvc' : process.platform === 'linux' ? '-gnu' : '';
const swc = require(`@next/swc-${process.platform}-${process.arch}${suffix}`);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, ...args) {
  return resolve.call(this, name === '@backend/domain'
    ? path.join(__dirname, '../Backend/domain/index.ts') : name, ...args);
};
for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => {
    const result = swc.transformSync(fs.readFileSync(filename, 'utf8'), false, Buffer.from(JSON.stringify({
      filename, jsc: { parser: { syntax: 'typescript', tsx: extension === '.tsx' },
        target: 'es2022', transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' },
    })));
    module._compile(result.code, filename);
  };
}
