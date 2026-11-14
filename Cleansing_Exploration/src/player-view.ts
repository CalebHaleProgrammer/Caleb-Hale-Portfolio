export type PlayerFit='fit'|'fill'|'actual';
export function playerSize(availableWidth:number,availableHeight:number,videoWidth:number,videoHeight:number,mode:PlayerFit='fit'){
  if(availableWidth<=0||availableHeight<=0||videoWidth<=0||videoHeight<=0)return {width:0,height:0};
  const scale=mode==='actual'?1:mode==='fill'?Math.max(availableWidth/videoWidth,availableHeight/videoHeight):Math.min(availableWidth/videoWidth,availableHeight/videoHeight);
  return {width:videoWidth*scale,height:videoHeight*scale};
}
