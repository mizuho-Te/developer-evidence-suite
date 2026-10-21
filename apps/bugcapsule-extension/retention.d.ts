export const DEFAULT_RETENTION_DAYS:number;
export function retentionDays(value?:number):number;
export function expired(session:any,now?:number):boolean;
export function readSession(storage:any,now?:number):Promise<any>;
export function extendSession(session:any,days:number,now?:number):any;
