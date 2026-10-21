import {z} from 'zod';
import {sha} from '../safe-io/index.ts';
import type {Finding,Evidence,ChangeRun} from './types.ts';
export const Suppression=z.object({findingKey:z.string().regex(/^[a-f0-9]{64}$/),diffDigest:z.string().regex(/^[a-f0-9]{64}$/),reason:z.string().trim().min(1).max(2000),owner:z.string().trim().min(1).max(200),expiresAt:z.string().datetime()}).strict();
export type SuppressionRecord=z.infer<typeof Suppression>;
export function findingKey(f:Finding){return sha(JSON.stringify({ruleId:f.ruleId,file:f.file,line:f.line,reason:f.reason}));}
export function suppressionRecords(e:Evidence<ChangeRun>){
 const result=new Map<string,SuppressionRecord>();
 for(const f of e.payload.findings){if(!f.suppressed)continue;const claim=e.claims.find(c=>c.id==='suppression:'+f.id);
  if(!claim||claim.type!=='asserted')throw Error('SUPPRESSION_METADATA_REQUIRED');const record=Suppression.parse(JSON.parse(claim.text));
  if(record.findingKey!==findingKey(f)||Date.parse(record.expiresAt)<=Date.parse(e.createdAt))throw Error('SUPPRESSION_INVALID_OR_EXPIRED_AT_RUN');result.set(f.id,record);
 }return result;
}
export function currentFindings(e:Evidence<ChangeRun>,now=Date.now()){
 const records=suppressionRecords(e);return e.payload.findings.map(f=>({...f,suppressed:f.suppressed&&Date.parse(records.get(f.id)!.expiresAt)>now}));
}
