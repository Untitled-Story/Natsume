import assert from 'node:assert/strict';
import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(root, 'data/unity-baselines/timeline');
const native = JSON.parse(await readFile(resolve(output, 'unity-2022.3.21f1.json'), 'utf8'));
const source = resolve(output, 'source/Assets/TimelineProbe');
await mkdir(source, { recursive: true });
await cp(resolve(root, 'data/unity-timeline-probe/Assets/TimelineProbe'), source, {
  recursive: true,
});
await cp(
  resolve(root, 'data/unity-timeline-probe/Assets/TimelineProbeSource'),
  resolve(output, 'source/Assets/TimelineProbeSource'),
  { recursive: true },
);
await rm(resolve(output, 'source/Packages'), { recursive: true, force: true });
await rm(resolve(output, 'source/Assets/TimelineRuntime'), { recursive: true, force: true });
await cp(
  resolve(root, 'data/unity-timeline-probe/Assets/TimelineRuntime'),
  resolve(output, 'source/Assets/TimelineRuntime'),
  {
    recursive: true,
    filter: async (path) =>
      !path.endsWith('.meta') || /guid: [a-f0-9]{32}/.test(await readFile(path, 'utf8')),
  },
);
const compiler = process.env.NOA_BIN ?? resolve(root, '../Noa/target/debug/noa');
await mkdir(resolve(output, 'packages'), { recursive: true });
let cursor = 0;
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (cursor < native.cases.length) {
      const index = cursor++;
      const row = native.cases[index];
      const target = resolve(output, `packages/case${index}.noap`);
      await rm(target, { force: true });
      await new Promise((accept, reject) => {
        const child = spawn(
          compiler,
          [
            'compile',
            resolve(output, 'source', row.prefab),
            '--search',
            resolve(output, 'source'),
            '--output',
            target,
            '--json',
          ],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let message = '';
        child.stdout.on('data', (value) => {
          message += value;
        });
        child.stderr.on('data', (value) => {
          message += value;
        });
        child.once('error', reject);
        child.once('exit', (code) =>
          code === 0 ? accept() : reject(new Error(`${row.label}: ${message}`)),
        );
      });
      assert((await stat(target)).size > 0, `No package emitted for ${row.label}`);
    }
  }),
);
console.log(`Compiled ${native.cases.length} Timeline packages`);
