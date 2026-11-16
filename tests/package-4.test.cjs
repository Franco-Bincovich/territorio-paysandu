require('./register-ts.cjs');
require.extensions['.css'] = () => {};
const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { groupParcelResults } = require('../Frontend/src/components/parcel-result-groups.ts');
const { OptionalDomicileSection } = require('../Frontend/src/components/optional-domicile-section.tsx');
const { ParcelSearchResults } = require('../Frontend/src/components/parcel-search-results.tsx');
process.env.DATA_MODE = 'synthetic';
const { catalogue } = require('../Backend/server/catalogue.ts');
const existing = () => catalogue().findPerson({ field: 'name', exact: 'PERSONA SINTÉTICA UNO' });
const refs = (rows) => rows.map((row) => ({ ...row, ...row.key }));
const renderResults = (props) => renderToStaticMarkup(React.createElement(ParcelSearchResults,
  { results: null, busy: false, error: '', nameSearch: false, onOpen: async () => {}, ...props }));

test('existing synthetic namesakes keep every distinct property and identity metadata', async () => {
  const records = refs(await existing());
  assert.equal(records.length, 3);
  const groups = groupParcelResults(records);
  assert.equal(groups.length, 3);
  assert.equal(new Set(groups.flatMap((group) => group.records.map((row) => row.CI))).size, 2);
  assert.deepEqual(groups.map((group) => group.records[0]), records);
});
test('only exact composite property identifiers group; all source rows retained without mutation', async () => {
  const rows = refs(await existing());
  const input = [rows[0], rows[0], rows[1], rows[2]];
  const before = structuredClone(input);
  const grouped = groupParcelResults(input);
  assert.equal(grouped.length, 3);
  assert.equal(grouped[0].records.length, 2);
  assert.deepEqual(grouped[0].addresses, [rows[0].address]);
  assert.deepEqual(input, before);
  assert.equal(grouped[0].records[0], input[0]);
});
test('different source addresses for the same key remain visible', async () => {
  const rows = refs(await existing());
  // Presentation-only conflict fixture, using existing values; no association is persisted.
  const groups = groupParcelResults([rows[0], { ...rows[0], address: rows[1].address }]);
  assert.deepEqual(groups[0].addresses, [rows[0].address, rows[1].address]);
  assert.equal(groups[0].records.length, 2);
});
test('large repeated response is not truncated or conflated with people', async () => {
  const rows = refs(await existing());
  const repeated = Array.from({ length: 100 }, () => rows).flat();
  const groups = groupParcelResults(repeated);
  assert.equal(groups.length, 3);
  assert.equal(groups.reduce((count, group) => count + group.records.length, 0), 300);
});
test('same parcel number in different localities remains two independent cards', async () => {
  const rows = refs(await existing());
  // Key-shape fixture only; this does not assert a real person/property association.
  const input = [rows[0], { ...rows[0], locality: rows[1].locality }];
  assert.equal(groupParcelResults(input).length, 2);
});
test('missing property address is explicitly unavailable, never replaced with a person address', async () => {
  const rows = refs(await existing());
  const html = renderResults({ results: [{ ...rows[0], address: '' }] });
  assert.match(html, /No informado/);
  assert.doesNotMatch(html, /personas distintas/);
});
test('domicile placeholder has no controls, fields, serialization or required validation', () => {
  const html = renderToStaticMarkup(React.createElement(OptionalDomicileSection));
  assert.match(html, />Domicilio</);
  assert.match(html, /Opcional/);
  assert.match(html, /Disponible próximamente/);
  assert.doesNotMatch(html, /<(input|select|textarea|form|button)\b|\brequired\b/);
});
test('domicile slot accepts future content without inventing fields', () => {
  const html = renderToStaticMarkup(React.createElement(OptionalDomicileSection, {}, React.createElement('span', {}, 'Contenido de prueba')));
  assert.match(html, /Contenido de prueba/);
  assert.doesNotMatch(html, /Disponible próximamente/);
});
test('idle, loading, empty and error states are distinct and accessible', () => {
  assert.equal(renderResults({}), '');
  assert.match(renderResults({ busy: true }), /role="status"[^>]*>Buscando/);
  assert.match(renderResults({ results: [] }), /No se encontraron coincidencias/);
  assert.match(renderResults({ error: 'Error de prueba' }), /role="alert"/);
  assert.match(renderResults({ error: '<script>unsafe</script>' }), /&lt;script&gt;/);
});
test('multiple property cards show the supplied fields without asserting a single person', async () => {
  const rows = refs(await existing());
  const html = renderResults({ results: rows, nameSearch: true });
  assert.match(html, /3 padrones encontrados/);
  assert.match(html, /personas distintas/);
  for (const row of rows) {
    assert.ok(html.includes(row.locality));
    assert.ok(html.includes(row.parcel));
    assert.ok(html.includes(row.address));
  }
  assert.equal((html.match(/class="padron-card"/g) ?? []).length, 3);
});
