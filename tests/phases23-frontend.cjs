require('./register-ts.cjs');require.extensions['.css']=()=>{};
const {test}=require('node:test');
const assert=require('node:assert/strict');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {request,RequestError}=require('../Frontend/src/components/contracts.ts');
const {normalizedUsername,validUsername}=require('../Frontend/src/components/administration-contracts.ts');
const {AdministrationView}=require('../Frontend/src/components/administration-view.tsx');
const {ExpedientesView}=require('../Frontend/src/components/expedientes-view.tsx');

test('administration normalizes Unicode identities and rejects whitespace/control input',()=>{
 assert.equal(normalizedUsername('  ＡDMIN  '),'admin');
 assert.equal(validUsername('María.Pérez@equipo'),true);
 for(const value of ['','a b','test\nuser','a'.repeat(101),'user/../admin'])assert.equal(validUsername(value),false);
});
test('administration initial view exposes loading and labeled search without credentials',()=>{
 const html=renderToStaticMarkup(React.createElement(AdministrationView,{onRequiresLogin:()=>{}}));
 assert.match(html,/Administración de usuarios/);assert.match(html,/Cargando usuarios/);assert.match(html,/Buscar usuario/);assert.match(html,/Crear usuario/);
 assert.doesNotMatch(html,/type="password"|passwordHash|tokenHash/);
});
test('expedientes offers independent locality and padron search without upload controls',()=>{
 const html=renderToStaticMarkup(React.createElement(ExpedientesView,{role:'collaborator'}));
 assert.match(html,/Número de padrón/);assert.doesNotMatch(html,/Número de caso|name="caso"/);assert.doesNotMatch(html,/PadCod/);assert.doesNotMatch(html,/type="file"|Subir|Eliminar|Modificar/);
});
test('request preserves sanitized version-conflict code for safe UI recovery',async()=>{
 const previous=global.fetch;global.fetch=async()=>Response.json({error:{code:'VERSION_CONFLICT',message:'La versión cambió.'}},{status:409});
 try{await assert.rejects(request('/api/admin/users/user',{method:'PATCH',body:'{}'}),error=>error instanceof RequestError&&error.status===409&&error.code==='VERSION_CONFLICT');}finally{global.fetch=previous;}
});
test('manual credential request retains cookie and no-store controls without delivery claims',async()=>{
 const previous=global.fetch;let captured;
 global.fetch=async(url,init)=>{captured={url,...init};return Response.json({user:{mustChangePassword:true}});};
 try{const result=await request('/api/admin/users',{method:'POST',body:JSON.stringify({username:'fixture',role:'collaborator',reason:'Prueba aislada',temporalPassword:'fictional only password',confirmPassword:'fictional only password'})});assert.equal(result.user.mustChangePassword,true);assert.equal(result.credentialDelivery,undefined);assert.equal(captured.credentials,'same-origin');assert.equal(captured.cache,'no-store');assert.equal(captured.headers['Idempotency-Key'],undefined);}finally{global.fetch=previous;}
});

test('unauthenticated administration response signals session expiration',async()=>{
 const previousFetch=global.fetch,previousWindow=global.window;let event;
 global.window={dispatchEvent:value=>{event=value;}};global.fetch=async()=>Response.json({error:{code:'UNAUTHENTICATED',message:'Iniciá sesión.'}},{status:401});
 try{await assert.rejects(request('/api/admin/users'));assert.equal(event.type,'territory-session-expired');}finally{global.fetch=previousFetch;if(previousWindow===undefined)delete global.window;else global.window=previousWindow;}
});


test('document search is available only to authorized roles with exactly two localities',()=>{
 for(const role of ['atencion_publico','collaborator','administrator']){
  const html=renderToStaticMarkup(React.createElement(ExpedientesView,{role}));
  if(role==='atencion_publico')assert.equal(html,'');
  else {assert.doesNotMatch(html,/Generar documento|contrato documental institucional/);assert.match(html,/Buscar expedientes/);assert.equal((html.match(/<option /g)||[]).length,2);assert.match(html,/value="PAYSANDU"/);assert.match(html,/value="PAYSANDU_CHACRAS"/);assert.match(html,/<input required=""[^>]*name="padron"/);assert.doesNotMatch(html,/<input required=""[^>]*name="caso"/);}
 }
});
test('document query rejects invalid locality and partial numeric input and includes exact association in downloads',()=>{
 const {expedienteQuery,expedienteDocumentUrl}=require('../Frontend/src/components/expedientes-view.tsx');
 assert.equal(expedienteQuery('PAYSANDU',' 3389 '),'localidad=PAYSANDU&padron=3389');
 for(const args of [['OTHER','3389',''],['PAYSANDU','',''],['PAYSANDU','3389x',''],['PAYSANDU','3389','../']])assert.throws(()=>expedienteQuery(...args));
 assert.equal(expedienteDocumentUrl({id:'abc',localidad:'PAYSANDU_CHACRAS',padron:'3389',caseNumber:'264893'},'descarga'),'/api/expedientes/abc/descarga?localidad=PAYSANDU_CHACRAS&padron=3389&caso=264893');
});
test('user editor defaults to least privilege and exposes all three role labels',()=>{
 const {UserEditor}=require('../Frontend/src/components/administration-view.tsx');
 const html=renderToStaticMarkup(React.createElement(UserEditor,{user:null,onSaved:()=>{},onCancel:()=>{}}));
 assert.match(html,/<option value="atencion_publico" selected="">Atención al público/);
 assert.match(html,/<option value="collaborator">Colaborador/);assert.match(html,/<option value="administrator">Administrador/);
});
test('logical deletion editor records automatic audit without editing identity or password',()=>{
 const {UserEditor}=require('../Frontend/src/components/administration-view.tsx');
 const html=renderToStaticMarkup(React.createElement(UserEditor,{user:{id:'fixture',username:'fixture',role:'atencion_publico',revision:1,enabled:true},deleting:true,onSaved:()=>{},onCancel:()=>{}}));
 assert.match(html,/Confirmar baja lógica/);assert.doesNotMatch(html,/Motivo de la operación/);assert.doesNotMatch(html,/<select|Nombre de usuario|type="password"/);
});


test('public attention and missing role render no document module',()=>{
 for(const role of ['atencion_publico',undefined])assert.equal(renderToStaticMarkup(React.createElement(ExpedientesView,{role,padCod:'123'})),'');
});
test('administration does not enable credential actions before server capabilities arrive',()=>{
 const html=renderToStaticMarkup(React.createElement(AdministrationView,{onRequiresLogin:()=>{}}));
 assert.match(html,/<button class="btn primary" disabled="">Crear usuario/);
});


test('password requirements communicate pending, satisfied and failed states without secret values',()=>{
 const {PasswordRequirements,passwordConditions}=require('../Frontend/src/components/password-fields.tsx');
 assert.ok(passwordConditions('','','').every(condition=>condition.state==='Pendiente'));
 assert.ok(passwordConditions('fictional unique phrase','fictional unique phrase','older fictional phrase').every(condition=>condition.state==='Cumplida'));
 assert.ok(passwordConditions('password1234','different','password1234').some(condition=>condition.state==='No cumplida'));
 const html=renderToStaticMarkup(React.createElement(PasswordRequirements,{id:'requirements',password:'fictional unique phrase',confirmation:'fictional unique phrase',current:'older fictional phrase'}));
 assert.match(html,/Cumplida/);assert.match(html,/aria-live="polite"/);assert.match(html,/lista local/);assert.match(html,/no detecta todas/);assert.doesNotMatch(html,/fictional unique phrase|older fictional phrase/);
});
test('MariaDB password change requests current password and confirmation with accessible toggles',()=>{
 const {AuthForm}=require('../Frontend/src/components/territory-app.tsx');
 const html=renderToStaticMarkup(React.createElement(AuthForm,{changePassword:true,provider:'mariadb',onSuccess:async()=>{}}));
 assert.match(html,/name="currentPassword"/);assert.match(html,/name="confirmPassword"/);assert.match(html,/name="password"/);assert.match(html,/aria-describedby="password-requirements"/);assert.match(html,/Mostrar contraseña actual/);assert.match(html,/aria-pressed="false"/);assert.match(html,/Pendiente/);
 const legacy=renderToStaticMarkup(React.createElement(AuthForm,{changePassword:true,onSuccess:async()=>{}}));assert.doesNotMatch(legacy,/name="currentPassword"/);
});
test('administrator create and reset request manually confirmed temporary passwords',()=>{
 const {UserEditor}=require('../Frontend/src/components/administration-view.tsx');
 for(const props of [{user:null},{user:{id:'fixture',username:'fixture',role:'atencion_publico',revision:1,enabled:true},reset:true}]){
  const html=renderToStaticMarkup(React.createElement(UserEditor,{...props,onSaved:()=>{},onCancel:()=>{}}));
  assert.match(html,/name="temporalPassword"/);assert.match(html,/name="confirmPassword"/);assert.match(html,/Mostrar contraseña temporal/);assert.match(html,/Permanece válida hasta que la cambie o se restablezca/);assert.doesNotMatch(html,/24 horas/);assert.doesNotMatch(html,/entrega privada.*pendiente/);
 }
});


test('user creation modal separates profile and credentials without a manual reason',()=>{
 const {UserEditor}=require('../Frontend/src/components/administration-view.tsx');
 const html=renderToStaticMarkup(React.createElement(UserEditor,{user:null,onSaved:()=>{},onCancel:()=>{}}));
 assert.match(html,/<dialog/);assert.match(html,/Cerrar formulario/);assert.match(html,/Datos personales/);
 for(const label of ['Nombre','Apellido','Correo electrónico','Cédula de identidad'])assert.ok(html.includes(label));
 assert.match(html,/type="email"/);assert.match(html,/automáticamente en la auditoría/);assert.doesNotMatch(html,/Motivo de la operación/);
});
test('audit labels and Uruguay dates are readable and preserve an invalid-date fallback',()=>{
 const {auditDate,auditAction}=require('../Frontend/src/components/administrative-audit-view.tsx');
 assert.equal(auditAction('reset-password'),'Restablecimiento de contraseña');
 assert.match(auditDate('2026-11-15T15:00:00Z'),/12:00:00/);
 assert.equal(auditDate('bad'),'Fecha no disponible');
});

test('legacy profile remains optional when editing an existing account',()=>{
 const {UserEditor}=require('../Frontend/src/components/administration-view.tsx');
 const html=renderToStaticMarkup(React.createElement(UserEditor,{user:{id:'fixture',username:'Jimena',role:'atencion_publico',revision:1,enabled:true},onSaved:()=>{},onCancel:()=>{}}));
 assert.match(html,/anterior al perfil personal/);assert.match(html,/value="Jimena"/);
 assert.doesNotMatch(html,/<input required="" maxLength="100" autoComplete="given-name"/);
});

test('audit row renders names Spanish labels Uruguay time and trace identifiers',()=>{
 const {AuditRow}=require('../Frontend/src/components/administrative-audit-view.tsx');
 const html=renderToStaticMarkup(React.createElement(AuditRow,{event:{actorId:'actor-id',targetId:'target-id',actorUsername:'Franco QA',targetUsername:'Jimena QA',action:'update',result:'success',at:'2026-11-15T15:00:00Z',reason:'Cambio de rol',requestId:'fixture'}}));
 for(const text of ['Franco QA','Jimena QA','Actualización de usuario','Correcta','12:00:00','actor-id','target-id','Cambio de rol'])assert(html.includes(text));
 assert.match(html,/<details>/);assert.doesNotMatch(html,/>success</);
});
