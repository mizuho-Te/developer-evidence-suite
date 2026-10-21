import {mkdir,mkdtemp,readFile,writeFile,readdir,lstat,rm,realpath,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {z} from 'zod';
import {git} from '../changeproof/git.ts';
import {artifact,sha,atomic,pack,unpack,safeRead,redact,relativePath} from '../../packages/safe-io/index.ts';
import {execute} from '../../packages/safe-io/process.ts';
import {validate} from '../../packages/contracts/index.ts';
import {renderVault} from '../../packages/report-ui/index.ts';
import type {Evidence,Snapshot,Resource} from '../../packages/contracts/types.ts';
import type {Capture} from './collector.ts';
const CipherIndex=z.object({schemaVersion:z.literal('1.0'),snapshotId:z.string().uuid(),createdAt:z.string().datetime(),ciphertext:z.object({path:z.literal('payload.age'),bytes:z.number().int().positive().max(60*1024*1024),sha256:z.string().regex(/^[0-9a-f]{64}$/),mediaType:z.literal('application/age')}).strict()}).strict();
export interface VaultOptions {age:string;workRoot:string}
export async function doctor(age:string){return {git:git(process.cwd(),['--version']).toString().trim(),age:(await execute([age,'--version'],process.cwd(),{timeoutMs:5000})),limits:{archiveBytes:50*1024*1024,remoteConnection:'NOT_RUN',restore:'empty local directory only'}};}
async function temp(options:VaultOptions){await mkdir(options.workRoot,{recursive:true,mode:0o700});return mkdtemp(path.join(options.workRoot,'vault-private-'));}
async function ageRun(args:string[],dir:string,options:VaultOptions){const result=await execute([options.age,...args],dir,{timeoutMs:120000});if(result.exitCode!==0||result.timedOut)throw Error('AGE_OPERATION_FAILED: check identity, recipient or encrypted payload');}
async function tree(root:string,prefix=''):Promise<Record<string,Uint8Array>>{
 const files:Record<string,Uint8Array>={};for(const entry of await readdir(path.join(root,prefix),{withFileTypes:true})){const p=prefix?`${prefix}/${entry.name}`:entry.name;relativePath(p);if(entry.isSymbolicLink())throw Error('SYMLINK_REJECTED');if(entry.isDirectory())Object.assign(files,await tree(root,p));else if(entry.isFile())files[p]=await safeRead(root,p);else throw Error('SPECIAL_FILE_REJECTED');}return files;
}
// Size/count pass before buffering any legacy ZIP tree bytes.
async function legacyTreePreflight(root:string,reserved:number){let total=reserved,count=0;async function walk(prefix:string){for(const e of await readdir(path.join(root,prefix),{withFileTypes:true})){const p=prefix?`${prefix}/${e.name}`:e.name;relativePath(p);if(e.isSymbolicLink())throw Error('SYMLINK_REJECTED');if(e.isDirectory())await walk(p);else if(e.isFile()){total+=(await lstat(path.join(root,p))).size;if(++count>10000||total>50*1024*1024)throw Error('ARCHIVE_LIMIT_50MIB');}else throw Error('SPECIAL_FILE_REJECTED');}}await walk('');}
function refs(repo:string){return git(repo,['for-each-ref','--format=%(refname) %(objectname)']).toString().trim().split('\n').filter(Boolean).sort();}
export async function captureLocal(input:{repo:string;repoId:string;recipient:string;out:string;metadata:Capture;attachments?:Record<string,Uint8Array>;trustedSynthetic:boolean},options:VaultOptions){
 if(!input.trustedSynthetic)throw Error('TRUSTED_SYNTHETIC_SOURCE_REQUIRED');if(!/^age1[a-z0-9]+$/.test(input.recipient))throw Error('X25519_RECIPIENT_REQUIRED');
 const snapshotId=randomUUID(),dir=await temp(options),started=new Date().toISOString();
 const out=path.resolve(input.out,snapshotId);
 try{
  await mkdir(out,{recursive:true,mode:0o700});
  const repo=await realpath(input.repo),mirror=path.join(dir,'mirror.git');
  git(repo,['clone','--mirror','--no-hardlinks','--',repo,mirror]);git(mirror,['remote','remove','origin']);git(mirror,['config','core.hooksPath','/dev/null']);git(mirror,['fsck','--full']);
  const refList=refs(mirror);const metadataBytes=Buffer.from(JSON.stringify(input.metadata,null,2));const reserved=metadataBytes.length+Buffer.byteLength(JSON.stringify(refList))+Object.values(input.attachments??{}).reduce((n,b)=>n+b.length,0);if(reserved>50*1024*1024)throw Error('ARCHIVE_LIMIT_50MIB');await legacyTreePreflight(dir,reserved);const files=await tree(dir);delete files['mirror.git/config'];files['mirror.git/config']=Buffer.from('[core]\n\trepositoryformatversion = 0\n\tbare = true\n\thooksPath = /dev/null\n');
  files['refs.json']=Buffer.from(JSON.stringify(refList));files['metadata.json']=metadataBytes;
  for(const [name,bytes] of Object.entries(input.attachments??{})){relativePath(name);files['attachments/'+name]=bytes;}
  let hasLfs=false;for(const line of refList){const ref=line.split(' ')[0]!;try{if(git(repo,['grep','-l','-F','version https://git-lfs.github.com/spec/v1',ref,'--']).length)hasLfs=true;}catch{/* no matching pointer */}}
  const resources:Resource[]=[{kind:'git',selected:true,status:'COMPLETE',expectedCount:refList.length,actualCount:refList.length,error:null},...input.metadata.resources,{kind:'lfs',selected:hasLfs,status:hasLfs?'NOT_SUPPORTED':'NOT_SELECTED',expectedCount:null,actualCount:0,error:hasLfs?'LFS_OBJECTS_NOT_CAPTURED':null},...['submodules','release-assets','actions','secrets','packages','projects','external-attachments'].map(kind=>({kind,selected:false,status:'NOT_SUPPORTED' as const,expectedCount:null,actualCount:0,error:'P0_SCOPE_EXCLUDED'}))];
  const selected=resources.filter(r=>r.selected),complete=selected.length>0&&selected.every(r=>r.status==='COMPLETE');
  const entries=Object.entries(files).map(([p,b])=>artifact(p,b,p.endsWith('.json')?'application/json':'application/octet-stream'));
  const evidence:Evidence<Snapshot>={schemaVersion:'1.0',evidenceId:randomUUID(),product:'repovault',createdAt:new Date().toISOString(),origin:{kind:'synthetic',trust:'local_observed',sourceId:input.repoId},integrity:{algorithm:'sha256',files:entries},claims:[{id:'scope',type:'observed',text:'合成ローカル Git と明示したメタデータ取得範囲。GitHub の実接続は未検証。',evidenceRefs:[]}],payload:{snapshotId,repoId:input.repoId,state:complete?'SEALED':'PARTIAL',consistency:complete?'best_effort':'incomplete',captureStart:input.metadata.captureStart<started?input.metadata.captureStart:started,captureEnd:new Date().toISOString(),coverageComplete:complete,resources,encryption:{format:'age',recipientFingerprint:sha(input.recipient)},restoreStatus:'NOT_RUN',files:entries}};validate(evidence);
  files['evidence.json']=Buffer.from(JSON.stringify(evidence,null,2));const zipped=pack(files);if(Object.values(files).reduce((n,b)=>n+b.length,0)>50*1024*1024)throw Error('ARCHIVE_LIMIT_50MIB');
  await writeFile(path.join(dir,'payload.zip'),zipped,{mode:0o600});await ageRun(['-r',input.recipient,'-o',path.join(out,'payload.age'),path.join(dir,'payload.zip')],dir,options);
  const cipher=await readFile(path.join(out,'payload.age'));const index={schemaVersion:'1.0',snapshotId,createdAt:new Date().toISOString(),ciphertext:artifact('payload.age',cipher,'application/age')};CipherIndex.parse(index);await atomic(path.join(out,'index.json'),JSON.stringify(index,null,2));return {directory:out,evidence};
 }catch(error){await rm(out,{recursive:true,force:true});throw error;}finally{await rm(dir,{recursive:true,force:true});}
}
export async function verify(snapshot:string,identity:string,options:VaultOptions){
 const root=await realpath(snapshot),key=await realpath(identity);if(key.startsWith(root+path.sep))throw Error('IDENTITY_MUST_BE_SEPARATE');
 const index=CipherIndex.parse(JSON.parse((await safeRead(root,'index.json',10000)).toString()));const cipher=await safeRead(root,'payload.age',60*1024*1024);
 if(cipher.length!==index.ciphertext.bytes||sha(cipher)!==index.ciphertext.sha256)throw Error('CIPHERTEXT_INTEGRITY_MISMATCH');
 const dir=await temp(options);
 try{await writeFile(path.join(dir,'payload.age'),cipher,{mode:0o600});await ageRun(['-d','-i',key,'-o',path.join(dir,'payload.zip'),path.join(dir,'payload.age')],dir,options);
  const files=unpack(await readFile(path.join(dir,'payload.zip')));const evidence=validate(JSON.parse(Buffer.from(files['evidence.json']??[]).toString())) as Evidence<Snapshot>;
  if(evidence.product!=='repovault'||evidence.payload.snapshotId!==index.snapshotId)throw Error('SNAPSHOT_ID_MISMATCH');
  if(JSON.stringify(evidence.payload.files)!==JSON.stringify(evidence.integrity.files))throw Error('FILE_MANIFEST_MISMATCH');
  if(Object.keys(files).length!==evidence.integrity.files.length+1)throw Error('UNLISTED_ARCHIVE_FILES');
  for(const f of evidence.integrity.files){const b=files[f.path];if(!b||b.length!==f.bytes||sha(b)!==f.sha256)throw Error('PLAINTEXT_INTEGRITY_MISMATCH');}
  if(!files['refs.json']||!files['metadata.json']||!files['mirror.git/HEAD'])throw Error('SNAPSHOT_STRUCTURE');
  const metadata=JSON.parse(Buffer.from(files['metadata.json']).toString()) as Capture;
  if(!metadata.data||!metadata.resources)throw Error('METADATA_STRUCTURE');
  for(const resource of metadata.resources){if(!Array.isArray(metadata.data[resource.kind])||metadata.data[resource.kind]!.length!==resource.actualCount)throw Error('METADATA_COUNT');}
  evidence.payload.state='VERIFIED';evidence.payload.restoreStatus='NOT_RUN';validate(evidence);return {index,evidence,files,metadata,cipherDigest:sha(cipher)};
 }finally{await rm(dir,{recursive:true,force:true});}
}
const Plan=z.object({version:z.literal(1),snapshot:z.string(),snapshotId:z.string().uuid(),cipherDigest:z.string().regex(/^[a-f0-9]{64}$/),target:z.string(),createdAt:z.string().datetime(),expiresAt:z.string().datetime(),requiredBytes:z.number().int().nonnegative(),excludedKinds:z.array(z.string()),planDigest:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type RestorePlan=z.infer<typeof Plan>;
async function emptyTarget(target:string){const parent=await realpath(path.dirname(target));if(parent!==path.dirname(target))throw Error('SYMLINK_PARENT_REJECTED');try{const s=await lstat(target);if(!s.isDirectory()||s.isSymbolicLink()||(await readdir(target)).length)throw Error('RESTORE_TARGET_NOT_EMPTY');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
export async function restorePlan(snapshot:string,identity:string,target:string,options:VaultOptions):Promise<RestorePlan>{
 const absolute=path.resolve(target);await emptyTarget(absolute);const v=await verify(snapshot,identity,options);
 const plan={version:1 as const,snapshot:await realpath(snapshot),snapshotId:v.index.snapshotId,cipherDigest:v.cipherDigest,target:absolute,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+30*60000).toISOString(),requiredBytes:Object.values(v.files).reduce((n,b)=>n+b.length,0),excludedKinds:v.evidence.payload.resources.filter(r=>r.status!=='COMPLETE').map(r=>r.kind)};
 return {...plan,planDigest:sha(JSON.stringify(plan))};
}
export async function restore(raw:unknown,identity:string,options:VaultOptions){
 const plan=Plan.parse(raw),{planDigest,...body}=plan;if(sha(JSON.stringify(body))!==planDigest||Date.now()>Date.parse(plan.expiresAt)||Date.parse(plan.expiresAt)-Date.parse(plan.createdAt)>30*60000)throw Error('PLAN_EXPIRED_OR_CHANGED');
 await emptyTarget(plan.target);const v=await verify(plan.snapshot,identity,options);if(v.cipherDigest!==plan.cipherDigest||v.index.snapshotId!==plan.snapshotId)throw Error('PLAN_SNAPSHOT_CHANGED');
 const staging=await mkdtemp(path.join(path.dirname(plan.target),'.restore-'));try{
  for(const [p,b] of Object.entries(v.files)){relativePath(p);await mkdir(path.dirname(path.join(staging,p)),{recursive:true,mode:0o700});await writeFile(path.join(staging,p),b,{mode:0o600,flag:'wx'});}
  const mirror=path.join(staging,'mirror.git');
  // Git requires these directories even when refs are packed and directories
  // contain no files. The archive manifest intentionally contains files only.
  await mkdir(path.join(mirror,'refs'),{recursive:true,mode:0o700});
  await mkdir(path.join(mirror,'objects'),{recursive:true,mode:0o700});
  git(mirror,['fsck','--full']);const expected=JSON.parse(Buffer.from(v.files['refs.json']!).toString()) as unknown;
  if(JSON.stringify(refs(mirror))!==JSON.stringify(expected))throw Error('REFS_MISMATCH');
  // No build, install, hooks, or captured scripts are executed.
  v.evidence.payload.restoreStatus=v.evidence.payload.coverageComplete?'PASS':'PARTIAL';
  const result={snapshotId:plan.snapshotId,planDigest,status:v.evidence.payload.restoreStatus,executedAt:new Date().toISOString(),checks:{gitFsck:'PASS',refsMatch:'PASS',metadataCounts:'PASS'},limitations:plan.excludedKinds};
  await atomic(path.join(staging,'restore-result.json'),JSON.stringify(result,null,2));await atomic(path.join(staging,'report.html'),renderVault(v.evidence,JSON.parse(redact(JSON.stringify(v.metadata.data)))));await atomic(path.join(staging,'report.en.html'),renderVault(v.evidence,JSON.parse(redact(JSON.stringify(v.metadata.data))),'en'));
  await emptyTarget(plan.target);await rename(staging,plan.target);return {directory:plan.target,result,evidence:v.evidence};
 }catch(e){await rm(staging,{recursive:true,force:true});throw e;}
}
