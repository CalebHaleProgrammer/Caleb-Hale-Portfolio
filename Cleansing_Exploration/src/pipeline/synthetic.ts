import {media,type MediaRevision,type Signal,type Range} from './model';
export function random(seed:number){let state=seed>>>0;return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};}
export interface SyntheticFixture {media:MediaRevision;signals:Record<string,Signal>;tags:Range[];markers:Range[]}
export function synthetic(seed=42,duration=90,rate=4):SyntheticFixture {
  if(!Number.isFinite(rate)||rate<=0||!Number.isFinite(duration)||duration<0)throw Error('Synthetic signals need a positive sample rate and a finite duration.');
  const rng=random(seed),revision=media(`synthetic-${seed}`,duration),n=Math.ceil(duration*rate),signals:Record<string,Signal>={};
  const make=(kind:string,fn:(t:number)=>number)=>{const values=Float32Array.from({length:n},(_,i)=>fn(i/rate)),confidence=new Float32Array(n).fill(.95);signals[kind]={id:kind,kind,revisionId:revision.id,sampleRateHz:rate,values,confidence,remappable:!['silence','variance'].includes(kind)};};
  make('speakerA',t=>t%30>=3&&t%30<16?.65+rng()*.3:rng()<.015?.8:rng()*.04);
  make('speakerB',t=>t%30>=12&&t%30<25?.6+rng()*.35:rng()<.015?.8:rng()*.04);
  make('loudness',t=>Math.max(signals.speakerA.values[Math.min(n-1,Math.floor(t*rate))],signals.speakerB.values[Math.min(n-1,Math.floor(t*rate))]));
  make('motion',t=>.2+.2*Math.sin(t)+rng()*.1);make('scene',t=>t>0&&t%15<1/rate?1:0);make('layout',t=>t%30>=12&&t%30<16?1:0);
  make('speech',t=>signals.loudness.values[Math.floor(t*rate)]>.2?1:0);
  let quiet=0;make('silence',t=>{quiet=signals.loudness.values[Math.floor(t*rate)]<.1?quiet+1/rate:0;return quiet;});
  make('variance',t=>{const at=Math.floor(t*rate),lo=Math.max(0,at-Math.round(rate)),v=signals.loudness.values;let sum=0,squares=0;for(let i=lo;i<=at;i++){sum+=v[i];squares+=v[i]*v[i];}const count=at-lo+1;return squares/count-(sum/count)**2;});
  return {media:revision,signals,tags:[{start:0,end:Math.min(3,duration),tags:['intro']},{start:Math.max(0,duration-3),end:duration,tags:['outro']}],markers:[{start:Math.min(10,duration),end:Math.min(15,duration),tags:['manual']}]};
}
