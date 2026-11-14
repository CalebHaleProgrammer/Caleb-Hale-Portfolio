import {type Signal,type Params} from './model';
/** Sample-grid tracking with linear cost and no full-media PCM buffers. */
export function trackSignal(input:Signal,p:Params):Signal {
  const rate=input.sampleRateHz,window=Math.max(1,Math.round(Number(p.windowSec??1)*rate));if(!Number.isFinite(window)||window>1e6||rate<=0)throw Error('Choose a finite tracking window and a positive signal sample rate.');
  const values=new Float32Array(input.values.length),confidence=new Float32Array(input.confidence),mode=String(p.tracking??'smooth');let sum=0,elapsed=0;const queue:number[]=[];let head=0;
  for(let i=0;i<values.length;i++){const v=input.values[i];if(mode==='smooth'){sum+=v;if(i>=window)sum-=input.values[i-window];values[i]=sum/Math.min(window,i+1);}else if(mode==='peak'){while(queue.length>head&&input.values[queue.at(-1)!]<=v)queue.pop();queue.push(i);while(queue[head]<=i-window)head++;values[i]=input.values[queue[head]];if(head>1024){queue.splice(0,head);head=0;}}else if(mode==='duration'){const match=p.direction==='above'?v>=Number(p.threshold??0):v<=Number(p.threshold??0);elapsed=match?elapsed+1/rate:0;values[i]=elapsed;}else if(mode==='change')values[i]=i?Math.abs(v-input.values[i-1])*rate:0;else throw Error('Choose smooth, peak, duration or change tracking.');}
  return {...input,id:`${input.id}/track`,kind:`track:${mode}`,values,confidence,remappable:false};
}
