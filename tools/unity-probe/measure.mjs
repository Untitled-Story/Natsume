import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const tool = dirname(fileURLToPath(import.meta.url));
const root = resolve(tool, '../..');
const directory = resolve(root, 'data/unity-baselines');
const events = resolve(directory, 'comparison-events.jsonl');
const modes = [
  '',
  'boundaries',
  'random',
  'shape',
  'basic-shapes',
  'rotation-prewarm',
  'sorting',
  'spaces',
  'sweeps',
  'noise-options',
  'rect-layout',
  'stretch',
  'noise-statistics',
  'custom-data',
];
async function run(command, args, env = process.env) {
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
  const code = await new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => accept(code ?? signal));
  });
  assert.equal(code, 0, `${command} ${args.join(' ')} failed`);
}
async function fingerprint(path) {
  const info = await stat(path);
  return {
    file: relative(root, path),
    modifiedAt: info.mtime.toISOString(),
    sha256: createHash('sha256')
      .update(await readFile(path))
      .digest('hex'),
  };
}
await mkdir(directory, { recursive: true });
if (process.argv.includes('--refresh-unity')) {
  assert(process.env.UNITY_EDITOR, 'Set UNITY_EDITOR for native remeasurement');
  for (const mode of modes)
    await run(process.execPath, [
      resolve(tool, 'probe-unity.mjs'),
      ...(mode ? ['--' + mode] : []),
      '--update-fixtures',
    ]);
}
// Fail before running comparisons when the full native or browser input is absent.
assert(
  (await stat(resolve(root, 'data/kirakira.noap')).catch(() => null))?.isFile(),
  'Browser measurement requires data/kirakira.noap',
);
const nativeRuns = [];
for (const mode of modes) {
  const path = resolve(
    directory,
    mode === 'rect-layout' ? 'layout' : mode,
    'unity-2022.3.21f1.json',
  );
  const data = await readFile(path, 'utf8').catch((error) => {
    throw new Error(`Missing native result: ${path}; run with --refresh-unity`, { cause: error });
  });
  assert.equal(JSON.parse(data).unityVersion, '2022.3.21f1', path);
  nativeRuns.push({
    mode: mode || 'curves-noise',
    ...(await fingerprint(path)),
    ...(mode === 'stretch'
      ? { cameraMotion: await fingerprint(resolve(directory, 'stretch/camera-motion.json')) }
      : {}),
  });
}
await writeFile(events, '');
for (const mode of modes) {
  const name = mode === 'rect-layout' ? 'layout' : mode || 'curves';
  const path = resolve(directory, 'fixtures', `unity-${name}.json`);
  assert((await stat(path).catch(() => null))?.isFile(), `Missing Unity fixture: ${path}`);
}
const env = { ...process.env, NATSUME_MEASUREMENTS: events };
await run('pnpm', ['test'], env);
await run('pnpm', ['exec', 'playwright', 'test'], env);
const entries = (await readFile(events, 'utf8'))
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));
assert(entries.length > 0, 'No comparisons were recorded');
const metrics = new Map();
for (const entry of entries) {
  assert(Number.isFinite(entry.error) && entry.error >= 0);
  let item = metrics.get(entry.metric);
  if (!item) {
    item = {
      metric: entry.metric,
      reference: entry.reference,
      unit: entry.unit,
      samples: 0,
      min: Infinity,
      max: -Infinity,
      sumSquares: 0,
      worstSample: '',
    };
    metrics.set(entry.metric, item);
  }
  assert.equal(item.unit, entry.unit);
  assert.equal(item.reference, entry.reference);
  item.samples++;
  item.min = Math.min(item.min, entry.error);
  item.sumSquares += entry.error ** 2;
  if (entry.error > item.max) {
    item.max = entry.error;
    item.worstSample = entry.sample;
  }
}
assert(
  [...metrics.keys()].some((key) => key.startsWith('renderer.')),
  'Browser comparisons were skipped',
);
const fixtures = [];
for (const file of (await readdir(resolve(root, 'data/unity-baselines/fixtures'))).sort()) {
  if (!file.startsWith('unity-') || !file.endsWith('.json')) continue;
  const path = resolve(root, 'data/unity-baselines/fixtures', file);
  fixtures.push({
    file: relative(root, path),
    sha256: createHash('sha256')
      .update(await readFile(path))
      .digest('hex'),
  });
}
const report = {
  unityVersion: '2022.3.21f1',
  measuredAt: new Date().toISOString(),
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  workingTreeChanges:
    execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length >
    0,
  nativeRuns,
  fixtures,
  metrics: [...metrics.values()]
    .sort((a, b) => a.metric.localeCompare(b.metric))
    .map(({ sumSquares, ...item }) => ({ ...item, rms: Math.sqrt(sumSquares / item.samples) })),
};
await writeFile(resolve(directory, 'measurements.json'), JSON.stringify(report, null, 2) + '\n');
console.log(
  `Recorded ${entries.length} scalar errors in ${report.metrics.length} metrics; ${relative(root, resolve(directory, 'measurements.json'))}`,
);
