import {clone,type Signal,type MediaRevision,type Params} from './model';
import {sourceTime,project} from './timemap';
export interface SignalCache {get(key:string):Promise<Signal|undefined>;put(key:string,value:Signal):Promise<void>}
export class MemorySignalCache implements SignalCache {private values=new Map<string,Signal>();async get(key:string){const s=this.values.get(key);return s&&clone(s);}async put(key:string,value:Signal){this.values.set(key,clone(value));}}
/** The browser app injects its IndexedDB store; the engine stays DOM-free. */
export class IndexedDBSignalCache implements SignalCache {constructor(private store?:{get:(key:string)=>Promise<Signal|undefined>;put:(key:string,value:Signal)=>Promise<void>}){}async get(key:string){if(!this.store)throw Error('Supply a persistent signal store or use MemorySignalCache.');return this.store.get(key);}async put(key:string,value:Signal){if(!this.store)throw Error('Supply a persistent signal store or use MemorySignalCache.');await this.store.put(key,value);}}
export function stable(value:unknown):string {if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;if(value&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;return JSON.stringify(value)??'null';}
export function signalKey(media:MediaRevision,detector:string,params:Params){return stable({hash:media.mediaHash,revision:media.id,map:media.timeMap,crop:media.crop,audioOffset:media.audioOffsetSec,detector,params});}
export function remapSignal(signal:Signal,from:MediaRevision,to:MediaRevision):Signal {
  if(signal.revisionId!==from.id)throw Error('Signal does not belong to the supplied source revision. Recompute or supply its original revision.');
  if(from.originId!==to.originId)throw Error('Cannot remap signals between recordings without a shared origin.');
  if(!signal.remappable&&stable(from.timeMap)!==stable(to.timeMap))throw Error(`${signal.kind} depends on neighboring content. Recompute detection on the new revision.`);
  const values=new Float32Array(Math.ceil(to.durationSec*signal.sampleRateHz)),confidence=new Float32Array(values.length);
  for(let i=0;i<values.length;i++){const origin=sourceTime(to.timeMap,i/signal.sampleRateHz),time=origin===undefined?undefined:project(from.timeMap,origin)[0];if(time===undefined)continue;const index=Math.floor(time*signal.sampleRateHz);values[i]=signal.values[index]??0;confidence[i]=signal.confidence[index]??0;}
  return {...signal,id:`${signal.id}@${to.id}`,revisionId:to.id,values,confidence};
}
