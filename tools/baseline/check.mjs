import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path) => readFile(resolve(root, path), 'utf8');
const matrix = JSON.parse(await read('tools/baseline/modules.json'));
const pins = JSON.parse(await read('tools/baseline/pins.json'));
const sha = (value) => createHash('sha256').update(value).digest('hex');
const readme = await read('README.md');
const schema = await read('packages/natsume/schemas/noir.fbs');
assert.equal(matrix.modules.length, 24);
assert.equal(new Set(matrix.modules.map((m) => m.name)).size, 24);
for (const status of ['Supported', 'Partial', 'Unsupported']) {
  const names = matrix.modules
    .filter((m) => m.status === status)
    .map((m) => m.name)
    .sort();
  assert.equal(names.length, matrix.counts[status]);
  const section = readme.split(`### ${status}\n`)[1]?.split(/\n#{2,3} /)[0];
  assert(section, `Missing README section: ${status}`);
  const documented = section
    .split('\n')
    .filter((line) => line.startsWith('| '))
    .map((line) => line.split('|')[1].trim())
    .filter((name) => name !== '模块' && !/^[-:]+$/.test(name))
    .sort();
  assert.deepEqual(documented, names, `README classification differs: ${status}`);
}
for (const module of matrix.modules) {
  if (module.wire) assert(new RegExp(`table ${module.wire}\\b`).test(schema), module.name);
  if (module.status !== 'Unsupported') {
    assert(module.supported.length > 0 && module.tests.length > 0, module.name);
  }
  for (const path of [...module.implementation, ...module.tests]) await access(resolve(root, path));
}
for (const [path, expected] of Object.entries(pins.files))
  assert.equal(sha(await readFile(resolve(root, path))), expected, `Pinned data changed: ${path}`);
for (const [name, expected] of Object.entries(pins.noa.sha256))
  assert.equal(sha(await readFile(resolve(root, 'packages/natsume/schemas', name))), expected);
for (const [name, count] of [
  ['boundaries', 37],
  ['random', 14],
  ['shape', 14],
]) {
  const fixture = JSON.parse(await read(`packages/natsume/tests/fixtures/unity-${name}.json`));
  assert.equal(fixture.unityVersion, pins.unityVersion);
  assert.equal(fixture.cases.length, count);
}
// Optional upstream verification; ordinary checks do not require a sibling checkout.
if (process.env.NATSUME_NOA_ROOT) {
  for (const [path, expected] of Object.entries(pins.exporterFiles)) {
    const source = execFileSync('git', [
      '-C',
      process.env.NATSUME_NOA_ROOT,
      'show',
      `${pins.noa.commit}:${path}`,
    ]);
    assert.equal(sha(source), expected, `Pinned Noa source changed: ${path}`);
  }
}
console.log(
  JSON.stringify({
    stage: matrix.stage,
    modules: matrix.modules.length,
    counts: matrix.counts,
    pinnedFiles: Object.keys(pins.files).length,
    upstreamVerified: Boolean(process.env.NATSUME_NOA_ROOT),
  }),
);
