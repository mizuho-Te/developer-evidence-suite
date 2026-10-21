import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {safeRead} from './index.ts';
export async function serve(root:string,port:number,entry='report.html'){
 const token=randomBytes(32).toString('hex'),host=`127.0.0.1:${port}`;
 const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.headers.host!==host||req.headers.origin&&req.headers.origin!==`http://${host}`){res.writeHead(403).end('FORBIDDEN');return;}
  if(req.method!=='GET'){res.writeHead(405).end('METHOD_NOT_ALLOWED');return;}
  const url=new URL(req.url??'/',`http://${host}`);const supplied=req.headers.authorization?.replace(/^Bearer /,'')??url.searchParams.get('token')??'';
  if(Buffer.byteLength(supplied)!==Buffer.byteLength(token)||!timingSafeEqual(Buffer.from(token),Buffer.from(supplied))){res.writeHead(401).end('UNAUTHORIZED');return;}
  try{const p=url.pathname==='/'?entry:decodeURIComponent(url.pathname.slice(1));const bytes=await safeRead(root,p);const mime=p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.json')?'application/json':'text/plain; charset=utf-8';res.setHeader('Content-Type',mime);
   // Authorize relative report links with an ephemeral token. Never write the token to disk.
   res.end(p.endsWith('.html')?bytes.toString().replace(/href="(?!#)([a-zA-Z0-9_.\/-]+)"/g,(_m,s:string)=>`href="${s}?token=${token}"`):bytes);
  }catch{res.writeHead(404).end('NOT_FOUND');}
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 return {server,token,url:`http://${host}/?token=${token}`};
}
