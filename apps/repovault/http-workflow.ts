import {safeRead} from '../../packages/safe-io/index.ts';
import {captureStream,verifyStream} from './stream.ts';
import {captureLocal,verify,type VaultOptions} from './core.ts';
import {collectRepository,localHttpTransport,type ApiSource,type Capture} from './collector.ts';
import {saveCheckpoint,loadCheckpoint} from './checkpoint.ts';
export async function captureHttp(input:{repo:string;repoId:string;archiveFormat?:'zip-v1'|'stream-v2';source?:ApiSource;recipient:string;out:string;checkpointOut:string;token:string;previousSnapshot?:string;previousCheckpoint?:string;identity?:string;trustedSynthetic:boolean},options:VaultOptions){
 if(!input.trustedSynthetic)throw Error('TRUSTED_SYNTHETIC_SOURCE_REQUIRED');if(input.previousSnapshot&&input.previousCheckpoint)throw Error('ONE_RESUME_SOURCE_REQUIRED');
 let previous:Capture|undefined;if(input.previousSnapshot){if(!input.identity)throw Error('RESUME_IDENTITY_REQUIRED');const index=JSON.parse((await safeRead(input.previousSnapshot,'index.json',10000)).toString());const verified=await (index.schemaVersion==='2.0'?verifyStream:verify)(input.previousSnapshot,input.identity,options);if(verified.evidence.payload.repoId!==input.repoId)throw Error('RESUME_REPO_ID_MISMATCH');previous=verified.metadata;}if(input.previousCheckpoint){if(!input.identity)throw Error('RESUME_IDENTITY_REQUIRED');previous=await loadCheckpoint(input.previousCheckpoint,input.identity,options);}
 const source=input.source??previous?.source;if(!source)throw Error('API_SOURCE_REQUIRED');const transport=localHttpTransport(source.apiOrigin,input.token);let checkpointDirectory:string|null=null;const captureStart=previous?.captureStart??new Date().toISOString();
 const metadata=await collectRepository(source,transport,previous,async cp=>{checkpointDirectory=await saveCheckpoint(input.checkpointOut,source,captureStart,cp,input.recipient,options);});
 const result=await (input.archiveFormat==='stream-v2'?captureStream:captureLocal)({repo:input.repo,repoId:input.repoId,recipient:input.recipient,out:input.out,metadata,trustedSynthetic:input.trustedSynthetic},options);return {...result,checkpointDirectory};
}
