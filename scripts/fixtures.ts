import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {PolicyType} from '../apps/changeproof/core.ts';
export const ROOT=fileURLToPath(new URL('..',import.meta.url));
export async function createDemo(root:string){
 const repo=path.join(root,'repo');await mkdir(repo,{recursive:true});
 const git=(...args:string[])=>execFileSync('/usr/bin/git',['-c','core.hooksPath=/dev/null','-C',repo,...args],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:'Synthetic Demo',GIT_AUTHOR_EMAIL:'synthetic@example.invalid',GIT_COMMITTER_NAME:'Synthetic Demo',GIT_COMMITTER_EMAIL:'synthetic@example.invalid'},stdio:['ignore','pipe','pipe']}).trim();
 git('init','-b','main');
 const good=`import {writeFileSync,readFileSync} from 'node:fs';\nexport function save(file:string,value:string):void {writeFileSync(file,JSON.stringify({value}));}\nexport function load(file:string):string {try {return (JSON.parse(readFileSync(file,'utf8')) as {value:string}).value;} catch {return '';}}\n`;
 const bug=good.replace('writeFileSync(file,JSON.stringify({value}));','void file; void value;');
 const test=`import {test,expect} from 'vitest';\nimport {save,load} from './storage';\ntest('save-and-reload',()=>{save('demo-data.json','SYNTHETIC-VALUE');expect(load('demo-data.json')).toBe('SYNTHETIC-VALUE');});\n`;
 const files:Record<string,string>={'storage.ts':good,'storage.test.ts':test,'vitest.config.mjs':"export default {test:{include:['storage.test.ts']}};\n",'tsconfig.json':JSON.stringify({compilerOptions:{strict:true,target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',noEmit:true,types:['node'],skipLibCheck:true},include:['storage.ts']}),'package.json':'{"name":"synthetic-save-demo","private":true,"type":"module"}', '.gitignore':'node_modules/\ndemo-data.json\nresult.json\n','policy.json':'{"required":true}\n'};
 for(const [p,v] of Object.entries(files))await writeFile(path.join(repo,p),v);
 function commit(name:string){git('add','.');git('commit','-m',name);git('tag',name);return git('rev-parse','HEAD');}
 const refs:Record<string,string>={};refs.base=commit('base');
 await writeFile(path.join(repo,'storage.ts'),bug);refs.bug=commit('bug');
 await writeFile(path.join(repo,'storage.test.ts'),test.replace('test(','test.skip('));refs.skip=commit('skip');
 git('checkout','-f','bug');await writeFile(path.join(repo,'storage.ts'),good+'\n// Fixed persistence after reload.\n');refs.fixed=commit('fixed');
 git('checkout','-f','base');await writeFile(path.join(repo,'storage.ts'),good+'\nconst typedValue: string = 42;\n');refs.typeerror=commit('typeerror');
 git('checkout','-f','base');await writeFile(path.join(repo,'storage.ts'),good+'\n// @ts-ignore\nconst typedValue: string = 42;\n');await writeFile(path.join(repo,'tsconfig.json'),files['tsconfig.json']!.replace('"strict":true','"strict":false'));refs.weak=commit('weak');
 git('checkout','-f','bug');await writeFile(path.join(repo,'policy.json'),'{"required":false}\n');refs.policy=commit('policy');
 git('checkout','-f','bug');await writeFile(path.join(repo,'storage.ts'),bug+'\nconst typedValue: string = 42;\n');refs.both=commit('both');
 git('checkout','-f','fixed');
 const policy:PolicyType={version:1,runTimeoutMs:900000,trustedFiles:['storage.test.ts','tsconfig.json','package.json','vitest.config.mjs'],requirements:[{id:'save-and-reload',expected:'保存した値が別の読込操作でも残る',owner:'synthetic-demo-owner',checkRefs:['persistence']}],checks:[{id:'types',kind:'typescript',required:true,argv:[process.execPath,path.join(ROOT,'node_modules/typescript/bin/tsc'),'--noEmit','--project','tsconfig.json'],timeoutMs:30000,retries:0},{id:'persistence',kind:'vitest',required:true,argv:[process.execPath,path.join(ROOT,'node_modules/vitest/vitest.mjs'),'run','storage.test.ts','--config','vitest.config.mjs','--reporter=json','--outputFile=result.json','--maxWorkers=1','--no-file-parallelism'],timeoutMs:30000,retries:0,resultFile:'result.json'}]};
 const policyPath=path.join(root,'trusted-policy.json');await writeFile(policyPath,JSON.stringify(policy,null,2));await writeFile(path.join(root,'refs.json'),JSON.stringify(refs,null,2));
 return {repo,refs,policy,policyPath,dependencies:path.join(ROOT,'node_modules')};
}
