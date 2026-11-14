import './build.mjs';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve('.');
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.map':'application/json', '.mp4':'video/mp4', '.png':'image/png' };
createServer(async (req,res) => {
  try {
    const path = resolve(root, '.' + decodeURIComponent(new URL(req.url,'http://localhost').pathname === '/' ? '/index.html' : new URL(req.url,'http://localhost').pathname));
    if (!path.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const info = await stat(path);
    if (!info.isFile()) throw Error('Not a file');
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control':'no-cache' });
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(4317, '127.0.0.1', () => console.log('Local: http://127.0.0.1:4317'));
