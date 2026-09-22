import {CodexAdapter} from '../apps/core/src/codex';import {resolve} from 'node:path';
const adapter=new CodexAdapter(resolve('.local/codex-control'));
try{await adapter.connect();console.log(JSON.stringify({connected:adapter.info.connected,version:adapter.info.version,loggedIn:!!adapter.info.account}));const result=await adapter.answer('请只回答：连接测试通过');console.log(JSON.stringify(result));}finally{adapter.disconnect();}
