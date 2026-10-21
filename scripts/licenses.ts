import {readdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {ROOT} from './fixtures.ts';
const rows:{name:string;version:string;license:unknown}[]=[];
const store=path.join(ROOT,'node_modules/.pnpm');
for(const folder of await readdir(store)){const dir=path.join(store,folder,'node_modules');let names:string[];try{names=await readdir(dir);}catch{continue;}
 for(const name of names){if(name.startsWith('.'))continue;const paths=name.startsWith('@')?(await readdir(path.join(dir,name))).map(n=>path.join(dir,name,n)): [path.join(dir,name)];for(const item of paths){try{const p=JSON.parse(await readFile(path.join(item,'package.json'),'utf8'));if(!rows.some(r=>r.name===p.name&&r.version===p.version))rows.push({name:p.name,version:p.version,license:p.license??'UNKNOWN'});}catch{}}}
}
rows.sort((a,b)=>a.name.localeCompare(b.name));await writeFile(path.join(ROOT,'DEPENDENCY_LICENSES.txt'),['Installed dependency metadata; local source distribution does not bundle node_modules.','Generated '+new Date().toISOString(),'Tool: age v1.3.2 — BSD-3-Clause — https://github.com/FiloSottile/age','Runtime: Node.js '+process.version+' — MIT and bundled third-party licenses','',...rows.map(r=>`${r.name}@${r.version} | ${typeof r.license==='string'?r.license:JSON.stringify(r.license)}`)].join('\n')+'\n');console.log(rows.length+' dependency license records');
