import {mkdir,readFile,mkdtemp,rm,symlink,realpath,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {Suppression,findingKey,type SuppressionRecord} from '../../packages/contracts/suppression.ts';
import {localRunQueue} from './queue.ts';
import {inspect,snapshot,git,freezeDirty} from './git.ts';
import {analyze} from './rules.ts';
import {vitestStatus,junitStatus} from './results.ts';
import {execute} from '../../packages/safe-io/process.ts';
import {sha,atomic,artifact,safeRead,redact,relativePath} from '../../packages/safe-io/index.ts';
import {validate,verdict} from '../../packages/contracts/index.ts';
import type {Check,ChangeRun,Evidence} from '../../packages/contracts/types.ts';
import {renderChangeProof} from '../../packages/report-ui/index.ts';
const CheckPolicy=z.object({id:z.string().regex(/^[a-zA-Z0-9_-]+$/),kind:z.enum(['typescript','vitest','junit','command']),required:z.boolean(),argv:z.array(z.string()).min(1),timeoutMs:z.number().int().min(20).max(300000),retries:z.number().int().min(0).max(2).default(0),resultFile:z.string().optional()}).strict();
export const Policy=z.object({version:z.literal(1),checks:z.array(CheckPolicy),trustedFiles:z.array(z.string()),requirements:z.array(z.object({id:z.string(),expected:z.string(),owner:z.string().min(1),checkRefs:z.array(z.string()).min(1)}).strict()),suppressions:z.array(Suppression).optional(),runTimeoutMs:z.number().int().min(20).max(900000).default(900000)}).strict();
export type PolicyType=z.infer<typeof Policy>;
export interface RunOptions {repo:string;base:string;head:string;policy:string;out:string;trustLocal:boolean;dirtySnapshot?:boolean;dependencies?:string;signal?:AbortSignal;secrets?:string[];compareBase?:boolean;onProgress?:(run:ChangeRun)=>void}
export interface Details {repoId:string;repoPath:string;dirty:boolean;snapshotId?:string;dirtyManifest?:{path:string;bytes:number;sha256:string;untracked:boolean}[];suppressionReview?:{findingId:string;record:SuppressionRecord;status:'ACTIVE'|'EXPIRED'|'DIFF_MISMATCH'}[];policyPath:string;commands:{id:string;argv:string[];targetSha:string;attempt:number;status:string;durationMs:number;pid:number|null;log:string}[];baseChecks:Check[];classification:{id:string;value:string}[];requirements:PolicyType['requirements'];diff:string;limitations:string[]}
export async function compare(options:RunOptions){return localRunQueue.run(()=>compareNow(options),options.signal);}
async function compareNow(options:RunOptions):Promise<{evidence:Evidence<ChangeRun>;details:Details;directory:string}>{
 if(!options.trustLocal)throw Error('TRUSTED_LOCAL_PROJECT_REQUIRED');
 const repo=await realpath(options.repo),policyPath=await realpath(options.policy);
 if(policyPath===repo||policyPath.startsWith(repo+path.sep))throw Error('EXTERNAL_TRUSTED_POLICY_REQUIRED');
 const policyBytes=await readFile(policyPath);if(policyBytes.length>100000)throw Error('POLICY_LIMIT');const policy=Policy.parse(JSON.parse(policyBytes.toString()));
 if(new Set(policy.checks.map(c=>c.id)).size!==policy.checks.length)throw Error('DUPLICATE_CHECK');if(new Set((policy.suppressions??[]).map(s=>s.findingKey)).size!==(policy.suppressions??[]).length)throw Error('DUPLICATE_SUPPRESSION');
 for(const c of policy.checks){if(!path.isAbsolute(c.argv[0]!))throw Error('ABSOLUTE_EXECUTABLE_REQUIRED');if(c.resultFile)relativePath(c.resultFile);}
 for(const p of policy.trustedFiles)relativePath(p);
 const info=inspect(repo,options.base,options.head);if(info.dirty&&!options.dirtySnapshot)throw Error('DIRTY_REPO_REQUIRES_EXPLICIT_SNAPSHOT');
 const dirty=info.dirty?await freezeDirty(repo,info.headSha):null;
 if(dirty)info.diff+='\n'+dirty.diff;
 const run:ChangeRun={runId:randomUUID(),baseSha:info.baseSha,headSha:info.headSha,policyDigest:sha(policyBytes),state:'RUNNING',verdict:null,checks:[],findings:analyze(redact(info.diff,options.secrets)),unverifiedRequirementIds:policy.requirements.map(r=>r.id)};
 const out=path.resolve(options.out,run.runId);await mkdir(out,{recursive:true,mode:0o700});
 const details:Details={repoId:sha(repo),repoPath:repo,dirty:!!dirty,...(dirty?{snapshotId:dirty.snapshotId,dirtyManifest:dirty.manifest}:{}),policyPath,commands:[],baseChecks:[],classification:[],requirements:policy.requirements,diff:redact(info.diff,options.secrets),limitations:['信頼したローカルコードのみ。OS sandbox ではありません。',dirty?'未コミット対象は details.json の snapshotId と明細で識別。headSha だけでは同一性を示しません。':'コミット済み対象。','検査弱化は行ベースの保守的検出。すべての変更意味を解析するものではありません。']};
 const evidence:Evidence<ChangeRun>={schemaVersion:'1.0',evidenceId:randomUUID(),product:'changeproof',createdAt:new Date().toISOString(),origin:{kind:'local_collector',trust:'local_observed',sourceId:details.repoId},integrity:{algorithm:'sha256',files:[]},claims:[{id:'run',type:'observed',text:'指定コミットのローカル検査。合成デモは顧客環境の再現証明ではありません。',evidenceRefs:[]}],payload:run};
 if(dirty){const bytes=Buffer.from(JSON.stringify({snapshotId:dirty.snapshotId,headSha:info.headSha,files:dirty.manifest},null,2));await atomic(path.join(out,'snapshot.json'),bytes);evidence.integrity.files.push(artifact('snapshot.json',bytes));evidence.claims.push({id:'dirty-snapshot',type:'observed',text:dirty.snapshotId,evidenceRefs:['snapshot.json']});}
 details.suppressionReview=[];
 for(const record of policy.suppressions??[]){for(const finding of run.findings){if(findingKey(finding)!==record.findingKey)continue;const status=record.diffDigest!==sha(details.diff)?'DIFF_MISMATCH':Date.parse(record.expiresAt)<=Date.parse(evidence.createdAt)?'EXPIRED':'ACTIVE';details.suppressionReview.push({findingId:finding.id,record,status});if(status==='ACTIVE'){finding.suppressed=true;evidence.claims.push({id:'suppression:'+finding.id,type:'asserted',text:JSON.stringify(record),evidenceRefs:[]});}}}
 const controller=new AbortController();const cancel=()=>controller.abort();options.signal?.addEventListener('abort',cancel);if(options.signal?.aborted)cancel();
 let expired=false;const deadline=setTimeout(()=>{expired=true;controller.abort();},policy.runTimeoutMs);
 await atomic(path.join(out,'report.html'),renderChangeProof(evidence,details));await atomic(path.join(out,'report.en.html'),renderChangeProof(evidence,details,'en'));
 const tmp=await mkdtemp(path.join(out,'.work-'));await atomic(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2));
 async function runTarget(target:'base'|'head'):Promise<Check[]>{
  const dir=path.join(tmp,target),targetSha=target==='base'?info.baseSha:info.headSha;if(target==='head'&&dirty){await mkdir(dir,{recursive:true,mode:0o700});for(const [p,bytes] of dirty.files){await mkdir(path.dirname(path.join(dir,p)),{recursive:true,mode:0o700});await writeFile(path.join(dir,p),bytes,{mode:0o600,flag:'wx'});}}else await snapshot(repo,targetSha,dir);
  if(target==='head')for(const p of policy.trustedFiles){const bytes=git(repo,['show',`${info.baseSha}:${p}`]);await mkdir(path.dirname(path.join(dir,p)),{recursive:true});await writeFile(path.join(dir,p),bytes,{mode:0o600});}
  if(options.dependencies)await symlink(await realpath(options.dependencies),path.join(dir,'node_modules'),'dir');
  const checks:Check[]=[];
  for(const p of policy.checks){
   if(controller.signal.aborted){checks.push({id:p.id,kind:p.kind,required:p.required,status:expired?'ERROR':'NOT_RUN',exitCode:null,artifactRefs:[],flaky:false});continue;}
   let check:Check={id:p.id,kind:p.kind,required:p.required,status:'NOT_RUN',exitCode:null,artifactRefs:[],flaky:false};let hadFailure=false;
   for(let attempt=0;attempt<=p.retries;attempt++){
    if(p.resultFile)await rm(path.join(dir,p.resultFile),{force:true});
    const result=await execute(p.argv,dir,{timeoutMs:p.timeoutMs,signal:controller.signal,secrets:options.secrets??[]});
    let status:Check['status']=result.timedOut||result.truncated||result.cancelled||result.exitCode===null?'ERROR':result.exitCode===0?'PASS':'FAIL';
    if(p.kind==='vitest'||p.kind==='junit'){
     try{if(!p.resultFile)throw Error('RESULT_FILE_REQUIRED');const bytes=await safeRead(dir,p.resultFile,10*1024*1024);const parsed=p.kind==='vitest'?vitestStatus(JSON.parse(bytes.toString())):junitStatus(bytes.toString());
      if(status!=='ERROR')status=parsed==='PASS'&&result.exitCode!==0?'ERROR':parsed;
      const name=`${target}-${p.id}-${attempt}.result.${p.kind==='vitest'?'json':'xml'}`;const redacted=Buffer.from(redact(bytes.toString(),options.secrets));await atomic(path.join(out,name),redacted);evidence.integrity.files.push(artifact(name,redacted));check.artifactRefs.push(name);
     }catch{status='ERROR';}
    }
    const logName=`${target}-${p.id}-${attempt}.log`,log=Buffer.from(result.log+(result.truncated?'\n[LOG_TRUNCATED]':'')+(result.timedOut?'\n[TIMEOUT]':''));await atomic(path.join(out,logName),log);evidence.integrity.files.push(artifact(logName,log,'text/plain'));check.artifactRefs.push(logName);
    details.commands.push({id:p.id,argv:p.argv.map(s=>redact(s,options.secrets)),targetSha,attempt,status,durationMs:result.durationMs,pid:result.pid,log:logName});
    check={...check,status,exitCode:result.exitCode,flaky:status==='PASS'&&hadFailure};
    if(status==='PASS'||status==='ERROR'||controller.signal.aborted)break;hadFailure=true;
   }
   checks.push(check);if(target==='head'){run.checks=[...checks];options.onProgress?.(run);await atomic(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2));await atomic(path.join(out,'report.html'),renderChangeProof(evidence,details));await atomic(path.join(out,'report.en.html'),renderChangeProof(evidence,details,'en'));}
  }
  return checks;
 }
 try{
  if(options.compareBase!==false)details.baseChecks=await runTarget('base');run.checks=await runTarget('head');
  details.classification=run.checks.map(c=>({id:c.id,value:c.status==='FAIL'?(details.baseChecks.find(b=>b.id===c.id)?.status==='FAIL'?'existing_failure':'new_failure'):c.status==='PASS'&&details.baseChecks.find(b=>b.id===c.id)?.status==='FAIL'?'resolved':'unchanged_or_unverified'}));
  run.unverifiedRequirementIds=policy.requirements.filter(r=>!r.checkRefs.every(id=>run.checks.some(c=>c.id===id&&c.status==='PASS'))).map(r=>r.id);
  run.state=controller.signal.aborted&&!expired?'CANCELLED':'COMPLETE';for(const f of run.findings){const review=details.suppressionReview?.find(x=>x.findingId===f.id&&x.status==='ACTIVE');if(review&&Date.parse(review.record.expiresAt)<=Date.now())f.suppressed=false;}run.verdict=verdict(run);
 }catch(error){run.state='FAILED';run.verdict=null;details.limitations.push(error instanceof Error?redact(error.message,options.secrets):'RUN_FAILED');}
 finally{clearTimeout(deadline);options.signal?.removeEventListener('abort',cancel);await rm(tmp,{recursive:true,force:true});}
 const detailBytes=Buffer.from(JSON.stringify(details,null,2));await atomic(path.join(out,'details.json'),detailBytes);evidence.integrity.files.push(artifact('details.json',detailBytes,'application/json'));
 validate(evidence);await atomic(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2));await atomic(path.join(out,'report.html'),renderChangeProof(evidence,details));await atomic(path.join(out,'report.en.html'),renderChangeProof(evidence,details,'en'));options.onProgress?.(run);
 return {evidence,details,directory:out};
}
