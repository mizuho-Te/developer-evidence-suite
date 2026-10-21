import {XMLParser,XMLValidator} from 'fast-xml-parser';
import type {CheckStatus,Check,ChangeRun,Evidence} from '../../packages/contracts/types.ts';
import {importEvidence,verdict} from '../../packages/contracts/index.ts';
export function vitestStatus(input:unknown):CheckStatus{
 if(typeof input!=='object'||input===null)throw Error('INVALID_TEST_RESULT');
 const x=input as Record<string,unknown>;
 if(!Array.isArray(x.testResults))throw Error('INVALID_TEST_RESULT');
 const statuses:string[]=[];
 for(const s of x.testResults){if(!s||typeof s!=='object'||!Array.isArray(s.assertionResults))throw Error('INVALID_ASSERTIONS');for(const t of s.assertionResults){if(!t||typeof t.status!=='string')throw Error('INVALID_ASSERTION');statuses.push(t.status);}}
 if(statuses.some(s=>s==='failed'))return 'FAIL';
 if(!statuses.length)return 'NOT_RUN';
 if(statuses.some(s=>!['passed','pending','skipped','todo','disabled'].includes(s)))return 'ERROR';
 return statuses.every(s=>s==='passed')?'PASS':'SKIPPED';
}
export function junitStatus(xml:string):CheckStatus{
 if(/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw Error('UNSAFE_XML');
 const parsed=new XMLParser({ignoreAttributes:false,processEntities:false,isArray:name=>['testsuite','testcase'].includes(name)}).parse(xml) as Record<string,unknown>;
 const statuses:CheckStatus[]=[];
 function visit(x:unknown){if(!x||typeof x!=='object')return;for(const [k,v] of Object.entries(x)){if(k==='testcase'&&Array.isArray(v)){for(const test of v)statuses.push(Object.hasOwn(test,'failure')?'FAIL':Object.hasOwn(test,'error')?'ERROR':Object.hasOwn(test,'skipped')?'SKIPPED':'PASS');}else if(Array.isArray(v))v.forEach(visit);else if(typeof v==='object')visit(v);}}
 visit(parsed);return statuses.includes('FAIL')?'FAIL':statuses.includes('ERROR')?'ERROR':!statuses.length?'NOT_RUN':statuses.includes('SKIPPED')?'SKIPPED':'PASS';
}
export function importedRun(input:unknown,expected:{headSha:string;policyDigest:string;sourceId:string}):Evidence<ChangeRun>{
 const e=importEvidence(input);if(e.product!=='changeproof')throw Error('WRONG_PRODUCT');const result=e as Evidence<ChangeRun>;
 const mismatch=result.payload.headSha!==expected.headSha||result.payload.policyDigest!==expected.policyDigest||result.origin.sourceId!==expected.sourceId;
 result.payload.checks=result.payload.checks.map(c=>({...c,status:mismatch?'STALE':'NOT_RUN',artifactRefs:[]} as Check));
 result.payload.findings.push({id:'import-trust',ruleId:'CP106',file:'import',line:null,severity:'review',suppressed:false,reason:mismatch?'対象 SHA / repo / policy が一致しません。':'未検証インポートです。ローカルの検査を実行してください。'});
 result.payload.verdict=verdict(result.payload);return result;
}
