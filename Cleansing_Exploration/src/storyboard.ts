import {duration,projectEnd,type Project} from './model';
export interface TimeScale {times:number[];positions:number[];width:number;toX:(time:number)=>number;toTime:(x:number)=>number;}
export function linearScale(end:number,zoom:number):TimeScale{return {times:[0,end],positions:[0,end*zoom],width:end*zoom,toX:t=>t*zoom,toTime:x=>x/zoom};}
export function structureScale(p:Project,minimum=32,compression=18):TimeScale{
  const times=[...new Set([0,...p.clips.flatMap(c=>[c.start,c.start+duration(c)]),...p.markers.map(m=>m.time)].filter(t=>Number.isFinite(t)&&t>=0).map(t=>Math.round(t*1e6)/1e6))].sort((a,b)=>a-b);
  if(times.length===1)times.push(Math.max(60,projectEnd(p)));
  const positions=[0];for(let i=1;i<times.length;i++)positions.push(positions[i-1]+Math.max(8,minimum)+Math.max(0,compression)*Math.log1p(times[i]-times[i-1]));
  function map(value:number,from:number[],to:number[]){let lo=0,hi=from.length-1;if(value<=from[0])return to[0]+(value-from[0])*(to[1]-to[0])/(from[1]-from[0]);if(value>=from[hi])return to[hi]+(value-from[hi])*(to[hi]-to[hi-1])/(from[hi]-from[hi-1]);while(hi-lo>1){const mid=(lo+hi)>>1;if(value<from[mid])hi=mid;else lo=mid;}return to[lo]+(value-from[lo])*(to[hi]-to[lo])/(from[hi]-from[lo]);}
  return {times,positions,width:positions.at(-1)!,toX:t=>map(t,times,positions),toTime:x=>map(x,positions,times)};
}
