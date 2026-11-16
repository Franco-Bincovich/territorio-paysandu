require('./register-ts.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {ConsultationRepository}=require('../Backend/server/consultations/repository.ts');
function fixture(){
  const owner=randomUUID(),admin=randomUUID(),stranger=randomUUID();
  const actors=new Map([[owner,'collaborator'],[admin,'administrator'],[stranger,'collaborator']].map(([userId,role])=>[userId,{verified:true,userId,role,enabled:true,mustChangePassword:false,expiresAt:Date.now()+3600000,sessionHash:userId}]));
  const input={idempotencyKey:randomUUID(),parcel:{padCod:'900001',locality:'QA',parcel:'900002'},person:{name:'PERSONA QA',documentType:'RUT',document:'000000000001'},relationship:{text:'Presentante'},phones:[{type:'CELULAR',value:'000123456'}],emails:['qa@example.test'],type:'GENERAL',description:'Descripción ficticia para edición de prueba.'};
  let state={query:{ID_CONSULTA:'10',ID_PERSONA:'20',USUARIO_CREADOR_ID:owner,USUARIO_MODIFICADOR_ID:owner,VERSION:1,PADCOD:'900001',PADRON:'900002',LOCALIDAD_PADRON:'QA',DOMICILIO_DECLARADO_JSON:null},history:[],sessions:new Set(actors.keys())},tail=Promise.resolve(),failAudit=false,failRollback=false,retryError=false,begins=0;
  const calls=[];
  const pool={getConnection:async()=>{
    let draft,release;return {
      beginTransaction:async()=>{begins++;const prior=tail;tail=new Promise(r=>release=r);await prior;draft=structuredClone(state);},
      commit:async()=>{state=draft;release();release=null;},rollback:async()=>{if(release){release();release=null;}if(failRollback)throw Error('rollback unavailable');},release:async()=>{},destroy:()=>{},
      query:async(sql,params=[])=>{calls.push({sql,params});
        if(sql.startsWith('SET'))return [];
        if(sql.includes('FB_MODELO_REVISION'))return [{REVISION:'7.1'}];
        if(sql.startsWith('SELECT USER_ID, ROLE')){const actor=actors.get(params[0]);return actor?[{USER_ID:actor.userId,ROLE:actor.role,ENABLED:actor.enabled?1:0,MUST_CHANGE_PASSWORD:actor.mustChangePassword?1:0}]:[];}
        if(sql.startsWith('SELECT TOKEN_HASH'))return draft.sessions.has(params[1])?[{TOKEN_HASH:params[1]}]:[];
        if(sql.startsWith('SELECT ID_PERSONA, USUARIO_CREADOR_ID'))return [{ID_PERSONA:'20',USUARIO_CREADOR_ID:draft.query.USUARIO_CREADOR_ID}];
        if(sql.startsWith('SELECT ID_PERSONA FROM FB_PERSONAS'))return [{ID_PERSONA:'20'}];
        if(sql.startsWith('SELECT ID_CONSULTA FROM'))return [{ID_CONSULTA:'10'}];
        if(sql.startsWith('SELECT UPPER'))return [{NORMALIZADO:'000000000001'}];
        if(sql.startsWith('SELECT * FROM FB_PERSONAS'))return [{ID_PERSONA:'20',TIPO_DOCUMENTO:'RUT',DOCUMENTO_NORMALIZADO:'000000000001'}];
        if(sql.startsWith('SELECT * FROM FB_CIU_CONSULTAS_WEB'))return [structuredClone(draft.query)];
        if(sql.startsWith('SELECT * FROM FB_CONTACTOS'))return [];
        if(sql.startsWith('UPDATE FB_CIU_CONSULTAS_WEB')){
          if(retryError)throw Object.assign(Error('deadlock'),{errno:1213});
          if(params.at(-2)!==draft.query.VERSION||params.at(-1)!==draft.query.USUARIO_CREADOR_ID)return {affectedRows:0};
          const before=structuredClone(draft.query),fields=sql.slice(sql.indexOf(' SET ')+5,sql.indexOf(' WHERE ')).split(',').map(s=>s.split(' = ')[0]);
          fields.forEach((field,i)=>draft.query[field]=params[i]);draft.query.VERSION++;
          if(failAudit)throw Error('private trigger failure');draft.history.push({before,after:structuredClone(draft.query),by:draft.query.USUARIO_MODIFICADOR_ID});return {affectedRows:1};
        }
        if(sql.startsWith('UPDATE FB_VINCULOS_DECLARADOS'))return {affectedRows:1};
        if(sql.startsWith('SELECT VERSION FROM'))return [{VERSION:draft.query.VERSION}];
        throw Error('Unexpected SQL in isolated fixture: '+sql);
      }
    };
  }};
  const repo=new ConsultationRepository(pool,async i=>({source:'institutional',verifiedAt:new Date().toISOString(),...i.parcel}));
  return {owner,admin,stranger,actors,input,repo,calls,get state(){return state;},get begins(){return begins;},failAudit(){failAudit=true;},failRollback(){failRollback=true;retryError=true;}};
}
test('collaborator edits own consultation preserving creator and audit modifier',async()=>{
  const f=fixture(),actor=f.actors.get(f.owner);const result=await f.repo.edit('10',1,f.input,actor);assert.equal(result.version,2);assert.equal(f.state.query.USUARIO_CREADOR_ID,f.owner);assert.equal(f.state.query.USUARIO_MODIFICADOR_ID,f.owner);assert.equal(f.state.history.length,1);
});
test('administrator edits another creator with original creator WHERE and version guard',async()=>{
  const f=fixture();await f.repo.edit('10',1,f.input,f.actors.get(f.admin));assert.equal(f.state.query.USUARIO_CREADOR_ID,f.owner);assert.equal(f.state.query.USUARIO_MODIFICADOR_ID,f.admin);assert.equal(f.state.history[0].by,f.admin);assert.equal(f.state.history[0].before.VERSION,1);assert.equal(f.state.history[0].after.VERSION,2);
  const update=f.calls.find(c=>c.sql.startsWith('UPDATE FB_CIU_CONSULTAS_WEB'));assert.equal(update.params.at(-1),f.owner);assert.match(update.sql,/AND VERSION = \? AND USUARIO_CREADOR_ID = \?/);
  const userLock=f.calls.findIndex(c=>c.sql.startsWith('SELECT USER_ID, ROLE')),sessionLock=f.calls.findIndex(c=>c.sql.startsWith('SELECT TOKEN_HASH')),personLock=f.calls.findIndex(c=>c.sql.startsWith('SELECT ID_PERSONA FROM'));assert.ok(userLock<sessionLock&&sessionLock<personLock);
});
test('collaborator is denied editing another creator before business writes',async()=>{
  const f=fixture();await assert.rejects(f.repo.edit('10',1,f.input,f.actors.get(f.stranger)),e=>e.code==='FORBIDDEN');assert.equal(f.state.query.VERSION,1);assert.equal(f.state.history.length,0);assert.equal(f.calls.some(c=>c.sql.startsWith('UPDATE')),false);
});
test('revocation after identify is detected inside consultation transaction',async()=>{
  const f=fixture();f.state.sessions.delete(f.admin);await assert.rejects(f.repo.edit('10',1,f.input,f.actors.get(f.admin)),e=>e.code==='UNAUTHENTICATED');assert.equal(f.state.query.VERSION,1);
});
test('role demotion after identify cannot retain administrator editing permission',async()=>{
  const f=fixture(),stale={...f.actors.get(f.admin)};f.actors.get(f.admin).role='collaborator';await assert.rejects(f.repo.edit('10',1,f.input,stale),e=>e.code==='FORBIDDEN');assert.equal(f.state.query.VERSION,1);
});
test('missing authenticated session reference never permits repository writes',async()=>{
  const f=fixture(),actor={...f.actors.get(f.admin),sessionHash:undefined};await assert.rejects(f.repo.edit('10',1,f.input,actor),e=>e.code==='UNAUTHENTICATED');assert.equal(f.state.history.length,0);
});
test('concurrent edits from one version commit once and preserve history',async()=>{
  const f=fixture(),actor=f.actors.get(f.admin);const result=await Promise.allSettled([f.repo.edit('10',1,f.input,actor),f.repo.edit('10',1,{...f.input,description:'Segunda edición ficticia simultánea.'},actor)]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.find(r=>r.status==='rejected').reason.code,'VERSION_CONFLICT');assert.equal(f.state.query.VERSION,2);assert.equal(f.state.history.length,1);
});
test('history trigger failure rolls back consultation and sanitizes error',async()=>{
  const f=fixture();f.failAudit();await assert.rejects(f.repo.edit('10',1,f.input,f.actors.get(f.admin)),e=>e.status===503&&!e.message.includes('private'));assert.equal(f.state.query.VERSION,1);assert.equal(f.state.history.length,0);
});
test('rollback failure prevents automatic deadlock retry',async()=>{
  const f=fixture();f.failRollback();await assert.rejects(f.repo.edit('10',1,f.input,f.actors.get(f.admin)),e=>e.code==='CONSULTATION_UNAVAILABLE');assert.equal(f.begins,1);
});
