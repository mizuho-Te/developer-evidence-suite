import {describe,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {Recorder} from '../apps/bugcapsule-extension/recorder.js';
import {report,exportPack,parsePack} from '../apps/bugcapsule-viewer/core.ts';
import {maskedReplay} from '../apps/bugcapsule-viewer/replay.ts';

describe('strict masked structure replay',()=>{
 it('never serializes text, attributes, private descendants, resources or input values',()=>{
  const d=new JSDOM('<main style="background:url(https://host.invalid/CANARY)"><h1>CANARY</h1><input value="CANARY"><div data-bc-private><button title="CANARY">CANARY</button></div><a href="https://host.invalid/CANARY">CANARY</a><img src="https://host.invalid/CANARY"><iframe srcdoc="CANARY"></iframe></main>',{url:'http://127.0.0.1:47832/?CANARY#CANARY'});
  const r=new Recorder(d.window as unknown as Window);try{r.start();const saved=JSON.stringify(r.status());expect(saved).not.toContain('CANARY');expect(saved).not.toContain('host.invalid');expect(saved).toContain('masked-dom-v1');const roundtrip=parsePack(exportPack(report(r.events,{title:'synthetic',expected:'persist',actual:'lost'},r.status().coverage),true));expect(JSON.stringify(roundtrip.evidence)).not.toContain('CANARY');const rendered=maskedReplay(r.events[0]!.maskedTarget);expect(rendered).toContain('data-kind="main"');expect(rendered).not.toContain('<a ');expect(rendered).not.toContain('<input');expect(rendered).not.toContain('<img');}finally{r.discard();d.window.close();}
 });
 it('treats hostile imported trees as inert data and bounds nesting',()=>{
  expect(maskedReplay('masked-dom-v1:'+JSON.stringify({tag:'script',children:[],text:'alert(1)'}))).toBe('');
  const rendered=maskedReplay('masked-dom-v1:'+JSON.stringify({tag:'a',href:'https://host.invalid',onclick:'alert(1)',children:[]}));expect(rendered).not.toContain('href');expect(rendered).not.toContain('onclick');expect(rendered).not.toContain('host.invalid');expect(maskedReplay('masked-dom-v1:{')).toBe('');
 });
 it('collects nothing while paused and resumes with fresh masked snapshot',()=>{
  const d=new JSDOM('<button>safe</button>',{url:'http://127.0.0.1:47832/'});const r=new Recorder(d.window as unknown as Window);try{r.start();r.pause();const before=JSON.stringify(r.events);d.window.document.body.innerHTML='<div data-bc-private>PAUSE_CANARY</div><button>PAUSE_CANARY</button>';d.window.document.querySelector('button')!.click();expect(JSON.stringify(r.events)).toBe(before);r.resume();expect(r.events.at(-1)?.kind).toBe('snapshot');expect(JSON.stringify(r.events)).not.toContain('PAUSE_CANARY');}finally{r.discard();d.window.close();}
 });
});
