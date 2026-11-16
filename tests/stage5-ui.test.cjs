require('./register-ts.cjs');require.extensions['.css']=()=>{};
const {test}=require('node:test'),assert=require('node:assert/strict'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {auditValueEqual,auditAddress}=require('../Frontend/src/components/audit-diff.ts');
const {AuditSnapshot}=require('../Frontend/src/components/audit-snapshot.tsx');
const {CollaboratorMenu}=require('../Frontend/src/components/collaborator-menu.tsx');
test('audit equivalence respects optional empties, canonical numeric representation and meaningful text',()=>{
 for(const [a,b]of [[null,undefined],[null,''],['  ',null],[42,'42'],[0,'0'],[' QA ','QA'],[{CALLE:'QA',PH:null},{CALLE:'QA'}]])assert.equal(auditValueEqual(a,b),true);
 for(const [a,b]of [['042',42],['0012','12'],['QA','qa'],['QA QA','QA  QA'],['000-123','000123'],[[1,2],[2,1]],['null',null],[false,null]])assert.equal(auditValueEqual(a,b),false);
});
test('structured audit values ignore object key order, including parsed address JSON, without mutation',()=>{
 const a={CALLE:'QA',PUERTA:'42',nested:{a:1,b:['QA',2]}},b={nested:{b:['QA','2'],a:'1'},PUERTA:42,CALLE:'QA'};
 const saved=JSON.stringify(a);assert.equal(auditValueEqual(a,b),true);assert.equal(JSON.stringify(a),saved);
 assert.equal(auditValueEqual(auditAddress('{"PUERTA":"42","CALLE":"QA"}'),auditAddress({CALLE:'QA',PUERTA:42})),true);
});
test('only actual changed leaves are highlighted on both sides; removals remain visible',()=>{
 const before={nombre_completo:'PERSONA QA',descripcion:'Anterior',mail_2:'old@example.invalid',domicilio_declarado_json:{CALLE:'QA',PUERTA:'1',LOCALIDAD:'Paysandú',BLOCK:null}},after={nombre_completo:'PERSONA QA',descripcion:'Nuevo',domicilio_declarado_json:{LOCALIDAD:'PAYSANDU',PUERTA:'2',CALLE:'QA',BLOCK:''}};
 for(const [value,comparison]of [[before,after],[after,before]]){
  const html=renderToStaticMarkup(React.createElement(AuditSnapshot,{value,comparison}));assert.equal((html.match(/class="audit-changed"/g)??[]).length,2); // mail + Puerta, description also has audit-wide.
  assert.equal((html.match(/Modificado/g)??[]).length,3);assert.match(html,/Nombre/);assert.doesNotMatch(html,/Nombre<span/);
 }
 const html=renderToStaticMarkup(React.createElement(AuditSnapshot,{value:after,comparison:before}));assert.match(html,/Sin informar/);assert.match(html,/Correo 2/);
});
test('known enum labels and place normalization avoid representation-only highlights',()=>{
 const html=renderToStaticMarkup(React.createElement(AuditSnapshot,{value:{tipo_consulta:'General',tipo_documento:'CI',tipo_telefono_1:'Fijo',domicilio_declarado_json:'{"LOCALIDAD":"Paysandú","DEPARTAMENTO":"Paysandú"}'},comparison:{tipo_consulta:'GENERAL',tipo_documento:'CEDULA_IDENTIDAD',tipo_telefono_1:'FIJO',domicilio_declarado_json:{DEPARTAMENTO:'PAYSANDU',LOCALIDAD:'PAYSANDU'}}}));assert.doesNotMatch(html,/Modificado/);
});
test('initial version stays unhighlighted and hidden technical IDs never appear',()=>{
 const html=renderToStaticMarkup(React.createElement(AuditSnapshot,{value:{nombre_completo:'QA',padcod:'HIDDEN_ID',domicilio_declarado_json:{ID_DOMICILIO_CP:'HIDDEN_ID',CALLE:'QA'}}}));assert.doesNotMatch(html,/Modificado|HIDDEN_ID/);
});
test('profile renders one accessible trigger, circular-avatar class and no separate logout',()=>{
 const html=renderToStaticMarkup(React.createElement(CollaboratorMenu,{username:'qa_colaborador',loggingOut:false,onLogout:()=>{},onSettings:()=>{}}));assert.match(html,/aria-haspopup="menu"/);assert.match(html,/aria-expanded="false"/);assert.match(html,/collaborator-avatar/);assert.match(html,/Atención al público/);assert.doesNotMatch(html,/Cerrar sesión/);
});
