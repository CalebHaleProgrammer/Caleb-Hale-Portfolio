/** Timeline execution boundary. The connected-node UI round-trips reusable
 * definitions through workflows.ts and uses this executor to preserve quiet
 * middle retention, normalization, nested conditions and reference policies.
 */
export {runWorkflow as runEditorWorkflow} from '../engine';
import {type Asset,type Clip,type Definition,copy} from '../model';
import {media,type MediaRevision,type EditInstance} from './model';
export function assetRevision(asset:Asset,contentHash:string):MediaRevision {if(!contentHash)throw Error('Provide a content hash; filename metadata is not a cache identity.');return {...media(asset.id,asset.duration,asset.kind==='video'?(asset.hasAudio?'av':'video'):asset.kind),assetId:asset.id,mediaHash:contentHash};}
export function clipRevision(asset:Asset,clip:Clip,contentHash:string):MediaRevision {const result=assetRevision(asset,contentHash),duration=(clip.sourceOut-clip.sourceIn)/clip.rate;return {...result,id:clip.id,parentId:asset.id,durationSec:duration,crop:{left:clip.cropLeft??0,right:clip.cropRight??0,top:clip.cropTop??0,bottom:clip.cropBottom??0},timeMap:{segments:[{outStart:0,outEnd:duration,srcStart:clip.sourceIn,srcEnd:clip.sourceOut,rate:clip.rate}]}};}
export interface LegacyEditBinding {uiKind:'quick'|'preset';definition:Definition;instance?:EditInstance}
export function bindLegacyDefinition(definition:Definition):LegacyEditBinding{return {uiKind:definition.kind,definition:copy(definition)};}
