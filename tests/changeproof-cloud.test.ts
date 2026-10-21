import {test,expect} from 'vitest';
import {mkdtemp,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createDemo} from '../scripts/fixtures.ts';
import {freezeDirty,git,inspect} from '../apps/changeproof/git.ts';
import {compare} from '../apps/changeproof/core.ts';
import {RunQueue} from '../apps/changeproof/queue.ts';
import {report,link} from '../apps/bugcapsule-viewer/core.ts';
import {ComparisonService} from '../apps/changeproof/server.ts';

test('dirty snapshot freezes bytes, hash changes with content, secrets and symlinks rejected',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'cp-dirty-'));
 try{const demo=await createDemo(root);await writeFile(path.join(demo.repo,'new.txt'),'first');const a=await freezeDirty(demo.repo,demo.refs.fixed!);await writeFile(path.join(demo.repo,'new.txt'),'second');const b=await freezeDirty(demo.repo,demo.refs.fixed!);expect(a.snapshotId).not.toBe(b.snapshotId);expect(a.files.get('new.txt')!.toString()).toBe('first');
 await symlink('/etc/hosts',path.join(demo.repo,'link'));await expect(freezeDirty(demo.repo,demo.refs.fixed!)).rejects.toThrow();await rm(path.join(demo.repo,'link'));
 await writeFile(path.join(demo.repo,'credentials'),'synthetic-secret');await expect(freezeDirty(demo.repo,demo.refs.fixed!)).rejects.toThrow('SENSITIVE_FILE');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('dirty run checks frozen worktree and preserves source repo',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'cp-dirty-run-'));try{const d=await createDemo(root);const original=await readFile(path.join(d.repo,'storage.ts'),'utf8');await writeFile(path.join(d.repo,'storage.ts'),original+'\nconst broken:string=42;\n');const before=git(d.repo,['status','--porcelain']).toString();
 await expect(compare({repo:d.repo,base:'base',head:'fixed',policy:d.policyPath,out:path.join(root,'out'),trustLocal:true})).rejects.toThrow('DIRTY_REPO_REQUIRES');
 const r=await compare({repo:d.repo,base:'base',head:'fixed',policy:d.policyPath,out:path.join(root,'out'),trustLocal:true,dirtySnapshot:true,dependencies:d.dependencies});expect(r.evidence.payload.checks.find(c=>c.id==='types')?.status).toBe('FAIL');expect(r.details.snapshotId).toMatch(/^[a-f0-9]{64}$/);expect(r.details.dirty).toBe(true);const bug=report([],{title:'Synthetic',expected:'saved',actual:'lost'},[]);expect(link(bug,r.evidence,r.evidence.payload.headSha).verification).toBe('INCOMPLETE');expect(link(bug,r.evidence,r.evidence.payload.headSha,r.details.snapshotId).status).toBe('MATCH');expect(git(d.repo,['status','--porcelain']).toString()).toBe(before);expect(inspect(d.repo,'base','fixed').headSha).toBe(d.refs.fixed);
 }finally{await rm(root,{recursive:true,force:true});}
},30000);
test('queue limits concurrency to two; cancelling queued work never executes it',async()=>{
 const q=new RunQueue(2),releases:(()=>void)[]=[];let active=0,max=0,thirdStarted=false;
 const work=()=>q.run(async()=>{active++;max=Math.max(active,max);await new Promise<void>(r=>releases.push(r));active--;});const a=work(),b=work();const c=new AbortController();const third=q.run(async()=>{thirdStarted=true;},c.signal);const rejected=expect(third).rejects.toThrow('CANCELLED');await new Promise(r=>setTimeout(r,5));expect(q.state).toEqual({active:2,queued:1});c.abort();c.abort();await rejected;releases.forEach(r=>r());await Promise.all([a,b]);expect(max).toBe(2);expect(thirdStarted).toBe(false);expect(q.state).toEqual({active:0,queued:0});
});
test('registered service rejects conflicting replay; cancellation idempotent',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'cp-service-'));try{const d=await createDemo(root);const service=new ComparisonService({repo:d.repo,policy:d.policyPath,out:path.join(root,'out'),trustLocal:true,dependencies:d.dependencies});const j=service.create('request-key-01',{base:'base',head:'fixed'});expect(service.create('request-key-01',{base:'base',head:'fixed'}).id).toBe(j.id);expect(()=>service.create('request-key-01',{base:'base',head:'bug'})).toThrow('IDEMPOTENCY_CONFLICT');service.cancel(j.id);service.cancel(j.id);await service.close();for(let i=0;i<100&&['RUNNING','QUEUED'].includes(j.state);i++)await new Promise(r=>setTimeout(r,50));expect(j.state).toBe('CANCELLED');
 }finally{await rm(root,{recursive:true,force:true});}
},30000);
