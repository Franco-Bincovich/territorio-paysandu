import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();const errors=[],queries=[];page.on('pageerror',e=>errors.push(e.message));
 const person={name:'PERSONA QA SINTÉTICA',documentType:'CI',document:'00000001',relationship:'Titular',phones:['00000000'],emails:['qa@example.test']};
 const consultation={id:'qa-consultation',locality:'QA',parcel:'900001',type:'General',description:'DESCRIPCIÓN SINTÉTICA',person,creatorUserId:'synthetic-user',createdAt:'2026-11-04T00:30:00Z',version:1};
 await page.route('**/api/**',r=>{const url=new URL(r.request().url());let data={};
 if(url.pathname==='/api/session')data={user:{id:'synthetic-user',username:'QA SINTÉTICO'},mustChangePassword:false,synthetic:true};
 else if(url.pathname==='/api/consultations'){queries.push(url.searchParams.toString());data={items:[consultation],total:2,page:Number(url.searchParams.get('page')??1),pageSize:1};}
 else if(url.pathname.startsWith('/api/consultations/'))data=consultation;
 else if(url.pathname==='/api/search'){
  if(url.searchParams.get('q')==='FALLO')return r.fulfill({status:503,json:{error:{message:'Fallo sintético controlado'}}});
  data={results:url.searchParams.get('q')==='VACÍO'?[]:[{locality:'QA',parcel:'900001',address:'SINTÉTICO'}]};
 }else if(url.pathname.startsWith('/api/parcels/'))data={locality:'QA',parcel:'900001',address:'SINTÉTICO',contacts:[],images:[]};
 return r.fulfill({json:data});});
 await page.goto(process.env.QA_BASE_URL ?? 'http://127.0.0.1:3000');await page.getByRole('button',{name:/Historial de consultas/}).click();
 await page.getByLabel('Localidad',{exact:true}).fill('QA');await page.getByLabel('Padrón',{exact:true}).fill('900001');await page.locator('select[name=type]').selectOption('General');await page.getByLabel('Desde (UTC)',{exact:true}).fill('2026-11-01');await page.getByLabel('Hasta (UTC)',{exact:true}).fill('2026-11-04');await page.getByRole('button',{name:'Aplicar filtros'}).click();
 await page.getByRole('button',{name:'Siguiente',exact:true}).click();await page.getByText('Página 2 · 2 consultas',{exact:true}).waitFor();
 await page.getByRole('button',{name:/Ver consulta/}).click();await page.getByRole('button',{name:'Guardar corrección'}).waitFor();await page.getByRole('button',{name:/Volver al historial/}).click();await page.getByText('Página 2 · 2 consultas',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('Localidad',{exact:true}).inputValue(),'QA');assert.equal(await page.getByLabel('Desde (UTC)',{exact:true}).inputValue(),'2026-11-01');
 const last=new URLSearchParams(queries.at(-1));for(const [key,value] of Object.entries({locality:'QA',parcel:'900001',type:'General',from:'2026-11-01',to:'2026-11-04',page:'2'}))assert.equal(last.get(key),value);
 await page.getByRole('button',{name:/Buscar padrón/}).first().click();await page.getByLabel('Dato de la persona').fill('VACÍO');await page.getByRole('button',{name:'Buscar persona',exact:true}).click();await page.getByText('No se encontraron coincidencias.',{exact:true}).waitFor();
 await page.getByLabel('Dato de la persona').fill('FALLO');await page.getByRole('button',{name:'Buscar persona',exact:true}).click();await page.getByRole('alert').filter({hasText:'Fallo sintético controlado'}).waitFor();
 await page.getByLabel('Localidad',{exact:true}).fill('QA');await page.getByLabel('Número de padrón').fill('900001');await page.getByRole('button',{name:'Buscar padrón',exact:true}).last().click();await page.getByRole('button',{name:/Padrón 900001/}).click();await page.getByRole('button',{name:'Consultas',exact:true}).click();await page.getByRole('button',{name:/Ver consulta/}).click();await page.getByRole('button',{name:/Volver a las consultas del padrón/}).click();await page.getByRole('heading',{name:'Consultas del padrón'}).waitFor();
 assert.deepEqual(errors,[]);console.log(JSON.stringify({status:'PASS',mocked:true,checks:['combined filters and page survive detail return','person empty and error UI','parcel history detail returns to parcel context'],requests:queries.length}));
}finally{await browser.close();}
