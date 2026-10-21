import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import path from 'node:path';
import {compare,Policy,type RunOptions} from './core.ts';
import {inspect} from './git.ts';
import {readFile} from 'node:fs/promises';
import {safeRead,sha} from '../../packages/safe-io/index.ts';
import {localize,label,type Language} from '../../packages/report-ui/locale.ts';
import {renderChangeProof,esc} from '../../packages/report-ui/index.ts';
import type {ChangeRun} from '../../packages/contracts/types.ts';
import {z} from 'zod';
import {currentFindings} from '../../packages/contracts/suppression.ts';
import {verdict} from '../../packages/contracts/index.ts';
import type {Evidence} from '../../packages/contracts/types.ts';
const Request=z.object({base:z.string().min(1).max(200),head:z.string().min(1).max(200),dirtySnapshot:z.boolean().default(false)}).strict();
type Job={id:string;state:ChangeRun['state'];run:ChangeRun|null;error:string|null;directory:string|null;controller:AbortController;done:Promise<void>;evidence:Evidence<ChangeRun>|null};
/** Registered paths are CLI configuration only, never accepted from the browser. */
export class ComparisonService {
 private jobs=new Map<string,Job>();private keys=new Map<string,{digest:string;id:string}>();
 readonly options:Omit<RunOptions,'base'|'head'|'signal'|'onProgress'>;
 constructor(options:Omit<RunOptions,'base'|'head'|'signal'|'onProgress'>){this.options=options;}
 list(){return [...this.jobs.values()].map(({controller,directory,done,evidence,...j})=>{const run=evidence?{...evidence.payload,findings:currentFindings(evidence)}:j.run;if(run)run.verdict=verdict(run);return {...j,run,report:directory?`/v1/runs/${j.id}/report.html`:null};});}
 get(id:string){return this.jobs.get(id);}
 create(key:string,raw:unknown){
  if(!/^[a-zA-Z0-9_-]{8,128}$/.test(key))throw Error('IDEMPOTENCY_KEY_REQUIRED');const input=Request.parse(raw),digest=sha(JSON.stringify(input)),old=this.keys.get(key);
  if(old){if(old.digest!==digest)throw Error('IDEMPOTENCY_CONFLICT');return this.get(old.id)!;}
  if(this.jobs.size>=100)throw Error('SESSION_JOB_LIMIT_RESTART_SERVER');inspect(this.options.repo,input.base,input.head);
  const j:Job={id:randomUUID(),state:'QUEUED',run:null,error:null,directory:null,controller:new AbortController(),done:Promise.resolve(),evidence:null};this.jobs.set(j.id,j);this.keys.set(key,{digest,id:j.id});
  j.done=compare({...this.options,...input,signal:j.controller.signal,onProgress:r=>{j.state=r.state;j.run=structuredClone(r);}}).then(result=>{j.evidence=result.evidence;j.directory=result.directory;j.state=result.evidence.payload.state;j.run=result.evidence.payload;}).catch(e=>{j.state=j.controller.signal.aborted?'CANCELLED':'FAILED';j.error=e instanceof Error?e.message:'RUN_FAILED';});return j;
 }
 cancel(id:string){const j=this.jobs.get(id);if(!j)throw Error('NOT_FOUND');if(['QUEUED','RUNNING'].includes(j.state)){j.controller.abort();if(j.state==='QUEUED')j.state='CANCELLED';}return j;}
 async close(){for(const j of this.jobs.values())j.controller.abort();await Promise.all([...this.jobs.values()].map(j=>j.done));}
}
export async function serveComparison(options:Omit<RunOptions,'base'|'head'|'signal'|'onProgress'>,port=47831){
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('INVALID_PORT');
 const policy=Policy.parse(JSON.parse(await readFile(options.policy,'utf8'))),service=new ComparisonService(options),token=randomBytes(32).toString('hex'),nonce=randomBytes(24).toString('base64'),host=`127.0.0.1:${port}`;
 const htmlFor=(lang:Language)=>localize(lang)`<!doctype html><html lang="${lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ChangeProof 比較設定</title><style>body{font:18px system-ui;max-width:1000px;padding:20px;margin:auto;color:#20313f}label{display:block;margin:18px 0}input,button{font:inherit;max-width:100%;padding:10px}input:not([type=checkbox]){width:100%;box-sizing:border-box}button{margin:8px}*:focus-visible{outline:3px solid #9b4300}pre{white-space:pre-wrap;overflow-wrap:anywhere}section{border:1px solid #acb5bd;padding:15px;margin:20px 0}li{margin:15px 0}small{display:block}</style><h1>ChangeProof 比較設定</h1><label>Language <select id="language"><option value="ja">日本語</option><option value="en">English</option></select></label><p>信頼済みローカルプロジェクトのみ。外部接続・AI説明は無効。</p><section><h2>登録済みプロジェクト</h2><pre>${esc(options.repo)}</pre><h3>信頼済み検査計画</h3><ul>${policy.checks.map(c=>`<li>${esc(c.id)} / ${esc(c.kind)} / ${label(c.required?'必須':'任意',lang)} / 最大 ${c.timeoutMs/1000} 秒</li>`).join('')}</ul><p>run 上限 ${policy.runTimeoutMs/1000} 秒。同時実行2件、残りは待機。</p></section><form id="compare"><label>比較元 base<input name="base" required value="HEAD~1"></label><label>比較先 head<input name="head" required value="HEAD"></label><label><input type="checkbox" name="dirty"> 未コミット作業ツリーのスナップショットを明示的に使用</label><button>検査を実行</button></form><p id="error" role="alert"></p><h2>実行状況</h2><div id="jobs" aria-live="polite">未実行。比較対象と検査計画を確認してください。</div><script nonce="${nonce}">
const language='${lang}';document.querySelector('#language').value=language;document.querySelector('#language').onchange=e=>{const u=new URL(location.href);u.searchParams.set('lang',e.target.value);location.href=u;};const token=new URL(location.href).searchParams.get('token');const form=document.querySelector('form');let key=null;let signature=null;
async function api(url,method='GET',body){const r=await fetch(url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error(await r.text());return r.json();}
form.onsubmit=async e=>{e.preventDefault();const body={base:form.base.value,head:form.head.value,dirtySnapshot:form.dirty.checked};const sig=JSON.stringify(body);if(sig!==signature||!key){key=crypto.randomUUID();signature=sig;}const b=form.querySelector('button');b.disabled=true;try{await api('/v1/runs','POST',body);document.querySelector('#error').textContent='';key=null;await refresh();}catch(e){document.querySelector('#error').textContent=e.message;}finally{b.disabled=false;}};
async function refresh(){const rows=await api('/v1/runs');const box=document.querySelector('#jobs');box.replaceChildren();for(const j of rows){const s=document.createElement('section'),h=document.createElement('h3');h.textContent=j.state+' / '+(j.run?.verdict??'未確認');s.append(h);const p=document.createElement('p');p.textContent=j.id+' / checks: '+(j.run?.checks.length??0)+(j.error?' / '+j.error:'');s.append(p);if(['QUEUED','RUNNING'].includes(j.state)){const b=document.createElement('button');b.textContent='取消';b.onclick=async()=>{await api('/v1/runs/'+j.id+'/cancel','POST',{});await refresh();};s.append(b);}if(j.report){const a=document.createElement('a');a.textContent='結果と根拠を見る';a.href=j.report.replace('report.html',language==='en'?'report.en.html':'report.html')+'?token='+token;s.append(a);}box.append(s);}}
refresh().catch(e=>document.querySelector('#error').textContent=e.message);setInterval(()=>refresh().catch(()=>{}),1000);
</script></html>`;
 const server=createServer(async(req:IncomingMessage,res:ServerResponse)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'self'`);
  const url=new URL(req.url??'/',`http://${host}`),supplied=req.headers.authorization?.replace(/^Bearer /,'')??url.searchParams.get('token')??'';
  if(req.headers.host!==host||(req.headers.origin&&req.headers.origin!==`http://${host}`)){res.writeHead(403).end('FORBIDDEN');return;}
  if(Buffer.byteLength(supplied)!==token.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token))){res.writeHead(401).end('UNAUTHORIZED');return;}
  if(req.method==='POST'&&req.headers.origin!==`http://${host}`){res.writeHead(403).end('ORIGIN_REQUIRED');return;}
  const json=(v:unknown,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(v));};
  try{
   if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(htmlFor(url.searchParams.get('lang')==='en'?'en':'ja'));return;}
   if(req.method==='GET'&&url.pathname==='/v1/runs'){json(service.list());return;}
   if(req.method==='POST'&&url.pathname==='/v1/runs'){let bytes=0;const chunks:Buffer[]=[];for await(const c of req){bytes+=c.length;if(bytes>10000){res.writeHead(413).end('BODY_LIMIT');return;}chunks.push(c);}const j=service.create(String(req.headers['idempotency-key']??''),JSON.parse(Buffer.concat(chunks).toString()));json({id:j.id,state:j.state},202);return;}
   const match=url.pathname.match(/^\/v1\/runs\/([a-f0-9-]+)(?:\/(.+))?$/);if(match){const id=match[1]!,resource=match[2],j=service.get(id);if(!j){res.writeHead(404).end('NOT_FOUND');return;}
    if(req.method==='POST'&&resource==='cancel'){service.cancel(id);json({id,state:j.state});return;}
    if(req.method==='GET'&&!resource){json(service.list().find(x=>x.id===id));return;}
    if(req.method==='GET'&&resource&&j.directory){let data=await safeRead(j.directory,decodeURIComponent(resource));if(['report.html','report.en.html'].includes(resource)){const evidence=JSON.parse((await safeRead(j.directory,'evidence.json')).toString()),details=JSON.parse((await safeRead(j.directory,'details.json')).toString());data=Buffer.from(renderChangeProof(evidence,details,resource==='report.en.html'?'en':'ja'));}const isHtml=resource.endsWith('.html');res.writeHead(200,{'Content-Type':isHtml?'text/html; charset=utf-8':resource.endsWith('.json')?'application/json':'text/plain; charset=utf-8'}).end(isHtml?data.toString().replace(/href="(?!#)([a-zA-Z0-9_.\/-]+)"/g,(_m,s:string)=>`href="${s}?token=${token}"`):data);return;}
   }res.writeHead(404).end('NOT_FOUND');
  }catch(e){const message=e instanceof Error?e.message:'ERROR';res.writeHead(message==='IDEMPOTENCY_CONFLICT'?409:400).end(message);}
 });
 server.on('close',()=>service.close());await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});return {server,service,url:`http://${host}/?token=${token}`};
}
