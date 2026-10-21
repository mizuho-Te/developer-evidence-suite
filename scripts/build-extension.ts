import {mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {ROOT} from './fixtures.ts';
const require=createRequire(import.meta.url);const esbuild=await import(require.resolve('esbuild',{paths:[path.dirname(require.resolve('vite',{paths:[path.dirname(require.resolve('vitest/package.json'))]}))]}));
const src=path.join(ROOT,'apps/bugcapsule-extension'),out=path.join(ROOT,'artifacts/bugcapsule-extension');await mkdir(out,{recursive:true});
for(const f of ['manifest.json','worker.js','content.js','popup.html','origin-policy.js','retention.js'])await copyFile(path.join(src,f),path.join(out,f));
await esbuild.build({stdin:{contents:"import {Recorder} from './recorder.js'; globalThis.BugCapsuleRecorder=Recorder;",resolveDir:src},bundle:true,outfile:path.join(out,'recorder.bundle.js'),format:'iife',platform:'browser'});
await esbuild.build({entryPoints:[path.join(src,'popup.js')],bundle:true,outfile:path.join(out,'popup.bundle.js'),format:'iife',platform:'browser'});console.log(out);
