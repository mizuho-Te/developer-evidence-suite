import {readSession,retentionDays} from './retention.js';
import {acceptsSession} from './origin-policy.js';
// Serialize storage decisions so a navigation stop cannot be overwritten by a late status.
let pending=Promise.resolve();
const enqueue=action=>{pending=pending.then(action,action);return pending;};
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(message.type!=='BC_STATUS')return false;
 enqueue(async()=>{
  const previous=await readSession(chrome.storage.local);
  const {recordingAuthorization,originConfig,localRetentionDays}=await chrome.storage.local.get(['recordingAuthorization','originConfig','localRetentionDays']);
  if(!acceptsSession(message,sender,recordingAuthorization,originConfig)){reply({error:'SESSION_ORIGIN_NOT_AUTHORIZED'});return;}
  // The isolated-world recorder serializes only already masked events before this boundary.
  await chrome.storage.local.set({session:{...message.session,tabId:sender.tab.id,storedAt:Date.now(),expiresAt:previous?.sessionId===message.session.sessionId?previous.expiresAt:Date.now()+retentionDays(localRetentionDays)*86400000}});
  if(message.session.state==='DISCARDED')await chrome.storage.local.remove('recordingAuthorization');
  reply({ok:true});
 }).catch(()=>reply({error:'LOCAL_STORAGE_FAILED'}));return true;
});
async function stopTab(id,reason){
 const session=await readSession(chrome.storage.local);const {recordingAuthorization}=await chrome.storage.local.get('recordingAuthorization');
 if(recordingAuthorization?.tabId===id)await chrome.storage.local.remove('recordingAuthorization');
 if(session?.tabId===id&&['RECORDING','PAUSED'].includes(session.state))await chrome.storage.local.set({session:{...session,state:'REVIEW',reason}});
}
chrome.tabs.onRemoved.addListener(id=>enqueue(()=>stopTab(id,'TAB_CLOSED_RECORDING_STOPPED')));
chrome.tabs.onUpdated.addListener((id,change)=>{if(change.status==='loading')enqueue(()=>stopTab(id,'NAVIGATION_RECORDING_STOPPED_RESTART_REQUIRED'));});
