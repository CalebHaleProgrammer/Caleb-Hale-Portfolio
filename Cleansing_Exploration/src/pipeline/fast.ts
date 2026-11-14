import {type Signal,type MediaRevision,type Params} from './model';
import type {Envelope} from '../model';
import {sourceTime} from './timemap';
import type {Detector} from './detectors';
export function audioSignal(revision:MediaRevision,e:Envelope,p:Params):Signal {
  const rate=Number(p.sampleRateHz??4),kind=String(p.detector??'loudness');if(!Number.isFinite(rate)||rate<=0||rate>50)throw Error('Choose a signal rate between 0 and 50 samples per second.');
  const values=new Float32Array(Math.ceil(revision.durationSec*rate)),confidence=new Float32Array(values.length),levels=new Float32Array(values.length),window=Math.max(1,Math.round(Number(p.windowSec??1)*rate));let quiet=0,sum=0,squares=0,valid=0;if(!Number.isFinite(window)||window>100000)throw Error('Choose a finite measurement window.');
  let segmentIndex=0;const segments=revision.timeMap.segments,prefix=new Float64Array(e.rms.length+1);for(let i=0;i<e.rms.length;i++)prefix[i+1]=prefix[i]+e.rms[i]**2;
  for(let i=0;i<values.length;i++){
    const start=i/rate,end=Math.min(revision.durationSec,(i+1)/rate),offset=Number(revision.audioOffsetSec??0);let energy=0,coverage=0;
    while(segmentIndex<segments.length&&segments[segmentIndex].outEnd<=start)segmentIndex++;
    if(e.hasAudio!==false)for(let s=segmentIndex;s<segments.length&&segments[s].outStart<end;s++){
      const seg=segments[s],a=Math.max(start,seg.outStart),b=Math.min(end,seg.outEnd);if(b<=a)continue;
      const loSource=seg.srcStart+(a-seg.outStart)*seg.rate+offset,hiSource=seg.srcStart+(b-seg.outStart)*seg.rate+offset;
      const lo=Math.max(0,Math.floor(loSource/e.step)),hi=Math.min(e.rms.length,Math.ceil(hiSource/e.step));if(hi<=lo)continue;
      const available=Math.max(0,Math.min(e.duration,hiSource)-Math.max(0,loSource))/seg.rate;energy+=(prefix[hi]-prefix[lo])/(hi-lo)*available;coverage+=available;
    }
    if(!coverage){values[i]=kind==='loudness'?-100:0;quiet=0;sum=0;squares=0;valid=0;continue;}
    const rms=Math.sqrt(energy/coverage),db=Math.max(-100,20*Math.log10(Math.max(1e-5,rms)));levels[i]=db;valid++;sum+=db;squares+=db*db;if(valid>window){sum-=levels[i-window];squares-=levels[i-window]**2;}
    const n=Math.min(window,valid),variance=Math.max(0,squares/n-(sum/n)**2);if(coverage<end-start-1e-6)quiet=0;quiet=db<=Number(p.threshold??-40)?quiet+coverage:0;values[i]=kind==='loudness'?db:kind==='silence'?quiet:kind==='variance'?variance:kind==='consistency'?1/(1+variance):db>Number(p.threshold??-35)?1:0;confidence[i]=(kind==='speech'?.55:.98)*Math.min(1,coverage/(end-start));
  }
  return {id:`${revision.id}/${kind}`,revisionId:revision.id,kind,sampleRateHz:rate,values,confidence,remappable:kind==='loudness'};
}
/** Downscaled frame difference: useful heuristics, not semantic scene/face recognition. */
export function frameDifference(before:Uint8ClampedArray|undefined,after:Uint8ClampedArray){if(!before)return {motion:0,scene:0};let change=0;const a=new Float32Array(16),b=new Float32Array(16),count=after.length/4;for(let i=0;i<after.length;i+=4){const x=(before[i]+before[i+1]+before[i+2])/3,y=(after[i]+after[i+1]+after[i+2])/3;change+=Math.abs(x-y)/255;a[Math.min(15,Math.floor(x/16))]++;b[Math.min(15,Math.floor(y/16))]++;}let hist=0;for(let i=0;i<16;i++)hist+=Math.abs(a[i]-b[i]);return {motion:change/Math.max(1,count),scene:hist/Math.max(1,2*count)};}
export type FastService=(revision:MediaRevision,params:Params,progress:(part:{progress:number;signal:Signal})=>void,abort?:AbortSignal)=>Promise<Signal>;
export class FastDetector implements Detector {
  version=1;constructor(public id:string,private service:FastService){}
  async *detect(revision:MediaRevision,params:Params,abort?:AbortSignal){abort?.throwIfAborted();let done=false,error:unknown,wake:(()=>void)|undefined;const queue:{progress:number;signal:Signal}[]=[];void this.service(revision,{...params,detector:this.id},part=>{queue.splice(0,queue.length,part);wake?.();},abort).then(signal=>{queue.splice(0,queue.length,{progress:1,signal});done=true;wake?.();},e=>{error=e;done=true;wake?.();});while(!done||queue.length){abort?.throwIfAborted();if(!queue.length){await new Promise<void>(resolve=>{wake=resolve;});wake=undefined;}if(error)throw error;if(queue.length)yield queue.shift()!;}if(error)throw error;
  }
}
export function fastDetectors(service:FastService){return new Map(['loudness','silence','speech','variance','consistency','motion','scene','time','markers'].map(id=>[id,new FastDetector(id,service)]));}
