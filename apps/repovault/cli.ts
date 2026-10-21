import {parseArgs} from 'node:util';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {doctor,captureLocal,verify,restorePlan,restore} from './core.ts';
import {captureStream,verifyStream,restorePlanStream,restoreStream} from './stream.ts';
import {atomic,safeRead} from '../../packages/safe-io/index.ts';
import {captureHttp} from './http-workflow.ts';
import type {Capture} from './collector.ts';
const {values:v,positionals}=parseArgs({allowPositionals:true,options:{'archive-format':{type:'string',default:'zip-v1'},age:{type:'string'},repo:{type:'string'},'repo-id':{type:'string'},recipient:{type:'string'},metadata:{type:'string'},snapshot:{type:'string'},identity:{type:'string'},target:{type:'string'},plan:{type:'string'},out:{type:'string'},'api-origin':{type:'string'},owner:{type:'string'},name:{type:'string'},checkpoint:{type:'string'},'checkpoint-out':{type:'string'},'trust-synthetic':{type:'boolean',default:false},'work-root':{type:'string',default:'.runtime/repovault'}}});
async function streaming(){return v.snapshot?JSON.parse((await safeRead(v.snapshot,'index.json',10000)).toString()).schemaVersion==='2.0':false;}
try{if(!['zip-v1','stream-v2'].includes(v['archive-format']))throw Error('UNKNOWN_ARCHIVE_FORMAT');if(!v.age)throw Error('--age ABSOLUTE_PATH required');const options={age:path.resolve(v.age),workRoot:path.resolve(v['work-root'])};switch(positionals[0]){
 case 'doctor':console.log(JSON.stringify(await doctor(options.age),null,2));break;
 case 'capture':if(!v.repo||!v['repo-id']||!v.recipient||!v.metadata||!v.out)throw Error('--repo --repo-id --recipient --metadata --out required');console.log(JSON.stringify(await (v['archive-format']==='stream-v2'?captureStream:captureLocal)({repo:v.repo,repoId:v['repo-id'],recipient:v.recipient,metadata:JSON.parse((await safeRead(path.resolve(path.dirname(v.metadata)),path.basename(v.metadata),v['archive-format']==='stream-v2'?16*1024**2:50*1024**2)).toString()) as Capture,out:v.out,trustedSynthetic:v['trust-synthetic']},options)));break;
 case 'capture-api':
 case 'resume':{if(!v.repo||!v['repo-id']||!v.recipient||!v.out||!v['checkpoint-out'])throw Error('--repo --repo-id --recipient --out --checkpoint-out required');const source=v['api-origin']&&v.owner&&v.name?{apiOrigin:v['api-origin'],owner:v.owner,repo:v.name,mode:'synthetic_http' as const}:undefined;console.log(JSON.stringify(await captureHttp({archiveFormat:v['archive-format'] as 'zip-v1'|'stream-v2',repo:v.repo,repoId:v['repo-id'],recipient:v.recipient,out:v.out,checkpointOut:v['checkpoint-out'],token:process.env.DOTS_SYNTHETIC_HTTP_TOKEN??'',trustedSynthetic:v['trust-synthetic'],...(source?{source}:{}),...(v.snapshot?{previousSnapshot:v.snapshot}:{}),...(v.checkpoint?{previousCheckpoint:v.checkpoint}:{}),...(v.identity?{identity:v.identity}:{})},options)));break;}
 case 'verify':if(!v.snapshot||!v.identity)throw Error('--snapshot --identity required');console.log(JSON.stringify((await (await streaming()?verifyStream:verify)(v.snapshot,v.identity,options)).evidence,null,2));break;
 case 'restore-plan':if(!v.snapshot||!v.identity||!v.target||!v.out)throw Error('--snapshot --identity --target --out required');await atomic(v.out,JSON.stringify(await (await streaming()?restorePlanStream:restorePlan)(v.snapshot,v.identity,v.target,options),null,2));console.log(v.out);break;
 case 'restore':if(!v.plan||!v.identity)throw Error('--plan --identity required');console.log(JSON.stringify(await (JSON.parse((await safeRead(path.resolve(path.dirname(v.plan)),path.basename(v.plan),100000)).toString()).version===2?restoreStream:restore)(JSON.parse((await safeRead(path.resolve(path.dirname(v.plan)),path.basename(v.plan),100000)).toString()),v.identity,options),null,2));break;
 default:throw Error('Usage: repovault doctor|capture|verify|restore-plan|restore');}
}catch(e){console.error(e instanceof Error?e.message:'ERROR');process.exitCode=2;}
