require('./register-ts.cjs');require.extensions['.css']=()=>{};
const {test}=require('node:test'),assert=require('node:assert/strict'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {AuditSnapshot}=require('../Frontend/src/components/audit-snapshot.tsx');
const {historyDate}=require('../Frontend/src/components/display-date.ts');
const {historyFilters}=require('../Backend/server/filters.ts');
const {HistoryView}=require('../Frontend/src/components/territory-app.tsx');
test('history date calendar and filter boundaries retain their original semantics',()=>{
 assert.equal(historyDate('2026-11-09T00:01:00Z'),historyDate('2026-11-08T21:01:00-03:00'));
 assert.notEqual(historyDate('2026-11-09T00:01:00Z'),historyDate('2026-11-08T23:59:00Z'));
 const q=historyFilters(new URLSearchParams('from=2026-11-09&to=2026-11-09&page=2'));assert.equal(q.from,'2026-11-09');assert.equal(q.to,'2026-11-09');assert.equal(q.page,2);
});
test('history filters retain names and dates while visible labels omit UTC',()=>{
 const html=renderToStaticMarkup(React.createElement(HistoryView,{onDetail:async()=>{},returnState:{query:'from=2026-11-09&to=2026-11-10',page:1}}));
 assert.doesNotMatch(html,/UTC/);for(const name of ['locality','parcel','type','from','to'])assert.ok(html.includes('name="'+name+'"'));assert.ok(html.includes('value="2026-11-09"'));
});
test('audit labels preserve originals and retired address fields without exposing IDs or raw HTML',()=>{
 const html=renderToStaticMarkup(React.createElement(AuditSnapshot,{value:{nombre_completo:'<script>QA</script>',descripcion:'texto original',tipo_consulta:'GENERAL',padcod:'INTERNAL_QA',domicilio_declarado_json:{PUERTA:'42',NUMERO:'original',PH:'histórico',LOCALIDAD:'PAYSANDU'}}}));
 for(const value of ['General','Puerta','42','Número original','original','PH original','histórico','texto original'])assert.ok(html.includes(value));assert.doesNotMatch(html,/<script>|INTERNAL_QA/);
});

test('unrecognized historical type values are preserved literally',()=>{for(const tipo_consulta of ['__proto__','toString','TIPO ORIGINAL QA'])assert.ok(renderToStaticMarkup(React.createElement(AuditSnapshot,{value:{tipo_consulta}})).includes(tipo_consulta));});
