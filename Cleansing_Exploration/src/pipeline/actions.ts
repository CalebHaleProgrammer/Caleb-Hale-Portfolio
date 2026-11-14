import {clone,type MediaRevision,type SelectionResult,type NodeDef,type DecisionList,type ApplyMode,type ConfidenceTier,type Range,type TimeMap} from './model';
import {compose,mergeRanges,rangeProjection,toOrigin} from './timemap';
import {projectSelection} from './selection';
export const defaultTiers:ConfidenceTier[]=[{minimum:.9,mode:'auto'},{minimum:.6,mode:'review'},{minimum:.3,mode:'propose'},{minimum:0,mode:'ignore'}];
export function route(confidence:number,mode:ApplyMode,tiers?:ConfidenceTier[],proposeOnly=false):ApplyMode|'ignore'{if(!Number.isFinite(confidence)||confidence<0||confidence>1)throw Error('Confidence must be between 0 and 1.');const resolved=tiers?[...tiers].sort((a,b)=>b.minimum-a.minimum).find(t=>confidence>=t.minimum)?.mode??'ignore':mode;return resolved==='ignore'?'ignore':proposeOnly?'propose':resolved;}
export function decisions(node:NodeDef,target:MediaRevision,selection:SelectionResult,proposeOnly=false):DecisionList {
  const projected=projectSelection(selection,target);if(projected.stale.length)throw Error(projected.stale[0].reason);
  const action=String(node.params.action);if(!['remove','speed','tag','layout'].includes(action))throw Error('Choose remove, speed, tag, or layout.');
  if(action==='layout'&&!node.params.defaultLayout)throw Error('Choose a default layout for times when nothing matches.');
  if(action==='speed'&&(!Number.isFinite(Number(node.params.rate))||Number(node.params.rate)<=0))throw Error('Choose a positive playback speed.');
  return mergeRanges(projected.ranges).map((range,i)=>{const confidence=range.confidence??1,mode=route(confidence,(node.params.mode??'auto') as ApplyMode,node.params.confidenceTiers as ConfidenceTier[]|undefined,proposeOnly);return {id:`${node.id}:${target.id}:${i}`,actionNodeId:node.id,action:action as 'remove'|'speed'|'tag'|'layout',range,params:clone(node.params),confidence,mode:mode==='ignore'?'propose':mode,status:mode==='ignore'?'ignored':mode==='auto'?'accepted':'pending',summary:`${action==='remove'?'Remove':action==='speed'?`Play at ${node.params.rate}×`:action==='tag'?`Tag as ${node.params.label??'label'}`:`Show ${node.params.layout??'layout'}`} from ${range.start.toFixed(2)} to ${range.end.toFixed(2)} seconds.`};});
}
export function applyDecisions(target:MediaRevision,list:DecisionList,id:string,defaultLayout?:string):MediaRevision {
  const accepted=list.filter(o=>o.status==='accepted'||o.status==='applied'),structural=accepted.filter(o=>o.action==='remove'||o.action==='speed');
  const boundaries=[...new Set([0,target.durationSec,...structural.flatMap(o=>[Math.max(0,o.range.start),Math.min(target.durationSec,o.range.end)])])].sort((a,b)=>a-b),local:TimeMap={segments:[]};let at=0;
  for(let i=1;i<boundaries.length;i++){const a=boundaries[i-1],b=boundaries[i],ops=structural.filter(o=>o.range.start<=a&&o.range.end>=b);if(ops.length>1)throw Error('Structural operations overlap. Merge selections or put actions in a linear chain.');const op=ops[0];if(op?.action==='remove')continue;const rate=op?.action==='speed'?Number(op.params.rate):1;if(!Number.isFinite(rate)||rate<=0)throw Error('Playback speed must be positive.');local.segments.push({outStart:at,outEnd:at+(b-a)/rate,srcStart:a,srcEnd:b,rate});at+=(b-a)/rate;}
  const result:MediaRevision={...clone(target),id,parentId:target.id,durationSec:at,timeMap:compose(local,target.timeMap),tags:rangeProjection(local,target.tags).ranges,layouts:target.layouts.flatMap(l=>rangeProjection(local,[l.range]).ranges.map(range=>({...l,range})))};
  if(defaultLayout)result.layouts.push({range:{start:0,end:at},layout:defaultLayout,z:-1});
  for(const op of accepted){if(op.action==='tag')result.tags.push(...rangeProjection(local,[{...op.range,tags:[String(op.params.label??'label')]}]).ranges);if(op.action==='layout')result.layouts.push(...rangeProjection(local,[op.range]).ranges.map(range=>({range,layout:String(op.params.layout??defaultLayout),z:Number(op.params.z??0)})));}
  return result;
}
export function originDecisionRanges(target:MediaRevision,ranges:Range[]){return toOrigin(target.timeMap,ranges);}
