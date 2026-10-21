import {suppressionRecords} from './suppression.ts';
import {readFileSync} from 'node:fs';
import {Ajv2020} from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import {sha,relativePath,safeRead} from '../safe-io/index.ts';
import type {Evidence,ChangeRun,BugReport,Snapshot,Verdict} from './types.ts';
const ajv=new Ajv2020({allErrors:true,strict:false});
const addFormats=addFormatsModule as unknown as (instance:Ajv2020)=>void;addFormats(ajv);
for(const name of ['common','changeproof','bugcapsule','repovault','evidence'])ajv.addSchema(JSON.parse(readFileSync(new URL(`../../specs/Dots_Implementation_Pack/schemas/${name}.schema.json`,import.meta.url),'utf8')));
const schema=ajv.getSchema('https://specs.invalid/dots/v1/evidence.schema.json')!;
export function verdict(run:ChangeRun):Verdict|null{
 if(run.state!=='COMPLETE')return null;
 const req=run.checks.filter(c=>c.required);
 if(req.some(c=>c.status==='FAIL'))return 'FAIL';
 if(!req.length||req.some(c=>c.status!=='PASS')||run.unverifiedRequirementIds.length)return 'INCOMPLETE';
 if(run.checks.some(c=>c.flaky)||run.findings.some(f=>!f.suppressed&&f.severity!=='info'))return 'REVIEW_REQUIRED';
 return 'PASS';
}
function utc(s:string){if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(s)||!Number.isFinite(Date.parse(s)))throw Error('UTC_REQUIRED');}
function unique(values:string[]){if(new Set(values).size!==values.length)throw Error('DUPLICATE_ID');}
export function validate(input:unknown):Evidence{
 if(!schema(input))throw Error('SCHEMA_INVALID: '+ajv.errorsText(schema.errors));
 const e=input as Evidence;utc(e.createdAt);unique(e.claims.map(c=>c.id));
 const files=e.integrity.files;unique(files.map(f=>f.path.toLowerCase()));for(const f of files)relativePath(f.path);
 if(e.product==='changeproof'){
  const p=e.payload as ChangeRun;unique(p.checks.map(c=>c.id));unique(p.findings.map(f=>f.id));
  if(p.verdict!==verdict(p))throw Error('VERDICT_MISMATCH');
  // Strict asserted-claim extension preserves original v1 payload schema. Boolean-only suppression remains invalid.
  suppressionRecords(e as Evidence<ChangeRun>);
 }else if(e.product==='bugcapsule'){
  const p=e.payload as BugReport;let seq=-1,ms=-1;utc(e.createdAt);
  if(new URL(p.origin).origin!==p.origin||!/^https?:/.test(p.origin))throw Error('ORIGIN_ONLY');
  for(const ev of p.events){if(ev.seq<=seq||ev.monotonicMs<ms)throw Error('EVENT_ORDER');seq=ev.seq;ms=ev.monotonicMs;}
  if(p.reproductionState==='reproduced')throw Error('INDEPENDENT_REPRODUCTION_NOT_IMPLEMENTED');
 }else{
  const p=e.payload as Snapshot;utc(p.captureStart);utc(p.captureEnd);if(p.captureEnd<p.captureStart)throw Error('CAPTURE_INTERVAL');
  unique(p.resources.map(r=>r.kind));const selected=p.resources.filter(r=>r.selected);
  if(p.coverageComplete!==(selected.length>0&&selected.every(r=>r.status==='COMPLETE')))throw Error('COVERAGE_MISMATCH');
  unique(p.files.map(f=>f.path.toLowerCase()));for(const f of p.files)relativePath(f.path);
 }
 return e;
}
export async function verifyFiles(e:Evidence,root:string){
 for(const f of e.integrity.files){const bytes=await safeRead(root,f.path);if(f.bytes!==bytes.length||sha(bytes)!==f.sha256)throw Error('INTEGRITY_MISMATCH');}
}
export function importEvidence(input:unknown):Evidence{
 const e=structuredClone(validate(input));e.origin={kind:'imported',trust:'unverified',sourceId:e.origin.sourceId};return e;
}
