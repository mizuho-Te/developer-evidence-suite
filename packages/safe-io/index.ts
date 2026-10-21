import {createHash,randomUUID} from 'node:crypto';
import {readFile,lstat,mkdir,writeFile,rename,realpath} from 'node:fs/promises';
import path from 'node:path';
import {zipSync,unzipSync} from 'fflate';
import type {Artifact} from '../contracts/types.ts';
export const LIMIT=50*1024*1024;
export function sha(bytes:Uint8Array|string):string{return createHash('sha256').update(bytes).digest('hex');}
export function relativePath(p:string):string {
 if(!p||p.includes('\\')||p.includes('\0')||p.includes(':')||p.startsWith('/')||p.split('/').some(s=>!s||s==='.'||s==='..'))throw Error('UNSAFE_PATH');
 return p;
}
export async function safeRead(root:string,p:string,limit=LIMIT):Promise<Buffer>{
 relativePath(p); const base=await realpath(root); let cursor=base;
 for(const part of p.split('/')){cursor=path.join(cursor,part);if((await lstat(cursor)).isSymbolicLink())throw Error('SYMLINK_REJECTED');}
 const s=await lstat(cursor);if(!s.isFile()||s.size>limit)throw Error('FILE_LIMIT'); return readFile(cursor);
}
export async function atomic(file:string,bytes:string|Uint8Array){await mkdir(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,bytes,{mode:0o600,flag:'wx'});await rename(tmp,file);}
export function json(bytes:Uint8Array|string):unknown {if(Buffer.byteLength(bytes)>LIMIT)throw Error('JSON_LIMIT');return JSON.parse(typeof bytes==='string'?bytes:Buffer.from(bytes).toString('utf8')) as unknown;}
export function artifact(p:string,bytes:Uint8Array,mediaType='application/octet-stream'):Artifact{return {path:relativePath(p),bytes:bytes.length,sha256:sha(bytes),mediaType};}
export function redact(s:string,secrets:string[]=[]):string {
 let out=s.replace(/\x1b\[[0-9;]*m/g,'');
 for(const value of secrets.filter(v=>v.length>=4).sort((a,b)=>b.length-a.length))out=out.split(value).join('[REDACTED]');
 return out.replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{12,})\b/g,'[REDACTED]')
 .replace(/(authorization\s*[:=]\s*(?:bearer\s+)?|(?:password|secret|token|api[_-]?key)\s*[:=]\s*)[^\s,;"']+/gi,'$1[REDACTED]');
}
export function pack(files:Record<string,Uint8Array>):Uint8Array{for(const p of Object.keys(files))relativePath(p);return zipSync(files,{level:6});}
// Inspect central directory BEFORE decompression, including Unix symlink modes.
export function unpack(bytes:Uint8Array,limit=LIMIT):Record<string,Uint8Array>{
 if(bytes.length>limit)throw Error('ARCHIVE_LIMIT');const b=Buffer.from(bytes);let end=-1;
 for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(b.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0||end+22+b.readUInt16LE(end+20)!==b.length)throw Error('INVALID_ZIP');
 const count=b.readUInt16LE(end+10),offset=b.readUInt32LE(end+16),size=b.readUInt32LE(end+12);
 if(count>10000||b.readUInt16LE(end+4)||b.readUInt16LE(end+6)||offset+size!==end)throw Error('ZIP_STRUCTURE');
 let at=offset,total=0;const seen=new Set<string>();const metadata=new Map<string,number>();
 for(let i=0;i<count;i++){
  if(at+46>end||b.readUInt32LE(at)!==0x02014b50)throw Error('ZIP_DIRECTORY');
  const n=b.readUInt16LE(at+28),extra=b.readUInt16LE(at+30),comment=b.readUInt16LE(at+32),length=b.readUInt32LE(at+24),flags=b.readUInt16LE(at+8),mode=b.readUInt32LE(at+38)>>>16;
  const p=b.subarray(at+46,at+46+n).toString('utf8'); relativePath(p);
  if(seen.has(p.toLowerCase())||(mode&0xf000)===0xa000||flags&1)throw Error('ZIP_UNSAFE_ENTRY');
  seen.add(p.toLowerCase());metadata.set(p,length);total+=length;if(total>limit||length===0xffffffff)throw Error('EXPANSION_LIMIT');
  at+=46+n+extra+comment;
 }
 if(at!==end)throw Error('ZIP_DIRECTORY_LENGTH');
 const files=unzipSync(bytes); if(Object.keys(files).length!==count)throw Error('ZIP_COUNT');
 for(const [p,value] of Object.entries(files))if(metadata.get(p)!==value.length)throw Error('ZIP_SIZE');
 return files;
}
