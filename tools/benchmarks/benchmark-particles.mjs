import { createServer } from 'vite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { cpus, platform, arch } from 'node:os';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../../', import.meta.url));
const outputDirectory = resolve(root, 'data/performance');

// CPU simulation benchmark, no frame scheduler or GPU timing. Run on one host.
const server = await createServer({
  root: resolve(root, 'packages/natsume'),
  configFile: false,
  server: { middlewareMode: true },
});
try {
  const { Emitter } = await server.ssrLoadModule('/src/runtime/emitter.ts');
  const { particleSource } = await server.ssrLoadModule('/tests/particle-fixtures.ts');
  const { Scene } = await server.ssrLoadModule('/src/runtime/scene.ts');
  const { minimalDocument } = await server.ssrLoadModule('/tests/helpers.ts');
  const document = minimalDocument();
  const scene = new Scene(
    {
      nodes: document.nodes,
      components: [],
      getNode: (id) => document.nodes.find((n) => n.id === id),
    },
    [1],
  );
  const source = particleSource('motion-limit-combined');
  source.main.maxParticles = 20_000;
  const emitter = new Emitter(3, scene.nodes.get(1), source, true, 123, false, []);
  emitter.sync();
  emitter.emitting = false;
  emitter.count = source.main.maxParticles;
  emitter.lifetimes.fill(1e9);
  emitter.positions.fill(0.5);
  emitter.velocities.fill(2);
  for (let i = 0; i < 80; i++) emitter.step(1 / 60);
  const milliseconds = [];
  for (let run = 0; run < 7; run++) {
    emitter.velocities.fill(2);
    const start = performance.now();
    for (let frame = 0; frame < 120; frame++) emitter.step(1 / 60);
    milliseconds.push((performance.now() - start) / 120);
  }
  milliseconds.sort((a, b) => a - b);
  const report = {
    scenario: 'synthetic-motion-limit-combined-v1',
    measuredAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: platform(),
      arch: arch(),
      cpu: cpus()[0]?.model,
    },
    fixedDelta: 1 / 60,
    warmupSteps: 80,
    sourceHash: createHash('sha256')
      .update(await readFile(resolve(root, 'packages/natsume/src/runtime/emitter.ts')))
      .digest('hex'),
    particles: emitter.count,
    storageBytes: [
      emitter.positions,
      emitter.velocities,
      emitter.startSizes,
      emitter.rotations,
      emitter.startColors,
      emitter.ages,
      emitter.lifetimes,
      emitter.serials,
    ].reduce((sum, array) => sum + array.byteLength, 0),
    framesPerRun: 120,
    runs: 7,
    medianMsPerStep: milliseconds[3],
    milliseconds,
  };
  await mkdir(outputDirectory, { recursive: true });
  const output = resolve(outputDirectory, `${process.argv[2] ?? 'current'}.json`);
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, output }));
} finally {
  await server.close();
}
