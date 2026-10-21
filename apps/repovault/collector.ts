import {z} from 'zod';
import type {Resource} from '../../packages/contracts/types.ts';
export interface PageResponse {status:number;headers:Record<string,string>;items:unknown[]}
export type Transport=(url:string)=>Promise<PageResponse>;
const Item=z.object({id:z.union([z.string().min(1),z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]),number:z.number().int().positive().optional(),pull_request:z.unknown().optional()}).passthrough();
export interface Checkpoint {url:string|null;pages:number;lastId:string|null;capturedAt:string|null;retryAt:string|null;error:string|null;items:Record<string,Record<string,unknown>>;startedAt?:string}
export interface ApiSource {apiOrigin:string;owner:string;repo:string;mode:'synthetic_http'}
export interface Capture {resources:Resource[];data:Record<string,Record<string,unknown>[]>;checkpoints:Record<string,Checkpoint>;captureStart:string;captureEnd:string;consistency:'best_effort'|'incomplete';source?:ApiSource}
export function nextLink(link:string|undefined):string|null{return link?.match(/<([^>]+)>;\s*rel="next"/)?.[1]??null;}
export async function collect(endpoints:Record<string,string>,transport:Transport,previous:Record<string,Checkpoint>={},onCheckpoint?:(checkpoints:Record<string,Checkpoint>)=>Promise<void>):Promise<Capture>{
 const captureStart=new Date().toISOString(),resources:Resource[]=[],data:Capture['data']={},checkpoints:Capture['checkpoints']={};
 for(const [kind,endpoint] of Object.entries(endpoints)){
  const initial=new URL(endpoint);const old=previous[kind];const cp:Checkpoint=old?structuredClone(old):{url:endpoint,pages:0,lastId:null,capturedAt:null,retryAt:null,error:null,items:{},startedAt:captureStart};
  // Revisit the first page on resume, preserving old items, to overlap update windows.
  if(old)cp.url=endpoint;cp.error=null;const visited=new Set<string>();
  if(cp.retryAt&&Date.now()<Date.parse(cp.retryAt))cp.error='RATE_LIMIT_WAIT';
  while(cp.url&&!cp.error){
   const url=new URL(cp.url);if(url.origin!==initial.origin||url.pathname!==initial.pathname||url.username||url.password||visited.has(url.href)||visited.size>=1000){cp.error='UNSAFE_PAGINATION';break;}visited.add(url.href);
   try{
    const response=await transport(url.href);if(response.status!==200){cp.error=response.status===403||response.status===404?'PERMISSION_OR_MISSING_AMBIGUOUS':response.status===429?'RATE_LIMIT':'HTTP_'+response.status;
     if(response.status===429||response.status===403){cp.retryAt=retryTime(new Headers(response.headers));}break;}
    if(!Array.isArray(response.items)||response.items.length>10000)throw Error('INVALID_PAGE');
    // Validate the whole page before committing any rows or cursor progress.
    const rows=response.items.map(raw=>Item.parse(raw));
    for(const row of rows){if(kind==='issues'&&row.pull_request)continue;const id=String(row.id);Object.defineProperty(cp.items,id,{value:{...row,id},enumerable:true,writable:true,configurable:true});cp.lastId=id;}
    cp.pages++;cp.capturedAt=new Date().toISOString();cp.retryAt=null;cp.url=nextLink(response.headers.link);checkpoints[kind]=cp;
   }catch{cp.error='NETWORK_OR_INVALID_PAGE';break;}
   // Persistence failures must abort, not masquerade as a recoverable API error.
   await onCheckpoint?.(structuredClone({...previous,...checkpoints}));
  }
  const values=Object.values(cp.items);resources.push({kind,selected:true,status:cp.error?(values.length?'PARTIAL':'FAILED'):'COMPLETE',expectedCount:null,actualCount:values.length,error:cp.error});data[kind]=values;checkpoints[kind]=cp;await onCheckpoint?.(structuredClone({...previous,...checkpoints}));
 }
 const captureEnd=new Date().toISOString();return {resources,data,checkpoints,captureStart,captureEnd,consistency:resources.some(r=>r.status!=='COMPLETE')?'incomplete':'best_effort'};
}
export function retryTime(headers:Headers):string|null{
 const value=headers.get('retry-after');if(value){const seconds=Number(value);return Number.isFinite(seconds)&&seconds>=0?new Date(Date.now()+seconds*1000).toISOString():Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;}
 const reset=Number(headers.get('x-ratelimit-reset'));return reset>0&&headers.get('x-ratelimit-remaining')==='0'?new Date(reset*1000).toISOString():null;
}
export function localHttpTransport(apiOrigin:string,token:string):Transport{
 const allowed=new URL(apiOrigin);if(allowed.origin!==apiOrigin||allowed.protocol!=='http:'||allowed.hostname!=='127.0.0.1'||!token)throw Error('SYNTHETIC_LOOPBACK_ORIGIN_AND_TOKEN_REQUIRED');
 return async url=>{const u=new URL(url);if(u.origin!==allowed.origin||u.username||u.password)throw Error('LOCAL_API_ORIGIN_MISMATCH');const response=await fetch(u,{headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(5000)});
  const size=Number(response.headers.get('content-length'));if(size>10*1024*1024)throw Error('PAGE_LIMIT');
  const chunks:Uint8Array[]=[];let total=0;if(response.body){for await(const chunk of response.body){total+=chunk.length;if(total>10*1024*1024)throw Error('PAGE_LIMIT');chunks.push(chunk);}}
  const headers=Object.fromEntries(response.headers),retryAt=retryTime(response.headers);if(retryAt)headers['retry-after']=String(Math.max(0,Math.ceil((Date.parse(retryAt)-Date.now())/1000)));
  return {status:response.status,headers,items:response.status===200?JSON.parse(Buffer.concat(chunks).toString()) as unknown[]:[]};
 };
}
export async function collectRepository(source:ApiSource,transport:Transport,previous?:Capture,onCheckpoint?:(checkpoints:Record<string,Checkpoint>)=>Promise<void>):Promise<Capture>{
 if(!/^[a-zA-Z0-9_.-]+$/.test(source.owner)||!/^[a-zA-Z0-9_.-]+$/.test(source.repo))throw Error('INVALID_REPOSITORY_NAME');
 if(previous&&(!previous.source||(['apiOrigin','owner','repo','mode'] as const).some(key=>previous.source![key]!==source[key])))throw Error('RESUME_SOURCE_MISMATCH');
 const base=`${source.apiOrigin}/repos/${source.owner}/${source.repo}`;
 const first=await collect({issues:`${base}/issues?state=all&per_page=30&page=1`,pulls:`${base}/pulls?state=all&per_page=30&page=1`,comments:`${base}/issues/comments?per_page=30&page=1`},transport,previous?.checkpoints??{},onCheckpoint);
 const reviewEndpoints:Record<string,string>={};
 for(const pr of first.data.pulls??[]){if(typeof pr.number!=='number'||!Number.isInteger(pr.number))throw Error('PULL_NUMBER_REQUIRED');reviewEndpoints[`reviews:${pr.number}`]=`${base}/pulls/${pr.number}/reviews?per_page=30&page=1`;reviewEndpoints[`review-comments:${pr.number}`]=`${base}/pulls/${pr.number}/comments?per_page=30&page=1`;}
 const rest=await collect(reviewEndpoints,transport,{...previous?.checkpoints,...first.checkpoints},onCheckpoint);
 const resources=[...first.resources],data={...first.data};
 for(const kind of ['reviews','review-comments']){const parts=rest.resources.filter(r=>r.kind.startsWith(kind+':'));const unique=new Map<string,Record<string,unknown>>();for(const part of parts)for(const item of rest.data[part.kind]??[])unique.set(String(item.id),{...item,pullNumber:Number(part.kind.split(':')[1])});
  const dependency=first.resources.find(r=>r.kind==='pulls')?.status!=='COMPLETE';const bad=parts.filter(r=>r.status!=='COMPLETE');const status=dependency||bad.length?(unique.size?'PARTIAL':'FAILED'):'COMPLETE';
  resources.push({kind,selected:true,status,expectedCount:null,actualCount:unique.size,error:dependency?'PULL_DISCOVERY_INCOMPLETE':bad.length?bad.map(r=>r.error).join(','):null});data[kind]=[...unique.values()];}
 const result:Capture={resources,data,checkpoints:{...first.checkpoints,...rest.checkpoints},captureStart:previous?.captureStart??first.captureStart,captureEnd:new Date().toISOString(),consistency:resources.some(r=>r.status!=='COMPLETE')?'incomplete':'best_effort',source};
 return result;
}
// Read-only adapter, deliberately opt-in. This task never calls it against GitHub.
// Do not persist or put the token into URLs, CLI arguments, logs, or the snapshot.
export function githubTransport(token:string,explicitlyApproved:boolean):Transport{
 if(!explicitlyApproved)throw Error('EXTERNAL_CONNECTION_NOT_APPROVED');
 return async url=>{const u=new URL(url);if(u.origin!=='https://api.github.com'||u.username||u.password)throw Error('GITHUB_ORIGIN_REQUIRED');const res=await fetch(u,{headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2026-03-10'},redirect:'error',signal:AbortSignal.timeout(30000)});const text=await res.text();if(text.length>10*1024*1024)throw Error('PAGE_LIMIT');return {status:res.status,headers:Object.fromEntries(res.headers),items:res.status===200?JSON.parse(text) as unknown[]:[]};};
}
