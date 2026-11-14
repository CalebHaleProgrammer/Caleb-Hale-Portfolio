import {clone,type EditDef,type NodeDef,type PortType} from './model';
import {createBlock,validateDraft} from './authoring';
import {port} from './examples';
import {workflowBlock,stepNode} from './workflows';
import type {Step} from '../model';
export function variants(n:NodeDef):[string,string][] {
  if(n.params.legacyStep){const s=n.params.legacyStep as Step;return s.type==='operation'?(s.operation==='detectQuiet'||s.operation==='quiet'?[['legacy:detectQuiet','Quiet signal'],['legacy:quiet','Find + shorten quiet']]:[['legacy:shorten','Shorten'],['legacy:speed','Speed'],['legacy:normalize','Normalize audio'],['legacy:check','Check']]):[];}
  if(n.kind==='media'&&!n.inputs.length)return [['av','Video + audio'],['video','Video'],['audio','Audio'],['image','Image'],['timeline','Timeline']];
  if(n.kind==='media')return [['static','Image → video'],['text-image','Text → image / template']];
  if(n.kind==='detection')return n.params.tracking?[['smooth','Smooth'],['peak','Peak'],['duration','Duration'],['change','Rate of change']]:[['loudness','Audio level'],['silence','Quiet duration'],['speech','Speech activity estimate'],['variance','Level variation'],['consistency','Level consistency'],['motion','Motion'],['scene','Scene changes'],['time','Time ranges'],['markers','Marked regions']];
  if(n.kind==='condition')return [['threshold','Threshold'],['and','All (AND)'],['or','Any (OR)'],['not','Not'],['priority','Priority']];
  if(n.kind==='selection')return [['select','Matching condition'],['range','Time ranges'],['tags','Tagged content']];
  if(n.kind==='action')return [['remove','Remove'],['speed','Speed'],['tag','Tag'],['layout','Layout']];return [];
}
export function variantValue(n:NodeDef):string {if(n.params.legacyStep)return `legacy:${(n.params.legacyStep as {operation:string}).operation}`;if(n.kind==='media')return !n.inputs.length?n.outputs[0].type:n.params.cast==='text-image'?'text-image':'static';if(n.kind==='detection')return String(n.params.tracking??n.params.detector);if(n.kind==='condition')return n.params.priorityOrder?'priority':String((n.params.expression as {op:string})?.op==='threshold'?'threshold':(n.params.expression as {op:string})?.op);if(n.kind==='selection')return n.params.ranges?'range':n.params.source==='tags'?'tags':'select';return String(n.params.action??'');}
export function changeVariant(edit:EditDef,id:string,value:string):EditDef {
  const next=clone(edit),n=next.nodes.find(n=>n.id===id)!;if(value.startsWith('legacy:')){const old=n.params.legacyStep as Step,step=workflowBlock('workflow-'+value.slice(7),old.id).params.legacyStep as Step;step.mode=old.mode;n.params.legacyStep=step;n.kind=stepNode(step).kind;}else if(n.kind==='media'&&!n.inputs.length){n.outputs[0].type=value as PortType;const slot=next.slots.find(s=>s.nodeId===id);if(slot)slot.type=value as 'av';}
  else if(n.kind==='detection'){if(n.params.tracking)n.params.tracking=value;else{n.params.detector=value;n.inputs[0].type=['motion','scene'].includes(value)?'video':['time','markers'].includes(value)?'media':'audio';}}
  else {const made=createBlock(value,id,n.ui.x,n.ui.y);n.params=made.params;n.inputs=made.inputs;n.outputs=made.outputs;}
  // Generic media channels perform safe extraction/holding at execution, while
  // signal/condition channels stay strictly typed. Never drop incompatible links.
  return validateDraft(next);
}
