import type {EditDef} from './pipeline/model';
import {validateDraft} from './pipeline/authoring';
import {validRegion,type VisualRegion} from './composition';
export type Mode = 'automatic' | 'suggested' | 'inherit';
export type Params = Record<string, number | string | boolean>;
export type Operation = 'quiet' | 'detectQuiet' | 'shorten' | 'speed' | 'normalize' | 'check';
export interface OpStep { id: string; type: 'operation'; operation: Operation; params: Params; mode: Mode; }
export type ConditionTest = 'matches' | 'duration' | 'loudness' | 'audio';
export interface ConditionStep { id:string;type:'condition';test:ConditionTest;params:Params;mode:Mode;then:Step[];otherwise:Step[]; }
export interface Reference { id: string; type: 'reference'; definitionId: string; policy: 'follow' | 'definition' | 'bake'; frozen?: Definition; unbaked?: Definition; overrides: Record<string, number | string | boolean>; mode: Mode; }
export type Step = OpStep | Reference | ConditionStep;
export interface Definition { id: string; version: number; kind: 'quick' | 'preset'; name: string; description: string; mode: Mode; initial: boolean; steps: Step[]; }
export type Property = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'gainDb';
export interface Keyframe { time: number; value: number; interpolation: 'linear' | 'hold'; }
export interface Clip { id: string; rootId: string; assetId: string; trackId: string; name: string; start: number; sourceIn: number; sourceOut: number; rate: number; gainDb: number; audioMuted?:boolean; enabled: boolean; quiet: boolean; x: number; y: number; scale: number; rotation: number; opacity: number; cropLeft?:number; cropRight?:number; cropTop?:number; cropBottom?:number; fadeIn?:number;fadeOut?:number; keyframes: Partial<Record<Property, Keyframe[]>>; }
export interface Asset { id: string; name: string; kind: 'video' | 'audio' | 'image'; duration: number; width: number; height: number; hasAudio: boolean; size: number; fingerprint: string; thumbnail?: string; demo?: boolean; }
export interface Track { id: string; name: string; kind: 'main' | 'overlay' | 'audio'; muted: boolean; }
export interface Change { type: string; start: number; end: number; description: string; }
export interface Proposal { id: string; name: string; rootId: string; before: Clip[]; after: Clip[]; changes: Change[]; revision: number; }
export interface Marker {id:string;time:number;name:string;color?:string;}
export interface SourceLink {id:string;name:string;videoAssetId:string;audioAssetId:string;audioOffsetSec:number}
export interface MarkedRegion {id:string;name:string;color:string;markerIds:[string,string];}
export interface Project { schema: 1; name: string; revision: number; assets: Asset[]; tracks: Track[]; clips: Clip[]; library: Definition[]; nodeEdits?:EditDef[]; sourceLinks?:SourceLink[]; visualRegions?:VisualRegion[]; proposals: Proposal[]; markers: Marker[]; regions?:MarkedRegion[]; width: number; height: number; fps: number; }
export interface Envelope { step: number; rms: Float32Array; peak: Float32Array; weighted: Float32Array; duration: number; hasAudio?:boolean; }
export interface Spectrum {step:number;columns:number;bins:number;data:Uint8Array;}
export const uid = () => crypto.randomUUID();
export const copy = <T>(value: T): T => structuredClone(value);
export const duration = (clip: Clip) => (clip.sourceOut - clip.sourceIn) / clip.rate;
export const projectEnd = (p: Project) => Math.max(0, ...p.clips.filter(c => c.enabled).map(c => c.start + duration(c)));
export const sourceAt = (c: Clip, time: number) => c.sourceIn + (time - c.start) * c.rate;
export function valueAt(c: Clip, prop: Property, sourceTime: number): number {
  const keys = c.keyframes[prop];
  if (!keys?.length) return c[prop];
  if (sourceTime <= keys[0].time) return keys[0].value;
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i], a = keys[i - 1];
    if (sourceTime < b.time) return a.interpolation === 'hold' ? a.value : a.value + (b.value - a.value) * ((sourceTime - a.time) / (b.time - a.time));
  }
  return keys[keys.length - 1].value;
}
export function makeClip(a: Asset, trackId: string, start: number): Clip {
  const id = uid();
  return {id, rootId:id, assetId:a.id, trackId, name:a.name, start, sourceIn:0, sourceOut:a.kind === 'image' ? 5 : a.duration, rate:1, gainDb:0, enabled:true, quiet:false, x:0.5, y:0.5, scale:trackId === 'main' ? 1 : 0.5, rotation:0, opacity:1, keyframes:{}};
}
export function blankProject(): Project {
  const quiet=quietDefinition();
  const normalize: Definition = {id:'normalize-action',version:1,kind:'quick',name:'Level spoken audio',description:'Measure loudness and adjust gain with a peak guard.',mode:'suggested',initial:false,steps:[{id:'level',type:'operation',operation:'normalize',mode:'inherit',params:{target:-16,maxBoost:12,peak:-1}}]};
  return {schema:1,name:'Untitled project',revision:0,assets:[],tracks:[{id:'main',name:'Main video',kind:'main',muted:false},{id:'overlay',name:'Overlay 1',kind:'overlay',muted:false},{id:'audio',name:'Audio',kind:'audio',muted:false}],clips:[],library:[quiet,normalize,{id:'lecture-preset',version:1,kind:'preset',name:'Lecture cleanup',description:'Shorten pauses, level audio, and check the result.',mode:'inherit',initial:true,steps:[reference(quiet.id),reference(normalize.id),{id:'verify',type:'operation',operation:'check',mode:'inherit',params:{minDuration:0.1,maxRate:4}}]}],proposals:[],markers:[],width:1920,height:1080,fps:30};
}
export function reference(id: string): Reference { return {id:uid(),type:'reference',definitionId:id,policy:'follow',overrides:{},mode:'inherit'}; }
export function quietDefinition():Definition{return {id:'quiet-action',version:2,kind:'quick',name:'Shorten quiet moments',description:'Find quiet regions, then shorten and speed them up when found.',mode:'suggested',initial:false,steps:[{id:'detect',type:'operation',operation:'detectQuiet',mode:'inherit',params:{threshold:-40,minQuiet:2,burstDuration:1,burstCeiling:-25}},{id:'when-quiet',type:'condition',test:'matches',params:{},mode:'inherit',then:[{id:'detect-shorten',type:'operation',operation:'shorten',mode:'inherit',params:{retain:20,target:'quiet'}},{id:'speed',type:'operation',operation:'speed',mode:'inherit',params:{rate:1.3,target:'quiet'}}],otherwise:[]}]};}
export function walkSteps(steps:Step[]):Step[]{return steps.flatMap(s=>s.type==='condition'?[s,...walkSteps(s.then),...walkSteps(s.otherwise)]:[s]);}
export function operationSteps(steps:Step[]):OpStep[]{return walkSteps(steps).filter((s):s is OpStep=>s.type==='operation');}
export function latest(library: Definition[], id: string): Definition {
  const versions = library.filter(d => d.id === id).sort((a,b) => b.version-a.version);
  if (!versions.length) throw Error('Referenced definition is missing.');
  return versions[0];
}
export function currentDefinitions(library: Definition[]) { return [...new Set(library.map(d=>d.id))].map(id=>latest(library,id)); }
export function resolveReference(ref: Reference, library: Definition[]): Definition {
  const d = copy(ref.policy === 'follow' ? latest(library,ref.definitionId) : ref.frozen ?? latest(library,ref.definitionId));
  for (const [path,value] of Object.entries(ref.overrides)) {
    const [id,param] = path.split(':');
    let step = walkSteps(d.steps).find(s=>s.id===id);
    if(param==='retain'&&step?.type==='operation'&&step.operation==='detectQuiet')step=walkSteps(d.steps).find(s=>s.id===`${id}-shorten`);
    if (!step || step.type === 'reference' || !(param in step.params)) throw Error(`A kept parameter (${path}) no longer exists. Keep the definition locked or resolve this override.`);
    step.params[param] = value;
  }
  return d;
}
export function bakeDefinition(d: Definition, library: Definition[], stack: string[] = []): Definition {
  if (stack.includes(d.id)) throw Error('Circular preset reference detected.');
  const baked = copy(d);
  const visit=(steps:Step[]):Step[]=>steps.map(s=>s.type==='condition'?{...copy(s),then:visit(s.then),otherwise:visit(s.otherwise)}:s.type === 'operation' ? copy(s) : {...copy(s),policy:'bake',overrides:{},unbaked:resolveReference(s,library),frozen:bakeDefinition(resolveReference(s,library),library,[...stack,d.id])});
  baked.steps = visit(d.steps);
  return baked;
}
export function setPolicy(ref: Reference, policy: Reference['policy'], library: Definition[]): Reference {
  if (policy === 'follow') { const result={...copy(ref),policy}; delete result.frozen;delete result.unbaked;return normalizeOverrides(result,library); }
  const raw = copy(ref.policy === 'follow' ? latest(library,ref.definitionId) : ref.policy==='bake' ? ref.unbaked ?? ref.frozen ?? latest(library,ref.definitionId) : ref.frozen ?? latest(library,ref.definitionId));
  return {...copy(ref),policy,unbaked:policy==='bake'?raw:undefined,frozen:policy === 'bake' ? bakeDefinition(raw,library) : raw};
}
export function normalizeOverrides(ref:Reference,library:Definition[]):Reference{const result=copy(ref),d=ref.policy==='follow'?latest(library,ref.definitionId):ref.frozen??latest(library,ref.definitionId);for(const [path,value]of Object.entries(result.overrides)){const[id,param]=path.split(':');if(param==='retain'&&operationSteps(d.steps).some(s=>s.id===id&&s.operation==='detectQuiet')&&operationSteps(d.steps).some(s=>s.id===`${id}-shorten`)){delete result.overrides[path];result.overrides[`${id}-shorten:${param}`]=value;}}return result;}
export interface Executable { operation: Operation | 'if'; params: Params; mode: Exclude<Mode,'inherit'>; label: string;condition?:ConditionTest;then?:Executable[];otherwise?:Executable[]; }
export function flattenExecutables(steps:Executable[]):Executable[]{return steps.flatMap(s=>[s,...flattenExecutables(s.then??[]),...flattenExecutables(s.otherwise??[])]);}
export function withMode(steps:Executable[],mode:Exclude<Mode,'inherit'>):Executable[]{return steps.map(s=>({...s,mode,then:s.then?withMode(s.then,mode):undefined,otherwise:s.otherwise?withMode(s.otherwise,mode):undefined}));}
export function compile(d: Definition, library: Definition[], inherited: Exclude<Mode,'inherit'> = 'suggested', stack: string[] = []): Executable[] {
  if (stack.includes(d.id) || stack.length>24) throw Error('Preset contains a circular reference or is nested too deeply.');
  const mode=d.mode==='inherit'?inherited:d.mode;
  const visit=(steps:Step[],parent:Exclude<Mode,'inherit'>,depth=0):Executable[]=>{if(depth>24)throw Error('Conditional logic is nested too deeply.');return steps.flatMap(s=>{const local=s.mode==='inherit'?parent:s.mode;if(s.type==='operation')return [{operation:s.operation,params:copy(s.params),mode:local,label:d.name}];if(s.type==='condition')return [{operation:'if',condition:s.test,params:copy(s.params),mode:local,label:d.name,then:visit(s.then,local,depth+1),otherwise:visit(s.otherwise,local,depth+1)}];const ops=compile(resolveReference(s,library),library,parent,[...stack,d.id]);return s.mode==='inherit'?ops:withMode(ops,s.mode);});};
  return visit(d.steps,mode);
}
export function migrateProject(p:Project):Project{const result=copy(p);for(const d of currentDefinitions(result.library)){if(!operationSteps(d.steps).some(s=>s.operation==='quiet'))continue;const visit=(steps:Step[]):Step[]=>steps.flatMap<Step>(s=>s.type==='condition'?[{...copy(s),then:visit(s.then),otherwise:visit(s.otherwise)}]:s.type==='operation'&&s.operation==='quiet'?[{...copy(s),operation:'detectQuiet',params:Object.fromEntries(Object.entries(s.params).filter(([key])=>key!=='retain'))},{id:`${s.id}-when`,type:'condition',test:'matches',params:{},mode:s.mode,then:[{id:`${s.id}-shorten`,type:'operation',operation:'shorten',mode:s.mode,params:{retain:s.params.retain,target:'quiet'}}],otherwise:[]}]:[copy(s)]);result.library.push({...copy(d),version:d.version+1,steps:visit(d.steps)});}return result;}
export function remapDefinition(d:Definition,ids:Map<string,string>):Definition{const visit=(steps:Step[]):Step[]=>steps.map(s=>s.type==='condition'?{...s,then:visit(s.then),otherwise:visit(s.otherwise)}:s.type==='reference'?{...s,definitionId:ids.get(s.definitionId)??s.definitionId,frozen:s.frozen?remapDefinition(s.frozen,ids):undefined,unbaked:s.unbaked?remapDefinition(s.unbaked,ids):undefined}:s);return {...d,id:ids.get(d.id)??d.id,steps:visit(d.steps)};}
function flatten(value: unknown, path=''): Record<string, unknown> {
  if (Array.isArray(value)) return Object.assign({},...value.map((v,i)=>flatten(v,`${path}[${i}]`)));
  if (value && typeof value==='object') return Object.assign({},...Object.entries(value).filter(([k])=>!['id','version','name','description','initial'].includes(k)).map(([k,v])=>flatten(v,path?`${path}.${k}`:k)));
  return {[path]:value};
}
export function referenceDiff(a: Reference, b: Reference, library: Definition[]): {path:string;before:unknown;after:unknown}[] {
  const left=flatten(compile(resolveReference(a,library),library)), right=flatten(compile(resolveReference(b,library),library));
  return [...new Set([...Object.keys(left),...Object.keys(right)])].filter(k=>JSON.stringify(left[k])!==JSON.stringify(right[k])).map(path=>({path,before:left[path],after:right[path]}));
}
export function cloneDefinition(d: Definition, library: Definition[], name: string): Definition {
  return {...bakeDefinition(d,library),id:uid(),version:1,name,initial:false};
}
export function validateProject(p: Project): void {
  if (p?.schema!==1 || !Array.isArray(p.clips) || !Array.isArray(p.library) || !Array.isArray(p.assets) || !Array.isArray(p.tracks) || !Array.isArray(p.proposals) || !Array.isArray(p.markers)) throw Error('This is not a supported Cutline project.');
  if (p.assets.length>10000 || p.clips.length>100000) throw Error('Project is too large to load.');
  if (!Number.isFinite(p.width)||!Number.isFinite(p.height)||p.width<16||p.width>4096||p.height<16||p.height>4096||!Number.isFinite(p.fps)||p.fps<1||p.fps>60) throw Error('Invalid output dimensions or frame rate.');
  for (const c of p.clips) if (![c.start,c.sourceIn,c.sourceOut,c.rate,c.gainDb,c.x,c.y,c.scale,c.rotation,c.opacity].every(Number.isFinite)||c.start<0||c.sourceIn<0||c.sourceOut<=c.sourceIn||c.rate<0.1||c.rate>8||!p.tracks.some(t=>t.id===c.trackId)||!p.assets.some(a=>a.id===c.assetId)) throw Error('Project contains an invalid clip.');
  if(new Set(p.markers.map(m=>m.id)).size!==p.markers.length||p.markers.some(m=>!m.id||!Number.isFinite(m.time)||m.time<0))throw Error('Project contains an invalid marker.');
  if(p.regions!==undefined&&!Array.isArray(p.regions))throw Error('Project contains invalid marked regions.');
  const linked=new Set<string>();for(const r of p.regions??[]){if(!r.id||!Array.isArray(r.markerIds)||r.markerIds.length!==2||r.markerIds[0]===r.markerIds[1]||r.markerIds.some(id=>!p.markers.some(m=>m.id===id)||linked.has(id)))throw Error('A marked region needs two distinct, unshared markers.');r.markerIds.forEach(id=>linked.add(id));}
  if(new Set((p.regions??[]).map(r=>r.id)).size!==(p.regions??[]).length)throw Error('Marked regions have duplicate identities.');
  if(p.nodeEdits!==undefined){if(!Array.isArray(p.nodeEdits)||new Set(p.nodeEdits.map(e=>e.id)).size!==p.nodeEdits.length)throw Error('Project contains an invalid node Edit library.');p.nodeEdits.forEach(validateDraft);}
  if(p.sourceLinks!==undefined){if(!Array.isArray(p.sourceLinks)||new Set(p.sourceLinks.map(l=>l.id)).size!==p.sourceLinks.length)throw Error('Project contains invalid source links.');for(const l of p.sourceLinks)if(!l.id||!l.name||!Number.isFinite(l.audioOffsetSec)||!p.assets.some(a=>a.id===l.videoAssetId&&a.kind==='video')||!p.assets.some(a=>a.id===l.audioAssetId&&a.hasAudio))throw Error('A source link needs video, an audio source and a finite offset.');}
  if(p.visualRegions!==undefined){if(!Array.isArray(p.visualRegions)||p.visualRegions.some(r=>!validRegion(r)||!p.assets.some(a=>a.id===r.assetId&&a.kind!=='audio')))throw Error('A visual region must stay inside its video or image.');}
  for(const d of currentDefinitions(p.library)) compile(d,p.library);
}
