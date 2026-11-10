import {randomUUID} from 'node:crypto';
import {HttpError} from '../security';
/** Opt-in local operational evidence. Never accepts paths, IDs, credentials or raw errors. */
export class ImageMetrics {
  private start=performance.now();
  private stages:Record<string,{calls:number;ms:number}>={};
  private active=new Map<string,number>();
  private id=randomUUID();
  private failures:Record<string,number>={};
  connections=0;
  constructor(private enabled:boolean,private operation:string){}
  begin(stage:string){const start=performance.now();this.active.set(stage,(this.active.get(stage)??0)+1);return()=>{const remaining=(this.active.get(stage)??1)-1;remaining?this.active.set(stage,remaining):this.active.delete(stage);const total=this.stages[stage]??={calls:0,ms:0};total.calls++;total.ms+=performance.now()-start;};}
  async measure<T>(stage:string,run:()=>Promise<T>):Promise<T>{const end=this.begin(stage);try{return await run();}catch(error){const code=error instanceof HttpError?error.code:'IMAGE_CONNECTION';this.failures[code]=(this.failures[code]??0)+1;throw error;}finally{end();}}
  finish(error?:unknown){if(this.enabled)console.info(JSON.stringify({event:'sftp_metrics',id:this.id,operation:this.operation,elapsedMs:Math.round(performance.now()-this.start),connections:this.connections,queueMs:0,failures:this.failures,activeStages:[...this.active.keys()],code:error instanceof HttpError?error.code:error?'IMAGE_CONNECTION':'OK',stages:Object.fromEntries(Object.entries(this.stages).map(([key,value])=>[key,{calls:value.calls,ms:Math.round(value.ms)}]))}));}
}
export async function imageReference<T>(enabled:boolean,run:()=>Promise<T>):Promise<T>{const metrics=new ImageMetrics(enabled,'institutional_reference');let failure:unknown;try{return await metrics.measure('database_reference',run);}catch(error){failure=error;throw error;}finally{metrics.finish(failure);}}
