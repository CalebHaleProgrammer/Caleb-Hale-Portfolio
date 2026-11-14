import {duration,type Project} from './model';
import {createMarkedRegion,moveMarker,regionForMarker} from './markers';
import type {TimeScale} from './storyboard';

export interface MarkerDragHooks {
  project:()=>Project;scale:()=>TimeScale;scroller:HTMLElement;
  stop:()=>void;commit:(p:Project)=>void;render:()=>void;
  active:(dragging:boolean)=>void;suppressClick:()=>void;toast:(message:string,error?:boolean)=>void;
}
export function startMarkerDrag(event:PointerEvent,h:MarkerDragHooks):boolean {
  const flag=(event.target as HTMLElement).closest<HTMLElement>('[data-marker]');
  if(!flag||event.button!==0)return false;
  const p=h.project(),marker=p.markers.find(m=>m.id===flag.dataset.marker);
  if(!marker)return false;
  const scale=h.scale(),scroller=h.scroller,ruler=flag.closest<HTMLElement>('[data-ruler]')!,startX=event.clientX,startScroll=scroller.scrollLeft,copying=event.shiftKey,region=regionForMarker(p,marker.id);
  let moved=false,time=marker.time,pointerX=startX,frame=0,previewFlag:HTMLElement|undefined,previewBand:HTMLElement|undefined;
  h.stop();
  const targets=[0,...p.markers.filter(m=>m.id!==marker.id).map(m=>m.time),...p.clips.flatMap(c=>[c.start,c.start+duration(c)])];
  function paint(){
    const x=scale.toX(marker!.time)+pointerX-startX+scroller.scrollLeft-startScroll;
    const snap=targets.find(t=>Math.abs(scale.toX(t)-x)<7);
    time=Math.max(0,snap??scale.toTime(x));
    const host=ruler.parentElement!;host.style.width=`${Math.max(parseFloat(host.style.width)||0,scale.toX(time)+240)}px`;
    const moving=copying?previewFlag!:flag!;moving.style.left=`${scale.toX(time)}px`;
    if(copying){const a=scale.toX(marker!.time),b=scale.toX(time);previewBand!.style.left=`${Math.min(a,b)}px`;previewBand!.style.width=`${Math.max(2,Math.abs(a-b))}px`;}
    else if(region){const band=Array.from(ruler.querySelectorAll<HTMLElement>('[data-region]')).find(b=>b.dataset.region===region.id),other=p.markers.find(m=>m.id===region.markerIds.find(id=>id!==marker!.id));if(band&&other){const a=scale.toX(other.time),b=scale.toX(time);band.style.left=`${Math.min(a,b)}px`;band.style.width=`${Math.max(2,Math.abs(a-b))}px`;}}
    moving.title=`${time.toFixed(2)}s`;
  }
  function scroll(){
    if(!moved)return;
    const rect=scroller.getBoundingClientRect(),delta=pointerX>rect.right-36?Math.min(18,(pointerX-rect.right+36)/2):pointerX<rect.left+150?-Math.min(18,(rect.left+150-pointerX)/2):0;
    if(delta){scroller.scrollLeft=Math.max(0,scroller.scrollLeft+delta);paint();}
    frame=requestAnimationFrame(scroll);
  }
  const move=(e:PointerEvent)=>{
    if(e.pointerId!==event.pointerId)return;pointerX=e.clientX;
    if(!moved&&Math.abs(pointerX-startX)<3)return;
    if(!moved){moved=true;h.active(true);scroller.setPointerCapture(event.pointerId);flag.classList.add('dragging');
      if(copying){previewFlag=flag.cloneNode(true) as HTMLElement;previewFlag.removeAttribute('data-marker');previewFlag.classList.add('marker-drag-preview');ruler.append(previewFlag);previewBand=document.createElement('span');previewBand.className='marked-region region-drag-preview';previewBand.style.setProperty('--region-color',marker!.color??'#efc17b');previewBand.style.top=`${ruler.clientHeight}px`;ruler.style.height=`${ruler.clientHeight+22}px`;ruler.append(previewBand);}
      frame=requestAnimationFrame(scroll);
    }
    e.preventDefault();paint();
  };
  const finish=(e:PointerEvent)=>{
    if(e.pointerId!==event.pointerId)return;
    window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',cancel);cancelAnimationFrame(frame);
    if(scroller.hasPointerCapture(event.pointerId))scroller.releasePointerCapture(event.pointerId);
    if(!moved)return;
    h.active(false);h.suppressClick();
    if(e.type==='pointercancel'){h.render();return;}
    try{if(copying){h.commit(createMarkedRegion(p,marker!.id,time).project);h.toast('Marked region created. Click its band to run an edit.');}else h.commit(moveMarker(p,marker!.id,time));}catch(error){h.render();h.toast((error as Error).message,true);}
  };
  const cancel=(e:PointerEvent)=>finish(e);
  window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',cancel);
  return true;
}
