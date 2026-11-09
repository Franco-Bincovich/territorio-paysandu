import { Client, type SFTPWrapper, type Stats } from 'ssh2';
import { createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { HttpError } from '../security';
import { imageError, sftpConfiguration } from './config';

function sanitized(error:unknown):HttpError {
  if(error instanceof HttpError)return error;
  const e=error as {code?:number;level?:string};
  if(e.code===2)return imageError('IMAGE_NOT_FOUND',404);
  if(e.code===3)return imageError('IMAGE_ACCESS_DENIED',403);
  if(e.level==='client-authentication')return imageError('IMAGE_AUTHENTICATION');
  return imageError('IMAGE_CONNECTION');
}
export class SftpReader {
  private active=0;
  constructor(private env:NodeJS.ProcessEnv=process.env) {}
  async read<T>(run:(reader:ReadOnlySftp,maxBytes:number)=>Promise<T>):Promise<T> {
    if(this.active>=3)throw imageError('IMAGE_BUSY');
    this.active++;
    const client=new Client();let timer:ReturnType<typeof setTimeout>|undefined;
    try {
      let config:ReturnType<typeof sftpConfiguration>;
      try{config=sftpConfiguration(this.env);}catch(error){throw error instanceof HttpError?error:imageError('IMAGE_CONFIG');}
      return await new Promise<T>((resolve,reject)=>{
        let done=false;
        const finish=(error:unknown,value?:T)=>{if(done)return;done=true;error?reject(sanitized(error)):resolve(value as T);};
        timer=setTimeout(()=>{finish(imageError('IMAGE_CONNECTION'));client.destroy();},config.timeout);
        client.on('error',error=>finish(error));
        client.on('close',()=>finish(imageError('IMAGE_CONNECTION')));
        client.on('ready',()=>client.sftp((error,sftp)=>{
          if(error){finish(error);return;}
          const reader=new ReadOnlySftp(sftp);
          run(reader,config.maxBytes).then(value=>finish(null,value),finish);
        }));
        client.connect({host:config.host,port:config.port,username:config.username,password:config.password,privateKey:config.privateKey,passphrase:config.passphrase,readyTimeout:config.timeout,
          authHandler:config.privateKey?['publickey']:['password'],algorithms:{serverHostKey:['ssh-ed25519']},keepaliveInterval:3000,keepaliveCountMax:1,
          hostVerifier:(key:Buffer)=>{const actual=createHash('sha256').update(key).digest();const valid=actual.length===config.fingerprint.length&&timingSafeEqual(actual,config.fingerprint);if(!valid)finish(imageError('IMAGE_HOST_KEY'));return valid;}});
      });
    }finally{if(timer)clearTimeout(timer);client.destroy();this.active--;}
  }
}
// The application exposes NO upload, write, rename, delete, exec or shell methods.
export class ReadOnlySftp {
  constructor(private sftp:SFTPWrapper) {}
  private invoke<T>(fn:(callback:(error:Error|null|undefined,value?:T)=>void)=>void):Promise<T>{return new Promise((resolve,reject)=>fn((error,value)=>error?reject(sanitized(error)):resolve(value as T)));}
  lstat(file:string){return this.invoke<Stats>(cb=>this.sftp.lstat(file,cb));}
  realpath(file:string){return this.invoke<string>(cb=>this.sftp.realpath(file,cb));}
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
      const chunks:Buffer[]=[];let total=0;
      for(;;){const buffer=Buffer.alloc(Math.min(65536,maxBytes+1-total));const count=await new Promise<number>((resolve,reject)=>this.sftp.read(handle,buffer,0,buffer.length,total,(e,n)=>e?reject(sanitized(e)):resolve(n)));
        if(!count)break;total+=count;if(total>maxBytes)throw imageError('IMAGE_TOO_LARGE',413);chunks.push(buffer.subarray(0,count));}
      if(total!==opened.size)throw imageError('IMAGE_INVALID',415);
      return Buffer.concat(chunks,total);
    }finally{await this.invoke<void>(cb=>this.sftp.close(handle,cb));}
  }
  async directoryCount(directory:string) {
    await this.directory(directory);
    const handle=await this.invoke<Buffer>(cb=>this.sftp.opendir(directory,cb));let count=0;
    try {for(;;){const rows=await this.directoryPage(handle);if(rows===false)break;count+=rows.filter((r:any)=>!['.','..'].includes(r.filename)).length;if(count>10000)throw imageError('IMAGE_TOO_LARGE',413);}return count;}
    finally{await this.invoke<void>(cb=>this.sftp.close(handle,cb));}
  }
  async filenames(directory:string,maxEntries=10000) {
    await this.directory(directory);
    const handle=await this.invoke<Buffer>(cb=>this.sftp.opendir(directory,cb));const result:string[]=[];
    try{for(;;){const rows=await this.directoryPage(handle);if(rows===false)break;
      for(const row of rows){if(['.','..'].includes(row.filename))continue;result.push(row.filename);if(result.length>maxEntries)throw imageError('IMAGE_TOO_LARGE',413);}}
      return result;
    }finally{await this.invoke<void>(cb=>this.sftp.close(handle,cb));}
  }
  private directoryPage(handle:Buffer):Promise<any[]|false>{
    return new Promise((resolve,reject)=>this.sftp.readdir(handle,(error,rows)=>{
      if((error as {code?:number})?.code===1){resolve(false);return;}
      if(error)reject(sanitized(error));else resolve(rows);
    }));
  }
}
