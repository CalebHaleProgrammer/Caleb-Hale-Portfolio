import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
await mkdir('.cache', { recursive: true });
await build({entryPoints:['tests/core.test.ts','tests/pipeline.test.ts','tests/authoring.test.ts','tests/unification.test.ts'],bundle:true,platform:'node',format:'esm',outdir:'.cache',outExtension:{'.js':'.mjs'}});
const result=spawnSync(process.execPath,['--test','.cache/core.test.mjs','.cache/pipeline.test.mjs','.cache/authoring.test.mjs','.cache/unification.test.mjs'],{stdio:'inherit'});
process.exitCode=result.status;
