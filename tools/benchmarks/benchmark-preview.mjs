import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
import { cpus } from 'node:os';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sample = resolve(root, process.argv[2] ?? 'data/kirakira.noap');
const bytes = await readFile(sample);
const server = await createServer({
  root: resolve(root, 'packages/playground'),
  server: { host: '127.0.0.1', port: 0 },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0]);
  await page.locator('#file').setInputFiles(sample);
  await page.locator('#status').filter({ hasText: '预览就绪' }).waitFor();
  const measurement = await page.evaluate(async () => {
    /* global performance */
    // Engineering-only inspection of private fields; no public API is added.
    const { getPreview } = await import('/src/preview.ts');
    const { app, runtime, effect } = getPreview();
    app.ticker.stop();
    const pack = effect.simulation.pack;
    const snapshot = () => ({
      instances: runtime.instances.size,
      textureLeases: [...runtime.textures.values()].reduce((n, cache) => n + cache.size, 0),
      textureRefs: [...runtime.textures.values()].flatMap((cache) =>
        [...cache.values()].map((r) => r.refs),
      ),
      retainedPixels: runtime.retainedPixels,
      stageChildren: app.stage.children.length,
    });
    const gl = app.renderer.gl;
    const renderer = gl.getExtension('WEBGL_debug_renderer_info');
    const device = renderer
      ? gl.getParameter(renderer.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    const counters = { drawCalls: 0, uploadCalls: 0, uploadedBytes: 0 };
    const originals = new Map();
    for (const name of [
      'drawElements',
      'drawArrays',
      'drawElementsInstanced',
      'drawArraysInstanced',
      'bufferData',
      'bufferSubData',
    ]) {
      const original = gl[name];
      originals.set(name, original);
      gl[name] = function (...args) {
        if (name.startsWith('draw')) counters.drawCalls++;
        else {
          counters.uploadCalls++;
          const data = args[name === 'bufferData' ? 1 : 2];
          const offset = args[3] ?? 0;
          const length = args[4];
          counters.uploadedBytes +=
            typeof data === 'number'
              ? data
              : data == null
                ? 0
                : length
                  ? length * (data.BYTES_PER_ELEMENT ?? 1)
                  : data.byteLength - offset * (data.BYTES_PER_ELEMENT ?? 1);
        }
        return original.apply(this, args);
      };
    }
    const stats = (values) => {
      values.sort((a, b) => a - b);
      return {
        median: values[Math.floor(values.length / 2)],
        p95: values[Math.floor(values.length * 0.95)],
      };
    };
    const update = [],
      submit = [];
    effect.restart();
    for (let i = 0; i < 180; i++) {
      effect.update(1 / 60);
      app.render();
    }
    Object.keys(counters).forEach((key) => {
      counters[key] = 0;
    });
    const counts = [];
    for (let i = 0; i < 120; i++) {
      const start = performance.now();
      effect.update(1 / 60);
      const middle = performance.now();
      app.render();
      const end = performance.now();
      update.push(middle - start);
      submit.push(end - middle);
      counts.push(effect.particleCount);
    }
    for (const [name, original] of originals) gl[name] = original;
    const buffers = new Set();
    const addArrays = (object) => {
      for (const value of Object.values(object))
        if (ArrayBuffer.isView(value)) buffers.add(value.buffer);
    };
    for (const emitter of effect.simulation.emitters.values()) addArrays(emitter);
    const simulationArrayBytes = [...buffers].reduce((n, buffer) => n + buffer.byteLength, 0);
    for (const mesh of effect.container.children) {
      for (const buffer of mesh.geometry.buffers) buffers.add(buffer.data.buffer);
      if (mesh.geometry.indexBuffer) buffers.add(mesh.geometry.indexBuffer.data.buffer);
    }
    const geometryAndSimulationArrayBytes = [...buffers].reduce(
      (n, buffer) => n + buffer.byteLength,
      0,
    );
    const single = snapshot();
    const second = await runtime.instantiate(pack, {
      seed: 12345,
      particleEnvironment: { fog: { mode: 'none' } },
    });
    app.stage.addChild(second.container);
    const shared = snapshot();
    second.destroy();
    effect.destroy();
    await Promise.resolve();
    await Promise.resolve();
    const released = snapshot();
    const cycles = [];
    for (let i = 0; i < 3; i++) {
      const instance = await runtime.instantiate(pack, {
        seed: 12345,
        particleEnvironment: { fog: { mode: 'none' } },
      });
      app.stage.addChild(instance.container);
      instance.play();
      instance.update(1 / 60);
      app.render();
      instance.destroy();
      await Promise.resolve();
      await Promise.resolve();
      cycles.push(snapshot());
    }
    pack.dispose();
    runtime.destroy();
    const final = snapshot();
    app.destroy(true);
    return {
      device,
      resolution: [1280, 720],
      fixedDelta: 1 / 60,
      seed: 12345,
      warmupFrames: 180,
      measuredFrames: 120,
      particleRange: [Math.min(...counts), Math.max(...counts)],
      updateMs: stats(update),
      renderSubmissionMs: stats(submit),
      perFrame: Object.fromEntries(
        Object.entries(counters).map(([key, value]) => [key, value / 120]),
      ),
      simulationArrayBytes,
      geometryAndSimulationArrayBytes,
      textureRgba8EstimateBytes: single.retainedPixels * 4,
      lifecycle: { single, shared, released, cycles, final },
      gpuExecutionMs: null,
    };
  });
  assert.deepEqual(errors, [], 'Browser errors');
  const { single, shared, released, cycles, final } = measurement.lifecycle;
  assert.equal(shared.instances, 2);
  assert.equal(single.textureLeases, shared.textureLeases);
  assert.equal(single.retainedPixels, shared.retainedPixels);
  assert.deepEqual(
    shared.textureRefs,
    single.textureRefs.map((n) => n * 2),
  );
  for (const point of [released, ...cycles, final]) {
    assert.equal(
      point.instances + point.textureLeases + point.retainedPixels + point.stageChildren,
      0,
    );
  }
  const report = {
    scenario: 'particle-preview-v1',
    measuredAt: new Date().toISOString(),
    node: process.version,
    cpu: cpus()[0]?.model,
    chromium: browser.version(),
    sample: {
      file: relative(root, sample),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.byteLength,
    },
    sourceHash: createHash('sha256')
      .update(await readFile(resolve(root, 'packages/natsume/src/rendering/particle-mesh.ts')))
      .digest('hex'),
    ...measurement,
  };
  await mkdir(resolve(root, 'data/performance'), { recursive: true });
  await writeFile(
    resolve(root, 'data/performance/preview-current.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  await server.close();
}
