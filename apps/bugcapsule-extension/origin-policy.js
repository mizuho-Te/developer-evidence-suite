// Configuration is local only. This never grants Chrome host permissions.
export const SYNTHETIC_ORIGIN = 'http://127.0.0.1:47832';
export function exactOrigin(value) {
 if(typeof value!=='string'||value.length>2048||value.includes('*'))throw Error('EXACT_HTTP_ORIGIN_REQUIRED');
 let url;try{url=new URL(value);}catch{throw Error('EXACT_HTTP_ORIGIN_REQUIRED');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||value!==url.origin)throw Error('EXACT_HTTP_ORIGIN_REQUIRED');
 return url.origin;
}
export function approvedOrigins(config) {
 if(config===undefined||config===null)return [SYNTHETIC_ORIGIN];
 if(config.version!==1||config.confirmed!==true||!Array.isArray(config.allowedOrigins)||config.allowedOrigins.length<1||config.allowedOrigins.length>20)throw Error('ORIGIN_CONFIRMATION_REQUIRED');
 return [...new Set(config.allowedOrigins.map(exactOrigin))];
}
export function recordingOrigin(url,config) {
 let origin;try{const parsed=new URL(url);if(parsed.username||parsed.password)throw Error();origin=exactOrigin(parsed.origin);}catch{throw Error('UNSUPPORTED_PAGE');}
 if(!approvedOrigins(config).includes(origin))throw Error('ORIGIN_NOT_APPROVED');
 return origin;
}
export function acceptsSession(message,sender,authorization,config) {
 try{return message.type==='BC_STATUS'&&Number.isInteger(sender.tab?.id)&&sender.frameId===0&&authorization?.tabId===sender.tab.id&&authorization.sessionId===message.session?.sessionId&&authorization.origin===exactOrigin(sender.origin)&&message.session.origin===authorization.origin&&approvedOrigins(config).includes(authorization.origin);}catch{return false;}
}
