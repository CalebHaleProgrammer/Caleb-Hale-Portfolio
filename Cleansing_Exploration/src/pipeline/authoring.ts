import {clone,validateGraph,media,type EditDef,type NodeDef,type PortType,type Connection,type MediaRevision} from './model';
import {node,port} from './examples';
import {migrate} from './serialize';
import type {Step} from '../model';
export const NODE_WIDTH=246,HEADER_HEIGHT=96,PORT_HEIGHT=30;
export const catalog=[
  ['source','Media','Media'],['constructor','Media Constructor','Media Constructor'],
  ['detect','Signal','Measure signal'],['track','Signal','Track signal'],['threshold','Decide','Decide'],
  ['select','Select','Select'],['action','Action','Action'],['breakpoint','Control','Break-Point']
] as const;
export function placeholderBindings(edit:EditDef):Record<string,MediaRevision>{return Object.fromEntries(edit.slots.map(s=>[s.id,media(`slot:${s.id}`,90,s.type)]));}
export function validateDraft(edit:EditDef){
  if(!edit||!Array.isArray(edit.nodes)||!Array.isArray(edit.connections)||!Array.isArray(edit.slots)||!Array.isArray(edit.history)||typeof edit.name!=='string'||!edit.id||!Number.isInteger(edit.version)||edit.version<1)throw Error('Choose an Edit JSON file with a name, nodes, connections, slots and version.');
  if(edit.nodes.length>1000||edit.connections.length>5000)throw Error('This draft exceeds the 1,000-node authoring limit. Split it into smaller Edits.');
  const types:PortType[]=['video','audio','av','image','text','timeline','media','signal','condition','selection'];
  if(edit.workflow&&(!['quick','preset'].includes(edit.workflow.kind)||!['automatic','suggested','inherit'].includes(edit.workflow.mode)||typeof edit.workflow.description!=='string'||typeof edit.workflow.initial!=='boolean'))throw Error('An Edit needs its kind, implementation setting, description and initial flag.');
  const validateStep=(s:unknown,depth=0)=>{const step=s as {id:string;type:string;mode:string;operation:string;params:object;then:unknown[];otherwise:unknown[];definitionId:string;policy:string;overrides:object};if(!step||depth>24||!step.id||!['operation','condition','reference'].includes(step.type)||!['automatic','suggested','inherit'].includes(step.mode))throw Error('A reusable action has invalid settings or nesting.');if(step.type==='reference'){if(!step.definitionId||!['follow','definition','bake'].includes(step.policy)||!step.overrides||typeof step.overrides!=='object')throw Error('A reusable Edit needs its source and update policy.');}else{if(!step.params||typeof step.params!=='object')throw Error('Action parameters must be an object.');if(step.type==='operation'&&!['quiet','detectQuiet','shorten','speed','normalize','check'].includes(step.operation))throw Error('Choose a supported timeline action.');if(step.type==='condition'){if(!Array.isArray(step.then)||!Array.isArray(step.otherwise))throw Error('Decide needs Then and Otherwise branches.');step.then.forEach(s=>validateStep(s,depth+1));step.otherwise.forEach(s=>validateStep(s,depth+1));}}};
  for(const n of edit.nodes)if(n.params?.legacyStep)validateStep(n.params.legacyStep);
  for(const n of edit.nodes){if(!n.id||typeof n.name!=='string'||!n.params||typeof n.params!=='object'||!n.ui||![n.ui.x,n.ui.y].every(v=>Number.isFinite(v)&&v>=0)||!Array.isArray(n.inputs)||!Array.isArray(n.outputs))throw Error('A node is missing its name, settings, position or ports.');for(const p of [...n.inputs,...n.outputs])if(!p.id||!types.includes(p.type)||typeof p.name!=='string')throw Error(`${n.name}: choose a supported port type and a name.`);}
  if(new Set(edit.slots.map(s=>s.id)).size!==edit.slots.length)throw Error('Input slot IDs must be unique.');
  validateGraph(edit,placeholderBindings(edit),{allowIncomplete:true});return edit;
}
export function importDraft(text:string){return validateDraft(migrate(JSON.parse(text)));}
export function freshEdit(id:string,name='Untitled Edit'):EditDef{return {schemaVersion:1,id,name,version:1,nodes:[],connections:[],slots:[],history:[]};}
export function createBlock(kind:string,id:string,x=50,y=50):NodeDef {
  if(kind==='constructor')kind='static';if(kind==='action')kind='remove';
  let n:NodeDef;
  if(['source','audio','video','timeline','image','text'].includes(kind))n=node(id,'media',{},[],kind==='source'?'av':kind as 'image'|'text'|'audio'|'video'|'timeline');
  else if(kind==='static')n=node(id,'media',{cast:'static-video',durationSec:5},[port('media','image')],'video');
  else if(kind==='text-image')n=node(id,'media',{cast:'text-image',template:'Chapter card',text:'Title'},[port('media','text',false)],'image');
  else if(kind==='detect')n=node(id,'detection',{detector:'loudness',sampleRateHz:4,seed:42},[port('media','audio')],'signal');
  else if(kind==='track')n=node(id,'detection',{tracking:'smooth',windowSec:1,threshold:-40},[port('value','signal')],'signal');
  else if(kind==='threshold')n=node(id,'condition',{expression:{op:'threshold',signal:'value',on:.5,off:.2},debounce:1.5,hold:3},[port('value','signal')],'condition');
  else if(kind==='and'||kind==='or')n=node(id,'condition',{expression:{op:kind,children:[{op:'threshold',signal:'a',on:.5},{op:'threshold',signal:'b',on:.5}]}},[port('a','condition'),port('b','condition')],'condition');
  else if(kind==='not')n=node(id,'condition',{expression:{op:'not',child:{op:'threshold',signal:'value',on:.5}}},[port('value','condition')],'condition');
  else if(kind==='priority')n=node(id,'condition',{priorityOrder:['a','b'],chooseState:'a',defaultState:'none',hold:3},[port('a','condition'),port('b','condition')],'condition');
  else if(['select','range','tags'].includes(kind))n=node(id,'selection',kind==='range'?{ranges:[{start:0,end:10}]}:kind==='tags'?{source:'tags',tag:'intro'}:{},[port('media','media'),...(kind==='select'?[port('condition','condition')]:[])],'selection');
  else if(kind==='breakpoint')n=node(id,'breakpoint',{note:'Review the result before continuing.'},[port('media','av')],'av');
  else if(['remove','speed','tag','layout'].includes(kind))n=node(id,'action',{action:kind,mode:'propose',...(kind==='speed'?{rate:1.3}:kind==='tag'?{label:'Chapter'}:kind==='layout'?{layout:'speakerA',defaultLayout:'grid',z:0}:{})},[port('media','media'),port('selection','selection')],'media');
  else throw Error('Choose a supported building block.');
  n.name=catalog.find(c=>c[0]===kind)?.[2]??({static:'Media Constructor','text-image':'Media Constructor',remove:'Action',speed:'Action',tag:'Action',layout:'Action',range:'Select',tags:'Select',and:'Decide',or:'Decide',not:'Decide',priority:'Decide'} as Record<string,string>)[kind]??'Media';n.ui={x,y};return n;
}
export function addBlock(edit:EditDef,n:NodeDef):EditDef {const next=clone(edit);next.nodes.push(clone(n));if(n.kind==='media'&&!n.inputs.length)next.slots.push({id:n.id,name:n.name,type:n.outputs[0].type as 'av',nodeId:n.id,required:true});return validateDraft(next);}
export function connect(edit:EditDef,connection:Connection){const next=clone(edit);next.connections.push(clone(connection));return validateDraft(next);}
export interface Pin {node:string;port:string;direction:'in'|'out'}
export function connectionBetween(a:Pin,b:Pin):Connection {if(a.direction===b.direction)throw Error('Connect an output pin to an input pin.');return a.direction==='out'?{from:{node:a.node,port:a.port},to:{node:b.node,port:b.port}}:{from:{node:b.node,port:b.port},to:{node:a.node,port:a.port}};}
export function disconnectPin(edit:EditDef,pin:Pin){const next=clone(edit);next.connections=next.connections.filter(c=>pin.direction==='out'?c.from.node!==pin.node||c.from.port!==pin.port:c.to.node!==pin.node||c.to.port!==pin.port);return next;}
export function insertConnected(edit:EditDef,kind:string,id:string,x:number,y:number,pin?:Pin){let next=addBlock(edit,createBlock(kind,id,Math.max(0,Math.round(x/16)*16),Math.max(0,Math.round(y/16)*16)));if(pin){const n=next.nodes.find(n=>n.id===id)!;let error='No compatible pin is available on this node.';for(const p of pin.direction==='out'?n.inputs:n.outputs){try{return connect(next,connectionBetween(pin,{node:id,port:p.id,direction:pin.direction==='out'?'in':'out'}));}catch(e){error=(e as Error).message;}}throw Error(error);}return next;}
export function removeBlock(edit:EditDef,id:string){const next=clone(edit);next.nodes=next.nodes.filter(n=>n.id!==id);next.connections=next.connections.filter(c=>c.from.node!==id&&c.to.node!==id);next.slots=next.slots.filter(s=>s.nodeId!==id);return next;}
export function duplicateBlock(edit:EditDef,id:string,newId:string){const original=edit.nodes.find(n=>n.id===id);if(!original)throw Error('Select a node to duplicate.');const n=clone(original);n.id=newId;n.name+=' copy';n.ui.x+=40;n.ui.y+=40;
  const mapped=(id:string)=>`${newId}:${id}`;
  const step=(s:Step,root=false):Step=>s.type==='condition'?{...clone(s),id:root?newId:mapped(s.id),then:s.then.map(s=>step(s)),otherwise:s.otherwise.map(s=>step(s))}:{...clone(s),id:root?newId:mapped(s.id)};
  const graph=(g:EditDef):EditDef=>{const copy=clone(g);copy.id=mapped(copy.id);copy.nodes.forEach(n=>{n.id=mapped(n.id);if(n.params.legacyStep)n.params.legacyStep=step(n.params.legacyStep as Step);if(n.params.branchDrafts)n.params.branchDrafts=Object.fromEntries(Object.entries(n.params.branchDrafts as Record<string,EditDef>).map(([k,g])=>[k,graph(g)]));});copy.connections.forEach(c=>{c.from.node=mapped(c.from.node);c.to.node=mapped(c.to.node);});copy.slots.forEach(s=>{s.id=mapped(s.id);s.nodeId=mapped(s.nodeId);});return copy;};
  if(n.params.legacyStep)n.params.legacyStep=step(n.params.legacyStep as Step,true);if(n.params.branchDrafts)n.params.branchDrafts=Object.fromEntries(Object.entries(n.params.branchDrafts as Record<string,EditDef>).map(([k,g])=>[k,graph(g)]));return addBlock(edit,n);}
export function arrange(edit:EditDef):EditDef {const next=clone(edit),order=validateGraph(next,placeholderBindings(next),{allowIncomplete:true}),depth=new Map<string,number>(),rows=new Map<number,number>();for(const n of order){const incoming=next.connections.filter(c=>c.to.node===n.id),column=Math.max(0,...incoming.map(c=>(depth.get(c.from.node)??0)+1)),row=rows.get(column)??0;depth.set(n.id,column);n.ui={x:40+column*340,y:40+row*270};rows.set(column,row+1);}return next;}
export function portPoint(n:NodeDef,direction:'in'|'out',id:string){const index=(direction==='in'?n.inputs:n.outputs).findIndex(p=>p.id===id);return {x:n.ui.x+(direction==='out'?NODE_WIDTH:0),y:n.ui.y+HEADER_HEIGHT+index*PORT_HEIGHT+PORT_HEIGHT/2};}
export function wirePath(a:{x:number;y:number},b:{x:number;y:number}){const bend=Math.max(60,Math.abs(b.x-a.x)*.5);return `M ${a.x} ${a.y} C ${a.x+bend} ${a.y}, ${b.x-bend} ${b.y}, ${b.x} ${b.y}`;}
export function describeNode(n:NodeDef):string {
  if(n.params.legacyStep){const s=n.params.legacyStep as {type:string;operation?:string;test?:string;policy?:string};return s.type==='reference'?`Reusable Edit · ${s.policy==='follow'?'Linked':s.policy==='bake'?'Baked':'Frozen definition'}`:s.type==='condition'?`If ${s.test} → Then / Otherwise`:`${n.name} · selected content`;}
  if(n.params.tracking)return `Track ${n.params.tracking} over ${n.params.windowSec??1}s`;
  const p=n.params;if(n.kind==='media')return p.cast==='static-video'?`Hold image for ${p.durationSec} seconds`:p.cast==='text-image'?`Fill the ${p.template} template`:'Named media input';
  if(n.kind==='detection')return `Measure ${p.detector} over time`;
  if(n.kind==='condition'){if(p.priorityOrder)return `Prefer ${(p.priorityOrder as string[]).join(', then ')}; otherwise ${p.defaultState}`;const e=p.expression as {op?:string;on?:number};return e?.op==='threshold'?`When value exceeds ${e.on}; wait ${p.debounce??0}s, hold ${p.hold??0}s`:e?.op==='and'?'When all connected conditions match':e?.op==='or'?'When any connected condition matches':e?.op==='not'?'When the connected condition is false':'Combine conditions';}
  if(n.kind==='selection')return p.ranges?`Select ${(p.ranges as {start:number;end:number}[]).map(r=>`${r.start}–${r.end}s`).join(', ')}`:p.source==='tags'?`Select content tagged ${p.tag??'any'}`:'Select matching content';
  if(n.kind==='action')return `${p.action==='speed'?`Play selected content at ${p.rate}×`:p.action==='tag'?`Label selected content “${p.label}”`:p.action==='layout'?`Show ${p.layout}; default ${p.defaultLayout}`:'Remove selected content'} · ${p.mode??'auto'}`;
  return String(p.note??'Pause until you continue');
}
export function linearSteps(edit:EditDef){return validateGraph(edit,placeholderBindings(edit),{allowIncomplete:true}).map(n=>({id:n.id,name:n.name,description:describeNode(n),inputs:edit.connections.filter(c=>c.to.node===n.id).map(c=>edit.nodes.find(n=>n.id===c.from.node)!.name)}));}
