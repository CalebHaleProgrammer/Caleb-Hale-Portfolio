/** Portable Phase 1 schema. Times are seconds, ranges are half-open. */
export type MediaType='video'|'audio'|'av'|'image'|'text'|'timeline';
export type PortType=MediaType|'media'|'signal'|'condition'|'selection';
export type NodeKind='media'|'detection'|'condition'|'selection'|'action'|'breakpoint';
export type Params=Record<string,unknown>;
export interface Range {start:number;end:number;confidence?:number;tags?:string[]}
export interface Segment {outStart:number;outEnd:number;srcStart:number;srcEnd:number;rate:number}
export interface TimeMap {segments:Segment[]}
export interface MediaRevision {id:string;originId:string;parentId?:string;mediaHash:string;type:MediaType;durationSec:number;timeMap:TimeMap;tags:Range[];layouts:{range:Range;layout:string;z:number}[];text?:string;template?:string;assetId?:string;audioAssetId?:string;audioOffsetSec?:number;crop?:{left:number;right:number;top:number;bottom:number}}
export interface Signal {id:string;revisionId:string;kind:string;sampleRateHz:number;values:Float32Array;confidence:Float32Array;remappable:boolean}
export interface SelectionResult {ranges:Range[];originRanges:Range[];originId:string;anchor:'content'|'timestamp';computedAgainst:string;timeMap:TimeMap;stale:{range:Range;reason:string}[];lost:Range[]}
export type ApplyMode='auto'|'review'|'propose';
export interface ConfidenceTier {minimum:number;mode:ApplyMode|'ignore'}
export interface EditOperation {id:string;actionNodeId:string;action:'remove'|'speed'|'tag'|'layout';range:Range;params:Params;confidence:number;mode:ApplyMode;status:'pending'|'accepted'|'rejected'|'skipped'|'applied'|'ignored';summary:string}
export type DecisionList=EditOperation[];
export interface Port {id:string;name:string;type:PortType;required:boolean}
export interface NodeDef {id:string;kind:NodeKind;name:string;params:Params;inputs:Port[];outputs:Port[];ui:{x:number;y:number};lockedCache?:boolean;weight?:number}
export interface Connection {from:{node:string;port:string};to:{node:string;port:string}}
export interface Slot {id:string;name:string;type:MediaType;nodeId:string;required:boolean}
export interface EditInstance {id:string;editId:string;state:'linked'|'frozen';frozenCopy?:EditDef;originVersion?:number;overrides?:Params}
export interface BakeManifest {parts:{instanceId:string;editId:string;version:number}[]}
export interface EditDef {schemaVersion:1;id:string;name:string;version:number;nodes:NodeDef[];connections:Connection[];slots:Slot[];instances?:EditInstance[];bakeManifest?:BakeManifest;derivedFrom?:{editId:string;version:number};history:{version:number;label:string}[];workflow?:{kind:'quick'|'preset';mode:'automatic'|'suggested'|'inherit';description:string;initial:boolean}}
export type Value=MediaRevision|Signal|SelectionResult;
export type Outputs=Record<string,Record<string,Value>>;
export const clone=<T>(value:T):T=>structuredClone(value);
export function media(id:string,durationSec:number,type:MediaType='av'):MediaRevision {if(!Number.isFinite(durationSec)||durationSec<0)throw Error('Media duration must be finite and non-negative.');return {id,originId:id,mediaHash:id,type,durationSec,timeMap:{segments:durationSec?[{outStart:0,outEnd:durationSec,srcStart:0,srcEnd:durationSec,rate:1}]:[]},tags:[],layouts:[]};}
export function compatible(from:PortType,to:PortType){return from===to||(to==='media'&&['audio','video','av','image','text','timeline'].includes(from))||(from==='av'&&(to==='video'||to==='audio'));}
/** A structural action preserves its input's media type. Keep the simple
 * Media UI while checking downstream audio/video connections precisely. */
export function outputType(edit:EditDef,nodeId:string,portId:string,seen=new Set<string>()):PortType|undefined {
  const n=edit.nodes.find(n=>n.id===nodeId),type=n?.outputs.find(p=>p.id===portId)?.type;
  if(type!=='media'||!n||seen.has(nodeId))return type;
  seen.add(nodeId);const input=n.inputs.find(p=>p.id==='media'),link=input&&edit.connections.find(c=>c.to.node===nodeId&&c.to.port===input.id);
  return link?outputType(edit,link.from.node,link.from.port,seen):type;
}
export function validateGraph(edit:EditDef,bindings:Record<string,MediaRevision>={},options:{allowIncomplete?:boolean}={}):NodeDef[]{
  if(edit.schemaVersion!==1||!Array.isArray(edit.nodes)||!Array.isArray(edit.connections)||!Array.isArray(edit.slots))throw Error('Unsupported pipeline schema. Import a version 1 Edit.');
  const nodes=new Map(edit.nodes.map(n=>[n.id,n]));if(nodes.size!==edit.nodes.length)throw Error('Node names may repeat, but node IDs must be unique.');
  const incoming=new Set<string>(),degree=new Map(edit.nodes.map(n=>[n.id,0])),edges=new Map<string,string[]>();
  for(const n of edit.nodes){if(!['media','detection','condition','selection','action','breakpoint'].includes(n.kind))throw Error(`${n.name}: choose a supported node kind.`);if(new Set(n.inputs.map(p=>p.id)).size!==n.inputs.length||new Set(n.outputs.map(p=>p.id)).size!==n.outputs.length)throw Error(`${n.name}: port IDs must be unique.`);}
  for(const c of edit.connections){const a=nodes.get(c.from.node),b=nodes.get(c.to.node),out=a?.outputs.find(p=>p.id===c.from.port),input=b?.inputs.find(p=>p.id===c.to.port);if(!a||!b||!out||!input)throw Error('A connection references a missing node or port. Reconnect it.');const actual=outputType(edit,a.id,out.id)??out.type;if(!compatible(actual,input.type))throw Error(`${a.name} (${actual}) cannot connect to ${b.name} → ${input.name} (${input.type}). Choose a compatible media channel or constructor.`);const key=`${b.id}:${input.id}`;if(incoming.has(key))throw Error(`${b.name} → ${input.name} accepts one connection. Use a condition to combine signals.`);incoming.add(key);degree.set(b.id,degree.get(b.id)!+1);edges.set(a.id,[...(edges.get(a.id)??[]),b.id]);}
  if(!options.allowIncomplete)for(const n of edit.nodes)for(const p of n.inputs)if(p.required&&!incoming.has(`${n.id}:${p.id}`))throw Error(`${n.name}: connect the required input “${p.name}”.`);
  for(const slot of edit.slots){const node=nodes.get(slot.nodeId);if(!node||node.kind!=='media')throw Error(`Slot “${slot.name}” must reference a Media node.`);if(!node.outputs.length||!compatible(slot.type,node.outputs[0].type))throw Error(`Slot “${slot.name}” and its Media output need compatible types.`);const value=bindings[slot.id];if(slot.required&&!value)throw Error(`Choose media for the required slot “${slot.name}”.`);if(value&&!compatible(value.type,slot.type))throw Error(`Slot “${slot.name}” needs ${slot.type}, received ${value.type}. Add an explicit cast.`);}
  // Structural outputs cannot split into competing structural successors.
  for(const n of edit.nodes){const successors=edit.connections.filter(c=>c.from.node===n.id&&n.outputs.find(p=>p.id===c.from.port)?.type!=='selection').map(c=>nodes.get(c.to.node)!).filter(b=>b.kind==='action'&&['remove','speed'].includes(String(b.params.action)));if(successors.length>1)throw Error(`${n.name}: keep structural actions in one linear chain.`);}
  const ready=edit.nodes.filter(n=>degree.get(n.id)===0),order:NodeDef[]=[];while(ready.length){const n=ready.shift()!;order.push(n);for(const id of edges.get(n.id)??[]){degree.set(id,degree.get(id)!-1);if(degree.get(id)===0)ready.push(nodes.get(id)!);}}if(order.length!==edit.nodes.length)throw Error('This Edit contains a cycle. Disconnect the loop; version 1 runs forward only.');return order;
}
