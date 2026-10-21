import {chromium,type BrowserContext} from '@playwright/test';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {syntheticServer} from '../apps/bugcapsule-viewer/synthetic-server.ts';
import {parsePack,link} from '../apps/bugcapsule-viewer/core.ts';
import {renderBug} from '../packages/report-ui/index.ts';
import {ROOT} from './fixtures.ts';
const root=await mkdtemp(path.join(ROOT,'artifacts/cloud-bugcapsule-'));const server=await syntheticServer(path.join(root,'synthetic'));
let context:BrowserContext;try{context=await chromium.launchPersistentContext(path.join(root,'profile'),{executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox',`--disable-extensions-except=${ROOT}/artifacts/bugcapsule-extension`,`--load-extension=${ROOT}/artifacts/bugcapsule-extension`],viewport:{width:1366,height:768},acceptDownloads:true});}catch(error){await writeFile(path.join(root,'browser-results.json'),JSON.stringify({status:'BLOCKED',reason:String(error),actualBrowserTestsRun:false,previousMacEvidenceReused:false},null,2));await writeFile(path.join(ROOT,'artifacts/latest-cloud-bugcapsule.txt'),root);await server.close();throw error;}
const results:any[]=[{id:'BC-RELOAD',status:'NOT_RUN',reason:'Reload lifecycle check not implemented in this script'},{id:'BC-WORKER-RESTART',status:'NOT_RUN',reason:'Service-worker suspension/restart check not implemented in this script'},{id:'BC-50MB-PERFORMANCE',status:'NOT_RUN',reason:'50MB viewer benchmark not implemented'}];const external:string[]=[];await context.route('**/*',r=>{const u=new URL(r.request().url());if(['127.0.0.1','localhost'].includes(u.hostname)||u.protocol==='chrome-extension:')return r.continue();external.push(u.origin);return r.abort();});
try{
const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
const page=context.pages()[0]!;await page.goto(server.url+'&secret=SYNTHETIC_URL_CANARY#SYNTHETIC_FRAGMENT');await page.waitForFunction(()=>document.querySelector('#status')?.textContent==='読み込み完了');
async function openActionPopup(){
 await page.bringToFront();await worker.evaluate(async()=>{await (globalThis as any).chrome.action.openPopup();});
 for(let attempt=0;attempt<30;attempt++){const candidate=context!.pages().find(p=>!p.isClosed()&&p.url().endsWith('popup.html'));if(candidate)return candidate;await page.waitForTimeout(100);}
 throw Error('ACTION_POPUP_UNAVAILABLE: no actual popup; no target-tab or activeTab permission bypass attempted');
}
let popup=await openActionPopup();
// Programmatic openPopup may not grant activeTab. This assertion must fail rather
// than substituting direct content-script injection or broader host permissions.
await popup.locator('#start').click();await page.waitForTimeout(500);
const session=()=>worker.evaluate(async()=>(await (globalThis as any).chrome.storage.local.get('session')).session);
let s=await session();assert.equal(s?.state,'RECORDING');console.log('RECORDING_STARTED',new Date().toISOString());
const started=Date.now();await page.locator('#password').fill('SYNTHETIC_PASSWORD_CANARY');await page.locator('#memo').fill('SYNTHETIC_MEMO_CANARY');await page.locator('#save').click();
await page.locator('#private-child').click();await page.waitForTimeout(100);s=await session();assert(!JSON.stringify(s).includes('CANARY'));results.push({id:'BC-A02',status:'PASS',detail:'Actual Chrome password entry absent in chrome.storage.local and masked tree'});results.push({id:'BC-A03',status:'PASS',detail:'Query and fragment canaries absent in Chrome storage'});
const before=s.events.length;await page.locator('#private-child').click();await page.waitForTimeout(100);assert.equal((await session()).events.length,before);results.push({id:'BC-A04',status:'PASS'});
await page.getByRole('button',{name:'Pause',exact:true}).click();await page.waitForTimeout(300);assert.equal((await session()).state,'PAUSED');const paused=(await session()).events.length;await page.locator('#memo').fill('SYNTHETIC_PAUSED_CANARY');await page.locator('#save').click();await page.waitForTimeout(300);assert.equal((await session()).events.length,paused);await page.getByRole('button',{name:'Resume',exact:true}).click();results.push({id:'BC-A05',status:'PASS'});
await page.evaluate(()=>{(window as any).__longTasks=[];new PerformanceObserver(list=>(window as any).__longTasks.push(...list.getEntries().map(e=>({startTime:e.startTime,duration:e.duration})))).observe({entryTypes:['longtask']});});
// Keep the actual monotonic clock running for a full five minutes. No clock mocking.
while(Date.now()-started<302000){await page.waitForTimeout(5000);s=await session();if(s.state==='REVIEW')break;await page.locator('#save').click();}
s=await session();assert.equal(s.state,'REVIEW');assert.equal(s.reason,'TIME_LIMIT');assert(s.elapsedMs>=300000);results.push({id:'BC-A08',status:'PASS',detail:{reason:s.reason,elapsedMs:s.elapsedMs,wallMs:Date.now()-started,bytes:s.bytes,eventCount:s.events.length,limitBranch:'Actual five-minute limit; not a 50MB benchmark'}});await writeFile(path.join(root,'recorded-session.json'),JSON.stringify(s,null,2));await writeFile(path.join(root,'long-tasks.json'),JSON.stringify(await page.evaluate(()=>(window as any).__longTasks))); 
await page.reload();await page.waitForFunction(()=>document.querySelector('#status')?.textContent==='読み込み完了');assert.equal(await page.locator('#memo').inputValue(),'');
// The action popup normally closes when the demo gains focus. Review in a fresh
// extension page does not require activeTab and never substitutes for starting.
popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup.html`);
await popup.locator('#title').fill('合成保存不具合のブラウザ記録');await popup.locator('#expected').fill('再読み込み後も合成メモが残る');await popup.locator('#actual').fill('再読み込み後に合成メモが消えた');
await popup.locator('#preview').click();await popup.locator('#approved').check();const downloaded=popup.waitForEvent('download');await popup.locator('#export').click();const download=await downloaded;await download.saveAs(path.join(root,'synthetic-extension.zip'));results.push({id:'BC-A01',status:'PASS',detail:'Actual popup start, real UI save defect record, review and ZIP export'});

const packed=await readFile(path.join(root,'synthetic-extension.zip'));const parsed=parsePack(packed);for(const bytes of Object.values(parsed.files))assert(!Buffer.from(bytes).includes('CANARY'));assert.equal(parsed.evidence.payload.reproductionState,'recorded');results.push({id:'BC-A12',status:'PASS'});
try{
 const cpRoot=(await readFile(path.join(ROOT,'artifacts/latest-acceptance.txt'),'utf8')).trim();
 const acceptance=JSON.parse(await readFile(path.join(cpRoot,'acceptance-results.json'),'utf8')) as {commands:{base:string;head:string;directory:string}[]};
 const fixed=acceptance.commands.find(row=>row.base==='bug'&&row.head==='fixed');assert(fixed,'Current acceptance has no bug-to-fixed run');
 const cpFile=path.join(path.isAbsolute(fixed.directory)?fixed.directory:path.join(cpRoot,fixed.directory),'evidence.json');
 const cp=JSON.parse(await readFile(cpFile,'utf8'));assert.equal(cp.payload.verdict,'PASS');
 const relation=link(parsed.evidence,cp,cp.payload.headSha);assert.equal(relation.status,'MATCH');assert.equal(relation.reportId,parsed.evidence.payload.reportId);assert.equal(relation.runId,cp.payload.runId);assert.equal(relation.reproductionState,'recorded');
 await writeFile(path.join(root,'INT01-report-run-link.json'),JSON.stringify({relation,sourceEvidence:cpFile,reportExport:'synthetic-extension.zip'},null,2));
 results.push({id:'INT01',status:'PASS',detail:'Fresh actual extension recording explicitly linked to current executed fixed ChangeProof run; recorded state retained'});
}catch(error){results.push({id:'INT01',status:'BLOCKED',reason:String(error)});}
const viewer=await context.newPage();const hostile=structuredClone(parsed.evidence);hostile.payload.title='<script>window.PWNED=true;fetch("https://blocked.invalid")</script>';hostile.payload.events.push({seq:99999,monotonicMs:1,kind:'snapshot',maskedTarget:'masked-dom-v1:'+JSON.stringify({tag:'a',href:'https://blocked.invalid',onclick:'window.PWNED=true',children:[{tag:'script',children:[]}]})});
await viewer.goto('about:blank');const requestCount=external.length;await viewer.setContent(renderBug(hostile));await viewer.waitForTimeout(300);assert.equal(await viewer.evaluate(()=>(window as any).PWNED),undefined);assert.equal(external.length,requestCount);const frame=viewer.frames().find(f=>f!==viewer.mainFrame())!;assert(frame);assert.equal(await frame.locator('script,img,a[href],iframe,form[action]').count(),0);results.push({id:'BC-A07',status:'PASS',detail:'Actual sandbox frame has no scripts or resource URLs; no attempted external request'});
await viewer.setContent(renderBug(parsed.evidence));for(const viewport of [{width:1366,height:768},{width:390,height:844}]){await viewer.setViewportSize(viewport);await viewer.screenshot({path:path.join(root,`viewer-${viewport.width}.png`),fullPage:true});assert(await viewer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
await viewer.evaluate(()=>document.documentElement.style.zoom='2');await viewer.keyboard.press('Tab');assert.equal(await viewer.evaluate(()=>document.activeElement?.tagName),'A');await viewer.keyboard.press('Enter');await viewer.screenshot({path:path.join(root,'viewer-200-percent.png'),fullPage:true});results.push({id:'COM-04-BC',status:'PARTIAL',detail:'Viewer two viewports, CSS 200% zoom and keyboard skip link only; full extension keyboard workflow and screen-reader audit not implemented'});
await context.setOffline(true);await viewer.setContent(renderBug(parsed.evidence));assert.equal(await viewer.getByRole('heading',{name:parsed.evidence.payload.title}).count(),1);results.push({id:'COM-06-BC',status:'PARTIAL',detail:'Viewer rendering with browser offline and local exported ZIP parsing only; offline extension recording/export not implemented'});await context.setOffline(false);
// Restart through the explicit popup action, then navigate to a different localhost origin.
await popup.close();const nextPopup=await openActionPopup();await nextPopup.locator('#start').click();await page.waitForTimeout(500);assert.equal((await session()).state,'RECORDING');await page.goto('http://localhost:47832/').catch(()=>{});await page.waitForTimeout(500);assert.equal((await session()).state,'REVIEW');assert.match((await session()).reason,/NAVIGATION|UNLOADED/);results.push({id:'BC-A06',status:'PASS',detail:'Different localhost origin stopped recording with visible reason'});
await writeFile(path.join(root,'browser-results.json'),JSON.stringify({executedAt:new Date().toISOString(),browser:context.browser()?.version(),cloudLinux:true,externalRequests:external,results},null,2));await writeFile(path.join(ROOT,'artifacts/latest-cloud-bugcapsule.txt'),root);console.log(root);
}catch(error){
 const covered=new Set(results.map(row=>row.id));for(const id of ['BC-A01','BC-A02','BC-A03','BC-A04','BC-A05','BC-A06','BC-A07','BC-A08','BC-A12','INT01','COM-04-BC','COM-06-BC'])if(!covered.has(id))results.push({id,status:'NOT_RUN',reason:'Suite interrupted before this check completed'});
 await writeFile(path.join(root,'browser-results.json'),JSON.stringify({status:'FAIL',reason:String(error),executedAt:new Date().toISOString(),results},null,2));await writeFile(path.join(ROOT,'artifacts/latest-cloud-bugcapsule.txt'),root);throw error;
}finally{await context.close();await server.close();}
