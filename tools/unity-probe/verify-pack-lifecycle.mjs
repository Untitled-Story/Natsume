import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

const root = fileURLToPath(new URL('../../', import.meta.url));
assert(process.argv[2], 'Provide a directory of local .noap files');
const directory = resolve(process.argv[2]);
const sortingLayers = process.argv[3]
  ? JSON.parse(await readFile(resolve(process.argv[3]), 'utf8'))
  : undefined;
const reportPath = resolve(
  process.argv[4] ?? resolve(root, 'data/unity-baselines/package-lifecycle.json'),
);
const inventoryArgument = process.argv.indexOf('--inventory');
const compilerArgument = process.argv.indexOf('--compiler-root');
const requireAll = process.argv.includes('--require-all');
const captureFrames = process.argv.includes('--capture-frames');
const metal = process.argv.includes('--metal');
const inventoryBytes =
  inventoryArgument >= 0 ? await readFile(resolve(process.argv[inventoryArgument + 1])) : undefined;
const inventory = inventoryBytes ? JSON.parse(inventoryBytes) : undefined;
const compilerRoot = compilerArgument >= 0 ? resolve(process.argv[compilerArgument + 1]) : root;
const inventoryEntries =
  inventory?.results.flatMap((bundle) =>
    bundle.entries.map((entry) => ({
      ...entry,
      bundle: bundle.bundle,
      output: resolve(compilerRoot, entry.output),
    })),
  ) ?? [];
if (inventory) {
  assert.equal(inventory.results.length, 356, 'Fixed inventory must include 356 effects');
  assert.equal(inventoryEntries.length, 391, 'Fixed inventory must include 391 prefab entries');
  assert.equal(
    new Set(inventoryEntries.map((entry) => entry.output)).size,
    391,
    'Duplicate package output',
  );
  assert(
    inventoryEntries.every((entry) => entry.sha256 && entry.prefab),
    'Inventory must identify every package and source prefab',
  );
}
const files = inventory
  ? inventoryEntries.map((entry) => entry.output)
  : (await readdir(directory, { recursive: true })).filter((file) => file.endsWith('.noap')).sort();
const frameDirectory = resolve(dirname(reportPath), 'frames');
assert(files.length > 0, 'No .noap files found');
const server = await createServer({
  root: resolve(root, 'packages/playground'),
  server: { host: '127.0.0.1', port: 0, hmr: false, ws: false },
});
let browser;
const results = [];
try {
  await server.listen();
  browser = await chromium.launch(
    metal ? { channel: 'chromium', args: ['--use-angle=metal'] } : {},
  );
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0]);
  await page.evaluate(
    async (source) => {
      globalThis.__natsumeLifecycle = await (
        await import('/@fs' + source + '/packages/natsume/tests/browser/playback-harness.ts')
      ).createPlaybackHarness();
    },
    root.replace(/\/$/, ''),
  );
  const renderer = await page.evaluate(() => {
    const gl = globalThis.__natsumeLifecycle.app.renderer.gl;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  });
  for (const [fileIndex, file] of files.entries()) {
    const bytes = await readFile(resolve(directory, file));
    const packageSha256 = createHash('sha256').update(bytes).digest('hex');
    if (inventory)
      assert.equal(
        packageSha256,
        inventoryEntries[fileIndex].sha256,
        'Package differs from the fixed inventory: ' + file,
      );
    const result = await page
      .evaluate(
        async ({ bytes, source, sortingLayers, captureFrames }) => {
          const { loadPack } = await import('/@fs' + source + '/packages/natsume/src/index.ts');
          const { prewarmDuration } = await import(
            '/@fs' + source + '/packages/natsume/src/runtime/prewarm.ts'
          );
          const { scalar } = await import(
            '/@fs' + source + '/packages/natsume/src/runtime/parameters.ts'
          );
          const { ComponentData } = await import(
            '/@fs' + source + '/packages/natsume/src/format/generated/noa/ir.ts'
          );
          const { timelineDuration } = await import(
            '/@fs' + source + '/packages/natsume/src/runtime/timeline-time.ts'
          );
          const { app, runtime } = globalThis.__natsumeLifecycle;
          app.renderer.background.alpha = 0;
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
          const hostBindings = [];
          try {
            pack = await loadPack(new Uint8Array(bytes));
            // Explicit declarations belong to this stationary test host, not the prefab.
            // Unknown game C# is not executed or inferred by this harness.
            for (const identity of [
              {
                assembly: 'Assembly-CSharp',
                namespace: 'Sekai.Core.Live',
                className: 'ParticleShaderSettings',
              },
              { assembly: 'Assembly-CSharp', namespace: 'Sekai', className: 'ScenarioEffector' },
              { assembly: 'Assembly-CSharp', namespace: 'Sekai', className: 'ParentRectFitter' },
            ])
              runtime.registerScript(
                identity,
                ({ node }) => {
                  const fields = {};
                  hostBindings.push({ nodeId: node.id, identity, fields });
                  return {
                    onAnimatedField(name, value) {
                      fields[name] = value;
                    },
                  };
                },
                identity.className === 'ParticleShaderSettings'
                  ? { animatedFields: { mode: 'int' } }
                  : {},
              );
            for (const entry of pack.document.entries) {
              let effect, other;
              const keyframes = [];
              try {
                const options = {
                  entryId: entry.id,
                  seed: 12345,
                  renderEnvironment: { globalMipBias: 0, sortingLayers },
                  canvasEnvironment: {
                    displays: { 0: { width: 640, height: 360 } },
                    mainCamera: {
                      viewMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, -1000, 1],
                      projectionMatrix: [
                        2 / 640,
                        0,
                        0,
                        0,
                        0,
                        2 / 360,
                        0,
                        0,
                        0,
                        0,
                        -2 / 1999.9,
                        0,
                        0,
                        0,
                        -2000.1 / 1999.9,
                        1,
                      ],
                    },
                  },
                  parentLayout: { width: 640, height: 360 },
                  particleEnvironment: {
                    // Explicit stationary test world; the game supplies its own velocities.
                    rigidbodyVelocities: Object.fromEntries(
                      pack.components.flatMap((component) =>
                        component.dataType === ComponentData.ParticleSystem &&
                        component.data.main.hostRigidbodyVelocitySlot
                          ? [[component.data.main.hostRigidbodyVelocitySlot, [0, 0, 0]]]
                          : [],
                      ),
                    ),
                    fixedDeltaSeconds: 0.02,
                    gravity: [0, -9.81, 0],
                    fog: { mode: 'none' },
                    viewPosition: [0, 0, -1000],
                  },
                };
                const compatibility = runtime.checkCompatibility(pack, options);
                if (
                  !compatibility.compatible ||
                  compatibility.issues.some((issue) => issue.code === 'UNKNOWN_SCRIPT')
                ) {
                  entries.push({
                    id: entry.id,
                    blocked: compatibility.issues.filter(
                      (i) => i.severity === 'error' || i.code === 'UNKNOWN_SCRIPT',
                    ),
                  });
                  continue;
                }
                effect = await runtime.instantiate(pack, options);
                app.stage.addChild(effect.container);
                const screenSpace = pack.components.some(
                  (c) => c.dataType === ComponentData.Canvas || c.dataType === ComponentData.Camera,
                );
                effect.container.position.set(screenSpace ? 0 : 320, screenSpace ? 0 : 180);
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
                for (const clip of pack.document.animations)
                  horizon = Math.max(horizon, clip.durationSeconds * (clip.loop ? 2 : 1) + 1 / 60);
                for (const component of pack.components)
                  if (component.dataType === ComponentData.PlayableDirector)
                    horizon = Math.max(
                      horizon,
                      (component.data.timeline ? timelineDuration(component.data.timeline) : 0) *
                        (component.data.wrap === 1 ? 2 : 1) +
                        1 / 60,
                    );
                check(
                  horizon <= 1000 && drain <= 1000,
                  'Lifecycle horizon exceeds 1000-second verification budget',
                );
                const steps = Math.ceil(horizon * 60) + 2;
                const captures = new Set([0, 1, 60, Math.ceil(steps / 2), steps]);
                const capture = (label, frame) => {
                  app.render();
                  inspect();
                  const meshes = [...effect.meshes, ...effect.auxiliaryMeshes];
                  let visibleMeshes = 0,
                    indices = 0,
                    minX = Infinity,
                    minY = Infinity,
                    maxX = -Infinity,
                    maxY = -Infinity;
                  for (const mesh of meshes) {
                    if (!mesh.visible) continue;
                    visibleMeshes++;
                    const attribute = mesh.geometry.getAttribute('aPosition');
                    const data = attribute.buffer.data;
                    const order = mesh.geometry.indexBuffer?.data;
                    const stride = (attribute.stride || 12) / 4,
                      offset = (attribute.offset || 0) / 4;
                    const count = mesh.geometry.indexCount ?? order?.length ?? 0;
                    const matrix = mesh.shader.resources.colorUniforms.uniforms.uDisplayWorld;
                    for (let i = 0; i < count; i++) {
                      const vertex = (order?.[i] ?? i) * stride + offset;
                      const vx = data[vertex],
                        vy = data[vertex + 1],
                        vz = data[vertex + 2];
                      check(
                        Number.isFinite(vx) && Number.isFinite(vy) && Number.isFinite(vz),
                        'Non-finite drawn geometry',
                      );
                      const w = matrix
                        ? matrix[3] * vx + matrix[7] * vy + matrix[11] * vz + matrix[15]
                        : 1;
                      const x =
                        (matrix
                          ? (matrix[0] * vx + matrix[4] * vy + matrix[8] * vz + matrix[12]) / w
                          : vx) + mesh.position.x;
                      const y =
                        (matrix
                          ? (matrix[1] * vx + matrix[5] * vy + matrix[9] * vz + matrix[13]) / w
                          : vy) + mesh.position.y;
                      if (Number.isFinite(x) && Number.isFinite(y)) {
                        minX = Math.min(minX, x);
                        maxX = Math.max(maxX, x);
                        minY = Math.min(minY, y);
                        maxY = Math.max(maxY, y);
                      }
                    }
                    indices += count;
                  }
                  // A host view frames all drawn geometry, without altering source transforms.
                  // Canvas and authored cameras already define a display-area projection.
                  if (!screenSpace && minX !== Infinity) {
                    const scale = Math.min(
                      1000,
                      576 / Math.max(1, maxX - minX),
                      324 / Math.max(1, maxY - minY),
                    );
                    effect.container.scale.set(scale);
                    effect.container.position.set(
                      320 - ((minX + maxX) / 2) * scale,
                      180 - ((minY + maxY) / 2) * scale,
                    );
                    app.render();
                  }
                  const gl = app.renderer.gl;
                  const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
                  gl.readPixels(
                    0,
                    0,
                    gl.drawingBufferWidth,
                    gl.drawingBufferHeight,
                    gl.RGBA,
                    gl.UNSIGNED_BYTE,
                    pixels,
                  );
                  let coveredPixels = 0,
                    nonzeroColorPixels = 0,
                    maximumAlpha = 0;
                  for (let i = 0; i < pixels.length; i += 4) {
                    coveredPixels += Number(pixels[i + 3] > 0);
                    nonzeroColorPixels += Number(
                      pixels[i] > 0 || pixels[i + 1] > 0 || pixels[i + 2] > 0,
                    );
                    maximumAlpha = Math.max(maximumAlpha, pixels[i + 3]);
                  }
                  // Additive shaders may write visible RGB with alpha zero. Preserve
                  // those pixels in the diagnostic PNG by compositing over black.
                  let png;
                  if (captureFrames) {
                    const canvas = globalThis.document.createElement('canvas');
                    canvas.width = gl.drawingBufferWidth;
                    canvas.height = gl.drawingBufferHeight;
                    const rgba = new Uint8ClampedArray(pixels.length);
                    for (let y = 0; y < canvas.height; y++)
                      for (let x = 0; x < canvas.width; x++) {
                        const source = ((canvas.height - 1 - y) * canvas.width + x) * 4;
                        const target = (y * canvas.width + x) * 4;
                        rgba[target] = pixels[source];
                        rgba[target + 1] = pixels[source + 1];
                        rgba[target + 2] = pixels[source + 2];
                        rgba[target + 3] = 255;
                      }
                    canvas
                      .getContext('2d')
                      .putImageData(
                        new globalThis.ImageData(rgba, canvas.width, canvas.height),
                        0,
                        0,
                      );
                    png = canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
                  }
                  keyframes.push({
                    label,
                    frame,
                    time: effect.time,
                    particles: effect.particleCount,
                    coveredPixels,
                    nonzeroColorPixels,
                    maximumAlpha,
                    visibleMeshes,
                    indices,
                    sourceBounds: minX === Infinity ? null : { minX, minY, maxX, maxY },
                    hostView: {
                      x: effect.container.x,
                      y: effect.container.y,
                      scale: effect.container.scale.x,
                    },
                    png,
                    imageBackground: 'black',
                  });
                };
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
                capture('start', 0);
                let first;
                let peak = effect.particleCount;
                for (let frame = 1; frame <= steps; frame++) {
                  effect.update(1 / 60);
                  peak = Math.max(peak, effect.particleCount);
                  if (frame === 60) first = snapshot(effect);
                  if (frame % 10 === 0 || frame === steps) app.render();
                  if (frame % 60 === 0 || frame === steps) inspect();
                  if (captures.has(frame))
                    capture(
                      frame === steps
                        ? 'end'
                        : frame === 1
                          ? 'first-step'
                          : frame === 60
                            ? 'one-second'
                            : 'midpoint',
                      frame,
                    );
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
                capture('drained', steps);
                effect.restart();
                for (let frame = 0; frame < 60; frame++) effect.update(1 / 60);
                check(
                  JSON.stringify(snapshot(effect)) === JSON.stringify(first),
                  'Restart is not deterministic',
                );
                capture('restarted', 60);
                const independent = JSON.stringify(snapshot(effect));
                other = await runtime.instantiate(pack, options);
                other.play();
                other.update(1 / 60);
                app.stage.addChild(other.container);
                app.render();
                check(
                  JSON.stringify(snapshot(effect)) === independent,
                  'Second instance changed the first instance',
                );
                other.destroy();
                other = undefined;
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
                  keyframes,
                  independentInstances: true,
                  hostPosition: { x: effect.container.x, y: effect.container.y },
                });
              } finally {
                other?.destroy();
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
          return {
            entries,
            blocked: entries.some((entry) => entry.blocked),
            hostBindings,
            device: app.renderer.gl.getParameter(app.renderer.gl.RENDERER),
          };
        },
        { bytes: [...bytes], source: root.replace(/\/$/, ''), sortingLayers, captureFrames },
      )
      .then(
        (value) => ({
          file,
          bundle: inventoryEntries[fileIndex]?.bundle,
          prefab: inventoryEntries[fileIndex]?.prefab,
          sha256: packageSha256,
          passed: !value.blocked,
          ...value,
        }),
        (error) => ({
          file,
          bundle: inventoryEntries[fileIndex]?.bundle,
          prefab: inventoryEntries[fileIndex]?.prefab,
          passed: false,
          error: error.message,
        }),
      );
    if (captureFrames) {
      await mkdir(frameDirectory, { recursive: true });
      for (const entry of result.entries ?? [])
        for (const [index, frame] of (entry.keyframes ?? []).entries()) {
          const name = `${String(fileIndex).padStart(3, '0')}-${entry.id}-${index}-${frame.label}.png`;
          const image = Buffer.from(frame.png, 'base64');
          await writeFile(resolve(frameDirectory, name), image);
          delete frame.png;
          frame.image = name;
          frame.sha256 = createHash('sha256').update(image).digest('hex');
        }
    }
    results.push(result);
    if (!result.passed)
      console.log(
        file + ': ' + (result.blocked ? 'blocked by compatibility checks' : result.error),
      );
    else if (results.length % 10 === 0)
      console.log(`Verified ${results.length}/${files.length} packages`);
  }
  const report = {
    measuredAt: new Date().toISOString(),
    chromium: browser.version(),
    renderer,
    inventorySha256: inventoryBytes
      ? createHash('sha256').update(inventoryBytes).digest('hex')
      : undefined,
    fixedInventory: inventory
      ? { effects: inventory.results.length, prefabEntries: inventoryEntries.length }
      : undefined,
    viewport: { width: 640, height: 360, resolution: 1, backgroundAlpha: 0 },
    hostContract:
      'Stationary rigidbodies; explicit script identities and animated mode field; original game C# is not executed',
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
    passedEffects: inventory
      ? inventory.results.filter((bundle) =>
          results
            .filter((result) => result.bundle === bundle.bundle)
            .every((result) => result.passed),
        ).length
      : undefined,
    passedEntries: results
      .flatMap((result) => result.entries ?? [])
      .filter((entry) => !entry.blocked).length,
    observedEntries: results.flatMap((result) => result.entries ?? []).length,
    blocked: results.filter((r) => r.blocked).length,
    total: files.length,
    errors,
    results,
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(
    reportPath,
    JSON.stringify(report, (_, value) => (typeof value === 'bigint' ? String(value) : value), 2) +
      '\n',
  );
  console.log(
    `Lifecycle: ${report.passed} passed, ${report.blocked} blocked, ${report.total - report.passed - report.blocked} failed / ${report.total}; browser errors: ${errors.length}`,
  );
  assert.equal(report.passed + report.blocked, report.total);
  if (requireAll)
    assert.equal(report.passed, report.total, 'Not every fixed entry completed playback');
  if (requireAll && inventory) {
    assert.equal(report.observedEntries, 391, 'Runtime entry set differs from the fixed inventory');
    assert.equal(report.passedEffects, 356, 'Not every fixed effect completed playback');
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await server.close();
}
