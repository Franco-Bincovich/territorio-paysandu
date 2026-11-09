import { createHash } from 'node:crypto';
import { HttpError } from '../security';
import { imageError, imagePadCod, imageDirectory, kindValue, naming, noSurvey, selectHistorical, type Kind, type ParcelImageRef } from './config';
import { SftpReader, type ReadOnlySftp } from './reader';

const types:Record<string,string>={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',pdf:'application/pdf'};
export function mediaType(buffer:Buffer) {
  if(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(buffer.length>=3&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return 'image/jpeg';
  if(buffer.subarray(0,4).toString()==='RIFF'&&buffer.subarray(8,12).toString()==='WEBP')return 'image/webp';
  if(buffer.subarray(0,5).toString()==='%PDF-')return 'application/pdf';
  throw imageError('IMAGE_INVALID',415);
}
const safeHeaders={'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
export class SftpImages {
  constructor(private env:NodeJS.ProcessEnv=process.env,private reader=new SftpReader(env)) {}
  placeholders(padCod:string) {imagePadCod(padCod);return (['historical','survey'] as const).map(kind=>({kind,provider:'sftp' as const,url:null,source:'Archivo institucional',unavailableReason:'Consultando disponibilidad de imágenes.'}));}
  private async reference(r:ReadOnlySftp,kind:Kind,ref:ParcelImageRef,maxBytes:number) {
    if(kind==='historical'){
      const directory=imageDirectory(kind,this.env),limit=Number(this.env.SFTP_IMAGES_MAX_ENTRIES??10000);
      if(!Number.isInteger(limit)||limit<1||limit>100000)throw imageError('IMAGE_CONFIG');
      const selected=selectHistorical(await r.filenames(directory,limit),ref);
      return {...await r.file(directory,selected.filename,maxBytes),directory,filename:selected.filename,type:'image/png',year:selected.year};
    }
    if(this.env.SFTP_IMAGES_SURVEY_MAPPING_CONFIRMED!=='true'){
      if(await r.directoryCount(imageDirectory(kind,this.env))===0)throw imageError('IMAGE_NOT_FOUND',404);
      throw imageError('IMAGE_MAPPING_PENDING');
    }
    const pattern=naming(kind,this.env),matches=[];
    // Only deterministic filenames for THIS PadCod. Never scan another parcel.
    for(const ext of pattern.extensions){const filename=pattern.basename.replace('{padCod}',ref.padCod)+'.'+ext;
      try{matches.push({...await r.file(pattern.directory,filename,maxBytes),directory:pattern.directory,filename,type:types[ext]});}
      catch(error){if(!(error instanceof HttpError)||error.code!=='IMAGE_NOT_FOUND')throw error;}}
    if(!matches.length)throw imageError('IMAGE_NOT_FOUND',404);
    if(matches.length>1)throw imageError('IMAGE_AMBIGUOUS',409);
    return matches[0];
  }
  async catalogue(ref:ParcelImageRef) {
    const padCod=imagePadCod(ref.padCod);
    const unavailable=(kind:Kind,error:unknown)=>({kind,provider:'sftp' as const,url:null,source:'Archivo institucional',unavailableCode:error instanceof HttpError?error.code:'IMAGE_CONNECTION',
      unavailableReason:error instanceof HttpError?(error.code==='IMAGE_NOT_FOUND'?(kind==='survey'?noSurvey:'Este padrón aún no registra imágenes históricas'):error.message):imageError('IMAGE_CONNECTION').message});
    try{return await this.reader.read(async(r,max)=>{
      const results=[];
      for(const kind of ['historical','survey'] as const){try{const file=await this.reference(r,kind,ref,max);const version=createHash('sha256').update(`${file.filename}:${file.stat.size}:${file.stat.mtime}`).digest('hex').slice(0,16);
        results.push({kind,provider:'sftp' as const,source:'Archivo institucional',mediaType:file.type,url:`/api/parcel-image/${kind}?padCod=${padCod}&v=${version}`});}
        catch(error){results.push(unavailable(kind,error));}}
      return results;
    });}catch(error){return (['historical','survey'] as const).map(kind=>unavailable(kind,error));}
  }
  async download(kindInput:string,ref:ParcelImageRef) {
    const kind=kindValue(kindInput),padCod=imagePadCod(ref.padCod);
    return this.reader.read(async(r,max)=>{const file=await this.reference(r,kind,ref,max);const bytes=await r.download(file.directory,file.filename,max);const detected=mediaType(bytes);if(detected!==file.type)throw imageError('IMAGE_INVALID',415);
      return new Response(new Uint8Array(bytes),{headers:{...safeHeaders,'Content-Type':detected,'Content-Length':String(bytes.length),'Content-Disposition':`inline; filename="${kind}-${padCod}.${detected==='application/pdf'?'pdf':detected==='image/jpeg'?'jpg':detected.split('/')[1]}"`,
        'Content-Security-Policy':"default-src 'none'; frame-ancestors 'self'; sandbox"}});
    });
  }
  async checkReadOnly() {return this.reader.read(async r=>{
    const result=[];for(const kind of ['historical','survey'] as const){const count=await r.directoryCount(imageDirectory(kind,this.env));result.push({slot:kind,entries:count,empty:count===0});}
    return {status:'PASS',authenticated:true,hostKeyVerified:true,username:'sftp-lectura',readOnlyOperations:true,directories:result};
  });}
}
