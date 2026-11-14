import {copy,duration,sourceAt,valueAt,makeClip,type Project,type Clip,type Property,type Asset} from './model';
export interface VisualRegion {id:string;name:string;assetId:string;left:number;top:number;right:number;bottom:number}
export function validRegion(r:VisualRegion){return [r.left,r.top,r.right,r.bottom].every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&r.right-r.left>=.01&&r.bottom-r.top>=.01;}
export function regionClip(asset:Asset,region:VisualRegion,trackId:string,start:number):Clip {if(!validRegion(region)||region.assetId!==asset.id)throw Error('Choose a region inside its source frame.');const c=makeClip(asset,trackId,start);return {...c,name:region.name,audioMuted:true,cropLeft:region.left,cropTop:region.top,cropRight:1-region.right,cropBottom:1-region.bottom};}
export function applyLayout(p:Project,time:number,kind:'grid'|'focus',focusId?:string):Project {
  const next=copy(p),all=next.clips.filter(c=>c.enabled&&c.start<=time&&c.start+duration(c)>time&&next.assets.find(a=>a.id===c.assetId)?.kind==='video'&&!next.tracks.find(t=>t.id===c.trackId)?.muted);if(!all.length)throw Error('Put the playhead on a video clip first.');if(kind==='focus'&&!all.some(c=>c.id===focusId))throw Error('Select a visible video clip to focus.');const overlays=all.filter(c=>next.tracks.find(t=>t.id===c.trackId)?.kind==='overlay'),clips=kind==='grid'&&overlays.length?overlays:all,cols=Math.ceil(Math.sqrt(clips.length)),rows=Math.ceil(clips.length/cols);
  const set=(c:Clip,prop:Property,value:number)=>{
    const at=sourceAt(c,time),keys=c.keyframes[prop]??[],existing=keys.find(k=>Math.abs(k.time-at)<1e-10);
    // Preserve an existing animated curve before the layout change. A guard
    // immediately before the new key prevents it from pulling earlier frames.
    const previous=keys.filter(k=>k.time<at).at(-1),start=Math.max(c.sourceIn,previous?.time??c.sourceIn);
    if(at>start){const guard=at-Math.min(1e-7,(at-start)/2),old=valueAt(c,prop,guard);keys.push({time:guard,value:old,interpolation:'hold'});}
    if(existing){existing.value=value;existing.interpolation='hold';}else keys.push({time:at,value,interpolation:'hold'});
    c.keyframes[prop]=keys.sort((a,b)=>a.time-b.time);
  };
  if(kind==='grid'&&overlays.length)all.filter(c=>!clips.includes(c)).forEach(c=>set(c,'opacity',0));clips.forEach((c,i)=>{const focused=kind==='focus'&&c.id===focusId;set(c,'x',kind==='grid'?(i%cols+.5)/cols:.5);set(c,'y',kind==='grid'?(Math.floor(i/cols)+.5)/rows:.5);set(c,'scale',kind==='grid'?Math.min(1/cols,1/rows):1);set(c,'opacity',kind==='grid'||focused?1:0);});return next;
}
