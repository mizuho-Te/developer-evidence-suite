import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createDemo,ROOT} from './fixtures.ts';
import {compare} from '../apps/changeproof/core.ts';
import {page,esc} from '../packages/report-ui/index.ts';
await mkdir(path.join(ROOT,'artifacts'),{recursive:true});const root=await mkdtemp(path.join(ROOT,'artifacts/demo-'));const demo=await createDemo(root);
const results=[];
for(const [name,base,head] of [['failure','base','bug'],['weakened','bug','skip'],['fixed','bug','fixed']] as const){const result=await compare({repo:demo.repo,base:base,head:head,policy:demo.policyPath,out:path.join(root,name),trustLocal:true,dependencies:demo.dependencies});results.push({name,verdict:result.evidence.payload.verdict,path:path.relative(root,path.join(result.directory,'report.html')),runId:result.evidence.payload.runId,headSha:result.evidence.payload.headSha});console.log(`${name}: ${result.evidence.payload.verdict}`);}
await writeFile(path.join(root,'index.html'),page('Dots · 合成デモ',`<div class="panel"><h1>保存不具合 → 検査弱化 → 修正</h1><p>実際の Git commit、TypeScript、Vitest の実行結果です。すべて専用の合成データです。</p>${results.map(r=>`<p><a href="${esc(r.path)}">${esc(r.name)} · ${esc(r.verdict)}</a><br><code>${r.headSha}</code></p>`).join('')}</div>`));
await writeFile(path.join(root,'summary.json'),JSON.stringify(results,null,2));await writeFile(path.join(ROOT,'artifacts/latest-demo.txt'),root+'\n');console.log(`Demo: ${path.join(root,'index.html')}`);
