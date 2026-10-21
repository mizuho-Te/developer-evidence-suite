import {mkdir,mkdtemp,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {sha,atomic,safeRead} from '../../packages/safe-io/index.ts';
import {execute} from '../../packages/safe-io/process.ts';
import type {VaultOptions} from './core.ts';
import type {ApiSource,Checkpoint,Capture} from './collector.ts';
const Source=z.object({apiOrigin:z.string().url(),owner:z.string().regex(/^[A-Za-z0-9_.-]+$/),repo:z.string().regex(/^[A-Za-z0-9_.-]+$/),mode:z.literal('synthetic_http')}).strict();
const Entry=z.object({url:z.string().nullable(),pages:z.number().int().nonnegative(),lastId:z.string().nullable(),capturedAt:z.string().datetime().nullable(),retryAt:z.string().datetime().nullable(),error:z.string().nullable(),items:z.record(z.string(),z.record(z.string(),z.unknown())),startedAt:z.string().datetime().optional()}).strict();
const Envelope=z.object({version:z.literal(1),source:Source,captureStart:z.string().datetime(),checkpoints:z.record(z.string(),Entry)}).strict();
export async function saveCheckpoint(out:string,source:ApiSource,captureStart:string,checkpoints:Record<string,Checkpoint>,recipient:string,options:VaultOptions){
 const body=Envelope.parse({version:1,source,captureStart,checkpoints});await mkdir(options.workRoot,{recursive:true,mode:0o700});const temp=await mkdtemp(path.join(options.workRoot,'checkpoint-')),dest=path.resolve(out,randomUUID());
 try{await mkdir(dest,{recursive:true,mode:0o700});const plaintext=Buffer.from(JSON.stringify(body));if(plaintext.length>50*1024*1024)throw Error('CHECKPOINT_SIZE_LIMIT');await writeFile(path.join(temp,'state.json'),plaintext,{mode:0o600});const result=await execute([options.age,'-r',recipient,'-o',path.join(dest,'state.age'),path.join(temp,'state.json')],temp,{timeoutMs:120000});if(result.exitCode!==0)throw Error('CHECKPOINT_ENCRYPTION_FAILED');const bytes=await readFile(path.join(dest,'state.age'));await atomic(path.join(dest,'index.json'),JSON.stringify({version:1,bytes:bytes.length,sha256:sha(bytes)}));return dest;
 }catch(e){await rm(dest,{recursive:true,force:true});throw e;}finally{await rm(temp,{recursive:true,force:true});}
}
export async function loadCheckpoint(root:string,identity:string,options:VaultOptions):Promise<Capture>{
 const sourceRoot=await realpath(root),key=await realpath(identity);if(key.startsWith(sourceRoot+path.sep))throw Error('IDENTITY_MUST_BE_SEPARATE');const index=z.object({version:z.literal(1),bytes:z.number().int().positive(),sha256:z.string().regex(/^[0-9a-f]{64}$/)}).strict().parse(JSON.parse((await safeRead(sourceRoot,'index.json',10000)).toString()));const cipher=await safeRead(sourceRoot,'state.age');if(cipher.length!==index.bytes||sha(cipher)!==index.sha256)throw Error('CHECKPOINT_INTEGRITY');await mkdir(options.workRoot,{recursive:true,mode:0o700});const temp=await mkdtemp(path.join(options.workRoot,'checkpoint-'));
 try{await writeFile(path.join(temp,'state.age'),cipher,{mode:0o600});const r=await execute([options.age,'-d','-i',key,'-o',path.join(temp,'state.json'),path.join(temp,'state.age')],temp,{timeoutMs:120000});if(r.exitCode!==0)throw Error('CHECKPOINT_DECRYPTION_FAILED');const body=Envelope.parse(JSON.parse((await safeRead(temp,'state.json')).toString()));return {source:body.source,captureStart:body.captureStart,captureEnd:body.captureStart,consistency:'incomplete',resources:[],data:{},checkpoints:Object.fromEntries(Object.entries(body.checkpoints).map(([kind,entry])=>{const {startedAt,...rest}=entry;return [kind,{...rest,...(startedAt===undefined?{}:{startedAt})}];}))};
 }finally{await rm(temp,{recursive:true,force:true});}
}
