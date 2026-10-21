import {describe,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {Recorder} from '../apps/bugcapsule-extension/recorder.js';
import {PACK_LIMIT,REPORT_RESERVE,assertPackBudget,projectedExportBytes,validateDescriptions} from '../apps/bugcapsule-extension/export-budget.js';
import {retentionDays,readSession,extendSession} from '../apps/bugcapsule-extension/retention.js';
import {report,exportPack,parsePack} from '../apps/bugcapsule-viewer/core.ts';
describe('BugCapsule precompression export budget',()=>{
 it('enforces exact aggregate bytes independently of compression ratio',()=>{
  const bytes=new Uint8Array(PACK_LIMIT);expect(assertPackBudget({a:bytes})).toBe(PACK_LIMIT);expect(()=>assertPackBudget({a:bytes,b:new Uint8Array(1)})).toThrow('EXPORT_SIZE_LIMIT');
 });
 it('bounds descriptions explicitly including non-ASCII and JSON escapes',()=>{
  validateDescriptions({title:'x'.repeat(200),expected:'\u0000'.repeat(10000),actual:'日'.repeat(10000)});
  for(const key of ['title','expected','actual'])expect(()=>validateDescriptions({title:'x',expected:'x',actual:'x',[key]:'x'.repeat(key==='title'?201:10001)})).toThrow('DESCRIPTION_TOO_LONG');
 });
 it('rejects a highly compressible pack whose duplicated events exceed 50 MiB',()=>{
  const e=report([{seq:0,kind:'snapshot',monotonicMs:0,maskedTarget:'x'.repeat(PACK_LIMIT/2)}],{title:'synthetic',expected:'persist',actual:'lost'},[]);
  expect(()=>exportPack(e,true)).toThrow('EXPORT_SIZE_LIMIT');
 });
 it('stops early enough that a near-limit recording with maximum descriptions reimports',()=>{
  const d=new JSDOM('<main></main>',{url:'http://127.0.0.1:47832/'});const r=new Recorder(d.window as unknown as Window);try{
   r.start();const target='x'.repeat(256*1024);let seq=1;
   while(r.state==='RECORDING'&&seq++<200)(r as any).add('snapshot',target);
   expect(r.status().reason).toBe('EXPORT_SIZE_LIMIT');expect(projectedExportBytes((r as any).bytes,r.events.length)).toBeLessThanOrEqual(PACK_LIMIT);expect((r as any).bytes).toBeGreaterThan((PACK_LIMIT-REPORT_RESERVE)/2-300000);
   const e=report(r.events,{title:'\u0000'.repeat(200),expected:'\u0000'.repeat(10000),actual:'\u0000'.repeat(10000)},r.status().coverage);const bytes=exportPack(e,true);const parsed=parsePack(bytes);expect(parsed.evidence.payload.events.length).toBe(r.events.length);expect(Object.values(parsed.files).reduce((n,b)=>n+b.byteLength,0)).toBeLessThanOrEqual(PACK_LIMIT);
  }finally{r.discard();d.window.close();}
 },20000);
});
describe('bounded explicit retention',()=>{
 const now=1000000000;const session={sessionId:'synthetic',expiresAt:now+7*86400000};
 it('defaults to 7 days and accepts explicit extension up to 365 days',()=>{expect(retentionDays()).toBe(7);expect(extendSession(session,30,now).expiresAt).toBe(now+30*86400000);expect(extendSession(session,7,now).expiresAt).toBe(session.expiresAt);for(const days of [0,6,366,Infinity,7.5])expect(()=>retentionDays(days)).toThrow();});
 it('deletes expired or invalid sessions and revokes collection authorization on read',async()=>{
  for(const expiresAt of [now,now-1,undefined,NaN]){const values:Record<string,any>={session:{...session,expiresAt},recordingAuthorization:{sessionId:'synthetic'}};const storage={get:async()=>values,remove:async(key:string)=>{delete values[key];}};expect(await readSession(storage,now)).toBeNull();expect(values.session).toBeUndefined();expect(values.recordingAuthorization).toBeUndefined();}
 });
 it('does not slide expiry on read or revive expired data',async()=>{const storage={get:async()=>({session}),remove:async()=>{throw Error('not expected');}};expect((await readSession(storage,now)).expiresAt).toBe(session.expiresAt);expect(()=>extendSession({...session,expiresAt:now},365,now)).toThrow('SESSION_EXPIRED');});
});
describe('post-action masked snapshot',()=>{
 it('captures synchronous page-handler inserted structure after capture phase',async()=>{
  const d=new JSDOM('<button>CANARY</button>',{url:'http://127.0.0.1:47832/'});const r=new Recorder(d.window as unknown as Window);try{r.start();d.window.document.querySelector('button')!.addEventListener('click',()=>{d.window.document.body.insertAdjacentHTML('beforeend','<section><h2>ERROR_CANARY</h2></section>');});d.window.document.querySelector('button')!.click();expect(r.events.at(-1)!.maskedTarget).not.toContain('section');await Promise.resolve();expect(r.events.at(-1)!.maskedTarget).toContain('section');expect(JSON.stringify(r.events)).not.toContain('CANARY');}finally{r.discard();d.window.close();}
 });
 it('drops pending snapshots if paused even if immediately resumed',async()=>{
  const d=new JSDOM('<button>CANARY</button>',{url:'http://127.0.0.1:47832/'});const r=new Recorder(d.window as unknown as Window);try{r.start();d.window.document.querySelector('button')!.click();r.pause();const count=r.events.length;await Promise.resolve();expect(r.events.length).toBe(count);r.resume();d.window.document.querySelector('button')!.click();r.pause();r.resume();const resumed=r.events.length;await Promise.resolve();expect(r.events.length).toBe(resumed);}finally{r.discard();d.window.close();}
 });
});
