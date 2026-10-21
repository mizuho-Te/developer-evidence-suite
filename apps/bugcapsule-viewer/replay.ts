// Untrusted snapshot data is parsed to an allowlisted inert structure, never HTML.
export function maskedReplay(target:string):string {
 if(!target.startsWith('masked-dom-v1:')||target.length>500000)return '';
 const allowed=new Set(['main','section','article','header','footer','nav','div','p','h1','h2','h3','ul','ol','li','button','a','label','form','fieldset','legend','table','tbody','tr','td','th','span']);
 let count=0;
 function render(node:unknown,depth:number):string {
  if(++count>2000||depth>40||!node||typeof node!=='object')return '';
  const n=node as Record<string,unknown>;
  if(typeof n.tag!=='string'||!allowed.has(n.tag)||!Array.isArray(n.children))return '';
  // Everything is a div: even source links/forms/buttons cannot navigate or submit.
  const children=n.children.slice(0,2000).map(c=>render(c,depth+1)).join('');
  return `<div class="masked-node" data-kind="${n.tag}"><small>${n.tag}</small>${children||'<span aria-label="マスク済み">████</span>'}</div>`;
 }
 try{return render(JSON.parse(target.slice('masked-dom-v1:'.length)),0);}catch{return '';}
}
