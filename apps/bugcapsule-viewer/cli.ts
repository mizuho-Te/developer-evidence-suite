import {parseArgs} from 'node:util';
import {readFile} from 'node:fs/promises';
import {importPack,exportPack,link} from './core.ts';
import {validate} from '../../packages/contracts/index.ts';
import {atomic} from '../../packages/safe-io/index.ts';
import type {Evidence,BugReport} from '../../packages/contracts/types.ts';
const {values,positionals}=parseArgs({allowPositionals:true,options:{input:{type:'string'},out:{type:'string',default:'artifacts/bugcapsule'},approved:{type:'boolean',default:false},run:{type:'string'},head:{type:'string'},snapshot:{type:'string'}}});
try{if(!values.input)throw Error('--input is required');const bytes=await readFile(values.input);if(bytes.length>50*1024*1024)throw Error('SIZE_LIMIT');switch(positionals[0]){
 case 'import':console.log(JSON.stringify(await importPack(bytes,values.out)));break;
 case 'export':{const e=validate(JSON.parse(bytes.toString()));if(e.product!=='bugcapsule')throw Error('WRONG_PRODUCT');await atomic(values.out,exportPack(e as Evidence<BugReport>,values.approved));console.log(values.out);break;}
 case 'link':if(!values.run||!values.head)throw Error('--run and --head are required');await atomic(values.out,JSON.stringify(link(JSON.parse(bytes.toString()),JSON.parse(await readFile(values.run,'utf8')),values.head,values.snapshot),null,2));console.log(values.out);break;
 default:throw Error('Usage: bugcapsule import|export|link --input FILE --out PATH');}
}catch(e){console.error(e instanceof Error?e.message:'ERROR');process.exitCode=2;}
