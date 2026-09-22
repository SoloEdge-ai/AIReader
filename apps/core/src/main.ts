import {resolve,join} from 'node:path';
import {createCore} from './server';
const core=createCore(process.env.AIREADER_DATA??join(process.env.LOCALAPPDATA??resolve('.local'),'AIReader'),process.env.AIREADER_WEB??resolve('dist/web'));
core.server.listen(Number(process.env.AIREADER_PORT??43120),'127.0.0.1',()=>{
  const a=core.server.address();if(typeof a==='object'&&a){const message={port:a.port};(process as NodeJS.Process&{parentPort?:{postMessage(value:unknown):void}}).parentPort?.postMessage(message);process.send?.(message);console.log(`AIReader Core: http://127.0.0.1:${a.port}`);}
});
process.on('SIGTERM',()=>{core.close();process.exit(0);});
