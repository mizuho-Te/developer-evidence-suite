export const PACK_LIMIT:number;
export const REPORT_RESERVE:number;
export const DESCRIPTION_LIMITS:Readonly<{title:number;expected:number;actual:number}>;
export function validateDescriptions(value:{title:string;expected:string;actual:string}):void;
export function projectedExportBytes(eventBytes:number,eventCount:number):number;
export function assertPackBudget(files:Record<string,Uint8Array>):number;
