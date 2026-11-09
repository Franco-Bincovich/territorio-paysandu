// Authorized SELECT-only preflight. No login/session writes, DDL or business data.
const {configuration}=require('./dev-mariadb.cjs');
require('./register-runtime-ts.cjs');
async function main(){
  let close;
  try {
    if(process.env.NODE_ENV==='production' || process.env.AUTH_PROVIDER==='mariadb') {
      const {requestedAuthProvider}=require('../Backend/server/mariadb/provider.ts');
      if(requestedAuthProvider()!=='mariadb')throw Error('Delivery mode required');
    } else Object.assign(process.env,configuration());
    const {mariaPool,closeMariaPool}=require('../Backend/server/mariadb/pool.ts');
    close=closeMariaPool;
    const pool=mariaPool(),c=await pool.getConnection();
    try {
      const tls=await c.query("SELECT VARIABLE_VALUE AS cipher FROM information_schema.SESSION_STATUS WHERE VARIABLE_NAME='SSL_CIPHER'");
      if(!tls[0]?.cipher)throw Error('TLS');
    }finally{await c.release();}
    const {inspectCompatibility}=require('../Backend/server/consultations/schema.ts');
    const result=await inspectCompatibility(pool);
    let institutionalSchema;
    if(process.env.INSTITUTIONAL_ENABLED==='true'){
      const {institutionalRead,closeInstitutionalPool}=require('../Backend/server/institutional/pool.ts');
      try{
        const required={AGM_CIU_PADRONES:['PadCod','PADRON','LOCALIDAD'],AGM_CIU_VINCULOS:['ID_PERSONA_CP','ConCod','RelCod','RelNom','TIPO_DOCUMENTO','DOCUMENTO_NORMALIZADO','DOCUMENTO_VALIDO','PadCod'],AGM_CIU_CONTACTOS:['ID_PERSONA_CP','ID_MEDIO_CP','TIPO_MEDIO','VALOR_CONTACTO'],AGM_CIU_DOMICILIOS:['ID_PERSONA_CP','ID_DOMICILIO_CP',...Object.keys(require('../Backend/server/consultations/model.ts').addressLimits)]};
        institutionalSchema=await institutionalRead(async r=>{
          const rows=await r.query('SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?,?,?,?)',Object.keys(required));
          const missing=Object.entries(required).flatMap(([table,columns])=>columns.filter(column=>!rows.some(row=>row.TABLE_NAME===table&&row.COLUMN_NAME.toUpperCase()===column.toUpperCase())).map(column=>table+'.'+column));
          return {compatible:missing.length===0,missing};
        });
      }finally{await closeInstitutionalPool();}
    }
    const allCompatible=result.compatible&&institutionalSchema?.compatible===true;
    console.log(JSON.stringify({status:allCompatible?'PASS':'BLOCKED',compatible:result.compatible,
      differences:result.differences,institutionalSchema,tls:true,certificateVerification:true,readOnly:true,writesActivated:false}));
    if(!allCompatible)process.exitCode=1;
  }catch{
    console.error('No se pudo verificar el modelo. Revisar conectividad, TLS, permisos y esquema. No se activaron escrituras; detalles sensibles omitidos.');
    process.exitCode=1;
  }finally{if(close)await close();}
}
main();
