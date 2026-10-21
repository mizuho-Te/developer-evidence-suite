/** Fresh source copy + pinned offline install; not a new machine/OS. */
import {cp,mkdir,rm,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT} from './fixtures.ts';
const dest=path.join(ROOT,'.runtime/clean-cloud');await rm(dest,{recursive:true,force:true});await mkdir(dest,{recursive:true});
for(const name of ['apps','packages','scripts','tests','specs','package.json','pnpm-lock.yaml','tsconfig.json','pnpm-workspace.yaml','.npmrc','vitest.config.ts'])await cp(path.join(ROOT,name),path.join(dest,name),{recursive:true});
await cp(path.join(ROOT,'.tooling/age-v1.3.2'),path.join(dest,'.tooling/age-v1.3.2'),{recursive:true});
const checks:{argv:string[];exitCode:number|null;expected:number;stdout:string;stderr:string}[]=[];
function run(argv:string[],expected=0){const r=spawnSync(argv[0]!,argv.slice(1),{cwd:dest,encoding:'utf8',maxBuffer:16*1024**2,env:process.env});checks.push({argv,exitCode:r.status,expected,stdout:r.stdout??'',stderr:r.stderr??''});if(r.status!==expected)throw Error(`CLEAN_CHECK_FAILED ${argv.join(' ')}`);}
let status='PASS';try{run([process.execPath,path.join(ROOT,'.tooling/node_modules/pnpm/bin/pnpm.cjs'),'install','--frozen-lockfile','--ignore-scripts','--offline','--store-dir',path.join(ROOT,'.pnpm-store')]);run([process.execPath,'node_modules/typescript/bin/tsc','--noEmit']);run([process.execPath,'node_modules/vitest/vitest.mjs','run','--maxWorkers=1','--no-file-parallelism','--reporter=json','--outputFile=unit-results.json']);run([process.execPath,'apps/changeproof/cli.ts'],2);run([process.execPath,'apps/bugcapsule-viewer/cli.ts'],2);run([process.execPath,'apps/repovault/cli.ts','doctor','--age',path.join(ROOT,'.tooling/age-v1.3.2/age/age')]);run([process.execPath,'scripts/demo.ts']);}catch(e){status='FAIL';console.error(e);}
let unitCount=0;try{unitCount=JSON.parse(await readFile(path.join(dest,'unit-results.json'),'utf8')).numPassedTests;}catch{}
await writeFile(path.join(ROOT,'artifacts/clean-install-validation.json'),JSON.stringify({status,executedAt:new Date().toISOString(),environment:{node:process.version,platform:process.platform,arch:process.arch},scope:'Fresh source copy and isolated node_modules, pinned offline install using shared package store; not new OS image',unitCount,checks},null,2));if(status!=='PASS')process.exitCode=1;
