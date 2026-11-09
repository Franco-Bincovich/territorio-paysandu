import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { readFileSync } from 'node:fs';
import { HttpError } from './security';

export type Rule={key:string;capacity:number;period:number;cost:number};
export interface QuotaStore { consume(rules:Rule[]):Promise<number> }
export class LimitError extends HttpError {
  constructor(public retryAfter=60){super(429,'RATE_LIMIT','Demasiadas solicitudes. Esperá antes de reintentar.');}
}
const unavailable=()=>new HttpError(503,'SECURITY_UNAVAILABLE','El servicio no está disponible temporalmente.');
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
// Atomic token buckets: all limits succeed together, clock and state owned by Redis.
export const quotaScript=`
local tm=redis.call('TIME'); local now=tonumber(tm[1])*1000+math.floor(tonumber(tm[2])/1000)
local states={}; local retry=0
for i,key in ipairs(KEYS) do
 local j=(i-1)*3; local cap=tonumber(ARGV[j+1]);local period=tonumber(ARGV[j+2]);local cost=tonumber(ARGV[j+3])
 local old=redis.call('HMGET',key,'tokens','at');local at=tonumber(old[2]) or now
 local tokens=math.min(cap,(tonumber(old[1]) or cap)+math.max(0,now-at)*cap/period)
 states[i]={tokens,cap,period,cost}
 if tokens<cost then retry=math.max(retry,math.ceil((cost-tokens)*period/cap/1000)) end
end
if retry>0 then return retry end
for i,key in ipairs(KEYS) do local s=states[i];redis.call('HSET',key,'tokens',s[1]-s[4],'at',now);redis.call('PEXPIRE',key,math.ceil(s[3]*2)) end
return 0`;

/** Development/isolated tests only. Production cannot select this backend. */
export class MemoryQuotaStore implements QuotaStore {
  private entries=new Map<string,{tokens:number;at:number;expires:number}>();
  constructor(private now=Date.now){}
  async consume(rules:Rule[]){const now=this.now();let retry=0;
    for(const [k,v] of this.entries)if(v.expires<=now)this.entries.delete(k);
    if(this.entries.size+rules.filter(r=>!this.entries.has(r.key)).length>10000)throw unavailable();
    const states=rules.map(r=>{const old=this.entries.get(r.key);const tokens=Math.min(r.capacity,(old?.tokens??r.capacity)+Math.max(0,now-(old?.at??now))*r.capacity/r.period);
      if(tokens<r.cost)retry=Math.max(retry,Math.ceil((r.cost-tokens)*r.period/r.capacity/1000));return {r,tokens};});
    if(!retry)for(const {r,tokens} of states)this.entries.set(r.key,{tokens:tokens-r.cost,at:now,expires:now+2*r.period});return retry;
  }
}
export class RedisQuotaStore implements QuotaStore {
  private client:any;private connecting:Promise<void>|undefined;private retryAt=0;
  constructor(private env:NodeJS.ProcessEnv=process.env){}
  private async ready(){
    if(this.client?.isReady)return;
    if(Date.now()<this.retryAt)throw unavailable();
    if(!this.connecting)this.connecting=(async()=>{
      const e=this.env,host=e.SECURITY_REDIS_HOST,port=Number(e.SECURITY_REDIS_PORT??6380);
      const local=['localhost','127.0.0.1','::1'].includes(host??'');
      const tls=e.SECURITY_REDIS_TLS!=='false';
      if(!host||!e.SECURITY_REDIS_PASSWORD||!e.SECURITY_REDIS_USER||!Number.isInteger(port)||port<1||port>65535||e.NODE_TLS_REJECT_UNAUTHORIZED==='0'||(!tls&&(e.NODE_ENV==='production'||!local)))throw unavailable();
      const {createClient}=await import('redis');
      const socket:any={host,port,connectTimeout:1500,reconnectStrategy:false};
      if(tls)Object.assign(socket,{tls:true,rejectUnauthorized:true,...(e.SECURITY_REDIS_CA_FILE?{ca:readFileSync(e.SECURITY_REDIS_CA_FILE)}:{})});
      if(this.client?.isOpen)this.client.destroy();
      this.client=createClient({socket,username:e.SECURITY_REDIS_USER,password:e.SECURITY_REDIS_PASSWORD,disableOfflineQueue:true});
      this.client.on('error',()=>{});await this.client.connect();
    })().catch(()=>{this.retryAt=Date.now()+5000;throw unavailable();}).finally(()=>{this.connecting=undefined;});
    await this.connecting;
  }
  async consume(rules:Rule[]){try{await this.ready();const result=await this.client.withCommandOptions({abortSignal:AbortSignal.timeout(2000)}).eval(quotaScript,{keys:rules.map(r=>'tp:security:{v1}:'+r.key),arguments:rules.flatMap(r=>[r.capacity,r.period,r.cost].map(String))});
    if(!Number.isSafeInteger(result)||result<0)throw unavailable();return result as number;
  }catch{if(this.client?.isOpen)this.client.destroy();if(Date.now()>=this.retryAt)this.retryAt=Date.now()+5000;throw unavailable();}}
  close(){if(this.client?.isOpen)this.client.destroy();}
}
const rule=(key:string,capacity:number,period=60000,cost=1):Rule=>({key,capacity,period,cost});
export class RequestLimits {
  private activeAuth=0;private activeApi=0;
  private logoutQuota=new MemoryQuotaStore();
  constructor(private store:QuotaStore,private env:NodeJS.ProcessEnv=process.env){}
  private source(request:Request){
    if(this.env.NODE_ENV!=='production')return 'local'; // Never trust client forwarding headers in development.
    const secret=this.env.SECURITY_PROXY_SECRET??'',provided=request.headers.get('x-tp-proxy-token')??'',ip=request.headers.get('x-tp-client-ip')??'';
    if(!/^[\x21-\x7e]{32,256}$/.test(secret))throw unavailable();
    if(provided.length>256||!isIP(ip)||!timingSafeEqual(Buffer.from(digest(secret)),Buffer.from(digest(provided))))throw new HttpError(403,'ORIGIN','Solicitud no permitida.');
    return digest(secret+':'+ip);
  }
  private async take(rules:Rule[]){const retry=await this.store.consume(rules);if(retry)throw new LimitError(retry);}
  async enter(request:Request,segments:string[]){
    const path=segments.join('/');
    // Logout must remain available if the quota coordinator is unavailable.
    const auth=path==='auth/login'||path==='auth/password',source=this.source(request);
    if((auth?this.activeAuth:this.activeApi)>=(auth?2:12))throw new LimitError(2);
    if(auth)this.activeAuth++;else this.activeApi++;
    let released=false;const release=()=>{if(released)return;released=true;if(auth)this.activeAuth--;else this.activeApi--;};
    try{
      if(path==='auth/logout'){const retry=await this.logoutQuota.consume([rule('logout',120)]);if(retry)throw new LimitError(retry);}
      else await this.take(auth?[rule('auth:global',30),rule('auth:hour',300,3600000),rule('auth:source:'+source,10)]:[rule('api:global',600),rule('api:source:'+source,180)]);
      return release;
    }
    catch(e){release();throw e;}
  }
  async user(userId:string,request:Request,segments:string[]){
    const category=segments[0]==='search'?'search':segments[0]==='parcel-image'?'download':segments[0]==='parcel-images'?'catalogue':segments[0]==='consultations'?(request.method==='GET'?'consultations':'write'):'read';
    const key=digest(userId),capacity=category==='download'?20:category==='write'?10:60;
    const rules=[rule('user:'+key+':minute',120),rule(category+':'+key,capacity),rule(category+':hour:'+key,category==='download'?100:category==='write'?60:300,3600000)];
    if(category==='download')rules.push(rule('bytes:'+key,200*1024*1024,3600000,20*1024*1024)); // Reserve the maximum before SFTP; never unbounded reads/refunds on failure.
    await this.take(rules);
  }
}
let shared:RequestLimits|undefined;
export function requestLimits(){return shared??=new RequestLimits(process.env.NODE_ENV==='production'||process.env.SECURITY_REDIS_HOST?new RedisQuotaStore():new MemoryQuotaStore());}
