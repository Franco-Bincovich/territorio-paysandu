"use client";
import {useEffect,useState} from 'react';
import {request,type ParcelImage} from './contracts';

export function useSftpCatalogue(initial:ParcelImage[],padCod:string|undefined,retry:number) {
  const enabled=initial.some(i=>i.provider==='sftp')&&!!padCod;
  const [catalogue,setCatalogue]=useState<{key:string;images:ParcelImage[]}|null>(null);
  useEffect(()=>{
    if(!enabled||!padCod)return;
    const controller=new AbortController();let busy=false;
    async function update(){
      if(busy||document.visibilityState==='hidden')return;busy=true;
      try{const data=await request<{images:ParcelImage[]}>(`/api/parcel-images?padCod=${encodeURIComponent(padCod!)}`,{signal:controller.signal});if(!controller.signal.aborted)setCatalogue({key:padCod!,images:data.images});}
      catch(error){if(!controller.signal.aborted)setCatalogue({key:padCod!,images:initial.map(i=>({...i,url:null,unavailableReason:error instanceof Error?error.message:'No se pudo consultar el servicio de imágenes.'}))});}
      finally{busy=false;}
    }
    void update();const timer=setInterval(()=>void update(),30000);
    return()=>{controller.abort();clearInterval(timer);};
  },[enabled,padCod,retry,initial]);
  return enabled&&catalogue?.key===padCod?catalogue.images:initial;
}
export function useSftpMedia(image:ParcelImage,retry:number) {
  const [media,setMedia]=useState<{key:string;url?:string;type?:string;error?:string}>({key:''});
  useEffect(()=>{
    if(image.provider!=='sftp'||!image.url)return;
    const key=image.url,controller=new AbortController();let objectUrl:string|undefined;
    (async()=>{
      try{
        const response=await fetch(key,{credentials:'same-origin',cache:'no-store',signal:controller.signal});
        if(response.status===401)window.dispatchEvent(new Event('territory-session-expired'));
        if(!response.ok){const body=await response.json().catch(()=>null);throw Error(body?.error?.message??'La imagen no está disponible.');}
        const type=response.headers.get('content-type')?.split(';')[0];
        if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(type??''))throw Error('El archivo no puede visualizarse.');
        const blob=await response.blob();if(blob.size>20*1024*1024)throw Error('El archivo supera el tamaño permitido.');
        if(controller.signal.aborted)return;
        objectUrl=URL.createObjectURL(blob);setMedia({key,url:objectUrl,type});
      }catch(error){if(!controller.signal.aborted)setMedia({key,error:error instanceof Error?error.message:'No se pudo conectar al servicio de imágenes.'});}
    })();
    return()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[image.provider,image.url,retry]);
  return media.key===image.url?media:{key:image.url??''};
}
