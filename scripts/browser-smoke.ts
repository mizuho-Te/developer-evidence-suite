import {chromium} from '@playwright/test';
import {mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {ROOT} from './fixtures.ts';
import {syntheticServer} from '../apps/bugcapsule-viewer/synthetic-server.ts';
const root=await mkdtemp(path.join(ROOT,'.runtime/isolated-browser-smoke-')),s=await syntheticServer(path.join(root,'synthetic'));
const profile=path.join(root,'fresh-profile'),extension=path.join(ROOT,'artifacts/bugcapsule-extension');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1366,height:768},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
try{
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
 const page=context.pages()[0]??await context.newPage();await page.goto(s.url);await page.waitForFunction(()=>document.querySelector('#status')?.textContent==='読み込み完了');
 const opened=await worker.evaluate(async()=>{const api=(globalThis as unknown as {chrome:{action:{openPopup:()=>Promise<void>}}}).chrome;try{await api.action.openPopup();return 'opened';}catch(e){return String(e);}});
 await new Promise(r=>setTimeout(r,500));console.log(JSON.stringify({browser:context.browser()?.version(),extensionId:id,popup:opened,pages:context.pages().map(p=>p.url()),profile}));
 await writeFile(path.join(ROOT,'artifacts/browser-smoke.json'),JSON.stringify({browser:context.browser()?.version(),extensionId:id,popup:opened,profile,sharedBrowserAttached:false,desktopOperated:false},null,2));
}finally{await context.close();await s.close();}
