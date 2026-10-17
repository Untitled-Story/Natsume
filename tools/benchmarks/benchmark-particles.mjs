import { createServer } from 'vite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { deserialize, serialize } from 'node:v8';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const outputDirectory = resolve(root, 'data/performance');

// CPU simulation benchmark, no frame scheduler or GPU timing. Run on one host.
const server = await createServer({
  root: resolve(root, 'packages/natsume'),
  configFile: false,
  server: { middlewareMode: true },
});
try {
  const { loadPack } = await server.ssrLoadModule('/src/loader/load.ts');
  const { Simulation } = await server.ssrLoadModule('/src/runtime/simulation.ts');
  const { Emitter } = await server.ssrLoadModule('/src/runtime/emitter.ts');
  const pack = await loadPack(new Uint8Array(await readFile(resolve(root, 'data/kirakira.noap'))));
  const simulation = new Simulation(pack, { seed: 123, approximateNoise: true });
  simulation.play();
  const original = simulation.emitters.get(76);
  const source = deserialize(serialize(original.source));
  source.main.maxParticles = 20_000;
  const emitter = new Emitter(76, original.node, source, true, 123, false, []);
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
    particles: emitter.count,
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
