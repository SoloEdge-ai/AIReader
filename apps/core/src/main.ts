import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = process.env.AIREADER_WEB ?? resolve('dist/web');
const server = createServer(async (req,res) => {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (pathname === '/api/health') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ok:true})); return; }
  const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + '/') && !file.startsWith(root + '\\')) { res.writeHead(403).end(); return; }
  try { const content = await readFile(file); res.setHeader('Content-Type', ({'.html':'text/html','.js':'text/javascript','.css':'text/css'} as Record<string,string>)[extname(file)] ?? 'application/octet-stream'); res.end(content); } catch { res.writeHead(404).end(); }
});
server.listen(Number(process.env.AIREADER_PORT ?? 43120), '127.0.0.1', () => { const a = server.address(); if (typeof a === 'object' && a) { (process as NodeJS.Process & {parentPort?:{postMessage(value:unknown):void}}).parentPort?.postMessage({port:a.port}); process.send?.({port:a.port}); console.log(`AIReader Core: ${a.port}`); } });
