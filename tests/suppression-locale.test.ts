import {test,expect} from 'vitest';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {createDemo} from '../scripts/fixtures.ts';import {compare} from '../apps/changeproof/core.ts';
import {sha} from '../packages/safe-io/index.ts';import {findingKey,currentFindings} from '../packages/contracts/suppression.ts';
import {validate,verdict} from '../packages/contracts/index.ts';import {renderChangeProof,renderBug} from '../packages/report-ui/index.ts';
import {report} from '../apps/bugcapsule-viewer/core.ts';import {localize} from '../packages/report-ui/locale.ts';
test('trusted exact-diff suppression requires owner/reason/expiry and expires without hiding findings',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'cp-review-'));try{const d=await createDemo(root),options={repo:d.repo,base:'base',head:'weak',policy:d.policyPath,out:path.join(root,'out'),trustLocal:true,dependencies:d.dependencies};const before=await compare(options);expect(before.evidence.payload.verdict).toBe('REVIEW_REQUIRED');
 const expiresAt=new Date(Date.now()+60000).toISOString();const records=before.evidence.payload.findings.map(f=>({findingKey:findingKey(f),diffDigest:sha(before.details.diff),reason:'Synthetic reviewed exception',owner:'Synthetic reviewer',expiresAt}));
 await writeFile(d.policyPath,JSON.stringify({...d.policy,suppressions:records}));const active=await compare(options);expect(active.evidence.payload.verdict).toBe('PASS');expect(active.evidence.payload.findings.every(f=>f.suppressed)).toBe(true);expect(()=>validate(active.evidence)).not.toThrow();
 expect(verdict({...active.evidence.payload,findings:currentFindings(active.evidence,Date.parse(expiresAt)+1)})).toBe('REVIEW_REQUIRED');const html=renderChangeProof(active.evidence,active.details,'en');expect(html).toContain('Synthetic reviewer');expect(html).toContain('Suppressed with reason');expect(html).toContain('lang="en"');
 const fake=structuredClone(active.evidence);fake.claims=fake.claims.filter(c=>!c.id.startsWith('suppression:'));expect(()=>validate(fake)).toThrow('SUPPRESSION_METADATA_REQUIRED');
 await writeFile(d.policyPath,JSON.stringify({...d.policy,suppressions:records.map(r=>({...r,diffDigest:'0'.repeat(64)}))}));expect((await compare(options)).evidence.payload.verdict).toBe('REVIEW_REQUIRED');
 await writeFile(d.policyPath,JSON.stringify({...d.policy,suppressions:records.map(r=>({...r,expiresAt:'2020-01-01T00:00:00Z'}))}));expect((await compare(options)).evidence.payload.verdict).toBe('REVIEW_REQUIRED');
 await writeFile(d.policyPath,JSON.stringify({...d.policy,suppressions:records.map(r=>({...r,owner:''}))}));await expect(compare(options)).rejects.toThrow();
 }finally{await rm(root,{recursive:true,force:true});}
},40000);
test('locale translates only template-owned labels, never interpolated source data',()=>{
 const user='変更の確認結果';expect(localize('en')`変更の確認結果: ${user}`).toBe('Change verification results: '+user);
 const e=report([],{title:user,expected:'検査結果',actual:'要確認'},[]);const en=renderBug(e,'en');expect(en).toContain('<h1>'+user+'</h1>');expect(en).toContain('Expected: 検査結果');expect(en).toContain('Actual: 要確認');expect(en).toContain('Masked timeline');expect(en).toContain('report.en.html');expect(renderBug(e)).toContain('マスク済みタイムライン');
});
