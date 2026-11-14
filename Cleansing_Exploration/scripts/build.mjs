import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/app.ts', 'src/media-worker.ts', 'src/pipeline/dev/harness.ts'], outbase:'src', bundle: true, outdir: 'dist', format: 'esm', target: 'es2022', sourcemap: true, splitting: true, chunkNames: 'chunks/[name]-[hash]' });
await writeFile('dist/app.css',await readFile('src/style.css','utf8')+'\n'+await readFile('src/pipeline/ui/editor.css','utf8'));
await import('./notices.mjs');
console.log('Built Cutline → dist/');
