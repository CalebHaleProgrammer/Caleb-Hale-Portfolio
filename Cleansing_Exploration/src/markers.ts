import {copy,uid,type Project,type MarkedRegion} from './model';

export function regionBounds(p:Project,region:MarkedRegion):[number,number]|undefined {
  const endpoints=region.markerIds.map(id=>p.markers.find(m=>m.id===id));
  if(endpoints.some(m=>!m))return;
  return [Math.min(endpoints[0]!.time,endpoints[1]!.time),Math.max(endpoints[0]!.time,endpoints[1]!.time)];
}
export function regionForMarker(p:Project,id:string){return p.regions?.find(r=>r.markerIds.includes(id));}
export function moveMarker(p:Project,id:string,time:number):Project {
  if(!Number.isFinite(time)||time<0)throw Error('Choose a valid marker time.');
  const next=copy(p),marker=next.markers.find(m=>m.id===id);
  if(!marker)throw Error('Marker no longer exists.');
  marker.time=time;return next;
}
export function createMarkedRegion(p:Project,markerId:string,time:number):{project:Project;regionId:string} {
  if(!Number.isFinite(time)||time<0)throw Error('Choose a valid region endpoint.');
  const next=copy(p),original=next.markers.find(m=>m.id===markerId);
  if(!original)throw Error('Marker no longer exists.');
  if(Math.abs(original.time-time)<.001)throw Error('Drag away from the marker to mark a region.');
  // Each marker belongs to one pair. Starting from an existing endpoint copies
  // the anchor so the previous region remains independently adjustable.
  const anchor=regionForMarker(next,markerId)?{...copy(original),id:uid()}:original;
  if(anchor!==original)next.markers.push(anchor);
  const end={...copy(anchor),id:uid(),time,name:`${anchor.name} · other end`};
  next.markers.push(end);
  const region:MarkedRegion={id:uid(),name:anchor.name,color:anchor.color??'#efc17b',markerIds:[anchor.id,end.id]};
  (next.regions??=[]).push(region);return {project:next,regionId:region.id};
}
export function deleteMarker(p:Project,id:string):Project {
  const next=copy(p);next.markers=next.markers.filter(m=>m.id!==id);
  next.regions=next.regions?.filter(r=>!r.markerIds.includes(id));return next;
}
