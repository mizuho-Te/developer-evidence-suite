import {test,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {createDemo} from '../scripts/fixtures.ts';
import {serveComparison} from '../apps/changeproof/server.ts';
test('actual registered loopback API requires token and Origin, deduplicates and cancels',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'cp-http-'));const d=await createDemo(root);const s=await serveComparison({repo:d.repo,policy:d.policyPath,out:path.join(root,'out'),trustLocal:true,dependencies:d.dependencies},47835);
 try{const u=new URL(s.url),origin=u.origin,token=u.searchParams.get('token')!;expect((await fetch(origin)).status).toBe(401);expect((await fetch(s.url,{headers:{Origin:'https://evil.invalid'}})).status).toBe(403);expect((await fetch(s.url)).status).toBe(200);const english=await(await fetch(s.url+'&lang=en')).text();expect(english).toContain('Comparison setup');expect(english).toContain('Run checks');expect(english).toContain('lang="en"');
 const body=JSON.stringify({base:'base',head:'fixed'}),headers={Authorization:`Bearer ${token}`,Origin:origin,'Content-Type':'application/json','Idempotency-Key':'synthetic-idempotency'};
 expect((await fetch(origin+'/v1/runs',{method:'POST',headers:{Authorization:`Bearer ${token}`},body})).status).toBe(403);
 const a=await fetch(origin+'/v1/runs',{method:'POST',headers,body});expect(a.status).toBe(202);const first=await a.json() as {id:string};const second=await(await fetch(origin+'/v1/runs',{method:'POST',headers,body})).json() as {id:string};expect(first.id).toBe(second.id);
 expect((await fetch(origin+'/v1/runs',{method:'POST',headers,body:JSON.stringify({base:'base',head:'bug'})})).status).toBe(409);
 expect((await fetch(origin+'/v1/runs',{method:'POST',headers:{...headers,'Idempotency-Key':'invalid-path-request'},body:JSON.stringify({base:'base',head:'fixed',repo:'/etc'})})).status).toBe(400);
 for(let i=0;i<2;i++)expect((await fetch(origin+'/v1/runs/'+first.id+'/cancel',{method:'POST',headers,body:'{}'})).status).toBe(200);
 await s.service.close();expect(s.service.get(first.id)?.state).toBe('CANCELLED');expect(s.service.list()).toHaveLength(1);
 }finally{await s.service.close();await new Promise<void>(r=>s.server.close(()=>r()));await rm(root,{recursive:true,force:true});}
},30000);
