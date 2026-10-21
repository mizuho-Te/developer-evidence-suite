import {parseArgs} from 'node:util';
import {serve} from '../packages/safe-io/server.ts';
const {values}=parseArgs({options:{root:{type:'string'},port:{type:'string',default:'47831'},entry:{type:'string',default:'report.html'}}});
if(!values.root)throw Error('--root is required');
const port=Number(values.port);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('INVALID_PORT');
const running=await serve(values.root,port,values.entry);console.log(running.url);process.once('SIGINT',()=>running.server.close());process.once('SIGTERM',()=>running.server.close());
