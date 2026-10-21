import {spawn} from 'node:child_process';
import {redact} from './index.ts';
export interface ProcessResult {exitCode:number|null;log:string;timedOut:boolean;cancelled:boolean;truncated:boolean;pid:number|null;durationMs:number}
export async function execute(command:string[],cwd:string,options:{timeoutMs:number;signal?:AbortSignal;secrets?:string[];maxBytes?:number;env?:Record<string,string>}):Promise<ProcessResult>{
 const [exe,...args]=command;if(!exe)throw Error('EMPTY_COMMAND');
 const started=Date.now(),max=options.maxBytes??10*1024*1024;let size=0,timedOut=false,cancelled=false,truncated=false;
 const chunks:Buffer[]=[];
 // Do not inherit auth variables, user HOME, Git helpers, or Node preload options.
 const env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'C.UTF-8',TZ:'UTC',CI:'1',HOME:cwd,TMPDIR:cwd,...options.env};
 return new Promise(resolve=>{
  const child=spawn(exe,args,{cwd,env,shell:false,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  let killTimer:NodeJS.Timeout|undefined;
  const kill=(signal:NodeJS.Signals)=>{try{if(child.pid)process.kill(process.platform==='win32'?child.pid:-child.pid,signal);}catch{/* already reaped */}};
  const stop=()=>{kill('SIGTERM');killTimer=setTimeout(()=>kill('SIGKILL'),150);};
  const abort=()=>{cancelled=true;stop();};options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
  const timer=setTimeout(()=>{timedOut=true;stop();},options.timeoutMs);
  const collect=(chunk:Buffer)=>{const available=Math.max(0,max-size);if(chunk.length>available)truncated=true;if(available){chunks.push(chunk.subarray(0,available));size+=Math.min(chunk.length,available);}};
  child.stdout.on('data',collect);child.stderr.on('data',collect);
  child.on('error',()=>chunks.push(Buffer.from('EXECUTION_START_ERROR')));
  child.on('close',code=>{
   clearTimeout(timer);if(killTimer)clearTimeout(killTimer);kill('SIGKILL');options.signal?.removeEventListener('abort',abort);
   resolve({exitCode:code,log:redact(Buffer.concat(chunks).toString('utf8'),options.secrets),timedOut,cancelled,truncated,pid:child.pid??null,durationMs:Date.now()-started});
  });
 });
}
