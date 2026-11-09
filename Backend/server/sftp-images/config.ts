import { readFileSync, statSync } from 'node:fs';
import { HttpError } from '../security';

export const SFTP_ENV_KEYS = ['SFTP_IMAGES_ENABLED','SFTP_IMAGES_HOST','SFTP_IMAGES_PORT','SFTP_IMAGES_USER','SFTP_IMAGES_PASSWORD','SFTP_IMAGES_PRIVATE_KEY_FILE','SFTP_IMAGES_PRIVATE_KEY_PASSPHRASE','SFTP_IMAGES_HOST_KEY_SHA256','SFTP_IMAGES_HOST_KEY_VERIFIED','SFTP_IMAGES_TIMEOUT_MS','SFTP_IMAGES_MAX_BYTES','SFTP_IMAGES_MAX_ENTRIES','SFTP_IMAGES_SURVEY_MAPPING_CONFIRMED','SFTP_IMAGES_HISTORICAL_DIRECTORY','SFTP_IMAGES_SURVEY_DIRECTORY','SFTP_IMAGES_SURVEY_BASENAME','SFTP_IMAGES_SURVEY_EXTENSIONS'] as const;
export type Kind = 'historical'|'survey';
export const noSurvey='Este padrón aún no registra imágenes de relevamiento';
export function imageError(code:string,status=503) {
  const messages:Record<string,string>={IMAGE_NOT_FOUND:'Imagen no encontrada.',IMAGE_CONNECTION:'No se pudo conectar al servidor de imágenes.',IMAGE_ACCESS_DENIED:'El servidor de imágenes denegó el acceso.',IMAGE_AUTHENTICATION:'No se pudo autenticar el acceso al servidor de imágenes.',IMAGE_HOST_KEY:'No se pudo verificar la identidad del servidor de imágenes.',IMAGE_HOST_KEY_UNVERIFIED:'La identidad del servidor de imágenes está pendiente de verificación independiente.',IMAGE_CONFIG:'El acceso a imágenes no está configurado.',IMAGE_MAPPING_PENDING:'La asociación de archivos de relevamiento está pendiente de confirmación.',IMAGE_INVALID:'El archivo no es una imagen o PDF válido.',IMAGE_TOO_LARGE:'El archivo supera el tamaño permitido.',IMAGE_AMBIGUOUS:'Hay más de un archivo asociado; se requiere revisar la referencia.',IMAGE_BUSY:'El servicio de imágenes está ocupado. Reintentá en unos instantes.'};
  return new HttpError(status,code,messages[code]??'Las imágenes no están disponibles.');
}
export function imagePadCod(value:unknown) {
  if(typeof value!=='string'||!(/^[1-9]\d{0,18}$/).test(value)||BigInt(value)>9223372036854775807n)
    throw new HttpError(400,'VALIDATION','Identificador de padrón inválido.');
  return value;
}
export function kindValue(value:string):Kind {if(value!=='historical'&&value!=='survey')throw imageError('IMAGE_NOT_FOUND',404);return value;}
const number=(value:string|undefined,fallback:number,min:number,max:number)=>{const n=value===undefined?fallback:Number(value);if(!Number.isInteger(n)||n<min||n>max)throw imageError('IMAGE_CONFIG');return n;};
export function sftpConfiguration(env:NodeJS.ProcessEnv=process.env) {
  if(env.SFTP_IMAGES_HOST_KEY_VERIFIED!=='true')throw imageError('IMAGE_HOST_KEY_UNVERIFIED');
  if(env.SFTP_IMAGES_ENABLED!=='true'||!env.SFTP_IMAGES_HOST||env.SFTP_IMAGES_USER!=='sftp-lectura'||!/^SHA256:[A-Za-z0-9+/]{43}=?$/.test(env.SFTP_IMAGES_HOST_KEY_SHA256??''))throw imageError('IMAGE_CONFIG');
  if(!!env.SFTP_IMAGES_PASSWORD===!!env.SFTP_IMAGES_PRIVATE_KEY_FILE)throw imageError('IMAGE_CONFIG');
  let privateKey:Buffer|undefined;
  if(env.SFTP_IMAGES_PRIVATE_KEY_FILE){if(statSync(env.SFTP_IMAGES_PRIVATE_KEY_FILE).size>65536)throw imageError('IMAGE_CONFIG');privateKey=readFileSync(env.SFTP_IMAGES_PRIVATE_KEY_FILE);}
  return {host:env.SFTP_IMAGES_HOST,port:number(env.SFTP_IMAGES_PORT,22,1,65535),username:'sftp-lectura',password:env.SFTP_IMAGES_PASSWORD,privateKey,passphrase:env.SFTP_IMAGES_PRIVATE_KEY_PASSPHRASE,
    fingerprint:Buffer.from(env.SFTP_IMAGES_HOST_KEY_SHA256!.slice(7),'base64'),timeout:number(env.SFTP_IMAGES_TIMEOUT_MS,10000,500,15000),maxBytes:number(env.SFTP_IMAGES_MAX_BYTES,10*1024*1024,1024,20*1024*1024)};
}
export function naming(kind:Kind,env:NodeJS.ProcessEnv=process.env) {
  const prefix=kind==='historical'?'SFTP_IMAGES_HISTORICAL':'SFTP_IMAGES_SURVEY';
  const directory=env[prefix+'_DIRECTORY']??(kind==='historical'?'/Satelitales':'/PDFs');
  const basename=kind==='historical'?'{padCod}':env[prefix+'_BASENAME']??'';
  const extensions=(env[prefix+'_EXTENSIONS']??(kind==='historical'?'jpg,jpeg,png,webp':'pdf,jpg,jpeg,png,webp')).split(',');
  if(!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(directory)||!basename.includes('{padCod}')||basename.split('{padCod}').length!==2||!/^[A-Za-z0-9_-]*\{padCod\}[A-Za-z0-9_-]*$/.test(basename)||extensions.length<1||extensions.length>5||new Set(extensions).size!==extensions.length||extensions.some(e=>!['jpg','jpeg','png','webp','pdf'].includes(e)))throw imageError('IMAGE_CONFIG');
  return {directory,basename,extensions};
}
export function imageDirectory(kind:Kind,env:NodeJS.ProcessEnv=process.env) {
  const value=env[kind==='historical'?'SFTP_IMAGES_HISTORICAL_DIRECTORY':'SFTP_IMAGES_SURVEY_DIRECTORY']??(kind==='historical'?'/Satelitales':'/PDFs');
  if(!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(value))throw imageError('IMAGE_CONFIG');return value;
}
export type ParcelImageRef={padCod:string;locality:string;parcel:string};
export function localityToken(value:string) {
  const slug=value.normalize('NFD').replace(/\p{M}/gu,'').trim().toUpperCase().replace(/[\s_]+/g,'_');
  if(!/^[A-Z0-9]+(?:_[A-Z0-9]+)*$/.test(slug))throw imageError('IMAGE_AMBIGUOUS',409);return slug;
}
/** Exact locality/parcel contract. ANTES is a delimited token, not a substring.
 * Year is read from the filename, not asserted as an independently verified date.
 */
export function selectHistorical(names:string[],ref:ParcelImageRef) {
  imagePadCod(ref.padCod);if(!/^\d{1,30}$/.test(ref.parcel))throw imageError('IMAGE_AMBIGUOUS',409);
  const slug=localityToken(ref.locality),pattern=new RegExp(`^(\\d{4})_${slug}_${ref.parcel}(?:_([A-Za-z0-9_-]+))?\\.png$`,'i');
  const candidates=names.flatMap(filename=>{if(filename.length>255)return [];const m=pattern.exec(filename);return m&&Number(m[1])>0?[{filename,year:Number(m[1]),before:(m[2]??'').split(/[_-]+/).some(t=>t.toUpperCase()==='ANTES')}]:[];});
  if(!candidates.length)throw imageError('IMAGE_NOT_FOUND',404);
  const unique=new Set<string>();for(const c of candidates){const key=c.filename.toUpperCase();if(unique.has(key))throw imageError('IMAGE_AMBIGUOUS',409);unique.add(key);}
  candidates.sort((a,b)=>Number(b.before)-Number(a.before)||a.year-b.year||(a.filename.toUpperCase()<b.filename.toUpperCase()?-1:a.filename.toUpperCase()>b.filename.toUpperCase()?1:0));
  return candidates[0];
}
