// Private explicit allowlist. No connection, logging or Node CLI flag propagation.
const fs=require('node:fs');
const path=require('node:path');
const {parseEnv}=require('node:util');
const file=path.resolve(__dirname,'../Backend/server/sftp-images/.env.local');
const keys=['SFTP_IMAGES_ENABLED','SFTP_IMAGES_HOST','SFTP_IMAGES_PORT','SFTP_IMAGES_USER','SFTP_IMAGES_PASSWORD','SFTP_IMAGES_PRIVATE_KEY_FILE','SFTP_IMAGES_PRIVATE_KEY_PASSPHRASE','SFTP_IMAGES_HOST_KEY_SHA256','SFTP_IMAGES_HOST_KEY_VERIFIED','SFTP_IMAGES_TIMEOUT_MS','SFTP_IMAGES_MAX_BYTES','SFTP_IMAGES_MAX_ENTRIES','SFTP_IMAGES_HISTORICAL_DIRECTORY','SFTP_IMAGES_SURVEY_DIRECTORY','SFTP_IMAGES_SURVEY_MAPPING_CONFIRMED','SFTP_IMAGES_SURVEY_BASENAME','SFTP_IMAGES_SURVEY_EXTENSIONS'];
function sftpEnvironment(base=process.env){const env={...base};if(fs.existsSync(file)){const parsed=parseEnv(fs.readFileSync(file,'utf8'));for(const k of keys)if(Object.hasOwn(parsed,k))env[k]=parsed[k];if(parsed.IMAGE_PROVIDER==='sftp')env.IMAGE_PROVIDER='sftp';}return env;}
module.exports={sftpEnvironment};
