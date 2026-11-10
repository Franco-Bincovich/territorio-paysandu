import { Client, type SFTPWrapper, type Stats } from 'ssh2';
import { createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import {ImageMetrics} from './metrics';
import { HttpError } from '../security';
import { imageError, sftpConfiguration } from './config';

function sanitized(error:unknown):HttpError {
  if(error instanceof HttpError)return error;
  const e=error as {code?:number|string;level?:string};
  if(e.level==='client-timeout'||e.code==='ETIMEDOUT')return imageError('IMAGE_TIMEOUT');
  if(e.code===2)return imageError('IMAGE_NOT_FOUND',404);
  if(e.code===3)return imageError('IMAGE_ACCESS_DENIED',403);
  if(e.level==='client-authentication')return imageError('IMAGE_AUTHENTICATION');
  return imageError('IMAGE_CONNECTION');
}
export class SftpReader {
  private active=0;
  private clients=new Set<Client>();
  constructor(private env:NodeJS.ProcessEnv=process.env) {}
  close(){for(const client of this.clients)client.destroy();}
  async read<T>(run:(reader:ReadOnlySftp,maxBytes:number)=>Promise<T>,operation='read',signal?:AbortSignal):Promise<T> {
    const metrics=new ImageMetrics(this.env.SFTP_IMAGES_METRICS==='true',operation);let failure:unknown;
    if(this.active>=3){const error=imageError('IMAGE_BUSY');metrics.finish(error);throw error;}
    this.active++;
    const client=new Client();this.clients.add(client);let timer:ReturnType<typeof setTimeout>|undefined;let abort:(()=>void)|undefined;
    try {
      let config:ReturnType<typeof sftpConfiguration>;
      try{config=sftpConfiguration(this.env);}catch(error){throw error instanceof HttpError?error:imageError('IMAGE_CONFIG');}
      return await new Promise<T>((resolve,reject)=>{
        let done=false;
        const finish=(error:unknown,value?:T)=>{if(done)return;done=true;error?reject(sanitized(error)):resolve(value as T);};
        abort=()=>{finish(imageError('IMAGE_CONNECTION'));client.destroy();};
        signal?.addEventListener('abort',abort,{once:true});
        if(signal?.aborted){abort();return;}
        timer=setTimeout(()=>{finish(imageError('IMAGE_TIMEOUT'));client.destroy();},config.timeout);
        client.on('error',error=>finish(error));
        client.on('close',()=>finish(imageError('IMAGE_CONNECTION')));
        const connected=metrics.begin('ssh_connect');
        client.on('ready',()=>{connected();const opened=metrics.begin('sftp_open');client.sftp((error,sftp)=>{
          opened();
          if(error){finish(error);return;}
          const reader=new ReadOnlySftp(sftp,metrics);
          run(reader,config.maxBytes).then(value=>finish(null,value),finish);
        });});
        metrics.connections++;client.connect({host:config.host,port:config.port,username:config.username,password:config.password,privateKey:config.privateKey,passphrase:config.passphrase,readyTimeout:config.timeout,
          authHandler:config.privateKey?['publickey']:['password'],algorithms:{serverHostKey:['ssh-ed25519']},keepaliveInterval:3000,keepaliveCountMax:1,
          hostVerifier:(key:Buffer)=>{const actual=createHash('sha256').update(key).digest();const valid=actual.length===config.fingerprint.length&&timingSafeEqual(actual,config.fingerprint);if(!valid)finish(imageError('IMAGE_HOST_KEY'));return valid;}});
      });
    }catch(error){failure=error;throw error;}finally{metrics.finish(failure);if(timer)clearTimeout(timer);if(abort)signal?.removeEventListener('abort',abort);client.destroy();this.clients.delete(client);this.active--;}
  }
}
// The application exposes NO upload, write, rename, delete, exec or shell methods.
export class ReadOnlySftp {
  constructor(private sftp:SFTPWrapper,private metrics?:ImageMetrics) {}
  private measure<T>(stage:string,run:()=>Promise<T>){return this.metrics?this.metrics.measure(stage,run):run();}
  private invoke<T>(fn:(callback:(error:Error|null|undefined,value?:T)=>void)=>void,stage='metadata'):Promise<T>{return this.measure(stage,()=>new Promise((resolve,reject)=>fn((error,value)=>error?reject(sanitized(error)):resolve(value as T))));}
  lstat(file:string){return this.invoke<Stats>(cb=>this.sftp.lstat(file,cb),'lstat');}
  realpath(file:string){return this.invoke<string>(cb=>this.sftp.realpath(file,cb),'realpath');}
  async directory(directory:string) {
    try{const stat=await this.lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw imageError('IMAGE_ACCESS_DENIED',403);
      return await this.realpath(directory);
    }catch(error){if(error instanceof HttpError&&error.code==='IMAGE_NOT_FOUND')throw imageError('IMAGE_CONFIG');throw error;}
  }
  async file(directory:string,filename:string,maxBytes:number) {
    const root=await this.directory(directory),file=path.posix.join(directory,filename);
    const stat=await this.lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink())throw imageError('IMAGE_ACCESS_DENIED',403);
    if(stat.size<=0)throw imageError('IMAGE_INVALID',415);
    if(stat.size>maxBytes)throw imageError('IMAGE_TOO_LARGE',413);
    const canonical=await this.realpath(file);
    if(path.posix.dirname(canonical)!==root)throw imageError('IMAGE_ACCESS_DENIED',403);
    return {file,canonical,stat};
  }
  async download(directory:string,filename:string,maxBytes:number) {
    const checked=await this.file(directory,filename,maxBytes);
    const handle=await this.invoke<Buffer>(cb=>this.sftp.open(checked.file,'r',cb));
    try {
      const opened=await this.invoke<Stats>(cb=>this.sftp.fstat(handle,cb));
      if(!opened.isFile()||opened.size!==checked.stat.size||await this.realpath(checked.file)!==checked.canonical||(await this.lstat(checked.file)).isSymbolicLink())throw imageError('IMAGE_ACCESS_DENIED',403);
      // Bound both memory and outstanding read requests. Sequential SSH round
      // trips per block can exhaust the total deadline for otherwise small PNGs.
      const bytes=Buffer.alloc(opened.size);let next=0,failed=false;
      const read=(offset:number,length:number)=>this.measure('read',()=>new Promise<number>((resolve,reject)=>this.sftp.read(handle,bytes,offset,length,offset,(error,count)=>error?reject(sanitized(error)):resolve(count))));
      const worker=async()=>{
        try{while(!failed&&next<bytes.length){const start=next,end=Math.min(start+65536,bytes.length);next=end;let offset=start;
          while(!failed&&offset<end){const count=await read(offset,end-offset);if(count<=0||count>end-offset)throw imageError('IMAGE_INVALID',415);offset+=count;}
        }}catch(error){failed=true;throw error;}
      };
      // Drain siblings before closing the handle, including on partial failure.
      const results=await Promise.allSettled(Array.from({length:Math.min(4,Math.ceil(bytes.length/65536))},worker));
      const failure=results.find((result):result is PromiseRejectedResult=>result.status==='rejected');if(failure)throw failure.reason;
      // Preserve the original EOF/length check: never silently accept growth.
      const probe=Buffer.alloc(1);const extra=await new Promise<number>((resolve,reject)=>this.sftp.read(handle,probe,0,1,bytes.length,(error,count)=>error?reject(sanitized(error)):resolve(count)));
      if(extra)throw imageError(bytes.length===maxBytes?'IMAGE_TOO_LARGE':'IMAGE_INVALID',bytes.length===maxBytes?413:415);
      return bytes;
    }finally{await this.invoke<void>(cb=>this.sftp.close(handle,cb));}
  }
  async directoryCount(directory:string) {return (await this.filenames(directory,100000,16*1024*1024)).length;}
  async filenames(directory:string,maxEntries=10000,maxNameBytes=Infinity) {
    return this.measure('list',async()=>{
      await this.directory(directory);
      const handle=await this.invoke<Buffer>(cb=>this.sftp.opendir(directory,cb),'opendir');const result:string[]=[];let bytes=0;
      try{let eof=false;while(!eof){
        // SFTP request IDs permit independent READDIR replies on one handle.
        // Drain each bounded batch before EOF/error handling or handle closure.
        const pages=await Promise.allSettled(Array.from({length:4},()=>this.directoryPage(handle)));
        const failure=pages.find((page):page is PromiseRejectedResult=>page.status==='rejected');if(failure)throw failure.reason;
        for(const page of pages){if(page.status!=='fulfilled')continue;if(page.value===false){eof=true;continue;}
          for(const row of page.value){if(['.','..'].includes(row.filename))continue;if(result.length>=maxEntries)throw imageError('IMAGE_TOO_LARGE',413);bytes+=Buffer.byteLength(row.filename,'utf8');if(bytes>maxNameBytes)throw imageError('IMAGE_INDEX_LIMIT');result.push(row.filename);}}
      }return result;
      }finally{await this.invoke<void>(cb=>this.sftp.close(handle,cb));}
    });
  }
  private directoryPage(handle:Buffer):Promise<any[]|false>{
    return this.measure('readdir',()=>new Promise((resolve,reject)=>this.sftp.readdir(handle,(error,rows)=>{
      if((error as {code?:number})?.code===1){resolve(false);return;}
      if(error)reject(sanitized(error));else resolve(rows);
    })));
  }
}
