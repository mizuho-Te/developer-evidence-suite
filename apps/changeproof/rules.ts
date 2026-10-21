import type {Finding} from '../../packages/contracts/types.ts';
export function analyze(diff:string):Finding[]{
 const found:Finding[]=[];let file='unknown',line=1;
 function add(ruleId:string,reason:string){if(!found.some(f=>f.ruleId===ruleId&&f.file===file&&f.line===line))found.push({id:`finding-${found.length+1}`,ruleId,file,line,reason,severity:'review',suppressed:false});}
 for(const text of diff.split('\n')){
  if(text.startsWith('+++ b/')){file=text.slice(6);continue;}
  if(text.startsWith('--- '))continue;
  const hunk=/^@@ .*\+(\d+)/.exec(text);if(hunk){line=Number(hunk[1]);continue;}
  if(text.startsWith('+')){
   if(/"(?:strict\w*|noImplicitAny|noUncheckedIndexedAccess|exactOptionalPropertyTypes)"\s*:\s*false|"exclude"\s*:/.test(text))add('CP101','型検査設定の無効化または除外範囲の変更。対象差分を確認してください。');
   if(/\bany\b|@ts-(?:ignore|nocheck)|\bas\s+(?:unknown|any)\b/.test(text))add('CP102','型の安全性を弱める構文が追加されました。必要性を確認してください。');
   if(/\b(?:test|it|describe)\.(?:skip|only|todo)|\bx(?:test|it|describe)\(/.test(text))add('CP103','テストの skip / only / todo が追加されました。');
   if(/\bexpect\s*\(|\bassert[.(]/.test(text))add('CP104','期待値または assertion の変更です。正しい期待動作か確認してください。');
   if(/\|\|\s*(?:true|exit\s+0)|process\.exit\(0\)|"(?:test|typecheck|check)"\s*:\s*"(?:echo|true)/.test(text))add('CP105','検査の失敗を成功に置き換える可能性があります。');
  }else if(text.startsWith('-')&&!text.startsWith('---')){
   if(/\b(?:test|it|describe)\s*\(/.test(text))add('CP103','テストが削除または変更されています。base の独立検査を維持します。');
   if(/\bexpect\s*\(|\bassert[.(]/.test(text))add('CP104','assertion が削除または変更されています。');
   if(/"(?:test|typecheck|check)"\s*:/.test(text))add('CP105','検査コマンドが削除または変更されています。');
  }
  if(/^\+/.test(text)&&/(?:policy|vitest\.config|package\.json)/.test(file))add('CP105','検査定義の変更。信頼済み外部 policy と base の検査を維持します。');
  if(!text.startsWith('-')&&!text.startsWith('\\'))line++;
 }
 return found;
}
