require('./register-ts.cjs');require.extensions['.css']=()=>{};
const {test}=require('node:test');const assert=require('node:assert/strict');const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
const {ParcelView}=require('../Frontend/src/components/parcel-view.tsx');
const parcel={locality:'Paysandú',parcel:'3389',address:'Domicilio ficticio',contacts:[],images:[],readOnly:true};
const expected=['Datos catastrales','Imágenes','Contactos','Consultas'];
for(const initialTab of ['record','images','contacts','consultations'])test(`territorial record keeps four tabs and renders ${initialTab} without document module`,()=>{
 const html=renderToStaticMarkup(React.createElement(ParcelView,{parcel,initialTab,onCreate:()=>{},onDetail:async()=>{},onBack:()=>{}}));
 const tabs=[...html.matchAll(/<button[^>]*role="tab"[^>]*>([^<]+)<\/button>/g)].map(match=>match[1]);
 assert.deepEqual(tabs,expected);assert.doesNotMatch(html,/Expedientes|tab-expedientes|expedientes-view|Buscar expedientes/);
 assert.match(html,new RegExp(`id="panel-${initialTab}"`));assert.match(html,new RegExp(`id="tab-${initialTab}"[^>]*aria-selected="true"`));
 if(initialTab==='record')assert.match(html,/Información catastral/);
 if(initialTab==='contacts')assert.match(html,/Contactos del padrón/);
 if(initialTab==='consultations')assert.match(html,/historial de la base propia/);
});
