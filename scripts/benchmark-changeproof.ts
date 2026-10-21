/** Static-rule measurement only: no build/test time hidden in this figure. */
import {mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import {performance} from 'node:perf_hooks';
import {analyze} from '../apps/changeproof/rules.ts';
const diff=Array.from({length:100},(_,f)=>`diff --git a/file${f}.ts b/file${f}.ts\n--- a/file${f}.ts\n+++ b/file${f}.ts\n@@ -0,0 +1,100 @@\n`+Array.from({length:100},(_,i)=>`+const value${i}: any = ${i};`).join('\n')).join('\n');
const start=performance.now(),findings=analyze(diff),elapsedMs=performance.now()-start;
if(findings.length!==10000||new Set(findings.map(f=>f.file)).size!==100)throw Error('BENCHMARK_ASSERTION');
const result={status:'PASS',executedAt:new Date().toISOString(),scope:'Synthetic 100-file/10,000-added-line rule analysis only. Not Git checkout, build/test, UI, arbitrary repositories or performance guarantee.',environment:{os:os.type(),release:os.release(),arch:os.arch(),cpu:os.cpus()[0]?.model,node:process.version,totalMemoryBytes:os.totalmem()},input:{files:100,addedLines:10000,diffBytes:Buffer.byteLength(diff)},findings:findings.length,elapsedMs,nodeMaxRssKiB:process.resourceUsage().maxRSS,underThirtySeconds:elapsedMs<30000};
await mkdir('artifacts/changeproof-static-benchmark',{recursive:true});await writeFile('artifacts/changeproof-static-benchmark/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
