import {describe,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {Recorder} from '../apps/bugcapsule-extension/recorder.js';
import {approvedOrigins,exactOrigin,recordingOrigin,acceptsSession} from '../apps/bugcapsule-extension/origin-policy.js';
import type {OriginConfiguration} from '../apps/bugcapsule-extension/origin-policy.js';
const config:OriginConfiguration={version:1,confirmed:true,allowedOrigins:['https://approved.invalid','https://second.invalid']};
function dom(url:string){return new JSDOM('<main><button>TEXT_CANARY</button><input value="INPUT_CANARY"><div data-bc-private>PRIVATE_CANARY</div></main>',{url});}
describe('explicit origin configuration (synthetic DOM only)',()=>{
 it('keeps localhost-only defaults and does not auto-approve the current page',()=>{
  expect(approvedOrigins()).toEqual(['http://127.0.0.1:47832']);expect(()=>recordingOrigin('https://approved.invalid')).toThrow('ORIGIN_NOT_APPROVED');
  const d=dom('https://approved.invalid');const r=new Recorder(d.window as unknown as Window);expect(()=>r.start()).toThrow('ORIGIN_NOT_APPROVED');expect(r.events).toEqual([]);d.window.close();
 });
 it.each(['*','https://*.invalid','https://approved.invalid/','https://approved.invalid/path','https://approved.invalid?CANARY','https://approved.invalid#CANARY','https://name:secret@approved.invalid','file:///tmp/a','data:text/html,test','chrome://settings','https://approved.invalid:443','https://APPROVED.invalid',' https://approved.invalid'])('rejects non-exact configuration %s',origin=>{expect(()=>exactOrigin(origin)).toThrow();});
 it('requires explicit confirmation and a bounded nonempty list',()=>{
  for(const value of [{...config,confirmed:false},{...config,allowedOrigins:[]},{...config,allowedOrigins:Array(21).fill('https://approved.invalid')}])expect(()=>approvedOrigins(value as OriginConfiguration)).toThrow();
 });
 it('matches origin exactly, not subdomains, prefixes, schemes or ports',()=>{
  for(const value of ['https://sub.approved.invalid','https://approved.invalid.evil.invalid','http://approved.invalid','https://approved.invalid:8443'])expect(()=>recordingOrigin(value,config)).toThrow('ORIGIN_NOT_APPROVED');
  expect(recordingOrigin('https://approved.invalid/private?QUERY_CANARY#FRAGMENT_CANARY',config)).toBe('https://approved.invalid');
 });
 it('masks synthetic approved-page events without leaking path/query/fragment or text',()=>{
  const d=dom('https://approved.invalid/PATH_CANARY?QUERY_CANARY#FRAGMENT_CANARY');const r=new Recorder(d.window as unknown as Window,undefined,{originConfig:config});try{
   r.start();d.window.document.querySelector('button')!.click();d.window.dispatchEvent(new d.window.Event('popstate'));
   expect(r.status().origin).toBe('https://approved.invalid');expect(r.status().coverage).toContain('explicit-user-approved-single-origin');expect(JSON.stringify(r.status())).not.toContain('CANARY');expect(r.events.some(e=>e.kind==='click')).toBe(true);
  }finally{r.discard();d.window.close();}
 });
 it('cannot widen a recorder configuration through later caller mutation',()=>{
  const settings={...config,allowedOrigins:['https://second.invalid']};const d=dom('https://approved.invalid');const r=new Recorder(d.window as unknown as Window,undefined,{originConfig:settings});settings.allowedOrigins.push('https://approved.invalid');expect(()=>r.start()).toThrow('ORIGIN_NOT_APPROVED');d.window.close();
 });
 it.each(['popstate','click','tick','resume'])('stops on a different origin even when that origin is approved (%s)',trigger=>{
  const d=dom('https://approved.invalid');const r=new Recorder(d.window as unknown as Window,undefined,{originConfig:config});try{
   r.start();if(trigger==='resume')r.pause();const before=JSON.stringify(r.events);d.reconfigure({url:'https://second.invalid/OTHER_CANARY?CANARY#CANARY'});
   if(trigger==='click')d.window.document.querySelector('button')!.click();else if(trigger==='tick')r.tick();else if(trigger==='resume')r.resume();else d.window.dispatchEvent(new d.window.Event('popstate'));
   expect(r.state).toBe('REVIEW');expect(r.status().reason).toBe('ORIGIN_CHANGED');expect(r.status().origin).toBe('https://approved.invalid');expect(JSON.stringify(r.events)).toBe(before);
  }finally{r.discard();d.window.close();}
 });
 it('rejects a tab that navigated between user approval and injection',()=>{
  const d=dom('https://second.invalid');const r=new Recorder(d.window as unknown as Window,undefined,{originConfig:config,expectedOrigin:'https://approved.invalid'});expect(()=>r.start()).toThrow('ORIGIN_CHANGED_BEFORE_START');expect(r.events).toEqual([]);d.window.close();
 });
 it('binds persistence to an explicit session, exact origin, top frame and tab',()=>{
  const auth={tabId:7,origin:'https://approved.invalid',sessionId:'session-1'};const sender={tab:{id:7},origin:auth.origin,frameId:0};const message={type:'BC_STATUS',session:{origin:auth.origin,sessionId:auth.sessionId}};
  expect(acceptsSession(message,sender,auth,config)).toBe(true);
  for(const changed of [{...sender,origin:'https://second.invalid'},{...sender,tab:{id:8}},{...sender,frameId:1}])expect(acceptsSession(message,changed,auth,config)).toBe(false);
  expect(acceptsSession(message,sender,undefined,config)).toBe(false);expect(acceptsSession({...message,session:{...message.session,sessionId:'old-session'}},sender,auth,config)).toBe(false);
  expect(acceptsSession(message,sender,auth)).toBe(false);
 });
 it('does not add standing host permissions or background content scripts',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../apps/bugcapsule-extension/manifest.json',import.meta.url),'utf8'));expect(manifest.permissions).toEqual(['activeTab','scripting','storage']);expect(manifest.host_permissions).toBeUndefined();expect(manifest.content_scripts).toBeUndefined();
 });
});
