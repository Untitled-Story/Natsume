import assert from 'node:assert/strict';
import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyUnityBaseline } from './verify-unity-baseline.mjs';

const tool = dirname(fileURLToPath(import.meta.url));
const root = resolve(tool, '../..');
const version = '2022.3.21f1';
const fitting = process.argv.includes('--noise-fit');
const layout = process.argv.includes('--prefab-layout');
const boundaries = process.argv.includes('--boundaries');
const distributions = process.argv.includes('--random');
const shape = process.argv.includes('--shape');
const basicShapes = process.argv.includes('--basic-shapes');
const rotationPrewarm = process.argv.includes('--rotation-prewarm');
assert(
  Number(fitting) +
    Number(layout) +
    Number(boundaries) +
    Number(distributions) +
    Number(shape) +
    Number(basicShapes) +
    Number(rotationPrewarm) <=
    1,
  'Choose one probe mode',
);
const editor = process.env.UNITY_EDITOR;
assert(editor, 'Set UNITY_EDITOR to the Unity executable inside Unity.app/Contents/MacOS/Unity');
const project = resolve(root, 'data/unity-probe');
const output = resolve(
  root,
  'data/unity-baselines',
  basicShapes
    ? 'basic-shapes'
    : rotationPrewarm
      ? 'rotation-prewarm'
      : layout
        ? 'prefab-layout'
        : boundaries
          ? 'boundaries'
          : distributions
            ? 'random'
            : shape
              ? 'shape'
              : '.',
);
const baseline = resolve(output, fitting ? 'noise-fit-output.json' : `unity-${version}.json`);
await mkdir(output, { recursive: true });
await cp(resolve(tool, 'project'), project, { recursive: true });
const prefabSource = resolve(
  process.env.NATSUME_PREFAB_SOURCE ?? resolve(root, '../Noa/data/scenario/effect/kirakira_01_rip'),
);
if (layout) {
  await cp(prefabSource, resolve(project, 'Assets/KirakiraLayout'), { recursive: true });
}
let previous;
try {
  previous = JSON.parse(await readFile(baseline, 'utf8'));
  // Preserve the last run and require a fresh file from this editor invocation.
  await rename(baseline, `${baseline}.previous`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const log = resolve(output, 'editor.log');
console.log(`Running Unity ${version}; editor log: ${log}`);
const child = spawn(
  editor,
  [
    '-batchmode',
    ...(layout || boundaries || distributions ? [] : ['-nographics']),
    '-noUpm',
    '-projectPath',
    project,
    '-executeMethod',
    basicShapes
      ? 'NatsumeBasicShapeProbe.Run'
      : rotationPrewarm
        ? 'NatsumeRotationPrewarmProbe.Run'
        : shape
          ? 'NatsumeShapeProbe.Run'
          : distributions
            ? 'NatsumeRandomProbe.Run'
            : layout
              ? 'NatsumePrefabLayoutProbe.Run'
              : boundaries
                ? 'NatsumeBoundaryProbe.Run'
                : fitting
                  ? 'NatsumeNoiseFitProbe.Run'
                  : 'NatsumeProbe.Run',
    '-quit',
    '-logFile',
    log,
  ],
  { stdio: 'inherit' },
);
await new Promise((accept, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) =>
    code === 0
      ? accept()
      : reject(new Error(`Unity exited with ${signal ?? code}; inspect ${log}`)),
  );
});
const current = JSON.parse(await readFile(baseline, 'utf8'));
assert.equal(current.unityVersion, version);
if (basicShapes || rotationPrewarm) {
  assert.equal(current.cases.length, basicShapes ? 31 : 9);
  if (process.argv.includes('--update-fixtures'))
    await writeFile(
      resolve(
        root,
        `packages/natsume/tests/fixtures/unity-${basicShapes ? 'basic-shapes' : 'rotation-prewarm'}.json`,
      ),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log(`Particle measurements: ${current.cases.length} cases, ${baseline}`);
  process.exit(0);
}
if (shape) {
  assert.equal(current.cases.length, 14);
  assert(current.cases.every((c) => c.positions.length > 0));
  if (process.argv.includes('--update-fixtures')) {
    const cases = current.cases.map((c) => {
      if (c.label.startsWith('spread-')) return c;
      const offsets = c.positions.map((p, i) => [
        p.x - 4 - c.radius * c.velocities[i].x,
        p.y - 5 - c.radius * c.velocities[i].y,
        p.z - 6 - c.radius * c.velocities[i].z,
      ]);
      const mean = [0, 1, 2].map((a) => offsets.reduce((s, p) => s + p[a], 0) / offsets.length);
      const secondMoment = [0, 1, 2].map(
        (a) => offsets.reduce((s, p) => s + p[a] * p[a], 0) / offsets.length,
      );
      const radiusSquared = offsets.map((p) => p.reduce((s, v) => s + v * v, 0));
      const radiusSquaredMean = radiusSquared.reduce((s, v) => s + v, 0) / offsets.length;
      const radiusSquaredVariance =
        radiusSquared.reduce((s, v) => s + (v - radiusSquaredMean) ** 2, 0) / offsets.length;
      return {
        label: c.label,
        radius: c.radius,
        jitter: c.jitter,
        scale: c.scale,
        rotated: c.rotated,
        count: offsets.length,
        mean,
        secondMoment,
        radiusSquaredMean,
        radiusSquaredVariance,
      };
    });
    await writeFile(
      resolve(root, 'packages/natsume/tests/fixtures/unity-shape.json'),
      JSON.stringify({ unityVersion: current.unityVersion, cases }, null, 2) +
        String.fromCharCode(10),
    );
  }
  console.log('Shape measurements: ' + current.cases.length + ' cases, ' + baseline);
  process.exit(0);
}
if (distributions) {
  assert.equal(current.cases.length, 14);
  assert(current.cases.every((c) => c.count === 16384 && c.distributions.length === 17));
  if (process.argv.includes('--update-fixtures')) {
    await mkdir(resolve(root, 'packages/natsume/tests/fixtures'), { recursive: true });
    const cases = current.cases.map((c) => ({
      ...c,
      correlations: c.correlations.filter((r) => Math.abs(r.value) > 0.1),
    }));
    await writeFile(
      resolve(root, 'packages/natsume/tests/fixtures/unity-random.json'),
      JSON.stringify({ unityVersion: current.unityVersion, cases }, null, 2) +
        String.fromCharCode(10),
    );
  }
  console.log('Random distributions: ' + current.cases.length + ' cases, ' + baseline);
  process.exit(0);
}
if (boundaries) {
  assert.notEqual(current.graphicsDevice, 'Null');
  assert(current.cases.length >= 24);
  assert(current.cases.every((sample) => sample.samples.length > 1));
  if (process.argv.includes('--update-fixtures')) {
    const cases = current.cases.map((sample) => ({
      label: sample.label,
      samples: sample.samples
        .filter((s) =>
          /motion|appearance|stretch|mesh-(view|world)/.test(sample.label)
            ? [0, 1, 4, 30, 59].includes(s.frame)
            : true,
        )
        .map((s) =>
          /motion|appearance|stretch|mesh-(view|world)/.test(sample.label)
            ? {
                frame: s.frame,
                positions: s.positions,
                velocities: s.velocities,
                sizes: s.sizes,
                colors: s.colors,
                ...(/appearance|stretch|mesh-(view|world)/.test(sample.label)
                  ? { vertices: s.vertices, uv: s.uv }
                  : {}),
              }
            : sample.label.startsWith('sheet-')
              ? { frame: s.frame, uv: s.uv }
              : { frame: s.frame, count: s.count },
        ),
    }));
    await mkdir(resolve(root, 'packages/natsume/tests/fixtures'), { recursive: true });
    await writeFile(
      resolve(root, 'packages/natsume/tests/fixtures/unity-boundaries.json'),
      `${JSON.stringify(
        {
          unityVersion: current.unityVersion,
          source:
            'NatsumeBoundaryProbe.cs; fixed dt 1/60; native measurements, not calculated expectations',
          cases,
        },
        null,
        2,
      )}\n`,
    );
  }
  console.log(`Boundary measurements: ${current.cases.length} cases, ${baseline}`);
  process.exit(0);
}
if (layout) {
  const sourceHash = createHash('sha256')
    .update(await readFile(resolve(prefabSource, 'kirakira_01.prefab')))
    .digest('hex');
  assert.equal(current.prefabSha256, sourceHash, 'The imported prefab must match the source');
  assert.notEqual(current.graphicsDevice, 'Null');
  assert(current.cases.some((sample) => sample.systems.some((system) => system.count > 0)));
  console.log(`Native prefab placement measurements and PNGs: ${output}`);
  process.exit(0);
}
if (fitting) {
  console.log(`Noise measurements: ${current.cases.length} cases, ${baseline}`);
  process.exit(0);
}
const report = verifyUnityBaseline(current);
if (previous?.unityVersion === version) {
  // Labels and probe metadata can evolve; compare unchanged numerical cases.
  let compared = 0;
  for (const sample of current.noise) {
    const prior = previous.noise.find((item) => item.label === sample.label);
    if (prior) {
      assert.deepEqual(sample, prior, `Noise changed across editor runs: ${sample.label}`);
      compared++;
    }
  }
  report.repeatedNoiseCases = compared;
}
await writeFile(resolve(output, 'verification.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
