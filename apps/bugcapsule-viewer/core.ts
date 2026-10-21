import {validateDescriptions,assertPackBudget} from '../bugcapsule-extension/export-budget.js';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {validate,importEvidence} from '../../packages/contracts/index.ts';
import {artifact,pack,unpack,sha,atomic} from '../../packages/safe-io/index.ts';
import {Store} from '../../packages/safe-io/store.ts';
import {renderBug} from '../../packages/report-ui/index.ts';
import type {Evidence,BugReport,BugEvent,ChangeRun} from '../../packages/contracts/types.ts';
const Manifest=z.object({schemaVersion:z.literal('1.0'),approvedAt:z.string().datetime(),files:z.array(z.object({path:z.string(),bytes:z.number().int().nonnegative(),sha256:z.string().regex(/^[a-f0-9]{64}$/),mediaType:z.string()}).strict()).length(2)}).strict();
export function report(events:BugEvent[],descriptions:{title:string;expected:string;actual:string},coverage:string[]):Evidence<BugReport>{
 const e:Evidence<BugReport>={schemaVersion:'1.0',evidenceId:randomUUID(),product:'bugcapsule',createdAt:new Date().toISOString(),origin:{kind:'synthetic',trust:'local_observed',sourceId:'synthetic-recorder'},integrity:{algorithm:'sha256',files:[]},claims:[{id:'description',type:'asserted',text:'合成デモ用の期待結果。独立した再現は未確認。',evidenceRefs:[]}],payload:{reportId:randomUUID(),sessionId:randomUUID(),...descriptions,origin:'http://127.0.0.1:47832',reproductionState:'recorded',redactionPolicyId:'strict-v1',coverage,events,verifierRunId:null}};validate(e);return e;
}
export function exportPack(e:Evidence<BugReport>,approved:boolean):Uint8Array{
 if(!approved)throw Error('LOCAL_EXPORT_REVIEW_REQUIRED');validate(e);validateDescriptions(e.payload);
 const files={'report.json':Buffer.from(JSON.stringify(e)),'events.jsonl':Buffer.from(e.payload.events.map(x=>JSON.stringify(x)).join('\n'))};
 const manifest={schemaVersion:'1.0',approvedAt:new Date().toISOString(),files:Object.entries(files).map(([p,b])=>artifact(p,b,p.endsWith('.jsonl')?'application/x-ndjson':'application/json'))};
 const allFiles={...files,'manifest.json':Buffer.from(JSON.stringify(manifest))};assertPackBudget(allFiles);return pack(allFiles);
}
export function parsePack(bytes:Uint8Array):{evidence:Evidence<BugReport>;digest:string;files:Record<string,Uint8Array>}{
 const files=unpack(bytes);if(Object.keys(files).sort().join(',')!=='events.jsonl,manifest.json,report.json')throw Error('PACK_FILE_SET');
 const manifest=Manifest.parse(JSON.parse(Buffer.from(files['manifest.json']!).toString()));
 if(new Set(manifest.files.map(f=>f.path)).size!==2)throw Error('DUPLICATE_MANIFEST');
 for(const f of manifest.files){if(!['report.json','events.jsonl'].includes(f.path))throw Error('MANIFEST_PATH');const value=files[f.path];if(!value||value.length!==f.bytes||sha(value)!==f.sha256)throw Error('MANIFEST_MISMATCH');}
 const e=importEvidence(JSON.parse(Buffer.from(files['report.json']!).toString()));if(e.product!=='bugcapsule')throw Error('WRONG_PRODUCT');const evidence=e as Evidence<BugReport>;
 const events=Buffer.from(files['events.jsonl']!).toString().split('\n').filter(Boolean).map(line=>JSON.parse(line) as unknown);
 if(JSON.stringify(events)!==JSON.stringify(evidence.payload.events))throw Error('EVENTS_MISMATCH');
 if(evidence.payload.events.some((e,i)=>i>0&&e.seq!==evidence.payload.events[i-1]!.seq+1))evidence.payload.coverage.push('event-sequence-gaps');
 return {evidence,digest:sha(bytes),files};
}
export async function importPack(bytes:Uint8Array,root:string){
 const parsed=parsePack(bytes),directory=path.join(root,parsed.digest);await mkdir(root,{recursive:true,mode:0o700});const store=new Store(path.join(root,'index.sqlite'));
 try{const existing=store.db.prepare('SELECT location FROM records WHERE product=? AND digest=?').get('bugcapsule',parsed.digest);if(existing)return {duplicate:true,directory:String(existing.location),evidence:parsed.evidence};
  await mkdir(directory,{mode:0o700});await atomic(path.join(directory,'original.zip'),bytes);await atomic(path.join(directory,'evidence.json'),JSON.stringify(parsed.evidence,null,2));await atomic(path.join(directory,'report.html'),renderBug(parsed.evidence));await atomic(path.join(directory,'report.en.html'),renderBug(parsed.evidence,'en'));await atomic(path.join(directory,'issue-draft.txt'),issueDraft(parsed.evidence));
  store.put(parsed.evidence.evidenceId,'bugcapsule',parsed.digest,directory);return {duplicate:false,directory,evidence:parsed.evidence};
 }finally{store.close();}
}
export function issueDraft(e:Evidence<BugReport>){const p=e.payload;return `# ${p.title}\n\n期待する結果: ${p.expected}\n実際の結果: ${p.actual}\n対象: ${p.origin}\nReport: ${p.reportId}\n再現状態: ${p.reproductionState}（記録だけでは独立再現を意味しません）\n\n制限: ${p.coverage.join(', ')}\n\n添付はローカル保存です。公開URL・Cookie・認証状態は含めません。\n`;}
export function link(reportEvidence:unknown,runEvidence:unknown,expectedHead:string,expectedSnapshot?:string){
 const bug=validate(reportEvidence),cp=validate(runEvidence);if(bug.product!=='bugcapsule'||cp.product!=='changeproof')throw Error('PRODUCT_MISMATCH');
 const p=cp.payload as ChangeRun,b=bug.payload as BugReport;const snapshotId=cp.claims.find(c=>c.id==='dirty-snapshot')?.text??null;const match=p.headSha===expectedHead&&(snapshotId===null?expectedSnapshot===undefined:snapshotId===expectedSnapshot);
 return {schemaVersion:'1.0',reportId:b.reportId,reportDigest:sha(JSON.stringify(bug)),runId:p.runId,runDigest:sha(JSON.stringify(cp)),headSha:p.headSha,expectedHeadSha:expectedHead,snapshotId,expectedSnapshotId:expectedSnapshot??null,status:match?'MATCH':'STALE',verification:match?p.verdict:'INCOMPLETE',reproductionState:b.reproductionState,createdAt:new Date().toISOString()};
}
