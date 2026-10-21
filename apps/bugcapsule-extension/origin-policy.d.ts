export interface OriginConfiguration {version:1;confirmed:true;allowedOrigins:string[]}
export const SYNTHETIC_ORIGIN:string;
export function exactOrigin(value:unknown):string;
export function approvedOrigins(config?:OriginConfiguration|null):string[];
export function recordingOrigin(url:string,config?:OriginConfiguration|null):string;
export function acceptsSession(message:any,sender:any,authorization:any,config?:OriginConfiguration|null):boolean;
