import {copy,reference,type Definition,type Step,type Operation} from '../model';
import {type EditDef,type NodeDef,clone,validateGraph} from './model';
import {node,port} from './examples';
import {arrange,placeholderBindings} from './authoring';
export const operationLabels:Record<Operation,string>={detectQuiet:'Quiet sections',quiet:'Shorten quiet sections',shorten:'Shorten sections',speed:'Playback speed',normalize:'Normalize audio',check:'Check result'};
export function stepNode(step:Step,name?:string):NodeDef {const kind=step.type==='condition'?'condition':step.type==='operation'&&['detectQuiet','quiet'].includes(step.operation)?'detection':'action';return node(step.id,kind,{legacyStep:copy(step)},[port('media','media')],'media') as NodeDef;}
export function stepName(step:Step){return step.type==='operation'?operationLabels[step.operation]:step.type==='condition'?'If / Then / Otherwise':'Reusable Edit';}
export function definitionGraph(d:Definition,library:Definition[]=[]):EditDef {
  const source=node(`source:${d.id}`,'media',{},[],'av');source.name='Media';const nodes=[source,...d.steps.map(s=>{const n=stepNode(s);n.name=s.type==='reference'?library.filter(d=>d.id===s.definitionId).sort((a,b)=>b.version-a.version)[0]?.name??'Reusable Edit':stepName(s);return n;})];
  return arrange({schemaVersion:1,id:d.id,name:d.name,version:Math.max(1,d.version),workflow:{kind:d.kind,mode:d.mode,description:d.description,initial:d.initial},nodes,connections:nodes.slice(1).map((n,i)=>({from:{node:nodes[i].id,port:'out'},to:{node:n.id,port:'media'}})),slots:[{id:source.id,name:'Media',type:'av',nodeId:source.id,required:true}],history:[]});
}
/** Reconstruct the actual connected chain; never silently drop detached actions. */
export function graphDefinition(g:EditDef,depth=0):Definition {
  if(depth>24)throw Error('Conditional branches are nested too deeply.');for(const n of g.nodes)for(const draft of Object.values(n.params.branchDrafts as Record<string,EditDef>??{}))graphDefinition(draft,depth+1);
  if(!g.workflow)throw Error('This is a signal graph, not a reusable timeline Edit.');if(g.slots.length!==1)throw Error('A timeline Edit needs one Media input. Use signal pipelines for multiple synchronized inputs.');validateGraph(g,placeholderBindings(g));const source=g.nodes.find(n=>g.slots.some(s=>s.nodeId===n.id));if(!source)throw Error('Add a Media input.');
  const steps:Step[]=[],visited=new Set([source.id]);let at=source.id;
  while(true){const links=g.connections.filter(c=>c.from.node===at&&c.from.port==='out'&&c.to.port==='media');if(links.length>1)throw Error('Chain timeline actions in one path. Put conditional choices inside Decide.');if(!links.length)break;const n=g.nodes.find(n=>n.id===links[0].to.node)!;if(visited.has(n.id))throw Error('Remove the cycle from this Edit.');visited.add(n.id);if(!n.params.legacyStep)throw Error(`${n.name}: use a timeline Action, Decide or reusable Edit in this path.`);steps.push(copy(n.params.legacyStep as Step));at=n.id;}
  if(g.nodes.some(n=>n.params.legacyStep&&!visited.has(n.id)))throw Error('Connect every action to the Media path before running. Detached nodes are saved but never silently skipped.');return {id:g.id,version:g.version,name:g.name,...copy(g.workflow),steps};
}
export function workflowBlock(kind:string,id:string):NodeDef {
  if(kind==='workflow-action')kind='workflow-shorten';
  let step:Step;if(kind.startsWith('reuse:'))step={...reference(kind.slice(6)),id};else if(kind==='workflow-decide')step={id,type:'condition',test:'matches',params:{},mode:'inherit',then:[],otherwise:[]};else {const op=kind.replace('workflow-','') as Operation;const defaults:Record<Operation,Record<string,number|string>>={detectQuiet:{threshold:-40,minQuiet:2,burstDuration:1,burstCeiling:-25},quiet:{threshold:-40,minQuiet:2,burstDuration:1,burstCeiling:-25,retain:20},shorten:{retain:20,target:'quiet'},speed:{rate:1.3,target:'quiet'},normalize:{target:-16,maxBoost:12,peak:-1,affected:'all'},check:{minDuration:.1,maxRate:4}};if(!defaults[op])throw Error('Choose a supported timeline action.');step={id,type:'operation',operation:op,params:copy(defaults[op]),mode:'inherit'};}
  const n=stepNode(step);n.name=stepName(step);return n;
}
export function updateStep(g:EditDef,id:string,step:Step){const next=clone(g),n=next.nodes.find(n=>n.id===id)!;n.params.legacyStep=copy(step);n.kind=stepNode(step).kind;return next;}
