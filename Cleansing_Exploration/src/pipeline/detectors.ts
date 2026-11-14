import {clone,type MediaRevision,type Params,type Signal} from './model';
import {synthetic} from './synthetic';
import {remapSignal} from './signals';
export interface Detector {id:string;version:number;detect(media:MediaRevision,params:Params,signal?:AbortSignal):AsyncGenerator<{progress:number;signal:Signal}>}
export class MockDetector implements Detector {
  version=1;constructor(public id:string){}
  async *detect(media:MediaRevision,params:Params,abort?:AbortSignal){
    abort?.throwIfAborted();
    const fixture=synthetic(Number(params.seed??42),Math.max(media.durationSec,...media.timeMap.segments.map(s=>s.srcEnd),0),Number(params.sampleRateHz??4));
    const aliases:Record<string,string>={consistency:'variance',speaker:String(params.label??'speakerA'),time:'speech',markers:'speech'};
    const key=aliases[this.id]??this.id;let base=fixture.signals[key];if(!base)throw Error(`Unknown detector “${this.id}”. Choose a supported Fast-tier mock.`);
    base=clone(base);base.revisionId=fixture.media.id;base.kind=this.id;
    if(this.id==='time'||this.id==='markers'){const ranges=(this.id==='markers'?params.ranges??fixture.markers:params.ranges??[]) as {start:number;end:number}[];base.values=Float32Array.from(base.values,(_,i)=>ranges.some(r=>i/base.sampleRateHz>=r.start&&i/base.sampleRateHz<r.end)?1:0);base.remappable=true;}
    // Duration/variance must be recalculated in revision coordinates, not reused.
    const original={...fixture.media,originId:media.originId};let result=remapSignal({...base,remappable:true},original,media);result.remappable=base.remappable;
    if(this.id==='silence'){const loud=remapSignal(fixture.signals.loudness,original,media);let elapsed=0;result.values=Float32Array.from(loud.values,v=>elapsed=v<Number(params.threshold??.1)?elapsed+1/loud.sampleRateHz:0);}
    if(this.id==='variance'||this.id==='consistency'){const loud=remapSignal(fixture.signals.loudness,original,media),radius=Math.max(1,Math.round(Number(params.windowSec??1)*loud.sampleRateHz));result.values=Float32Array.from(loud.values,(_,at)=>{const lo=Math.max(0,at-radius);let sum=0,square=0;for(let j=lo;j<=at;j++){sum+=loud.values[j];square+=loud.values[j]**2;}const n=at-lo+1,variance=square/n-(sum/n)**2;return this.id==='variance'?variance:1/(1+variance);});result.remappable=false;}
    for(const fraction of [.25,.5,.75,1]){abort?.throwIfAborted();const count=Math.ceil(result.values.length*fraction);yield {progress:fraction,signal:{...result,values:result.values.slice(0,count),confidence:result.confidence.slice(0,count)}};await Promise.resolve();}
  }
}
export const mockDetectors=()=>new Map(['loudness','variance','consistency','silence','speech','speaker','motion','scene','time','markers','layout'].map(id=>[id,new MockDetector(id)]));
