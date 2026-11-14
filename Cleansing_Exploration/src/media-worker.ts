import {Input,ALL_FORMATS,BlobSource,AudioSampleSink,CanvasSink,Output,Mp4OutputFormat,BufferTarget,StreamTarget,CanvasSource,AudioSampleSource,AudioSample,canEncodeVideo,canEncodeAudio,type InputVideoTrack,type InputAudioTrack} from 'mediabunny';
import {duration,projectEnd,sourceAt,valueAt,type Asset,type Clip,type Envelope,type Project} from './model';
import {drawLayer,drawDemo,demoAudio,audioGain} from './render';
import {stretchedAudio} from './audio';
import {frequencyBins} from './audio-view';
import {audioSignal,frameDifference} from './pipeline/fast';
import {sourceTime as originTime} from './pipeline/timemap';
import {SHA256} from './pipeline/hash';
import type {MediaRevision,Params,Signal} from './pipeline/model';
const scope=self as unknown as {postMessage:(v:unknown,transfer?:Transferable[])=>void;onmessage:((e:MessageEvent)=>void)|null};
const files=new Map<string,File>(), cancelled=new Set<string>();
const inputs=new Map<string,Input>();
const envelopeCache=new Map<string,Envelope>(),hashes=new Map<string,string>();
async function fileHash(id:string,assetId:string){if(hashes.has(assetId))return hashes.get(assetId)!;const file=files.get(assetId);if(!file)throw Error('Relink the source file first.');const reader=file.stream().getReader(),hash=new SHA256();let count=0,last=-1;try{while(true){check(id);const part=await reader.read();if(part.done)break;hash.update(part.value);count+=part.value.length;const percent=Math.floor(count/Math.max(1,file.size)*100);if(percent!==last){last=percent;progress(id,percent/100,'Checking source content identity');}if(percent%2===0)await new Promise(resolve=>setTimeout(resolve,0));}}finally{await reader.cancel();reader.releaseLock();}const value=hash.digest();hashes.set(assetId,value);return value;}
async function pipelineSignal(id:string,assetId:string,revision:MediaRevision,p:Params):Promise<Signal>{const kind=String(p.detector),rate=Number(p.sampleRateHz??4);if(!Number.isFinite(rate)||rate<=0||rate>8)throw Error('Choose a Fast-tier rate between 0 and 8 samples per second.');if(['loudness','variance','consistency','silence','speech'].includes(kind)){let e=envelopeCache.get(assetId);if(!e){e=files.get(assetId)?.type.startsWith('image/')?{duration:revision.durationSec,step:.02,rms:new Float32Array(),peak:new Float32Array(),weighted:new Float32Array(),hasAudio:false}:await analyze(id,assetId);envelopeCache.set(assetId,e);}return audioSignal(revision,e,p);}
  const values=new Float32Array(Math.ceil(revision.durationSec*rate)),confidence=new Float32Array(values.length),result:Signal={id:`${revision.id}/${kind}`,revisionId:revision.id,kind,sampleRateHz:rate,values,confidence,remappable:false};
  if(kind==='time'||kind==='markers'){const ranges=(p.ranges??[]) as {start:number;end:number}[];for(let i=0;i<values.length;i++){values[i]=ranges.some(r=>i/rate>=r.start&&i/rate<r.end)?1:0;confidence[i]=1;}return result;}
  if(!['motion','scene'].includes(kind))throw Error('This detector is not implemented in the Fast tier.');if(files.get(assetId)?.type.startsWith('image/'))return result;const track=await(await input(assetId)).getPrimaryVideoTrack();if(!track)return result;
  const timestamps=(function*(){for(let i=0;i<values.length;i++)yield originTime(revision.timeMap,i/rate)??0;})(),canvas=new OffscreenCanvas(64,36),ctx=canvas.getContext('2d',{willReadFrequently:true})!;let previous:Uint8ClampedArray|undefined,at=0,last=0;
  for await(const frame of new CanvasSink(track,{width:64,height:36,fit:'fill',poolSize:1}).canvasesAtTimestamps(timestamps)){check(id);if(frame){const crop=revision.crop??{left:0,right:0,top:0,bottom:0};ctx.drawImage(frame.canvas,crop.left*64,crop.top*36,(1-crop.left-crop.right)*64,(1-crop.top-crop.bottom)*36,0,0,64,36);const pixels=ctx.getImageData(0,0,64,36).data,diff=frameDifference(previous,pixels);values[at]=kind==='motion'?diff.motion:diff.scene>Number(p.threshold??.35)?1:0;confidence[at]=at?.8:0;previous=pixels;}at++;const percent=Math.floor(at/Math.max(1,values.length)*100);if(percent!==last){last=percent;scope.postMessage({id,progress:percent/100,message:`Tracking ${kind} on downscaled frames`,signal:percent%10===0?{...result,values:values.slice(0,at),confidence:confidence.slice(0,at)}:undefined});await new Promise(resolve=>setTimeout(resolve,0));}}
  return result;
}
async function input(id:string){if(!files.has(id))throw Error('Source media is missing. Relink the file in Assets.');if(!inputs.has(id))inputs.set(id,new Input({formats:ALL_FORMATS,source:new BlobSource(files.get(id)!)}));return inputs.get(id)!;}
function check(id:string){if(cancelled.has(id))throw new DOMException('Cancelled','AbortError');}
function progress(id:string,value:number,message:string){scope.postMessage({id,progress:value,message});}
function biquad(rate:number,highpass:boolean){const f=highpass?38.13547087602444:1681.974450955533,Q=highpass?.5003270373238773:.7071752369554196,K=Math.tan(Math.PI*f/rate),Vh=10**(3.999843853973347/20),Vb=Vh**.4996667741545416,a0=1+K/Q+K*K;
  const b=highpass?[1,-2,1]:[(Vh+Vb*K/Q+K*K)/a0,2*(K*K-Vh)/a0,(Vh-Vb*K/Q+K*K)/a0];const a=[2*(K*K-1)/a0,(1-K/Q+K*K)/a0];let x1=0,x2=0,y1=0,y2=0;
  return (x:number)=>{const y=b[0]*x+b[1]*x1+b[2]*x2-a[0]*y1-a[1]*y2;x2=x1;x1=x;y2=y1;y1=y;return y;};}
async function analyze(id:string,assetId:string):Promise<Envelope>{
  const media=await input(assetId),track=await media.getPrimaryAudioTrack(),total=await media.computeDuration(),step=.02,length=Math.ceil(total/step),rms=new Float32Array(length),peak=new Float32Array(length),weighted=new Float32Array(length),counts=new Uint32Array(length);
  if(!track) return {step,rms,peak,weighted,duration:total,hasAudio:false};
  let filters:((v:number)=>number)[][]=[];let last=-1;
  for await(const sample of new AudioSampleSink(track).samples()){
    try{check(id);const channels=sample.numberOfChannels,frames=sample.numberOfFrames,data=new Float32Array(frames*channels);sample.copyTo(data,{format:'f32',planeIndex:0});
      if(!filters.length)filters=Array.from({length:channels},()=>[biquad(sample.sampleRate,false),biquad(sample.sampleRate,true)]);
      for(let i=0;i<frames;i++){const window=Math.floor((sample.timestamp+i/sample.sampleRate)/step);if(window<0||window>=length)continue;let energy=0,weightedEnergy=0,max=0;
        for(let ch=0;ch<channels;ch++){const v=data[i*channels+ch];energy=Math.max(energy,v*v);max=Math.max(max,Math.abs(v));const k=filters[ch][1](filters[ch][0](v));weightedEnergy+=k*k;}
        rms[window]+=energy;weighted[window]+=weightedEnergy;peak[window]=Math.max(peak[window],max);counts[window]++;
      }
      const percent=Math.floor(100*(sample.timestamp+sample.duration)/total);if(percent!==last){last=percent;progress(id,percent/100,'Analyzing audio in bounded blocks');}
    }finally{sample.close();}
  }
  for(let i=0;i<length;i++){rms[i]=Math.sqrt(rms[i]/Math.max(1,counts[i]));weighted[i]/=Math.max(1,counts[i]);}
  return {step,rms,peak,weighted,duration:total,hasAudio:true};
}
async function spectrum(id:string,assetId:string){const media=await input(assetId),track=await media.getPrimaryAudioTrack(),total=await media.computeDuration(),step=Math.max(.05,total/8192),columns=Math.max(1,Math.ceil(total/step)),bins=48,data=new Uint8Array(columns*bins);if(!track)return {step,columns,bins,data};let ring:Float32Array[]=[],cursor=0,filled=0,next=0,lastProgress=-1;
  for await(const sample of new AudioSampleSink(track).samples()){try{check(id);const frames=sample.numberOfFrames,channels=sample.numberOfChannels,pcm=new Float32Array(frames*channels);sample.copyTo(pcm,{format:'f32',planeIndex:0});if(!ring.length)ring=Array.from({length:Math.min(2,channels)},()=>new Float32Array(1024));for(let i=0;i<frames;i++){for(let ch=0;ch<ring.length;ch++)ring[ch][cursor]=pcm[i*channels+ch];cursor=(cursor+1)%1024;filled=Math.min(1024,filled+1);const time=sample.timestamp+i/sample.sampleRate;if(filled===1024&&time>=next){const column=Math.min(columns-1,Math.floor(time/step));for(const channel of ring){const ordered=new Float32Array(1024);ordered.set(channel.subarray(cursor));ordered.set(channel.subarray(0,cursor),1024-cursor);const values=frequencyBins(ordered,sample.sampleRate,bins);for(let b=0;b<bins;b++)data[column*bins+b]=Math.max(data[column*bins+b],values[b]);}next=(column+1)*step;}}const percent=Math.floor(100*(sample.timestamp+sample.duration)/total);if(percent!==lastProgress){lastProgress=percent;progress(id,Math.min(1,percent/100),'Building a bounded spectrogram');}}finally{sample.close();}}
  return {step,columns,bins,data};}
async function probe(id:string,assetId:string){const f=files.get(assetId)!;
  if(f.type.startsWith('image/')){const image=await createImageBitmap(f),canvas=new OffscreenCanvas(240,135),ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0,240,135);const thumb=await canvas.convertToBlob({type:'image/jpeg',quality:.65});const result={kind:'image',width:image.width,height:image.height,duration:5,hasAudio:false,thumb};image.close();return result;}
  const media=await input(assetId),video=await media.getPrimaryVideoTrack(),audio=await media.getPrimaryAudioTrack();
  let thumb:Blob|undefined;if(video){const frame=await new CanvasSink(video,{width:240,height:135,fit:'contain',poolSize:1}).getCanvas(0);if(frame)thumb=await (frame.canvas as OffscreenCanvas).convertToBlob({type:'image/jpeg',quality:.65});}
  progress(id,1,'Media ready');return {kind:video?'video':'audio',width:video?await video.getDisplayWidth():0,height:video?await video.getDisplayHeight():0,duration:await media.computeDuration(),hasAudio:!!audio,thumb};
}
interface AudioCursor {iterator:AsyncGenerator<Float32Array>;buffer:Float32Array;offset:number;position:number;}
async function takeAudio(cursor:AudioCursor,count:number){const out=new Float32Array(count*2);let filled=0;while(filled<count){if(cursor.offset>=cursor.buffer.length){const next=await cursor.iterator.next();if(next.done)break;cursor.buffer=next.value;cursor.offset=0;}const n=Math.min(count-filled,(cursor.buffer.length-cursor.offset)/2);out.set(cursor.buffer.subarray(cursor.offset,cursor.offset+n*2),filled*2);cursor.offset+=n*2;cursor.position+=n;filled+=n;}return out;}
async function render(id:string,p:Project,handle:FileSystemFileHandle|undefined,demo=false){
  if(!await canEncodeVideo('avc',{width:p.width,height:p.height,bitrate:6_000_000})||!await canEncodeAudio('aac',{numberOfChannels:2,sampleRate:48000,bitrate:192000}))throw Error('This Chromium installation does not provide the H.264/AAC encoders required for MP4 export.');
  const canvas=new OffscreenCanvas(p.width,p.height),ctx=canvas.getContext('2d')!;
  const target=handle?new StreamTarget(await handle.createWritable()):new BufferTarget();
  const output=new Output({format:new Mp4OutputFormat({fastStart:false}),target});
  const video=new CanvasSource(canvas,{codec:'avc',bitrate:demo?1_500_000:6_000_000,latencyMode:'realtime',keyFrameInterval:2}),audio=new AudioSampleSource({codec:'aac',bitrate:192000});output.addVideoTrack(video,{frameRate:p.fps});output.addAudioTrack(audio);await output.start();
  const total=demo?60:projectEnd(p),frames=Math.ceil(total*p.fps),assets=new Map(p.assets.map(a=>[a.id,a])),videoIter=new Map<string,AsyncGenerator<any>>(),audioIter=new Map<string,AudioCursor>(),images=new Map<string,ImageBitmap>();
  const activeClips=p.clips.filter(c=>c.enabled&&!p.tracks.find(t=>t.id===c.trackId)?.muted),ordered=[...p.tracks].sort((a,b)=>(a.kind==='main'?-1:b.kind==='main'?1:0));
  let audioFrame=0;
  try{for(let frame=0;frame<frames;frame++){
    check(id);const t=frame/p.fps;ctx.fillStyle='#000';ctx.fillRect(0,0,p.width,p.height);
    if(demo)drawDemo(ctx,p.width,p.height,t);
    else for(const track of ordered){if(track.kind==='audio')continue;for(const c of activeClips.filter(c=>c.trackId===track.id&&t>=c.start&&t<c.start+duration(c))){const a=assets.get(c.assetId)!;
      if(a.kind==='image'){if(!images.has(a.id))images.set(a.id,await createImageBitmap(files.get(a.id)!));drawLayer(ctx,images.get(a.id)!,p.width,p.height,c,t);}
      else if(a.kind==='video'){
        if(!videoIter.has(c.id)){const v=await (await input(c.assetId)).getPrimaryVideoTrack();if(!v)continue;const times=(function*(){for(let f=frame;f/p.fps<Math.min(total,c.start+duration(c));f++)yield sourceAt(c,f/p.fps);})();videoIter.set(c.id,new CanvasSink(v,{poolSize:1}).canvasesAtTimestamps(times));}
        const next=await videoIter.get(c.id)!.next();if(!next.done&&next.value)drawLayer(ctx,next.value.canvas,p.width,p.height,c,t);
      }
    }}
    await video.add(t,Math.min(1/p.fps,total-t));
    const endAudio=Math.round(Math.min(total,(frame+1)/p.fps)*48000),count=endAudio-audioFrame,mix=new Float32Array(count*2),blockStart=audioFrame/48000,blockEnd=endAudio/48000;
    if(demo){for(let i=0;i<count;i++){const v=demoAudio(blockStart+i/48000);mix[i*2]=v;mix[i*2+1]=v;}}
    else for(const c of activeClips){const a=assets.get(c.assetId);if(!a?.hasAudio||c.start>=blockEnd||c.start+duration(c)<=blockStart)continue;
      if(!audioIter.has(c.id)){const audioTrack=await(await input(c.assetId)).getPrimaryAudioTrack();if(!audioTrack)continue;audioIter.set(c.id,{iterator:stretchedAudio(audioTrack,c),buffer:new Float32Array(),offset:0,position:0});}
      const from=Math.max(audioFrame,Math.round(c.start*48000)),to=Math.min(endAudio,Math.round((c.start+duration(c))*48000)),n=Math.max(0,to-from),data=await takeAudio(audioIter.get(c.id)!,n);
      for(let i=0;i<n;i++){const at=(from+i)/48000,gain=audioGain(c,at);mix[(from-audioFrame+i)*2]+=data[i*2]*gain;mix[(from-audioFrame+i)*2+1]+=data[i*2+1]*gain;}
    }
    for(let i=0;i<mix.length;i++)mix[i]=Math.max(-1,Math.min(1,mix[i]));
    if(count){const sample=new AudioSample({data:mix,format:'f32',numberOfChannels:2,sampleRate:48000,timestamp:audioFrame/48000});await audio.add(sample);sample.close();}audioFrame=endAudio;
    for(const [key,it] of videoIter){const c=activeClips.find(c=>c.id===key)!;if(t+1/p.fps>=c.start+duration(c)){await it.return(undefined);videoIter.delete(key);}}
    for(const [key,cursor]of audioIter){const c=activeClips.find(c=>c.id===key)!;if(blockEnd>=c.start+duration(c)){await cursor.iterator.return(undefined);audioIter.delete(key);}}
    for(const [key,image]of images)if(!activeClips.some(c=>c.assetId===key&&t>=c.start&&t<c.start+duration(c))){image.close();images.delete(key);}
    if(frame%p.fps===0)progress(id,frame/frames,`${demo?'Creating demo media':'Exporting'} · ${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')} / ${Math.ceil(total)}s`);
  }
  video.close();audio.close();progress(id,.99,'Finalizing MP4');await output.finalize();return handle?{saved:true}:{blob:new Blob([(target as BufferTarget).buffer!],{type:'video/mp4'})};
  }catch(error){await output.cancel();throw error;}finally{for(const it of videoIter.values())await it.return(undefined);for(const cursor of audioIter.values())await cursor.iterator.return(undefined);for(const image of images.values())image.close();}
}
scope.onmessage=async(e:MessageEvent)=>{const {id,action,...args}=e.data;if(action==='cancel'){cancelled.add(args.job);return;}
  try{let result:unknown;
    if(action==='register'){envelopeCache.delete(args.assetId);hashes.delete(args.assetId);files.set(args.assetId,args.file);inputs.get(args.assetId)?.dispose();inputs.delete(args.assetId);result=true;}
    else if(action==='hash')result=await fileHash(id,args.assetId);
    else if(action==='pipeline-signal')result=await pipelineSignal(id,args.assetId,args.revision,args.params);
    else if(action==='probe')result=await probe(id,args.assetId);
    else if(action==='thumbnail'){const track=await(await input(args.assetId)).getPrimaryVideoTrack();if(!track)result=null;else{const frame=await new CanvasSink(track,{width:320,height:180,fit:'contain',poolSize:1}).getCanvas(args.time);result=frame?await(frame.canvas as OffscreenCanvas).convertToBlob({type:'image/jpeg',quality:.65}):null;}}
    else if(action==='release'){inputs.get(args.assetId)?.dispose();inputs.delete(args.assetId);files.delete(args.assetId);envelopeCache.delete(args.assetId);hashes.delete(args.assetId);result=true;}
    else if(action==='analyze')result=await analyze(id,args.assetId);
    else if(action==='spectrum')result=await spectrum(id,args.assetId);
    else if(action==='export')result=await render(id,args.project,args.handle,false);
    else if(action==='demo')result=await render(id,{width:1280,height:720,fps:24} as Project,undefined,true);
    else throw Error('Unknown media task.');
    scope.postMessage({id,result});
  }catch(error){scope.postMessage({id,error:error instanceof Error?error.message:String(error)});}finally{cancelled.delete(id);}
};
