import {mkdir,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {syntheticServer} from '../apps/bugcapsule-viewer/synthetic-server.ts';
await mkdir('artifacts',{recursive:true});const root=await mkdtemp(path.resolve('artifacts/synthetic-web-'));const s=await syntheticServer(root);console.log(s.url);process.once('SIGINT',()=>void s.close());process.once('SIGTERM',()=>void s.close());
