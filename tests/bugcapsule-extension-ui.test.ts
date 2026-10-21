import {describe,it,expect,vi,beforeAll} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readSession,retentionDays} from '../apps/bugcapsule-extension/retention.js';
import {acceptsSession} from '../apps/bugcapsule-extension/origin-policy.js';
const source=(name:string)=>readFileSync(new URL('../apps/bugcapsule-extension/'+name,import.meta.url),'utf8');
const bundles:Record<string,string>={};
const built=(name:string)=>bundles[name]!;
beforeAll(async()=>{
 const require=createRequire(import.meta.url);const esbuild=await import(require.resolve('esbuild',{paths:[path.dirname(require.resolve('vite',{paths:[path.dirname(require.resolve('vitest/package.json'))]}))]}));
 const src=fileURLToPath(new URL('../apps/bugcapsule-extension/',import.meta.url));
 bundles['popup.bundle.js']=(await esbuild.build({entryPoints:[path.join(src,'popup.js')],bundle:true,write:false,format:'iife',platform:'browser'})).outputFiles[0].text;
 bundles['recorder.bundle.js']=(await esbuild.build({stdin:{contents:"import {Recorder} from './recorder.js'; globalThis.BugCapsuleRecorder=Recorder;",resolveDir:src},bundle:true,write:false,format:'iife',platform:'browser'})).outputFiles[0].text;
});
describe('extension synthetic UI and lifecycle',()=>{
 it('renders the current origin without URL secrets, switches UI only, and requires config confirmation',async()=>{
  const d=new JSDOM(source('popup.html'),{url:'https://extension.invalid',runScripts:'outside-only'});const saved:Record<string,unknown>={};const executeScript=vi.fn();
  Object.assign(d.window,{chrome:{storage:{local:{get:async()=>saved,set:async(value:object)=>Object.assign(saved,value),remove:async()=>{}}},tabs:{query:async()=>[{id:1,url:'https://approved.invalid/PATH_CANARY?QUERY_CANARY#FRAGMENT_CANARY'}]},scripting:{executeScript}}});
  d.window.eval(built('popup.bundle.js'));await new Promise(resolve=>setTimeout(resolve,0));
  const get=(id:string)=>d.window.document.getElementById(id)!;expect(get('target-origin').textContent).toBe('https://approved.invalid');expect(d.window.document.body.textContent).not.toContain('CANARY');
  const title=get('title') as HTMLInputElement;title.value='利用者の文章';const language=get('language') as HTMLSelectElement;language.value='en';language.dispatchEvent(new d.window.Event('change'));expect(get('start').textContent).toBe('Start recording');expect(title.value).toBe('利用者の文章');
  (get('origins') as HTMLTextAreaElement).value='https://approved.invalid';(get('save-origins') as HTMLButtonElement).click();await new Promise(resolve=>setTimeout(resolve,0));expect(saved.originConfig).toBeUndefined();
  (get('confirm-origins') as HTMLInputElement).checked=true;(get('save-origins') as HTMLButtonElement).click();await new Promise(resolve=>setTimeout(resolve,0));expect(saved.originConfig).toEqual({version:1,confirmed:true,allowedOrigins:['https://approved.invalid']});expect(executeScript).not.toHaveBeenCalled();d.window.close();
 });
 it('clears an expired reviewed preview rather than exporting it',async()=>{
  const d=new JSDOM(source('popup.html'),{url:'https://extension.invalid',runScripts:'outside-only'});const saved:Record<string,any>={session:{sessionId:'synthetic',origin:'http://127.0.0.1:47832',state:'REVIEW',events:[],coverage:[],reason:'USER_STOP',expiresAt:Date.now()+60000}};
  Object.assign(d.window,{chrome:{storage:{local:{get:async()=>saved,set:async(value:object)=>Object.assign(saved,value),remove:async(key:string)=>{delete saved[key];}}},tabs:{query:async()=>[{id:1,url:'http://127.0.0.1:47832'}]}}});
  d.window.eval(built('popup.bundle.js'));await new Promise(resolve=>setTimeout(resolve,0));const get=(id:string)=>d.window.document.getElementById(id)!;
  (get('preview') as HTMLButtonElement).click();await new Promise(resolve=>setTimeout(resolve,0));expect(get('preview-data').textContent).toContain('synthetic');(get('approved') as HTMLInputElement).checked=true;saved.session.expiresAt=Date.now()-1;
  (get('export') as HTMLButtonElement).click();await new Promise(resolve=>setTimeout(resolve,0));expect(saved.session).toBeUndefined();expect(get('preview-data').textContent).toBe('');expect((get('approved') as HTMLInputElement).checked).toBe(false);expect(get('status').textContent).toBe('SESSION_EXPIRED_OR_CHANGED');d.window.close();
 });
 it('does not collect from content injection without an explicit start configuration',()=>{
  const d=new JSDOM('<main>CANARY</main>',{url:'https://approved.invalid',runScripts:'outside-only'});d.window.eval(built('recorder.bundle.js'));d.window.eval(source('content.js'));expect((d.window as any).__bugCapsule).toBeUndefined();d.window.close();
 });
 it('shows translated recording controls with a synthetic approved session',async()=>{
  const d=new JSDOM('<main>CANARY</main>',{url:'https://approved.invalid',runScripts:'outside-only'});const messages:any[]=[];let listener:any;
  Object.assign(d.window,{TextEncoder,chrome:{runtime:{sendMessage:async(message:any)=>{messages.push(message);return {ok:true};},onMessage:{addListener:(value:any)=>{listener=value;}}}},__bugCapsuleStart:{origin:'https://approved.invalid',sessionId:'synthetic-test',language:'ja',originConfig:{version:1,confirmed:true,allowedOrigins:['https://approved.invalid']}}});
  try{d.window.eval(built('recorder.bundle.js'));d.window.eval(source('content.js'));expect(d.window.document.querySelector('[data-bc-private]')?.textContent).toContain('一時停止');let result:any;listener({type:'BC_COMMAND',action:'status'},null,(status:any)=>{result=status;});expect(result.sessionId).toBe('synthetic-test');expect(result.state).toBe('RECORDING');expect(JSON.stringify(messages)).not.toContain('CANARY');}finally{(d.window as any).__bugCapsule?.discard();d.window.close();}
 });
});

describe('worker origin-bound persistence (mock extension API)',()=>{
 it('rejects cross-origin messages and late status after navigation stops',async()=>{
  const auth={origin:'https://approved.invalid',tabId:1,sessionId:'test-session'};
  const storage:Record<string,any>={originConfig:{version:1,confirmed:true,allowedOrigins:['https://approved.invalid','https://second.invalid']},recordingAuthorization:auth};
  let onMessage:any,onUpdated:any;
  const chrome={runtime:{onMessage:{addListener:(listener:any)=>{onMessage=listener;}}},storage:{local:{get:async()=>({...storage}),set:async(value:any)=>Object.assign(storage,value),remove:async(key:string)=>{delete storage[key];}}},tabs:{onRemoved:{addListener:()=>{}},onUpdated:{addListener:(listener:any)=>{onUpdated=listener;}}}};
  new Function('chrome','acceptsSession','readSession','retentionDays',source('worker.js').replace(/^import .*;$/gm,''))(chrome,acceptsSession,readSession,retentionDays);
  const message={type:'BC_STATUS',session:{...auth,state:'RECORDING',events:[]}};const sender={origin:auth.origin,tab:{id:1},frameId:0};
  const send=(value:any,from:any)=>new Promise<any>(resolve=>onMessage(value,from,resolve));
  expect(await send(message,sender)).toEqual({ok:true});const originalExpiry=storage.session.expiresAt;expect(await send(message,sender)).toEqual({ok:true});expect(storage.session.expiresAt).toBe(originalExpiry);
  expect(await send({...message,session:{...message.session,origin:'https://second.invalid'}},{...sender,origin:'https://second.invalid'})).toEqual({error:'SESSION_ORIGIN_NOT_AUTHORIZED'});
  expect(storage.session.origin).toBe(auth.origin);
  onUpdated(1,{status:'loading'});expect(await send(message,sender)).toEqual({error:'SESSION_ORIGIN_NOT_AUTHORIZED'});expect(storage.session.state).toBe('REVIEW');expect(storage.session.reason).toBe('NAVIGATION_RECORDING_STOPPED_RESTART_REQUIRED');expect(storage.recordingAuthorization).toBeUndefined();
 });
});
