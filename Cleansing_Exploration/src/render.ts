import {sourceAt,valueAt,type Clip} from './model';
export type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export function drawLayer(ctx:Context,image:CanvasImageSource,w:number,h:number,c:Clip,time:number) {
  const source=sourceAt(c,time), iw=('videoWidth' in image?image.videoWidth:'width' in image?image.width:w) as number, ih=('videoHeight' in image?image.videoHeight:'height' in image?image.height:h) as number;
  if(!iw||!ih)return;
  const left=c.cropLeft??0,top=c.cropTop??0,cw=iw*(1-left-(c.cropRight??0)),ch=ih*(1-top-(c.cropBottom??0));
  const fit=Math.min(w/cw,h/ch)*valueAt(c,'scale',source);
  ctx.save();ctx.globalAlpha=Math.max(0,Math.min(1,valueAt(c,'opacity',source)));ctx.translate(valueAt(c,'x',source)*w,valueAt(c,'y',source)*h);ctx.rotate(valueAt(c,'rotation',source)*Math.PI/180);ctx.drawImage(image,left*iw,top*ih,cw,ch,-cw*fit/2,-ch*fit/2,cw*fit,ch*fit);ctx.restore();
}
export function audioGain(c:Clip,time:number){return c.audioMuted?0:10**(valueAt(c,'gainDb',sourceAt(c,time))/20)*Math.max(0,Math.min(1,(time-c.start)/Math.max(.005,c.fadeIn??0),(c.start+((c.sourceOut-c.sourceIn)/c.rate)-time)/Math.max(.005,c.fadeOut??0)));}
export function drawDemo(ctx:Context,w:number,h:number,t:number) {
  const g=ctx.createLinearGradient(0,0,w,h);g.addColorStop(0,'#173b40');g.addColorStop(1,'#081d23');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
  ctx.fillStyle='#8ddbb5';ctx.font=`${h*.026}px sans-serif`;ctx.fillText('FIELD NOTES  /  01',w*.075,h*.15);
  ctx.fillStyle='#eef6ed';ctx.font=`600 ${h*.085}px sans-serif`;ctx.fillText('A little room',w*.075,h*.36);ctx.fillText('to think.',w*.075,h*.46);
  ctx.fillStyle='#90aaa6';ctx.font=`${h*.026}px sans-serif`;ctx.fillText(t>=12&&t<48?'A quiet moment. Keep what matters.':'Ideas take shape, one moment at a time.',w*.075,h*.57);
  for(let i=0;i<7;i++){ctx.strokeStyle=`rgba(149,224,187,${.12+i*.035})`;ctx.lineWidth=2;ctx.beginPath();for(let j=0;j<100;j++){const x=w*(.63+j*.003),y=h*(.5+Math.sin(j*.06+t*.12+i*.35)*(.07+i*.025));j?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.stroke();}
  ctx.fillStyle='#90aaa6';ctx.font=`${h*.022}px monospace`;ctx.fillText(`${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')} / 01:00`,w*.075,h*.87);
}
export function demoAudio(t:number) {
  const quiet=t>=12&&t<48,burst=t>=28&&t<28.6;
  const amp=burst?.025:quiet?.0008:.17*(.7+.3*Math.sin(t*9));
  return amp*(Math.sin(t*2*Math.PI*220)+.3*Math.sin(t*2*Math.PI*443))*.7;
}
