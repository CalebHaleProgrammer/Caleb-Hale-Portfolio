import {SoundTouch} from 'soundtouchjs';
import {AudioSampleSink,type InputAudioTrack} from 'mediabunny';
import {duration,type Clip} from './model';
export async function* stretchedAudio(track:InputAudioTrack,c:Clip):AsyncGenerator<Float32Array> {
  const sink=new AudioSampleSink(track), st=new SoundTouch();st.tempo=c.rate;st.stretch.setParameters(48000,0,0,8);
  const wanted=Math.round(duration(c)*48000),sourceFrames=Math.round((c.sourceOut-c.sourceIn)*48000);let produced=0,resampled=0;
  function output(){const count=Math.min(st.outputBuffer.frameCount,wanted-produced);if(count<=0)return null;const out=new Float32Array(count*2);st.outputBuffer.receiveSamples(out,count);produced+=count;return out;}
  for await(const sample of sink.samples(c.sourceIn,c.sourceOut)){
    try{
      const channels=sample.numberOfChannels,frames=sample.numberOfFrames,data=new Float32Array(frames*channels);sample.copyTo(data,{format:'f32',planeIndex:0});
      const start=Math.max(c.sourceIn,sample.timestamp),end=Math.min(c.sourceOut,sample.timestamp+sample.duration);
      const first=Math.min(sourceFrames,Math.max(resampled,Math.ceil((start-c.sourceIn)*48000-1e-7))),last=Math.max(first,Math.min(sourceFrames,Math.ceil((end-c.sourceIn)*48000-1e-7)));
      while(resampled<first){const gap=Math.min(4800,first-resampled),silence=new Float32Array(gap*2);if(c.rate===1){produced+=gap;yield silence;}else{st.inputBuffer.putSamples(silence,0,gap);st.process();const out=output();if(out)yield out;}resampled+=gap;}
      const count=last-resampled,stereo=new Float32Array(count*2);
      for(let i=first;i<last;i++){const pos=(c.sourceIn+i/48000-sample.timestamp)*sample.sampleRate,j=Math.max(0,Math.min(frames-1,Math.floor(pos))),k=Math.min(frames-1,j+1),f=Math.max(0,Math.min(1,pos-j));for(let ch=0;ch<2;ch++){const channel=Math.min(ch,channels-1);stereo[(i-resampled)*2+ch]=data[j*channels+channel]*(1-f)+data[k*channels+channel]*f;}}resampled=last;
      if(c.rate===1){const out=stereo.subarray(0,Math.min(stereo.length,(wanted-produced)*2));produced+=out.length/2;if(out.length)yield out;}
      else{st.inputBuffer.putSamples(stereo,0,count);st.process();const out=output();if(out)yield out;}
      if(produced>=wanted)break;
    }finally{sample.close();}
  }
  if(c.rate!==1){for(let i=0;i<8&&produced<wanted;i++){st.inputBuffer.putSamples(new Float32Array(9600),0,4800);st.process();const out=output();if(out)yield out;}}
  while(produced<wanted){const n=Math.min(4800,wanted-produced);yield new Float32Array(n*2);produced+=n;}
}
