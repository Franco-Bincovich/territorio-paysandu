import {request,isInstitutionalImage,type ParcelImage,type ParcelRef} from './contracts';
export const parcelImageIdentity=(ref:Pick<ParcelRef,'padCod'|'locality'|'parcel'>)=>JSON.stringify([ref.padCod,ref.locality.normalize('NFD').replace(/\p{M}/gu,'').trim().toUpperCase().replace(/[\s_]+/g,'_'),ref.parcel]);
type Kind=ParcelImage['kind'];
export type CachedMedia={url:string;type:string;bytes:number};
/** One owner per mounted territorial record. No module/session/browser storage. */
export class ParcelImageCache {
  readonly controller=new AbortController();
  private ready=new Map<Kind,CachedMedia>();
  private pending=new Map<Kind,Promise<CachedMedia|undefined>>();
  private catalogueValue:ParcelImage[]|undefined;
  private cataloguePending:Promise<ParcelImage[]>|undefined;
  constructor(readonly identity:string){}
  async preload(padCod:string){
    const images=await this.catalogue(async()=>{const result=await request<{images:ParcelImage[]}>(`/api/parcel-images?padCod=${encodeURIComponent(padCod)}`,{signal:this.controller.signal});return result.images;});
    if(this.controller.signal.aborted)return;
    await Promise.allSettled(images.filter(image=>isInstitutionalImage(image)&&image.url).map(image=>this.load(image)));
  }
  get(kind:Kind){return this.ready.get(kind);}
  invalidate(kind:Kind,url?:string){const entry=this.ready.get(kind);if(entry&&entry.url===url){URL.revokeObjectURL(entry.url);this.ready.delete(kind);}}
  dispose(){this.controller.abort();for(const value of this.ready.values())URL.revokeObjectURL(value.url);this.ready.clear();this.catalogueValue=undefined;}
  catalogue(load:()=>Promise<ParcelImage[]>,refresh=false):Promise<ParcelImage[]>{
    if(this.cataloguePending)return this.cataloguePending;
    if(this.catalogueValue&&!refresh)return Promise.resolve(this.catalogueValue);
    const pending=load().then(images=>{
      if(this.controller.signal.aborted)throw new DOMException('Aborted','AbortError');
      // A failed refresh of either slot cannot hide bytes already owned by this record.
      const merged=images.map(image=>this.ready.has(image.kind)?this.catalogueValue?.find(old=>old.kind===image.kind)??image:image);
      this.catalogueValue=merged;return merged;
    }).finally(()=>{if(this.cataloguePending===pending)this.cataloguePending=undefined;});
    this.cataloguePending=pending;return pending;
  }
  load(image:ParcelImage):Promise<CachedMedia|undefined>{
    const cached=this.ready.get(image.kind);if(cached)return Promise.resolve(cached);
    const existing=this.pending.get(image.kind);if(existing)return existing;
    if(!image.url||this.controller.signal.aborted)return Promise.resolve(undefined);
    const pending=this.download(image.url).then(value=>{if(this.controller.signal.aborted){URL.revokeObjectURL(value.url);throw new DOMException('Aborted','AbortError');}this.ready.set(image.kind,value);return value;}).finally(()=>{if(this.pending.get(image.kind)===pending)this.pending.delete(image.kind);});
    this.pending.set(image.kind,pending);return pending;
  }
  private async download(key:string):Promise<CachedMedia>{
    const signal=this.controller.signal;
    const response=await fetch(key,{credentials:'same-origin',cache:'no-store',signal});
    if(response.status===401){window.dispatchEvent(new Event('territory-session-expired'));throw Error('La sesi\u00f3n ha vencido.');}
    if(!response.ok){const body=await response.json().catch(()=>null);throw Error(body?.error?.message??'La imagen no est\u00e1 disponible.');}
    const type=response.headers.get('content-type')?.split(';')[0];
    if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(type??''))throw Error('El archivo no puede visualizarse.');
    const blob=await response.blob(),length=response.headers.get('content-length');
    if(!blob.size)throw Error('El archivo de imagen est\u00e1 vac\u00edo.');
    if(blob.size>20*1024*1024)throw Error('El archivo supera el tama\u00f1o permitido.');
    if(length!==null&&Number(length)!==blob.size)throw Error('La descarga de la imagen est\u00e1 incompleta.');
    if(signal.aborted)throw new DOMException('Aborted','AbortError');
    const url=URL.createObjectURL(blob);
    try{
      if(type!=='application/pdf'){
        const img=new Image();img.src=url;
        await new Promise<void>((resolve,reject)=>{
          const abort=()=>{img.src='';reject(new DOMException('Aborted','AbortError'));};
          signal.addEventListener('abort',abort,{once:true});
          img.decode().then(()=>{signal.removeEventListener('abort',abort);resolve();},()=>{signal.removeEventListener('abort',abort);reject(Error('No se pudo visualizar la imagen.'));});
        });
      }
      if(signal.aborted)throw new DOMException('Aborted','AbortError');
      return {url,type:type!,bytes:blob.size};
    }catch(error){URL.revokeObjectURL(url);throw error;}
  }
}
