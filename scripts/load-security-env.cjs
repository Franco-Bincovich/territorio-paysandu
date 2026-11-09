const fs=require('node:fs'),path=require('node:path'),{parseEnv}=require('node:util');
function securityEnvironment(base=process.env){const env={...base},file=path.resolve(__dirname,'../Backend/server/security/.env.local');if(fs.existsSync(file)){const parsed=parseEnv(fs.readFileSync(file,'utf8'));for(const k of ['SECURITY_REDIS_HOST','SECURITY_REDIS_PORT','SECURITY_REDIS_USER','SECURITY_REDIS_PASSWORD','SECURITY_REDIS_TLS','SECURITY_REDIS_CA_FILE','SECURITY_PROXY_SECRET'])if(Object.hasOwn(parsed,k))env[k]=parsed[k];}return env;}
module.exports={securityEnvironment};
