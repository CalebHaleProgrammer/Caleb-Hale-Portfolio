import {clone,type MediaRevision,type Range,type SelectionResult} from './model';
import {mergeRanges,rangeProjection,toOrigin} from './timemap';
export function select(media:MediaRevision,ranges:Range[],anchor:SelectionResult['anchor']='content'):SelectionResult {const bounded=mergeRanges(ranges).map(r=>({...r,start:Math.min(media.durationSec,r.start),end:Math.min(media.durationSec,r.end)})).filter(r=>r.end>r.start);return {ranges:bounded,originRanges:toOrigin(media.timeMap,bounded),originId:media.originId,anchor,computedAgainst:media.id,timeMap:clone(media.timeMap),stale:[],lost:[]};}
export function projectSelection(selection:SelectionResult,target:MediaRevision):SelectionResult {
  if(selection.originId!==target.originId)throw Error('Selection and target have no shared origin. Connect media derived from the same recording.');
  const result=clone(selection);if(selection.anchor==='timestamp'&&JSON.stringify(selection.timeMap)!==JSON.stringify(target.timeMap)){result.stale=selection.ranges.map(range=>({range,reason:'Timing changed. Recompute this timestamp selection before applying it.'}));return result;}
  const projected=rangeProjection(target.timeMap,selection.originRanges);result.ranges=projected.ranges;result.lost=projected.lost;result.computedAgainst=target.id;result.timeMap=clone(target.timeMap);return result;
}
export function recompute(selection:SelectionResult,target:MediaRevision,ranges:Range[]){return select(target,ranges,selection.anchor);}
