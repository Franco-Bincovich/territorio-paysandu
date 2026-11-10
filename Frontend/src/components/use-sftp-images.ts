"use client";
import {useEffect,useMemo,useState} from 'react';
import {request,isInstitutionalImage,type ParcelImage} from './contracts';
import {ParcelImageCache} from './parcel-image-cache';

export function useParcelImageCache(identity:string,shared?:ParcelImageCache){
  const cache=useMemo(()=>shared?.identity===identity&&!shared.controller.signal.aborted?shared:new ParcelImageCache(identity),[identity,shared]);
  useEffect(()=>{
    let mounted=true;
    const expired=()=>cache.dispose();window.addEventListener('territory-session-expired',expired);
    // StrictMode immediately replays effects. Dispose real departures after the
    // replay opportunity, without allowing an old owner to dispose the new one.
    const owners=cacheOwners;owners.set(cache,(owners.get(cache)??0)+1);
    return()=>{mounted=false;window.removeEventListener('territory-session-expired',expired);owners.set(cache,(owners.get(cache)??1)-1);queueMicrotask(()=>{if(!mounted&&!owners.get(cache)){cache.dispose();owners.delete(cache);}});};
  },[cache]);
  return cache;
}
const cacheOwners=new WeakMap<ParcelImageCache,number>();
export function useSftpCatalogue(initial:ParcelImage[],padCod:string|undefined,retry:number,cache:ParcelImageCache) {
  const enabled=initial.some(isInstitutionalImage)&&!!padCod;
  const [catalogue,setCatalogue]=useState<{cache:ParcelImageCache;images:ParcelImage[]}|null>(null);
  useEffect(()=>{
    if(!enabled||!padCod)return;let mounted=true,busy=false;
    async function update(refresh=false){
      if(busy||document.visibilityState==='hidden')return;busy=true;
      try{const images=await cache.catalogue(async()=>{const data=await request<{images:ParcelImage[]}>(`/api/parcel-images?padCod=${encodeURIComponent(padCod!)}`,{signal:cache.controller.signal});return data.images;},refresh);if(mounted)setCatalogue({cache,images});}
      catch(error){if(mounted&&!cache.controller.signal.aborted)setCatalogue(old=>old?.cache===cache?old:{cache,images:initial.map(i=>({...i,url:null,unavailableReason:error instanceof Error?error.message:'No se pudo consultar el servicio de im\u00e1genes.'}))});}
      finally{busy=false;}
    }
    void update(retry>0);// A loaded record is a stable in-memory snapshot. Missing/error slots can
    // still be refreshed explicitly, without polling SQL/SFTP behind valid media.
    const timer=setInterval(()=>{if(!cache.get('historical')&&!cache.get('survey'))void update(true);},30000);
    return()=>{mounted=false;clearInterval(timer);};
  },[enabled,padCod,retry,initial,cache]);
  return enabled&&catalogue?.cache===cache?catalogue.images:initial;
}
export function useSftpMedia(image:ParcelImage,retry:number,cache:ParcelImageCache):{url?:string;type?:string;error?:string} {
  const attempt=useMemo(()=>({kind:image.kind,url:image.url,retry,cache}),[image.kind,image.url,retry,cache]);
  const [media,setMedia]=useState<{attempt:typeof attempt;url?:string;type?:string;error?:string}|null>(null);
  useEffect(()=>{
    if(!isInstitutionalImage(image))return;let mounted=true;
    cache.load(image).then(value=>{if(mounted&&!cache.controller.signal.aborted)setMedia({attempt,...value});},error=>{if(mounted&&!cache.controller.signal.aborted)setMedia({attempt,error:error instanceof Error?error.message:'No se pudo conectar al servicio de im\u00e1genes.'});});
    return()=>{mounted=false;};
  },[attempt,image.provider,cache]);
  const ready=cache.get(image.kind);
  return ready??(media?.attempt===attempt?media:{});
}
