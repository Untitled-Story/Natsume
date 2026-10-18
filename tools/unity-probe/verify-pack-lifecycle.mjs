import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../../', import.meta.url));
assert(process.argv[2], 'Provide a directory of local .noap files');
const directory = resolve(process.argv[2]);
const files = (await readdir(directory)).filter((file) => file.endsWith('.noap')).sort();
assert(files.length > 0, 'No .noap files found');
const server = await createServer({
  root: resolve(root, 'packages/playground'),
  server: { host: '127.0.0.1', port: 0 },
});
let browser;
const results = [];
try {
  await server.listen();
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0]);
  await page.locator('#file').setInputFiles(resolve(directory, files[0]));
  await page.locator('#status').filter({ hasText: '预览就绪' }).waitFor();
  await page.evaluate(async () => {
    const { app, effect } = (await import('/src/preview.ts')).getPreview();
    app.ticker.stop();
    const pack = effect.simulation.pack;
    effect.destroy();
    pack.dispose();
  });
  for (const file of files) {
    const bytes = await readFile(resolve(directory, file));
    const result = await page
      .evaluate(
        async ({ bytes, source }) => {
          const { loadPack } = await import('/@fs' + source + '/packages/natsume/src/index.ts');
          const { prewarmDuration } = await import(
            '/@fs' + source + '/packages/natsume/src/runtime/prewarm.ts'
          );
          const { scalar } = await import(
            '/@fs' + source + '/packages/natsume/src/runtime/parameters.ts'
          );
          const { app, runtime } = (await import('/src/preview.ts')).getPreview();
          const check = (condition, message) => {
            if (!condition) throw new Error(message);
          };
          const snapshot = (effect) =>
            [...effect.simulation.emitters.values()].map((e) => ({
              count: e.count,
              positions: Array.from(e.positions.subarray(0, e.count * 3)),
              ages: Array.from(e.ages.subarray(0, e.count)),
            }));
          let pack;
          const entries = [];
          try {
            pack = await loadPack(new Uint8Array(bytes));
            for (const entry of pack.document.entries) {
              let effect;
              try {
                effect = await runtime.instantiate(pack, {
                  entryId: entry.id,
                  seed: 12345,
                  parentLayout: { width: 640, height: 360 },
                  particleEnvironment: {
                    gravity: [0, -9.81, 0],
                    fog: { mode: 'none' },
                    viewPosition: [0, 0, -1000],
                  },
                });
                app.stage.addChild(effect.container);
                const systems = [...effect.simulation.emitters.values()];
                let horizon = 1,
                  drain = 1;
                for (const e of systems) {
                  if (!e.main.simulationSpeed) continue;
                  const lifetime = prewarmDuration({ ...e.main, loop: true, prewarm: true });
                  const delay = Math.max(
                    scalar(e.main.startDelay, 0, 0),
                    scalar(e.main.startDelay, 0, 1),
                  );
                  horizon = Math.max(
                    horizon,
                    (delay + e.main.durationSeconds * (e.main.loop ? 2 : 1) + lifetime) /
                      e.main.simulationSpeed,
                  );
                  drain = Math.max(drain, lifetime / e.main.simulationSpeed + 1);
                }
                check(
                  horizon <= 1000 && drain <= 1000,
                  'Lifecycle horizon exceeds 1000-second verification budget',
                );
                const steps = Math.ceil(horizon * 60) + 2;
                const inspect = () => {
                  for (const e of systems) {
                    check(e.count >= 0 && e.count <= e.ages.length, 'Particle capacity exceeded');
                    for (const field of [e.positions, e.velocities, e.rotations])
                      check(
                        field.subarray(0, e.count * 3).every(Number.isFinite),
                        'Non-finite particle state',
                      );
                    for (let i = 0; i < e.count; i++)
                      check(
                        e.ages[i] < e.lifetimes[i] && e.ages[i] >= 0,
                        'Expired particle retained',
                      );
                  }
                  check(effect.simulation.droppedSeconds === 0, 'Simulation time dropped');
                  check(app.renderer.gl.getError() === app.renderer.gl.NO_ERROR, 'WebGL error');
                };
                effect.play();
                let first;
                let peak = effect.particleCount;
                for (let frame = 1; frame <= steps; frame++) {
                  effect.update(1 / 60);
                  peak = Math.max(peak, effect.particleCount);
                  if (frame === 60) first = snapshot(effect);
                  if (frame % 10 === 0 || frame === steps) app.render();
                  if (frame % 60 === 0 || frame === steps) inspect();
                }
                effect.pause();
                const paused = JSON.stringify(snapshot(effect)),
                  time = effect.time;
                effect.update(1);
                check(
                  effect.time === time && JSON.stringify(snapshot(effect)) === paused,
                  'Pause changed particle state',
                );
                effect.play();
                effect.stop('drain');
                for (let frame = 0; frame < Math.ceil(drain * 60) + 2; frame++) {
                  effect.update(1 / 60);
                  if (frame % 10 === 0) app.render();
                }
                check(
                  effect.particleCount === 0 && effect.state === 'stopped',
                  'Stopped particles did not drain',
                );
                effect.restart();
                for (let frame = 0; frame < 60; frame++) effect.update(1 / 60);
                check(
                  JSON.stringify(snapshot(effect)) === JSON.stringify(first),
                  'Restart is not deterministic',
                );
                effect.stop('clear');
                check(
                  effect.particleCount === 0 && effect.state === 'stopped',
                  'Clear retained particles',
                );
                app.render();
                inspect();
                entries.push({
                  id: entry.id,
                  steps,
                  horizonSeconds: horizon,
                  drainSeconds: drain,
                  peakParticles: peak,
                  diagnostics: [...new Set(effect.diagnostics.map((d) => d.code))],
                });
              } finally {
                effect?.destroy();
              }
            }
          } finally {
            pack?.dispose();
          }
          await Promise.resolve();
          await Promise.resolve();
          check(
            runtime.instances.size === 0 &&
              runtime.textures.size === 0 &&
              runtime.retainedPixels === 0 &&
              app.stage.children.length === 0,
            'Resources retained after destruction',
          );
          return { entries, device: app.renderer.gl.getParameter(app.renderer.gl.RENDERER) };
        },
        { bytes: [...bytes], source: root.replace(/\/$/, '') },
      )
      .then(
        (value) => ({
          file,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          passed: true,
          ...value,
        }),
        (error) => ({ file, passed: false, error: error.message }),
      );
    results.push(result);
    if (!result.passed) console.log(file + ': ' + result.error);
    else if (results.length % 10 === 0)
      console.log(`Verified ${results.length}/${files.length} packages`);
  }
  const report = {
    measuredAt: new Date().toISOString(),
    sources: Object.fromEntries(
      await Promise.all(
        ['runtime/emitter.ts', 'runtime/runtime.ts', 'rendering/particle-mesh.ts'].map(
          async (path) => [
            path,
            createHash('sha256')
              .update(await readFile(resolve(root, 'packages/natsume/src', path)))
              .digest('hex'),
          ],
        ),
      ),
    ),
    fixedDelta: 1 / 60,
    drawEverySteps: 10,
    passed: results.filter((r) => r.passed).length,
    total: files.length,
    errors,
    results,
  };
  await mkdir(resolve(root, 'data/unity-baselines'), { recursive: true });
  await writeFile(
    resolve(root, 'data/unity-baselines/package-lifecycle.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(`Lifecycle: ${report.passed}/${report.total}; browser errors: ${errors.length}`);
  assert.equal(report.passed, report.total);
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await server.close();
}
