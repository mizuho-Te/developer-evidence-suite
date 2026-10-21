import {parseArgs} from 'node:util';
import {serveComparison} from '../apps/changeproof/server.ts';
const {values:v}=parseArgs({options:{repo:{type:'string'},policy:{type:'string'},out:{type:'string',default:'artifacts/changeproof'},dependencies:{type:'string'},port:{type:'string',default:'47831'},'trust-local':{type:'boolean',default:false}}});
if(!v.repo||!v.policy||!v['trust-local'])throw Error('--repo --policy --trust-local required');
const running=await serveComparison({repo:v.repo,policy:v.policy,out:v.out,trustLocal:true,...(v.dependencies?{dependencies:v.dependencies}:{})},Number(v.port));console.log(running.url);for(const s of ['SIGINT','SIGTERM'] as const)process.once(s,async()=>{await running.service.close();running.server.close();});
