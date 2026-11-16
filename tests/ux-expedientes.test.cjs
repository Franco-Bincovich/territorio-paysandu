require('./register-ts.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {ExpedientesView}=require('../Frontend/src/components/expedientes-view.tsx');

test('document consultation starts with search and no generation for every authorized role',()=>{
 for(const role of ['collaborator','administrator']){
  const html=renderToStaticMarkup(React.createElement(ExpedientesView,{role,padCod:'123'}));
  assert.match(html,/class="expedientes-view"/);
  assert.match(html,/Solo lectura/);
  assert.match(html,/Buscar expedientes/);
  assert.match(html,/Número de padrón/);
  assert.doesNotMatch(html,/contrato documental institucional|Exportar a Word|Exportar a PDF/);
  assert.doesNotMatch(html,/Generar documento|Registrar un expediente|type="file"|Subir documento/);
 }
});

test('document consultation remains hidden from public attention and missing sessions',()=>{
 for(const role of ['atencion_publico',undefined]){
  assert.equal(renderToStaticMarkup(React.createElement(ExpedientesView,{role,padCod:'123'})),'');
 }
});

test('search requires locality and padron without a case input or institutional PadCod',()=>{
 const html=renderToStaticMarkup(React.createElement(ExpedientesView,{role:'collaborator'}));
 assert.match(html,/Ingresá la localidad y el número de padrón/);
 assert.doesNotMatch(html,/Número de caso|name="caso"/);
 assert.equal((html.match(/<input /g)||[]).length,1);
 assert.equal((html.match(/<select /g)||[]).length,1);
 assert.doesNotMatch(html,/UUID|PadCod|undefined|null|Cargando expedientes/);
});
