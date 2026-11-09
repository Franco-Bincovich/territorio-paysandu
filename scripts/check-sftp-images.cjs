// Real preflight: only lstat, realpath, opendir, readdir and close over SFTP.
require('./register-runtime-ts.cjs');
const {sftpEnvironment}=require('./load-sftp-env.cjs');
const {SftpImages}=require('../Backend/server/sftp-images/provider.ts');
(async()=>{try{
 const env=sftpEnvironment();
 if(process.argv.includes('--config-only')){
  const fields=['SFTP_IMAGES_ENABLED','SFTP_IMAGES_HOST','SFTP_IMAGES_PASSWORD','SFTP_IMAGES_PRIVATE_KEY_FILE','SFTP_IMAGES_HOST_KEY_SHA256'];
  console.log(JSON.stringify({connectionAttempted:false,fieldsPresent:Object.fromEntries(fields.map(k=>[k,!!env[k]])),usernameAllowed:env.SFTP_IMAGES_USER==='sftp-lectura',hostKeyIndependentlyVerified:env.SFTP_IMAGES_HOST_KEY_VERIFIED==='true'}));return;
 }
 console.log(JSON.stringify(await new SftpImages(env).checkReadOnly()));
}catch(error){console.error(JSON.stringify({status:'BLOCKED',code:error.code??'IMAGE_CONFIG',message:['IMAGE_CONFIG','IMAGE_HOST_KEY_UNVERIFIED','IMAGE_HOST_KEY','IMAGE_AUTHENTICATION','IMAGE_ACCESS_DENIED','IMAGE_CONNECTION','IMAGE_TOO_LARGE'].includes(error.code)?error.message:'No se pudo verificar SFTP. Detalles sensibles omitidos.'}));process.exitCode=1;}})();
