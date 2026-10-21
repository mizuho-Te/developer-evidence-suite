export const DEFAULT_RETENTION_DAYS=7;
export function retentionDays(value=DEFAULT_RETENTION_DAYS){if(!Number.isInteger(value)||value<7||value>365)throw Error('RETENTION_DAYS_7_TO_365_REQUIRED');return value;}
export function expired(session,now=Date.now()){return !!session&&(!Number.isFinite(session.expiresAt)||session.expiresAt<=now);}
export async function readSession(storage,now=Date.now()){
 const {session}=await storage.get('session');
 if(expired(session,now)){await storage.remove('recordingAuthorization');await storage.remove('session');return null;}
 return session??null;
}
export function extendSession(session,days,now=Date.now()){if(!session||expired(session,now))throw Error('SESSION_EXPIRED');return {...session,expiresAt:Math.max(session.expiresAt,now+retentionDays(days)*86400000)};}
