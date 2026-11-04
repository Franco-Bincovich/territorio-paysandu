import test from 'node:test';
import assert from 'node:assert/strict';
import { SyntheticCadastreCache } from '../../src/domain/cadastre-cache';
import type { CadastreAdapter, ParcelRecord } from '../../src/domain';
function record(parcel='123',source:ParcelRecord['source']='synthetic'):ParcelRecord{return {key:{locality:'QA-SYNTHETIC',parcel},address:'Synthetic',originalLandArea:10,originalBuildingArea:5,detectedBuildingArea:6,source};}
function fixture(options:ConstructorParameters<typeof SyntheticCadastreCache>[1]={}) {
 let calls=0,now=1000;const adapter:CadastreAdapter={async findParcel(key){calls++;return record(key.parcel);},async findPerson(){calls++;return [record()];}};
 return {cache:new SyntheticCadastreCache(adapter,{now:()=>now,...options}),calls:()=>calls,setClock:(value:number)=>{now=value;}};
}
test('TTL expires at exact boundary and distinct parcel/locality keys do not collide',async()=>{
 const f=fixture({ttlMs:10});const key=record().key;await f.cache.findParcel(key);await f.cache.findParcel(key);assert.equal(f.calls(),1);
 f.setClock(1009);await f.cache.findParcel(key);assert.equal(f.calls(),1);
 f.setClock(1010);await f.cache.findParcel(key);assert.equal(f.calls(),2);
 await f.cache.findParcel({...key,locality:'OTHER'});assert.equal(f.calls(),3);
});
test('LRU remains bounded and hits update recency',async()=>{
 const f=fixture({maxEntries:2});for(const parcel of ['1','2','1','3','1','2'])await f.cache.findParcel(record(parcel).key);assert.equal(f.calls(),4);
});
test('caller or delegate mutation cannot poison retained data',async()=>{
 const f=fixture();const first=await f.cache.findParcel(record().key);(first!.key as {locality:string}).locality='POISON';
 assert.equal((await f.cache.findParcel(record().key))!.key.locality,'QA-SYNTHETIC');
 const people=await f.cache.findPerson({field:'name',exact:'SYNTHETIC'});(people as ParcelRecord[]).pop();
 assert.equal((await f.cache.findPerson({field:'name',exact:'SYNTHETIC'})).length,1);
});
test('errors, missing results and institutional records are never cached',async()=>{
 let calls=0;const adapter:CadastreAdapter={async findParcel(){calls++;if(calls===1)throw Error('temporary');return null;},async findPerson(){calls++;return [record('1','institutional')];}};
 const cache=new SyntheticCadastreCache(adapter);await assert.rejects(cache.findParcel(record().key),/temporary/);await cache.findParcel(record().key);await cache.findParcel(record().key);await cache.findPerson({field:'CI',exact:'00000000'});await cache.findPerson({field:'CI',exact:'00000000'});assert.equal(calls,5);
});
test('oversized and mixed-source search results bypass cache',async()=>{
 let calls=0;const delegate:CadastreAdapter={async findParcel(){return null;},async findPerson(){calls++;return [record('1'),record('2')];}};
 const cache=new SyntheticCadastreCache(delegate,{maxRecordsPerEntry:1});await cache.findPerson({field:'name',exact:'QA'});await cache.findPerson({field:'name',exact:'QA'});assert.equal(calls,2);
 const mixed:CadastreAdapter={async findParcel(){return null;},async findPerson(){calls++;return [record('1'),record('2','institutional')];}};
 const mixedCache=new SyntheticCadastreCache(mixed);await mixedCache.findPerson({field:'name',exact:'QA'});await mixedCache.findPerson({field:'name',exact:'QA'});assert.equal(calls,4);
});
test('TTL zero, clear and backwards clock invalidate cache',async()=>{
 const disabled=fixture({ttlMs:0});await disabled.cache.findParcel(record().key);await disabled.cache.findParcel(record().key);assert.equal(disabled.calls(),2);
 const f=fixture();await f.cache.findParcel(record().key);f.cache.clear();await f.cache.findParcel(record().key);f.setClock(900);await f.cache.findParcel(record().key);assert.equal(f.calls(),3);
});
test('clear during pending request cannot repopulate stale data',async()=>{
 let resolve!:(value:ParcelRecord)=>void,calls=0;const delegate:CadastreAdapter={findParcel(){calls++;return new Promise(r=>{resolve=r;});},async findPerson(){return [];}};
 const cache=new SyntheticCadastreCache(delegate);const pending=cache.findParcel(record().key);cache.clear();resolve(record());await pending;
 const next=cache.findParcel(record().key);assert.equal(calls,2);resolve(record());await next;
});
test('configuration bounds reject unbounded caches and exact person search keys remain distinct',async()=>{
 for(const options of [{ttlMs:-1},{ttlMs:300001},{maxEntries:0},{maxEntries:1001},{maxRecordsPerEntry:0}])assert.throws(()=>fixture(options),RangeError);
 const f=fixture();await f.cache.findPerson({field:'name',exact:'QA'});await f.cache.findPerson({field:'name',exact:'qa'});await f.cache.findPerson({field:'CI',exact:'QA'});assert.equal(f.calls(),3);
});
