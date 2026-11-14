import {copy,duration,sourceAt,valueAt,uid,type Clip,type Project,type Envelope,type Change,type Executable,type Proposal} from './model';
import {audioGain} from './render';
export interface QuietRange { start:number; end:number; }
const db=(v:number)=>20*Math.log10(Math.max(1e-10,v));
export function detectQuiet(e: Envelope, c: Clip, p: Record<string,unknown>): QuietRange[] {
  const lo=Math.floor(c.sourceIn/e.step), hi=Math.min(e.rms.length,Math.ceil(c.sourceOut/e.step));
  const runs:{start:number;end:number;quiet:boolean;peak:number}[]=[];
  for(let i=lo;i<hi;i++) {
    const level=db(e.rms[i]*audioGain(c,c.start+(i*e.step-c.sourceIn)/c.rate)), quiet=level<Number(p.threshold);
    const last=runs.at(-1);
    if(last && last.quiet===quiet){last.end=(i+1)*e.step;last.peak=Math.max(last.peak,level);}
    else runs.push({start:i*e.step,end:(i+1)*e.step,quiet,peak:level});
  }
  for(let i=1;i<runs.length-1;i++) if(!runs[i].quiet && runs[i-1].quiet && runs[i+1].quiet && (runs[i].end-runs[i].start)/c.rate<=Number(p.burstDuration)+1e-8 && runs[i].peak<=Number(p.burstCeiling)) runs[i].quiet=true;
  const merged:QuietRange[]=[];
  for(const r of runs.filter(r=>r.quiet)){const last=merged.at(-1);if(last&&r.start<=last.end+1e-6)last.end=r.end;else merged.push({start:Math.max(c.sourceIn,r.start),end:Math.min(c.sourceOut,r.end)});}
  return merged.filter(r=>(r.end-r.start)/c.rate>=Number(p.minQuiet));
}
export function loudness(e: Envelope,c:Clip):{lufs:number;peak:number} {
  const lo=Math.floor(c.sourceIn/e.step),hi=Math.min(e.rms.length,Math.ceil(c.sourceOut/e.step));
  let peak=0;for(let i=lo;i<hi;i++)peak=Math.max(peak,e.peak[i]*audioGain(c,c.start+(i*e.step-c.sourceIn)/c.rate));
  const blocks:number[]=[];const n=Math.max(1,Math.round(.4/e.step)),hop=Math.max(1,Math.round(.1/e.step));
  for(let i=lo;i<hi;i+=hop){let sum=0,count=0;for(let j=i;j<Math.min(hi,i+n);j++){const gain=audioGain(c,c.start+(j*e.step-c.sourceIn)/c.rate);sum+=e.weighted[j]*gain*gain;count++;}const energy=sum/Math.max(1,count);if(-.691+10*Math.log10(Math.max(energy,1e-15))>-70)blocks.push(energy);}
  const mean=blocks.reduce((a,b)=>a+b,0)/Math.max(1,blocks.length), gate=mean/10;
  const gated=blocks.filter(v=>v>=gate), integrated=gated.reduce((a,b)=>a+b,0)/Math.max(1,gated.length);
  return {lufs:integrated>0?-.691+10*Math.log10(integrated):-Infinity,peak:db(peak)};
}
function piece(c:Clip,sourceIn:number,sourceOut:number,start:number,quiet:boolean):Clip{return {...copy(c),id:uid(),sourceIn,sourceOut,start,quiet};}
export function shortenQuiet(c:Clip,ranges:QuietRange[],retain:number):{clips:Clip[];changes:Change[]} {
  if(!Number.isFinite(retain)||retain<0)throw Error('Retained quiet duration must be zero or greater.');
  const clips:Clip[]=[],changes:Change[]=[];let source=c.sourceIn,at=c.start;
  const add=(a:number,b:number,q:boolean)=>{if(b-a>1e-7){const next=piece(c,a,b,at,q);clips.push(next);at+=duration(next);}};
  for(const r of ranges){add(source,r.start,false);const length=(r.end-r.start)/c.rate;
    if(length>retain+1e-7){const edge=retain*c.rate/2;add(r.start,r.start+edge,true);add(r.end-edge,r.end,true);changes.push({type:'cut',start:c.start+(r.start-c.sourceIn)/c.rate+retain/2,end:c.start+(r.end-c.sourceIn)/c.rate-retain/2,description:`Shorten ${length.toFixed(2)}s quiet to ${retain}s`});}
    else add(r.start,r.end,true); source=r.end;
  }
  add(source,c.sourceOut,false);
  return {clips:ranges.length?clips:[copy(c)],changes};
}
export function replaceClips(p:Project,before:Clip[],after:Clip[]):Project {
  if(!before.length)return p;
  const draft=copy(p),ids=new Set(before.map(c=>c.id)),oldStart=Math.min(...before.map(c=>c.start)),oldEnd=Math.max(...before.map(c=>c.start+duration(c)));
  const newEnd=after.length?Math.max(...after.map(c=>c.start+duration(c))):oldStart,delta=newEnd-oldEnd;
  const main=before.some(c=>c.trackId==='main');
  draft.clips=draft.clips.filter(c=>!ids.has(c.id)).map(c=>({...c,start:c.start>=oldEnd-1e-7&&(main||c.trackId===before[0].trackId)?Math.max(0,c.start+delta):c.start})).concat(copy(after));
  if(main)draft.markers=draft.markers.map(m=>{if(m.time>=oldEnd)return {...m,time:m.time+delta};const original=before.find(c=>m.time>=c.start&&m.time<c.start+duration(c));if(!original)return m;const source=sourceAt(original,m.time),kept=after.find(c=>c.assetId===original.assetId&&source>=c.sourceIn&&source<=c.sourceOut);if(kept)return {...m,time:kept.start+(source-kept.sourceIn)/kept.rate};const next=after.filter(c=>c.sourceIn>source).sort((a,b)=>a.sourceIn-b.sourceIn)[0];return {...m,time:next?.start??newEnd};});
  draft.proposals=draft.proposals.map(s=>s.before.every(c=>c.start>=oldEnd-1e-7)&&(main||s.before[0].trackId===before[0].trackId)?{...s,before:s.before.map(c=>({...c,start:c.start+delta})),after:s.after.map(c=>({...c,start:c.start+delta})),changes:s.changes.map(c=>({...c,start:c.start+delta,end:c.end+delta}))}:s);
  draft.revision++; return draft;
}
export type Analyze=(assetId:string)=>Promise<Envelope>;
export async function processClip(original:Clip,steps:Executable[],analyze:Analyze,signal?:AbortSignal):Promise<{automatic:Clip[];pending:Clip[];changes:Change[];suggested:boolean}> {
  async function evaluate(initial:Clip[],sequence:Executable[],depth=0):Promise<{automatic:Clip[];pending:Clip[];changes:Change[];suggested:boolean}>{
    if(depth>24)throw Error('Conditional logic is nested too deeply.');
    let clips=copy(initial),automatic=copy(initial),suggested=false;const changes:Change[]=[];
    const anchor=initial[0]?.start??original.start;
    for(const step of sequence){signal?.throwIfAborted();let next:Clip[]=[];const local:Change[]=[];let conditionalPending=false;
      for(const c of clips){signal?.throwIfAborted();
        if(step.operation==='if'){
          let matches=false;const target=step.params.target;
          if(step.condition==='matches')matches=c.quiet;
          else if(step.condition==='duration')matches=(target!=='quiet'||c.quiet)&&compare(duration(c),Number(step.params.value),String(step.params.compare??'gt'));
          else{const env=await analyze(c.assetId),hasAudio=env.hasAudio!==false&&env.rms.length>0;if(step.condition==='audio')matches=hasAudio;else matches=hasAudio&&compare(loudness(env,c).lufs,Number(step.params.value),String(step.params.compare??'lt'));}
          if(step.params.invert===true)matches=!matches;
          const branch=await evaluate([c],matches?step.then??[]:step.otherwise??[],depth+1);next.push(...branch.pending);local.push(...branch.changes);conditionalPending ||= branch.suggested;
        }else if(step.operation==='detectQuiet'||step.operation==='quiet'){
          const env=await analyze(c.assetId);if(env.hasAudio===false){next.push({...c,quiet:false});continue;}const ranges=detectQuiet(env,c,step.params);
          const result=shortenQuiet(c,ranges,step.operation==='detectQuiet'?duration(c)+1:Number(step.params.retain));next.push(...result.clips);if(step.operation==='quiet')local.push(...result.changes);
        }else if(step.operation==='shorten'){
          if(step.params.target==='quiet'&&!c.quiet){next.push(c);continue;}
          const result=shortenQuiet(c,[{start:c.sourceIn,end:c.sourceOut}],Number(step.params.retain));next.push(...result.clips.map(piece=>({...piece,quiet:c.quiet})));local.push(...result.changes);
        }else if(step.operation==='speed'){
          const rate=Number(step.params.rate);if(!Number.isFinite(rate)||rate<.1||rate>8||c.rate*rate>8||c.rate*rate<.1)throw Error('Resulting playback rate must be between 0.1× and 8×.');
          const apply=step.params.target!=='quiet'||c.quiet;next.push({...c,rate:apply?c.rate*rate:c.rate});if(apply&&rate!==1)local.push({type:'speed',start:c.start,end:c.start+duration(c),description:`${c.quiet?'Matching section':'Clip'} → ${(c.rate*rate).toFixed(2)}×`});
        }else if(step.operation==='normalize'){
          if(step.params.affected==='quiet'&&!c.quiet){next.push(c);continue;}const env=await analyze(c.assetId);if(env.hasAudio===false){next.push(c);continue;}
          const m=loudness(env,c),target=Number(step.params.target),boost=Number(step.params.maxBoost),peak=Number(step.params.peak),gain=Number.isFinite(m.lufs)?Math.min(target-m.lufs,boost,peak-m.peak):0;
          const adjusted={...copy(c),gainDb:c.gainDb+gain};if(adjusted.keyframes.gainDb)adjusted.keyframes.gainDb=adjusted.keyframes.gainDb.map(k=>({...k,value:k.value+gain}));next.push(adjusted);if(Math.abs(gain)>.01)local.push({type:'gain',start:c.start,end:c.start+duration(c),description:`Loudness ${m.lufs.toFixed(1)} LUFS · gain ${gain>=0?'+':''}${gain.toFixed(1)} dB`});
        }else{if(duration(c)<Number(step.params.minDuration)||c.rate>Number(step.params.maxRate))throw Error('Final checks failed: a segment is too short or too fast. No edits from this run were applied.');next.push(c);}
      }
      let at=anchor;clips=next.map(c=>{const result={...c,start:at};at+=duration(c);return result;});
      if(local.length){suggested ||= step.operation==='if'?conditionalPending:step.mode==='suggested';changes.push(...local);if(!suggested)automatic=copy(clips);}
    }
    return {automatic,pending:clips,changes,suggested};
  }
  return evaluate([original],steps);
}
function compare(actual:number,expected:number,operator:string){return operator==='lt'?actual<expected:operator==='lte'?actual<=expected:operator==='gte'?actual>=expected:actual>expected;}
export async function runWorkflow(p:Project,ids:string[],steps:Executable[],analyze:Analyze,name:string,signal?:AbortSignal):Promise<Project> {
  let draft=copy(p);const selected=p.clips.filter(c=>ids.includes(c.id)).sort((a,b)=>b.start-a.start);
  if(!selected.length)throw Error('Select at least one clip.');
  for(const original of selected){signal?.throwIfAborted();if(draft.proposals.some(s=>s.before.some(b=>b.id===original.id)))throw Error('Resolve the existing suggestion for this content first.');
    const result=await processClip(original,steps,analyze,signal);
    if(!result.changes.length)continue;
    if(result.suggested){
      const base=result.automatic;
      if(JSON.stringify(base)!==JSON.stringify([original]))draft=replaceClips(draft,[original],base);
      const suggestion:Proposal={id:uid(),name,rootId:original.rootId,before:base,after:result.pending,changes:result.changes,revision:draft.revision};draft.proposals.push(suggestion);
    }else draft=replaceClips(draft,[original],result.pending);
  }
  return draft;
}
export function acceptProposal(p:Project,id:string):Project {
  const proposal=p.proposals.find(s=>s.id===id);if(!proposal)throw Error('Suggestion no longer exists.');
  const existing=p.clips.filter(c=>proposal.before.some(b=>b.id===c.id));
  if(JSON.stringify([...existing].sort((a,b)=>a.id.localeCompare(b.id)))!==JSON.stringify([...proposal.before].sort((a,b)=>a.id.localeCompare(b.id))))throw Error('The clip has changed since analysis. Reject this suggestion and run the action again.');
  let result=replaceClips(p,proposal.before,proposal.after);
  result.proposals=result.proposals.filter(s=>s.id!==id);
  return result;
}
export function splitClip(p:Project,id:string,time:number):Project {
  const c=p.clips.find(c=>c.id===id);if(!c||time<=c.start+.001||time>=c.start+duration(c)-.001)throw Error('Put the playhead inside the selected clip.');
  const t=sourceAt(c,time),left={...copy(c),sourceOut:t},right={...copy(c),id:uid(),sourceIn:t,start:time};const result=copy(p);result.clips=result.clips.filter(x=>x.id!==id).concat(left,right);result.revision++;return result;
}
/** Stage exact source-preserving slices before running a workflow. No split is
 * committed if the workflow subsequently produces no edits. */
export function selectTimeRange(p:Project,from:number,to:number,trackIds?:string[]):{project:Project;ids:string[]} {
  if(!Number.isFinite(from)||!Number.isFinite(to)||from<0||to<=from)throw Error('Enter a valid time range.');
  const next=copy(p),ids:string[]=[];
  next.clips=p.clips.flatMap(c=>{
    if((trackIds&&!trackIds.includes(c.trackId))||c.start>=to||c.start+duration(c)<=from)return [copy(c)];
    if(p.proposals.some(s=>s.before.some(b=>b.id===c.id)))throw Error('Resolve the existing suggestion in this region first.');
    const start=Math.max(from,c.start),end=Math.min(to,c.start+duration(c)),pieces:Clip[]=[];
    const add=(a:number,b:number,selected:boolean)=>{const part={...copy(c),id:pieces.length?uid():c.id,start:a,sourceIn:sourceAt(c,a),sourceOut:sourceAt(c,b)};pieces.push(part);if(selected)ids.push(part.id);};
    if(start>c.start)add(c.start,start,false);
    add(start,end,true);
    if(end<c.start+duration(c))add(end,c.start+duration(c),false);
    return pieces;
  });
  return {project:next,ids};
}
