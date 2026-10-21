import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {validate,importEvidence} from '../packages/contracts/index.ts';
import {unpack,pack,relativePath,redact} from '../packages/safe-io/index.ts';
const load=(name:string)=>JSON.parse(readFileSync(new URL(`../specs/Dots_Implementation_Pack/examples/${name}.json`,import.meta.url),'utf8'));
describe('unmodified specification fixtures',()=>{
 for(const name of ['changeproof-incomplete','bugcapsule-recorded','repovault-partial'])it(name,()=>expect(()=>validate(load(name))).not.toThrow());
 for(const sample of load('invalid-cases'))it(sample.name,()=>expect(()=>validate(sample.document)).toThrow());
 it('unknown major and extra fields rejected without mutation',()=>{const v=load('changeproof-incomplete');v.schemaVersion='2.0';const before=JSON.stringify(v);expect(()=>validate(v)).toThrow();expect(JSON.stringify(v)).toBe(before);v.schemaVersion='1.0';v.extra=true;expect(()=>validate(v)).toThrow();});
 it('import cannot retain CI trust',()=>{const v=load('changeproof-incomplete');v.origin.trust='ci_verified';expect(importEvidence(v).origin.trust).toBe('unverified');});
 it('reject dishonest reproduction even with invented ID',()=>{const v=load('bugcapsule-recorded');v.payload.reproductionState='reproduced';v.payload.verifierRunId='invented';expect(()=>validate(v)).toThrow();});
});
describe('input boundaries',()=>{
 it('safe zip roundtrip',()=>{expect(Buffer.from(unpack(pack({'report.json':Buffer.from('{}')}))['report.json']!).toString()).toBe('{}');});
 it('reject traversal, absolute, Windows and duplicate syntax',()=>{for(const p of ['../x','/tmp/x','C:/x','a\\x','a//x','a/./x'])expect(()=>relativePath(p)).toThrow();});
 it('redacts before persistence',()=>expect(redact('token=SYNTHETIC-CANARY\nsecret: other')).not.toContain('SYNTHETIC-CANARY'));
});
