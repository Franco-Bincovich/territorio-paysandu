import { readFileSync, statSync } from 'node:fs';
import { HttpError } from '../security';

export const SFTP_ENV_KEYS = ['SFTP_IMAGES_ENABLED','SFTP_IMAGES_HOST','SFTP_IMAGES_PORT','SFTP_IMAGES_USER','SFTP_IMAGES_PASSWORD','SFTP_IMAGES_PRIVATE_KEY_FILE','SFTP_IMAGES_PRIVATE_KEY_PASSPHRASE','SFTP_IMAGES_HOST_KEY_SHA256','SFTP_IMAGES_HOST_KEY_VERIFIED','SFTP_IMAGES_TIMEOUT_MS','SFTP_IMAGES_MAX_BYTES','SFTP_IMAGES_MAX_ENTRIES','SFTP_IMAGES_HISTORICAL_DIRECTORY','SFTP_IMAGES_SURVEY_DIRECTORY','SFTP_IMAGES_SURVEY_EXTENSIONS'] as const;
export type Kind = 'historical'|'survey';
export const noSurvey='Este padrón aún no registra imágenes de relevamiento';
export function imageError(code:string,status=503) {
  const messages:Record<string,string>={IMAGE_INDEXED_FILE_MISSING:'La imagen histórica indexada ya no está disponible. Reintentá más tarde.',IMAGE_CATALOG_UNAVAILABLE:'El catálogo de imágenes históricas no está disponible. Reintentá más tarde.',IMAGE_INDEX_LIMIT:'El catálogo de imágenes históricas supera los límites de seguridad.',IMAGE_NOT_FOUND:'Imagen no encontrada.',IMAGE_TIMEOUT:'El servidor de im\u00e1genes agot\u00f3 el tiempo de espera. Reintent\u00e1 en unos instantes.',IMAGE_CONNECTION:'No se pudo conectar al servidor de imágenes.',IMAGE_ACCESS_DENIED:'El servidor de imágenes denegó el acceso.',IMAGE_AUTHENTICATION:'No se pudo autenticar el acceso al servidor de imágenes.',IMAGE_HOST_KEY:'No se pudo verificar la identidad del servidor de imágenes.',IMAGE_HOST_KEY_UNVERIFIED:'La identidad del servidor de imágenes está pendiente de verificación independiente.',IMAGE_CONFIG:'El acceso a imágenes no está configurado.',IMAGE_MAPPING_PENDING:'La asociación de archivos de relevamiento está pendiente de confirmación.',IMAGE_INVALID:'El archivo no es una imagen o PDF válido.',IMAGE_TOO_LARGE:'El archivo supera el tamaño permitido.',IMAGE_AMBIGUOUS:'Hay más de un archivo asociado; se requiere revisar la referencia.',IMAGE_BUSY:'El servicio de imágenes está ocupado. Reintentá en unos instantes.'};
  messages.IMAGE_READ='No se pudieron leer las imágenes. Reintentá más tarde.';
  messages.IMAGE_CANCELLED='Solicitud cancelada.';
  messages.IMAGE_QUEUE_TIMEOUT='El servicio de imágenes agotó la espera. Reintentá en unos instantes.';
  return new HttpError(status,code,messages[code]??'Las imágenes no están disponibles.');
}
// Instrumentation and route bundles may have different HttpError constructors.
// Only known internal codes cross that boundary; never forward an arbitrary message/status.
const imageStatuses:Record<string,number>={IMAGE_NOT_FOUND:404,IMAGE_TIMEOUT:503,IMAGE_CONNECTION:503,
  IMAGE_ACCESS_DENIED:403,IMAGE_AUTHENTICATION:503,IMAGE_HOST_KEY:503,IMAGE_HOST_KEY_UNVERIFIED:503,
  IMAGE_CONFIG:503,IMAGE_MAPPING_PENDING:503,IMAGE_INVALID:415,IMAGE_TOO_LARGE:413,IMAGE_AMBIGUOUS:409,
  IMAGE_BUSY:503,IMAGE_CATALOG_UNAVAILABLE:503,IMAGE_INDEX_LIMIT:503,IMAGE_INDEXED_FILE_MISSING:404,
  IMAGE_READ:503,IMAGE_CANCELLED:499,IMAGE_QUEUE_TIMEOUT:503};
export function localImageError(error:unknown):HttpError {
  if(error instanceof HttpError)return error;
  const code=(error as {code?:unknown}|null)?.code;
  return typeof code==='string'&&Object.hasOwn(imageStatuses,code)?imageError(code,imageStatuses[code]):imageError('IMAGE_CONNECTION');
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
export function surveyExtensions(env:NodeJS.ProcessEnv=process.env) {
  const extensions=(env.SFTP_IMAGES_SURVEY_EXTENSIONS??'png').split(',').map(e=>e.trim().toLowerCase());
  if(extensions.length<1||extensions.length>5||new Set(extensions).size!==extensions.length||extensions.some(e=>!['jpg','jpeg','png','webp','pdf'].includes(e)))throw imageError('IMAGE_CONFIG');
  return extensions;
}
export function imageDirectory(kind:Kind,env:NodeJS.ProcessEnv=process.env) {
  const value=env[kind==='historical'?'SFTP_IMAGES_HISTORICAL_DIRECTORY':'SFTP_IMAGES_SURVEY_DIRECTORY']??(kind==='historical'?'/Satelitales/IMAGENES_HISTORICAS':'/Satelitales/IMAGENES_ACTUALES');
  if(env.IMAGE_PROVIDER==='filesystem')return value; // Validated once by filesystemEnvironment/FilesystemReader.
  if(!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(value))throw imageError('IMAGE_CONFIG');return value;
}
export type ParcelImageRef={padCod:string;locality:string;parcel:string};
export function localityToken(value:string) {
  const slug=value.normalize('NFD').replace(/\p{M}/gu,'').trim().toUpperCase().replace(/[\s_]+/g,'_');
  if(!/^[A-Z0-9]+(?:_[A-Z0-9]+)*$/.test(slug))throw imageError('IMAGE_AMBIGUOUS',409);return slug;
}
/** Approved exact remote names only; no case aliases or directory discovery. */
export function surveyFilenames(ref:ParcelImageRef){
  imagePadCod(ref.padCod);if(!/^\d{1,30}$/.test(ref.parcel))throw imageError('IMAGE_AMBIGUOUS',409);
  const token=localityToken(ref.locality);
  const names=[...new Set([`parcela_${ref.parcel}_${token.replaceAll('_',' ')}.png`,`parcela_${ref.parcel}_${token}.png`])];
  if(names.some(name=>name.length>255))throw imageError('IMAGE_AMBIGUOUS',409);return names;
}
/** Exact parcela_PADRON_LOCALIDAD.png contract. ASCII remote locality separators
 * may be spaces or underscores. Ambiguous normalized aliases fail closed.
 */
export function selectSurvey(names:string[],ref:ParcelImageRef,extensions:readonly string[]) {
  imagePadCod(ref.padCod);if(!/^\d{1,30}$/.test(ref.parcel))throw imageError('IMAGE_AMBIGUOUS',409);
  const locality=localityToken(ref.locality);
  const matches=names.flatMap(filename=>{
    if(filename.length>255)return [];
    const match=/^parcela_(\d{1,30})_([A-Za-z0-9]+(?:[ _]+[A-Za-z0-9]+)*)\.png$/i.exec(filename);
    return match&&match[1]===ref.parcel&&localityToken(match[2])===locality&&extensions.includes('png')?[{filename,extension:'png'}]:[];
  });
  if(!matches.length)throw imageError('IMAGE_NOT_FOUND',404);
  if(matches.length!==1)throw imageError('IMAGE_AMBIGUOUS',409);
  return matches[0];
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
