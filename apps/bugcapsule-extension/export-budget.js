export const PACK_LIMIT=50*1024*1024;
export const REPORT_RESERVE=256*1024;
export const DESCRIPTION_LIMITS=Object.freeze({title:200,expected:10000,actual:10000});
export function validateDescriptions(value){for(const [key,limit] of Object.entries(DESCRIPTION_LIMITS))if(typeof value[key]!=='string'||value[key].length>limit)throw Error('DESCRIPTION_TOO_LONG_'+key.toUpperCase());}
// Events appear twice: report JSON and JSONL. Compact JSON keeps this bound stable.
export function projectedExportBytes(eventBytes,eventCount){return 2*eventBytes+2*eventCount+REPORT_RESERVE;}
export function assertPackBudget(files){const total=Object.values(files).reduce((sum,bytes)=>sum+bytes.byteLength,0);if(total>PACK_LIMIT)throw Error('EXPORT_SIZE_LIMIT');return total;}
