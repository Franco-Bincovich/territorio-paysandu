import path from 'node:path';
import { createHash } from 'node:crypto';
import { HttpError } from '../security';
import { imageError, localImageError, imagePadCod, imageDirectory, kindValue, surveyExtensions, noSurvey, surveyFilenames, type Kind, type ParcelImageRef } from './config';
import type { ImageReader, ImageFileReader } from '../image-reader';
import { filesystemEnvironment } from '../filesystem-images/reader';
import { HistoricalIndex } from './historical-index';
import { createImageServices, imageServices } from './runtime';

export function mediaType(buffer:Buffer) {
  if(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(buffer.length>=3&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return 'image/jpeg';
  if(buffer.subarray(0,4).toString()==='RIFF'&&buffer.subarray(8,12).toString()==='WEBP')return 'image/webp';
  if(buffer.subarray(0,5).toString()==='%PDF-')return 'application/pdf';
  throw imageError('IMAGE_INVALID',415);
}
const safeHeaders={'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
function indexedFileError(kind:Kind,error:unknown) {
  error=localImageError(error);
  return kind==='historical'&&error instanceof HttpError&&error.code==='IMAGE_NOT_FOUND'
    ?imageError('IMAGE_INDEXED_FILE_MISSING',404):error;
}
export class SftpImages {
  private pendingCatalogues=new Map<string,Promise<Awaited<ReturnType<SftpImages['catalogueRead']>>>>();
  private reader:ImageReader;
  private provider:'sftp'|'filesystem';
  readonly historical:HistoricalIndex;
  constructor(private env:NodeJS.ProcessEnv=process.env,reader?:ImageReader,historical?:HistoricalIndex) {
    this.provider=env.IMAGE_PROVIDER==='filesystem'?'filesystem':'sftp';
    if(this.provider==='filesystem')this.env=filesystemEnvironment(env);
    const services=reader||env!==process.env?createImageServices(env,reader):imageServices();
    this.reader=services.reader;this.historical=historical??services.historical;
    this.historical.start();
  }
  placeholders(padCod:string) {imagePadCod(padCod);return (['historical','survey'] as const).map(kind=>({kind,provider:this.provider,url:null,source:'Archivo institucional',unavailableReason:'Consultando disponibilidad de imágenes.'}));}
  private historicalReference(ref:ParcelImageRef){
    try{const selected=this.historical.lookup(ref);
      return {directory:imageDirectory('historical',this.env),filename:selected.filename,type:'image/png',year:selected.year};
    }catch(error){throw localImageError(error);}
  }
  private async reference(r:ImageFileReader,kind:Kind,ref:ParcelImageRef) {
    if(kind==='historical')return this.historicalReference(ref);
    const directory=imageDirectory(kind,this.env);
    const extensions=surveyExtensions(this.env);if(!extensions.includes('png'))throw imageError('IMAGE_NOT_FOUND',404);
    const names=surveyFilenames(ref);
    // The validating file read is authoritative for the single exact name.
    // Do not repeat its directory/file metadata checks during resolution.
    if(names.length===1)return {directory,filename:names[0],type:'image/png'};
    const matches:string[]=[];
    for(const filename of names){
      try{await r.lstat(path.posix.join(directory,filename));matches.push(filename);}
      catch(error){if(!(error instanceof HttpError)||error.code!=='IMAGE_NOT_FOUND')throw error;}
    }
    if(!matches.length){await r.directory(directory);throw imageError('IMAGE_NOT_FOUND',404);}
    if(matches.length!==1){console.warn(JSON.stringify({event:'image_resolution',slot:'survey',code:'IMAGE_AMBIGUOUS'}));throw imageError('IMAGE_AMBIGUOUS',409);}
    return {directory,filename:matches[0],type:'image/png'};
  }

  catalogue(ref:ParcelImageRef) {
    imagePadCod(ref.padCod);const key=JSON.stringify([ref.padCod,ref.locality,ref.parcel]);
    const existing=this.pendingCatalogues.get(key);if(existing)return existing;
    if(this.pendingCatalogues.size>=3)return this.catalogueRead(ref);
    const pending=this.catalogueRead(ref).finally(()=>{if(this.pendingCatalogues.get(key)===pending)this.pendingCatalogues.delete(key);});
    this.pendingCatalogues.set(key,pending);return pending;
  }
  private async catalogueRead(ref:ParcelImageRef) {
    const padCod=imagePadCod(ref.padCod);
    const unavailable=(kind:Kind,failure:unknown)=>{const error=localImageError(failure);return {kind,provider:this.provider,url:null,source:'Archivo institucional',unavailableCode:error.code,
      unavailableReason:error.code==='IMAGE_NOT_FOUND'?(kind==='survey'?noSurvey:'Este padrón aún no registra imágenes históricas'):error.message};};
    let historical:ReturnType<SftpImages['historicalReference']>|undefined,historicalError:unknown;
    try{historical=this.historicalReference(ref);}catch(error){historicalError=error;}
    try{return await this.reader.read(async(r,max)=>{
      const results=[];
      for(const kind of ['historical','survey'] as const){try{if(kind==='historical'&&historicalError)throw historicalError;const file=kind==='historical'?historical!:await this.reference(r,kind,ref);const {stat}=await r.file(file.directory,file.filename,max).catch(error=>{throw indexedFileError(kind,error);});const version=createHash('sha256').update(`${file.filename}:${stat.size}:${stat.mtime}`).digest('hex').slice(0,16);
        results.push({kind,provider:this.provider,source:'Archivo institucional',mediaType:file.type,url:`/api/parcel-image/${kind}?padCod=${padCod}&v=${version}`});}
        catch(error){results.push(unavailable(kind,error));}}
      return results;
    },'catalogue');}catch(error){return [unavailable('historical',historicalError??error),unavailable('survey',error)];}
  }
  async download(kindInput:string,ref:ParcelImageRef,signal?:AbortSignal) {
    const kind=kindValue(kindInput),padCod=imagePadCod(ref.padCod);
    const historical=kind==='historical'?this.historicalReference(ref):undefined;
    return this.reader.read(async(r,max)=>{const file=historical??await this.reference(r,kind,ref);const bytes=await r.download(file.directory,file.filename,max).catch(error=>{throw indexedFileError(kind,error);});const detected=mediaType(bytes);if(detected!==file.type)throw imageError('IMAGE_INVALID',415);
      let offset=0;
      const body=this.provider==='filesystem'?new ReadableStream<Uint8Array>({pull(controller){if(offset>=bytes.length){controller.close();return;}const end=Math.min(offset+65536,bytes.length);controller.enqueue(bytes.subarray(offset,end));offset=end;}}):new Uint8Array(bytes);
      return new Response(body,{headers:{...safeHeaders,'Content-Type':detected,'Content-Length':String(bytes.length),'Content-Disposition':`inline; filename="${kind}-${padCod}.${detected==='application/pdf'?'pdf':detected==='image/jpeg'?'jpg':detected.split('/')[1]}"`,
        'Content-Security-Policy':"default-src 'none'; frame-ancestors 'self'; sandbox"}});
    },'download',signal).catch(error=>{throw localImageError(error);});
  }
  async checkReadOnly() {return this.reader.read(async r=>{
    const result=[];for(const kind of ['historical','survey'] as const){const count=await r.directoryCount(imageDirectory(kind,this.env));result.push({slot:kind,entries:count,empty:count===0});}
    return this.provider==='filesystem'
      ? {status:'PASS',provider:this.provider,readOnlyOperations:true,directories:result}
      : {status:'PASS',authenticated:true,hostKeyVerified:true,username:'sftp-lectura',readOnlyOperations:true,directories:result};
  });}
}
