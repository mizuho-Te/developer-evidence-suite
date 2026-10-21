import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {relativePath} from '../../packages/safe-io/index.ts';
export function sensitivePath(p:string){return /(?:^|\/)(?:\.env(?:\..*)?|id_rsa|id_ed25519|credentials|\.npmrc)$|\.(?:pem|key)$/i.test(p);}
export function git(repo:string,args:string[]):Buffer{return execFileSync('/usr/bin/git',['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-C',repo,...args],{maxBuffer:100*1024*1024,env:{PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_OPTIONAL_LOCKS:'0',LANG:'C',GIT_TERMINAL_PROMPT:'0'},stdio:['ignore','pipe','pipe']});}
export function resolveRef(repo:string,ref:string):string{
 if(!/^[A-Za-z0-9_./~-]+$/.test(ref)||ref.startsWith('-'))throw Error('INVALID_REF');
 const value=git(repo,['rev-parse','--verify',ref+'^{commit}']).toString().trim();if(!/^[0-9a-f]{40,64}$/.test(value))throw Error('INVALID_SHA');return value;
}
export function inspect(repo:string,base:string,head:string){
 const baseSha=resolveRef(repo,base),headSha=resolveRef(repo,head);
 const dirty=git(repo,['status','--porcelain','--untracked-files=all']).toString();
 // Refuse before asking Git for any diff bytes so secret-file contents cannot
 // enter a failed run's diagnostic report.
 const changed=git(repo,['diff','--name-only','-z',baseSha,headSha,'--']).toString().split('\0').filter(Boolean);
 if(changed.some(sensitivePath))throw Error('SENSITIVE_FILE_DIFF_REJECTED');
 return {baseSha,headSha,dirty:dirty.length>0,diff:git(repo,['diff','--no-ext-diff','--no-textconv','--unified=3',baseSha,headSha,'--']).toString()};
}
export async function snapshot(repo:string,ref:string,dest:string){
 await mkdir(dest,{recursive:true,mode:0o700});const entries=git(repo,['ls-tree','-r','-z',ref]).toString().split('\0').filter(Boolean);let total=0;
 for(const entry of entries){const tab=entry.indexOf('\t'),[mode,type,oid]=entry.slice(0,tab).split(' '),p=entry.slice(tab+1);relativePath(p);
  if(type!=='blob'||mode==='120000'||mode==='160000')throw Error('UNSUPPORTED_GIT_ENTRY');
  if(sensitivePath(p))throw Error('SENSITIVE_FILE_IN_SNAPSHOT');
  const bytes=git(repo,['cat-file','blob',oid!]);total+=bytes.length;if(total>100*1024*1024)throw Error('REPO_SIZE_LIMIT');
  await mkdir(path.dirname(path.join(dest,p)),{recursive:true,mode:0o700});await writeFile(path.join(dest,p),bytes,{mode:0o600,flag:'wx'});
 }
}

/** Freeze dirty bytes once, without changing the source index, refs, or worktree. */
export async function freezeDirty(repo:string,headSha:string){
 if(resolveRef(repo,'HEAD')!==headSha)throw Error('DIRTY_HEAD_MUST_BE_CHECKED_OUT_HEAD');
 const {safeRead,sha}=await import('../../packages/safe-io/index.ts');
 const names=git(repo,['ls-files','--cached','--others','--exclude-standard','-z']).toString().split('\0').filter(Boolean);
 const unique=[...new Set(names)].sort();for(const p of unique){relativePath(p);if(sensitivePath(p))throw Error('SENSITIVE_FILE_IN_DIRTY_SNAPSHOT');}
 const files=new Map<string,Buffer>();let bytes=0;const manifest:{path:string;bytes:number;sha256:string;untracked:boolean}[]=[];
 const tracked=new Set(git(repo,['ls-files','--cached','-z']).toString().split('\0'));
 for(const p of unique){let b:Buffer;try{b=await safeRead(repo,p,100*1024*1024);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT'&&tracked.has(p))continue;throw e;}
  bytes+=b.length;if(bytes>100*1024*1024)throw Error('REPO_SIZE_LIMIT');files.set(p,b);manifest.push({path:p,bytes:b.length,sha256:sha(b),untracked:!tracked.has(p)});
 }
 const snapshotId=sha(JSON.stringify({headSha,manifest}));let diff='';
 const headFiles=git(repo,['ls-tree','-r','--name-only','-z',headSha]).toString().split('\0').filter(Boolean);
 for(const p of [...new Set([...headFiles,...files.keys()])].sort()){
  const before=headFiles.includes(p)?git(repo,['show',`${headSha}:${p}`]):Buffer.alloc(0),after=files.get(p)??Buffer.alloc(0);
  if(before.equals(after))continue;
  diff+=`\ndiff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n`;
  if(before.includes(0)||after.includes(0)){diff+='Binary files differ\n';continue;}
  diff+=before.toString().split('\n').map(l=>'-'+l).join('\n')+'\n'+after.toString().split('\n').map(l=>'+'+l).join('\n')+'\n';
 }
 return {files,manifest,snapshotId,diff};
}
