import {uid,duration,sourceAt,valueAt,type Asset,type Envelope,type Project,type Spectrum} from './model';
import {drawLayer,audioGain} from './render';
import * as storage from './storage';
interface Pending {resolve:(v:any)=>void;reject:(e:Error)=>void;progress?:(v:number,message:string,partial?:import('./pipeline/model').Signal)=>void;}
export class Media {
  worker=new Worker(new URL('./media-worker.js',import.meta.url),{type:'module'});
  pending=new Map<string,Pending>();files=new Map<string,File>();urls=new Map<string,string>();envelopes=new Map<string,Envelope>();spectra=new Map<string,Spectrum>();thumbs=new Map<string,string>();thumbQueue=Promise.resolve();
  constructor(){this.worker.onmessage=e=>{const p=this.pending.get(e.data.id);if(!p)return;if('progress'in e.data){p.progress?.(e.data.progress,e.data.message,e.data.signal);return;}this.pending.delete(e.data.id);e.data.error?p.reject(Error(e.data.error)):p.resolve(e.data.result);};this.worker.onerror=e=>{for(const p of this.pending.values())p.reject(Error(e.message||'Media worker failed'));this.pending.clear();};}
  task<T=any>(action:string,args:Record<string,unknown>,progress?:Pending['progress'],signal?:AbortSignal):Promise<T>{const id=uid();return new Promise((resolve,reject)=>{const cancel=()=>this.worker.postMessage({action:'cancel',job:id});if(signal?.aborted){reject(Error('Cancelled'));return;}signal?.addEventListener('abort',cancel,{once:true});this.pending.set(id,{resolve:v=>{signal?.removeEventListener('abort',cancel);resolve(v);},reject:e=>{signal?.removeEventListener('abort',cancel);reject(e);},progress});this.worker.postMessage({id,action,...args});});}
  async register(id:string,file:File){this.files.set(id,file);if(this.urls.has(id))URL.revokeObjectURL(this.urls.get(id)!);this.urls.set(id,URL.createObjectURL(file));await this.task('register',{assetId:id,file});}
  async import(file:File,progress?:Pending['progress']):Promise<Asset>{const id=uid();await this.register(id,file);const info=await this.task('probe',{assetId:id},progress);const a:Asset={id,name:file.name,kind:info.kind,width:info.width,height:info.height,duration:info.duration,hasAudio:info.hasAudio,size:file.size,fingerprint:`${file.name}:${file.size}:${file.lastModified}`,thumbnail:info.thumb?await storage.asDataURL(info.thumb):undefined};return a;}
  async analyze(id:string,progress?:Pending['progress'],signal?:AbortSignal):Promise<Envelope>{if(this.envelopes.has(id))return this.envelopes.get(id)!;const cached=await storage.get<Envelope>('analysis',id);if(cached){this.envelopes.set(id,cached);return cached;}const e=await this.task<Envelope>('analyze',{assetId:id},progress,signal);this.envelopes.set(id,e);await storage.put('analysis',id,e);return e;}
  async restore(assets:Asset[]){for(const a of assets){const f=await storage.get<File>('files',a.id);if(f)await this.register(a.id,f);}}
  async release(id:string){this.files.delete(id);this.envelopes.delete(id);const url=this.urls.get(id);if(url)URL.revokeObjectURL(url);this.urls.delete(id);await this.task('release',{assetId:id});}
  async thumbnail(id:string,time:number,wanted:()=>boolean=()=>true){const key=`${id}:${time.toFixed(2)}`;if(this.thumbs.has(key))return this.thumbs.get(key)!;let result='';const task=this.thumbQueue.then(async()=>{if(!wanted())return;if(this.thumbs.has(key)){result=this.thumbs.get(key)!;return;}const blob=await this.task<Blob|null>('thumbnail',{assetId:id,time});if(blob){result=await storage.asDataURL(blob);this.thumbs.set(key,result);if(this.thumbs.size>120)this.thumbs.delete(this.thumbs.keys().next().value!);}});this.thumbQueue=task.catch(()=>{});await task;return result;}
}
export class Preview {
  elements=new Map<string,HTMLMediaElement>();images=new Map<string,HTMLImageElement>();audio?:AudioContext;gains=new Map<string,GainNode>();sources=new Map<string,MediaElementAudioSourceNode>();
  playing=false;time=0;origin=0;originTime=0;project!:Project;raf=0;drawing=false;
  constructor(public canvas:HTMLCanvasElement,public media:Media,public update:(t:number)=>void){}
  setProject(p:Project){this.project=p;this.pause();this.render();}
  async ensureElement(id:string,asset:Asset):Promise<HTMLMediaElement|undefined>{if(!this.media.urls.has(asset.id))return;
    if(this.elements.has(id)){const existing=this.elements.get(id)!;if(existing.src===this.media.urls.get(asset.id))return existing;existing.pause();this.sources.get(id)?.disconnect();this.sources.delete(id);this.gains.get(id)?.disconnect();this.gains.delete(id);this.elements.delete(id);}
    const el=document.createElement(asset.kind==='video'?'video':'audio');el.src=this.media.urls.get(asset.id)!;el.preload='auto';if(el instanceof HTMLVideoElement){el.playsInline=true;el.preservesPitch=true;}el.crossOrigin='anonymous';
    el.addEventListener('loadeddata',()=>setTimeout(()=>void this.render(),0),{once:true});this.elements.set(id,el);return el;
  }
  async seek(t:number){this.time=Math.max(0,t);this.originTime=this.time;this.origin=performance.now();for(const el of this.elements.values())el.pause();await this.render(true);this.update(this.time);}
  async play(){if(!this.project)return;this.audio??=new AudioContext();await this.audio.resume();this.playing=true;this.originTime=this.time;this.origin=performance.now();this.tick();}
  pause(){this.playing=false;cancelAnimationFrame(this.raf);for(const el of this.elements.values())el.pause();}
  tick=()=>{if(!this.playing)return;this.time=this.originTime+(performance.now()-this.origin)/1000;const end=Math.max(0,...this.project.clips.filter(c=>c.enabled).map(c=>c.start+duration(c)));if(this.time>=end){this.time=end;this.pause();}this.update(this.time);void this.render();if(this.playing)this.raf=requestAnimationFrame(this.tick);};
  async render(seek=false){if(this.drawing||!this.project)return;this.drawing=true;try{
    const p=this.project,ctx=this.canvas.getContext('2d')!;if(this.canvas.width!==p.width||this.canvas.height!==p.height){this.canvas.width=p.width;this.canvas.height=p.height;}ctx.fillStyle='#090d10';ctx.fillRect(0,0,p.width,p.height);
    const active=p.clips.filter(c=>c.enabled&&this.time>=c.start&&this.time<c.start+duration(c)&&!p.tracks.find(t=>t.id===c.trackId)?.muted),keep=new Set(active.map(c=>c.id));
    for(const [id,el]of this.elements)if(!keep.has(id)){el.pause();this.sources.get(id)?.disconnect();this.sources.delete(id);this.gains.get(id)?.disconnect();this.gains.delete(id);el.removeAttribute('src');el.load();this.elements.delete(id);}
    const order=[...p.tracks].sort((a,b)=>a.kind==='main'?-1:b.kind==='main'?1:0);
    for(const track of order)for(const c of active.filter(c=>c.trackId===track.id)){
      const a=p.assets.find(a=>a.id===c.assetId)!;
      if(a.kind==='image'){if(!this.media.urls.has(a.id))continue;if(!this.images.has(a.id)||this.images.get(a.id)!.src!==this.media.urls.get(a.id)){const im=new Image();im.src=this.media.urls.get(a.id)!;await im.decode();this.images.set(a.id,im);}drawLayer(ctx,this.images.get(a.id)!,p.width,p.height,c,this.time);continue;}
      const el=await this.ensureElement(c.id,a);if(!el)continue;const t=sourceAt(c,this.time);el.playbackRate=c.rate;
      if(seek||Math.abs(el.currentTime-t)>.2){el.currentTime=t;if(el.readyState<2||el.seeking)await Promise.race([new Promise<void>(r=>el.addEventListener('seeked',()=>r(),{once:true})),new Promise<void>(r=>setTimeout(r,150))]);}
      if(this.audio&&a.hasAudio){if(!this.gains.has(c.id)){const gain=this.audio.createGain(),source=this.audio.createMediaElementSource(el);source.connect(gain);gain.connect(this.audio.destination);this.sources.set(c.id,source);this.gains.set(c.id,gain);}this.gains.get(c.id)!.gain.value=audioGain(c,this.time);el.volume=1;}else el.volume=Math.min(1,audioGain(c,this.time));
      if(this.playing&&el.paused)void el.play().catch(()=>{});if(a.kind==='video'&&el.readyState>=2)drawLayer(ctx,el as HTMLVideoElement,p.width,p.height,c,this.time);
    }
    for(const id of this.images.keys())if(!active.some(c=>c.assetId===id))this.images.delete(id);
  }finally{this.drawing=false;}}
}
