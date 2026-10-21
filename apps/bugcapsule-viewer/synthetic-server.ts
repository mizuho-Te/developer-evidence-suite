import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {snapshot} from '../changeproof/git.ts';
import {createDemo} from '../../scripts/fixtures.ts';
export async function syntheticServer(root:string){
 await mkdir(root,{recursive:true,mode:0o700});const demo=await createDemo(path.join(root,'source'));const token=randomBytes(32).toString('hex');
 const modules:Record<string,{save:(file:string,value:string)=>void;load:(file:string)=>string}>={};
 for(const mode of ['bug','fixed']){const dir=path.join(root,mode);await snapshot(demo.repo,demo.refs[mode]!,dir);modules[mode]=await import(pathToFileURL(path.join(dir,'storage.ts')).href);}
 const server=createServer(async(req,res)=>{
  const origin='http://127.0.0.1:47832';res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  if(req.headers.host!=='127.0.0.1:47832'||req.headers.origin&&req.headers.origin!==origin){res.writeHead(403).end();return;}
  const u=new URL(req.url??'/',origin);if((req.headers.authorization??'')!==`Bearer ${token}`&&u.searchParams.get('token')!==token){res.writeHead(401).end();return;}
  const mode=u.searchParams.get('mode')==='fixed'?'fixed':'bug',module=modules[mode]!,file=path.join(root,mode,'saved.json');
  try{if(u.pathname==='/api/value'){
    if(req.method==='POST'){if(req.headers.origin!==origin){res.writeHead(403).end();return;}let body='';for await(const chunk of req){body+=String(chunk);if(body.length>2000){res.writeHead(413).end();return;}}const input=JSON.parse(body) as {value:unknown};if(typeof input.value!=='string'||input.value.length>200){res.writeHead(400).end();return;}module.save(file,input.value);}
    else if(req.method!=='GET'){res.writeHead(405).end();return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({value:module.load(file),headSha:demo.refs[mode]}));return;
   }
   if(req.method!=='GET'){res.writeHead(405).end();return;}
   res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'none'; connect-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src 'self'; form-action 'none'");
   res.end(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>合成保存デモ</title><style>body{font:18px system-ui;color:#183642;background:#f3f6f7;max-width:650px;margin:40px auto;padding:20px}main{padding:28px;background:white;border-radius:12px}label{display:block;margin:18px 0}input{padding:10px;max-width:100%}button{padding:12px;margin:8px 4px}button:focus-visible,input:focus-visible{outline:3px solid #ae6000}code{font-size:11px;overflow-wrap:anywhere}</style><main><p>DOTS · SYNTHETIC ONLY</p><h1>メモを保存</h1><p>${mode==='bug'?'保存に故障を仕込んだ':'修正後の'}合成ページです。</p><label>合成メモ <input id="memo"></label><label>合成password <input id="password" type="password"></label><div data-bc-private><button id="private">非公開領域 <span id="private-child">内側</span></button></div><button id="save">保存</button><button id="reload">ページを再読込</button><p id="status" role="status">読み込み中</p><code id="sha">${demo.refs[mode]}</code><iframe title="未対応iframe" srcdoc="<p>iframe 内部の合成文字</p>"></iframe></main><script>const token=${JSON.stringify(token)},mode=${JSON.stringify(mode)};async function load(){const r=await fetch('/api/value?mode='+mode,{headers:{Authorization:'Bearer '+token}});const data=await r.json();document.querySelector('#memo').value=data.value;document.querySelector('#status').textContent='読み込み完了';}document.querySelector('#save').onclick=async()=>{await fetch('/api/value?mode='+mode,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({value:document.querySelector('#memo').value})});document.querySelector('#status').textContent='保存処理が完了しました';};document.querySelector('#reload').onclick=()=>location.reload();load();</script></html>`);
  }catch{res.writeHead(500).end('SYNTHETIC_ERROR');}
 });await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(47832,'127.0.0.1',resolve);});
 return {server,demo,token,url:`http://127.0.0.1:47832/?token=${token}`,close:()=>new Promise<void>(r=>server.close(()=>r()))};
}
