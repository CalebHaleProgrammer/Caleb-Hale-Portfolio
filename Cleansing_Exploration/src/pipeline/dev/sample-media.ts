import {Output,Mp4OutputFormat,BufferTarget,CanvasSource,AudioSampleSource,AudioSample,canEncodeVideo,canEncodeAudio} from 'mediabunny';
import {synthetic} from '../synthetic';
/** Tiny disposable fixtures, never used to benchmark real media processing. */
export async function sampleMedia(kind:'meeting'|'podcast'|'slideshow',signal?:AbortSignal):Promise<Blob>{
  if(!await canEncodeVideo('avc')||!await canEncodeAudio('aac'))throw Error('These sample MP4s require browser H.264 and AAC encoders.');
  const target=new BufferTarget(),out=new Output({format:new Mp4OutputFormat(),target}),canvas=new OffscreenCanvas(640,360),ctx=canvas.getContext('2d')!,video=new CanvasSource(canvas,{codec:'avc',bitrate:600000}),audio=new AudioSampleSource({codec:'aac',bitrate:96000}),fixture=synthetic(42,12,4);out.addVideoTrack(video,{frameRate:12});out.addAudioTrack(audio);await out.start();
  try{for(let frame=0;frame<144;frame++){signal?.throwIfAborted();const t=frame/12,index=Math.floor(t*4),a=fixture.signals.speakerA.values[index],b=fixture.signals.speakerB.values[index];ctx.fillStyle='#13232b';ctx.fillRect(0,0,640,360);ctx.font='24px sans-serif';ctx.fillStyle='white';
    if(kind==='meeting'){for(const [i,level]of [a,b].entries()){ctx.fillStyle=i?'#4b355f':'#235b50';ctx.fillRect(20+i*310,70,290,230);ctx.strokeStyle=level>.5?'#b6ffc5':'#718493';ctx.lineWidth=level>.5?8:2;ctx.strokeRect(20+i*310,70,290,230);ctx.fillStyle='white';ctx.fillText(`Speaker ${i?'B':'A'}`,60+i*310,190);}}
    else if(kind==='podcast'){ctx.fillText(t<2?'Podcast intro':t>=10?'Thanks for listening':'Host · local demo',100,180);ctx.fillStyle='#91dcb0';ctx.fillRect(100,240,a*400,15);}
    else {ctx.fillStyle=['#244d65','#553d67','#335b42'][Math.floor(t/4)];ctx.fillRect(25,25,590,310);ctx.fillStyle='white';ctx.fillText(`Slide ${Math.floor(t/4)+1}`,230,180);}
    await video.add(t,1/12);const rate=48000,frames=4000,data=new Float32Array(frames*2);for(let i=0;i<frames;i++){const v=kind==='slideshow'?0:.08*(a*Math.sin(2*Math.PI*220*(t+i/rate))+b*Math.sin(2*Math.PI*330*(t+i/rate)));data[i*2]=data[i*2+1]=v;}const sample=new AudioSample({format:'f32',sampleRate:rate,numberOfChannels:2,timestamp:t,data});try{await audio.add(sample);}finally{sample.close();}}
    video.close();audio.close();await out.finalize();return new Blob([target.buffer!],{type:'video/mp4'});
  }catch(error){await out.cancel();throw error;}
}
