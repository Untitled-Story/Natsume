import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import type { EffectInstance } from '../../src/index.js';
import type { ParticleMesh } from '../../src/rendering/particle-mesh.js';

test.skip(
  !existsSync(new URL('../../../../data/kirakira.noap', import.meta.url)),
  'Local Noa sample is not distributed',
);

test('uses one stable lifetime-size random factor across axes, matching Unity statistics', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .locator('#file')
    .setInputFiles(fileURLToPath(new URL('../../../../data/kirakira.noap', import.meta.url)));
  await expect(page.locator('#status')).toHaveText('预览就绪');
  const native = JSON.parse(
    readFileSync(new URL('../fixtures/unity-random.json', import.meta.url), 'utf8'),
  );
  for (const seed of [12345, 98765, 24680]) {
    const results = await page.evaluate(
      async ({ path, seed }) => (await import('/@fs' + path)).measureLifetimeSizeRandomness(seed),
      { path: new URL('./render-fixture.ts', import.meta.url).pathname, seed },
    );
    expect(results[0].distributions).toEqual(results[1].distributions);
    const fixture = native.cases.find((c: { seed: number }) => c.seed === seed);
    for (const result of results) {
      expect(result.maximumAxisDifference).toBeLessThan(1e-6);
      for (let axis = 0; axis < 3; axis++) {
        const expected = fixture.distributions.find(
          (d: { name: string }) => d.name === 'sizeLife' + 'XYZ'[axis],
        );
        const actual = result.distributions[axis]!;
        expect(Math.abs(actual.mean - expected.mean)).toBeLessThan(0.018);
        expect(Math.abs(actual.variance - expected.variance)).toBeLessThan(0.007);
        for (let i = 0; i < 16; i++)
          expect(
            Math.abs(actual.bins[i]! / fixture.count - expected.bins[i] / fixture.count),
          ).toBeLessThan(0.018);
      }
    }
  }
});

test('loads and renders local haruka with infinite bursts, jitter and Burst Spread', async ({
  page,
}) => {
  const sample = new URL('../../../../data/idol_smile_haruka_02.noap', import.meta.url);
  test.skip(!existsSync(sample), 'Local Noa sample is not distributed');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.locator('#file').setInputFiles(fileURLToPath(sample));
  await expect(page.locator('#status')).toHaveText('预览就绪');
  await page.evaluate(async () => {
    const path = '/src/preview.ts';
    const { effect } = (await import(path)).getPreview();
    effect.restart();
    for (let i = 0; i < 180; i++) effect.update(1 / 60);
    effect.pause();
  });
  await page.locator('#focus').selectOption('24');
  await page.locator('#fit').click();
  const result = await page.evaluate(async () => {
    const path = '/src/preview.ts';
    const { app, effect } = (await import(path)).getPreview();
    app.render();
    const gl = app.renderer.gl,
      pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(
      0,
      0,
      gl.drawingBufferWidth,
      gl.drawingBufferHeight,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i]! + pixels[i + 1]! + pixels[i + 2]! > 160) colored++;
    return { count: effect.particleCount, colored, version: app.renderer.context.webGLVersion };
  });
  expect(result.count).toBeGreaterThan(0);
  expect(result.colored).toBeGreaterThan(0);
  expect(result.version).toBe(2);
  await page.screenshot({ path: 'test-results/haruka-preview.png', fullPage: true });
  await page.locator('#restart').click();
  await expect(page.locator('#playback-status')).toContainText('播放中');
  expect(errors).toEqual([]);
});

test('matches Unity Billboard, Mesh and Stretch vertices with UVs', async ({ page }) => {
  await page.goto('/');
  await page
    .locator('#file')
    .setInputFiles(fileURLToPath(new URL('../../../../data/kirakira.noap', import.meta.url)));
  await expect(page.locator('#status')).toHaveText('预览就绪');
  const actual = await page.evaluate(
    async (path) => (await import(`/@fs${path}`)).measureParticleGeometry(),
    new URL('./render-fixture.ts', import.meta.url).pathname,
  );
  const native = JSON.parse(
    readFileSync(new URL('../fixtures/unity-boundaries.json', import.meta.url), 'utf8'),
  );
  for (const result of actual) {
    const label = result.label;
    const sample = native.cases
      .find((c: { label: string }) => c.label === label)
      .samples.find((s: { frame: number }) => s.frame === result.frame);
    // Native Billboard vertex order differs; compare the set of positions.
    for (const [index, vertex] of result.vertices.entries()) {
      const nearest = Math.min(
        ...sample.vertices.map((p: { x: number; y: number; z: number }) =>
          Math.hypot(p.x - vertex[0], p.y - vertex[1], p.z - vertex[2]),
        ),
      );
      // Native normalized direction has a small length error for combined velocity.
      const tolerance = label === 'stretch-linear-velocity' ? 0.015 : 1e-5;
      expect(nearest, label + ' frame ' + result.frame).toBeLessThan(tolerance);
      const uv = result.uv[index]!;
      const matching = sample.vertices.some(
        (p: { x: number; y: number; z: number }, i: number) =>
          Math.hypot(p.x - vertex[0]!, p.y - vertex[1]!, p.z - vertex[2]!) < tolerance &&
          Math.hypot(sample.uv[i].x - uv[0]!, sample.uv[i].y - uv[1]!) < 1e-6,
      );
      expect(matching, label + ' UV-to-vertex mapping').toBe(true);
    }
  }
});

test('plays WebGL2 particles, freezes on pause and preserves authored layout under host scaling', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page
    .locator('#file')
    .setInputFiles(fileURLToPath(new URL('../../../../data/kirakira.noap', import.meta.url)));
  await expect(page.locator('#status')).toHaveText('预览就绪');
  await expect(page.locator('#console')).toContainText('布局 100 × 100');
  await page.evaluate(async () => {
    const path = '/src/preview.ts';
    const { getPreview } = await import(path);
    const { effect } = getPreview();
    effect.restart();
    for (let i = 0; i < 90; i++) effect.update(1 / 60);
    effect.pause();
  });
  await page.locator('#pause').click();
  const status = await page.locator('#playback-status').textContent();
  await page.waitForTimeout(100);
  await expect(page.locator('#playback-status')).toHaveText(status!);
  const data = await page.evaluate(async () => {
    const path = '/src/preview.ts';
    const { getPreview } = await import(path);
    const { app, effect } = getPreview();
    const size = effect.layoutSize;
    effect.container.scale.set(2);
    const width = effect.container.width;
    app.renderer.resize(700, 480);
    const layoutAfter = effect.layoutSize;
    app.render();
    const gl = app.renderer.gl,
      pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(
      0,
      0,
      gl.drawingBufferWidth,
      gl.drawingBufferHeight,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i]! + pixels[i + 1]! + pixels[i + 2]! > 160) colored++;
    return { size, layoutAfter, width, version: app.renderer.context.webGLVersion, colored };
  });
  expect(data.size).toEqual({ width: 100, height: 100 });
  expect(data.layoutAfter).toEqual(data.size);
  expect(data.width).toBe(200);
  expect(data.version).toBe(2);
  const beforeFocus = await page.evaluate(async () => {
    const path = '/src/preview.ts';
    const { effect } = (await import(path)).getPreview();
    return {
      entry: effect.simulation.entry.id,
      time: effect.time,
      particles: effect.particleCount,
      matrix: Array.from(effect.displayMatrix),
      active: [...effect.simulation.scene.nodes.values()].map((n) => n.active),
      scale: effect.container.scale.x,
    };
  });
  await expect(page.locator('#focus option')).toHaveCount(18);
  await page.locator('#focus').selectOption('14');
  const afterFocus = await page.evaluate(async () => {
    const path = '/src/preview.ts';
    const { effect } = (await import(path)).getPreview();
    return {
      entry: effect.simulation.entry.id,
      time: effect.time,
      particles: effect.particleCount,
      matrix: Array.from(effect.displayMatrix),
      active: [...effect.simulation.scene.nodes.values()].map((n) => n.active),
      scale: effect.container.scale.x,
    };
  });
  expect(afterFocus.entry).toBe(100);
  expect(afterFocus.time).toBe(beforeFocus.time);
  expect(afterFocus.particles).toBe(beforeFocus.particles);
  expect(afterFocus.matrix).toEqual(beforeFocus.matrix);
  expect(afterFocus.active).toEqual(beforeFocus.active);
  expect(afterFocus.scale).toBeGreaterThan(beforeFocus.scale);
  await page.locator('#fit').click();
  const colored = await page.evaluate(async () => {
    const path = '/src/preview.ts';
    const { getPreview } = await import(path);
    const { app } = getPreview();
    app.render();
    const gl = app.renderer.gl,
      p = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(
      0,
      0,
      gl.drawingBufferWidth,
      gl.drawingBufferHeight,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      p,
    );
    let count = 0;
    for (let i = 0; i < p.length; i += 4) if (p[i]! + p[i + 1]! + p[i + 2]! > 160) count++;
    return count;
  });
  expect(colored).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/preview.png', fullPage: true });
  await page.locator('#clear').click();
  await expect(page.locator('#playback-status')).toContainText('已停止 · 0 粒子');
  await page.locator('#restart').click();
  await expect(page.locator('#playback-status')).toContainText('播放中');
  expect(errors).toEqual([]);
});

test('shares textures between independent instances and survives pack/instance disposal', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .locator('#file')
    .setInputFiles(fileURLToPath(new URL('../../../../data/kirakira.noap', import.meta.url)));
  await expect(page.locator('#status')).toHaveText('预览就绪');
  const result = await page.evaluate(async () => {
    const path = '/src/preview.ts';
    const { getPreview } = await import(path);
    const { effect: first, runtime, app } = getPreview();
    first.pause();
    const second = await runtime.instantiate(first.simulation.pack, {
      seed: 99,
    });
    const shared = first.container.children[0].texture === second.container.children[0].texture;
    second.play();
    const firstState = first.state;
    const secondCount = second.particleCount;
    first.simulation.pack.dispose();
    first.destroy();
    second.container.position.set(100, 100);
    app.stage.addChild(second.container);
    second.update(1 / 60);
    app.render();
    const alive = !second.destroyed && !second.container.children[0].texture.destroyed;
    second.destroy();
    second.destroy();
    return { shared, firstState, secondCount, alive, remaining: app.stage.children.length };
  });
  expect(result).toEqual({
    shared: true,
    firstState: 'paused',
    secondCount: 100,
    alive: true,
    remaining: 0,
  });
});

test('honors RGB-only additive/alpha blending, host alpha, Pixi siblings and masks', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .locator('#file')
    .setInputFiles(fileURLToPath(new URL('../../../../data/kirakira.noap', import.meta.url)));
  await expect(page.locator('#status')).toHaveText('预览就绪');
  const result = await page.evaluate(
    async (fixturePath) => (await import(`/@fs${fixturePath}`)).checkRenderState(),
    new URL('./render-fixture.ts', import.meta.url).pathname,
  );
  // Premultiplied framebuffer: half red over half blue; RGB-only preserves alpha.
  expect(result.alpha[0]).toBeCloseTo(128, 0);
  expect(result.alpha[1]).toBe(0);
  expect(Math.abs(result.alpha[2] - 64)).toBeLessThanOrEqual(1);
  expect(result.alpha[3]).toBe(result.background[3]);
  // Following Pixi draw writes alpha normally: 0.5 + 0.5*(1-0.5) = 0.75.
  expect(Math.abs(result.host[3] - 192)).toBeLessThanOrEqual(1);
  expect(Math.abs(result.inherited[0] - 64)).toBeLessThanOrEqual(1);
  expect(result.inherited[3]).toBe(result.background[3]);
  expect(result.outsideMask).toEqual(result.background);
  expect(result.clamped).toEqual(result.background);
  expect(result.restoredMask).toEqual([true, true, true, true]);
  expect(Math.abs(result.additive[0] - 128)).toBeLessThanOrEqual(1);
  expect(result.additive[2]).toBe(result.background[2]);
  expect(result.additive[3]).toBe(result.background[3]);
  expect(Math.abs(result.gamma - 128)).toBeLessThanOrEqual(1);
  expect(Math.abs(result.linear - 55)).toBeLessThanOrEqual(1);
});

test('isolates failing script behaviors and keeps pause/active lifecycle distinct', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .locator('#file')
    .setInputFiles(fileURLToPath(new URL('../../../../data/kirakira.noap', import.meta.url)));
  await expect(page.locator('#status')).toHaveText('预览就绪');
  const result = await page.evaluate(async () => {
    const path = '/src/preview.ts';
    const { getPreview } = await import(path);
    const { effect: first, runtime } = getPreview();
    first.pause();
    const identity = first.simulation.pack.customComponents
      .map((c: (typeof first.simulation.pack.components)[number]) => c.data.script)
      .find((s: { className: string }) => s.className === 'ScenarioEffector');
    let enable = 0,
      disable = 0,
      updates = 0,
      destroyed = 0;
    runtime.registerScript(identity, () => ({
      onEnable() {
        enable++;
      },
      onDisable() {
        disable++;
      },
      update() {
        updates++;
      },
      destroy() {
        destroyed++;
      },
    }));
    const settings = {
      assembly: 'Assembly-CSharp',
      namespace: 'Sekai.Core.Live',
      className: 'ParticleShaderSettings',
    };
    runtime.registerScript(settings, () => ({
      update() {
        throw new Error('test script failure');
      },
    }));
    const e = await runtime.instantiate(first.simulation.pack, {});
    e.play();
    e.play();
    e.update(1 / 60);
    e.update(1 / 60);
    const errors = e.diagnostics.filter((d: { code: string }) => d.code === 'SCRIPT_ERROR').length;
    e.pause();
    e.update(1);
    const paused = { enable, disable, updates };
    e.play();
    e.update(1 / 60);
    e.setNodeActive(23, false);
    e.setNodeActive(23, true);
    e.destroy();
    return { errors, paused, enable, disable, updates, destroyed };
  });
  expect(result).toEqual({
    errors: 15,
    paused: { enable: 1, disable: 0, updates: 2 },
    enable: 2,
    disable: 2,
    updates: 3,
    destroyed: 1,
  });
});

test('owns one runtime per Pixi application and releases instances on application destruction', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .locator('#file')
    .setInputFiles(fileURLToPath(new URL('../../../../data/kirakira.noap', import.meta.url)));
  await expect(page.locator('#status')).toHaveText('预览就绪');
  const result = await page.evaluate(
    async (fixturePath) => {
      const { checkApplicationPlugin } = await import(`/@fs${fixturePath}`);
      return checkApplicationPlugin();
    },
    new URL('./render-fixture.ts', import.meta.url).pathname,
  );
  expect(result).toEqual({
    distinct: true,
    stable: true,
    destroyed: true,
    rejected: true,
    isolated: true,
    detached: true,
  });
});

test('applies public node render offsets with inheritance, validation and Bridge lifecycle', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .locator('#file')
    .setInputFiles(fileURLToPath(new URL('../../../../data/kirakira.noap', import.meta.url)));
  await expect(page.locator('#status')).toHaveText('预览就绪');
  const result = await page.evaluate(async () => {
    const path = '/src/preview.ts';
    const { effect: first, runtime } = (await import(path)).getPreview();
    first.pause();
    const pack = first.simulation.pack;
    const identity = pack.customComponents
      .map((c: { data: { script: { className: string } } }) => c.data.script)
      .find((s: { className: string }) => s.className === 'ScenarioEffector');
    runtime.registerScript(
      identity,
      ({ node }: { node: import('../../src/index.js').NatsumeNode }) => ({
        onEnable() {
          node.setRenderOffset({ x: 9, y: 13 });
        },
        onDisable() {
          node.setRenderOffset(null);
        },
      }),
    );
    const e = (await runtime.instantiate(pack, {})) as EffectInstance;
    e.play();
    e.pause();
    const meshes = e.container.children as ParticleMesh[];
    const nodes = e.renderedNodes;
    const node = nodes.find((n) => n.parent)!;
    const parent = node.parent!;
    const before = {
      time: e.time,
      count: e.particleCount,
      world: Array.from(node.worldMatrix),
      vertices: meshes.map((m) => Array.from(m.geometry.getBuffer('aPosition').data)),
    };
    const bridge = meshes.some((m) => m.position.x === 9 && m.position.y === 13);
    // Clear Bridge-owned offsets before testing explicit hierarchy composition.
    for (const n of e.simulation.scene.ordered) e.getNode(n.id)!.setRenderOffset(null);
    parent.setRenderOffset({ x: 10, y: 20 });
    const input = { x: -3, y: 5 };
    node.setRenderOffset(input);
    input.x = 100;
    const copy = node.renderOffset as { x: number; y: number };
    copy.x = 200;
    const composed = meshes
      .filter((m) => m.emitter.node.id === node.id)
      .every((m) => m.position.x === 7 && m.position.y === 25);
    const unrelated = meshes
      .filter((m) => {
        for (let n = e.getNode(m.emitter.node.id); n; n = n.parent)
          if (n.id === parent.id) return false;
        return true;
      })
      .every((m) => m.position.x === 0 && m.position.y === 0);
    let invalid = 0;
    for (const value of [NaN, Infinity, -Infinity]) {
      try {
        node.setRenderOffset({ x: value, y: 0 });
      } catch {
        invalid++;
      }
    }
    const copied = node.renderOffset.x === -3;
    const unchanged =
      before.time === e.time &&
      before.count === e.particleCount &&
      JSON.stringify(before.world) === JSON.stringify(Array.from(node.worldMatrix)) &&
      JSON.stringify(before.vertices) ===
        JSON.stringify(meshes.map((m) => Array.from(m.geometry.getBuffer('aPosition').data)));
    const matrix = e.displayMatrix;
    matrix[0] = 0;
    matrix[1] = 2;
    matrix[4] = 3;
    matrix[5] = 0;
    e.setDisplayMatrix(matrix);
    const localSpace = meshes
      .filter((m) => m.emitter.node.id === node.id)
      .every((m) => m.position.x === 7 && m.position.y === 25);
    e.restart();
    const retained = node.renderOffset.x === -3 && parent.renderOffset.x === 10;
    node.setRenderOffset(null);
    const inherited = meshes
      .filter((m) => m.emitter.node.id === node.id)
      .every((m) => m.position.x === 10 && m.position.y === 20);
    parent.setRenderOffset(null);
    const cleared = meshes.every((m) => m.position.x === 0 && m.position.y === 0);
    const isolated = first.container.children.every(
      (m: { x: number; y: number }) => m.x === 0 && m.y === 0,
    );
    e.destroy();
    const cleanLifecycle = !e.diagnostics.some((d) => d.code === 'SCRIPT_ERROR');
    let disposed = false;
    try {
      node.setRenderOffset(null);
    } catch {
      disposed = true;
    }
    return {
      bridge,
      composed,
      unrelated,
      copied,
      unchanged,
      localSpace,
      retained,
      inherited,
      cleared,
      isolated,
      invalid,
      disposed,
      cleanLifecycle,
      unique: new Set(nodes.map((n) => n.id)).size === nodes.length,
    };
  });
  expect(result).toEqual({
    bridge: true,
    composed: true,
    unrelated: true,
    copied: true,
    unchanged: true,
    localSpace: true,
    retained: true,
    inherited: true,
    cleared: true,
    isolated: true,
    invalid: 3,
    disposed: true,
    cleanLifecycle: true,
    unique: true,
  });
});

test('overlays emitter groups without changing simulation, geometry or source transforms', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page
    .locator('#file')
    .setInputFiles(fileURLToPath(new URL('../../../../data/kirakira.noap', import.meta.url)));
  await expect(page.locator('#status')).toHaveText('预览就绪');
  await expect(page.locator('#overlay')).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(async () => {
    const path = '/src/preview.ts';
    const { effect } = (await import(path)).getPreview();
    effect.restart();
    for (let i = 0; i < 180; i++) effect.update(1 / 60);
    effect.pause();
  });
  const snapshot = () =>
    page.evaluate(async () => {
      const path = '/src/preview.ts';
      const effect = (await import(path)).getPreview().effect as EffectInstance;
      const meshes = effect.container.children as ParticleMesh[];
      return {
        model: {
          time: effect.time,
          state: effect.state,
          count: effect.particleCount,
          pack: effect.simulation.pack.nodes.map((n) => n.transform),
          world: [...effect.simulation.scene.nodes.values()].map((n) => Array.from(n.worldMatrix)),
          emitters: [...effect.simulation.emitters.values()].map((e) => ({
            id: e.id,
            positions: Array.from(e.positions.slice(0, e.count * 3)),
            velocities: Array.from(e.velocities.slice(0, e.count * 3)),
            ages: Array.from(e.ages.slice(0, e.count)),
          })),
          geometry: meshes.map((mesh) =>
            Array.from(mesh.geometry.getAttribute('aPosition').buffer.data.slice(0, 64)),
          ),
        },
        centers: meshes.map((mesh) => ({
          node: mesh.emitter.node.id,
          x: mesh.emitter.node.worldMatrix[12]! + mesh.position.x,
          y: -mesh.emitter.node.worldMatrix[13]! + mesh.position.y,
        })),
      };
    });
  await page.locator('#fit').click();
  const authored = await snapshot();
  expect(new Set(authored.centers.map((c) => c.y)).size).toBe(4);
  await page.screenshot({ path: 'test-results/layout-authored.png' });
  await page.locator('#overlay').click();
  await expect(page.locator('#overlay')).toHaveAttribute('aria-pressed', 'true');
  const overlaid = await snapshot();
  expect(overlaid.model).toEqual(authored.model);
  expect(new Set(overlaid.centers.map((c) => c.y)).size).toBe(1);
  expect(new Set(overlaid.centers.map((c) => c.x)).size).toBe(1);
  await page.screenshot({ path: 'test-results/layout-overlay.png' });
  await page.locator('#focus').selectOption('14');
  expect((await snapshot()).model).toEqual(authored.model);
  await page.locator('#overlay').click();
  await expect(page.locator('#overlay')).toHaveAttribute('aria-pressed', 'false');
  expect(await snapshot()).toEqual(authored);
  await page.locator('#overlay').click();
  await page.locator('#restart').click();
  await expect(page.locator('#overlay')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#playback-status')).toContainText('播放中');
  expect(errors).toEqual([]);
});

test('orders transparent particles by Unity sort modes', async ({ page }) => {
  await page.goto('/');
  await page
    .locator('#file')
    .setInputFiles(fileURLToPath(new URL('../../../../data/kirakira.noap', import.meta.url)));
  await expect(page.locator('#status')).toHaveText('预览就绪');
  const result = await page.evaluate(
    async (path) => (await import(`/@fs${path}`)).measureParticleSorting(),
    new URL('./render-fixture.ts', import.meta.url).pathname,
  );
  const native = JSON.parse(
    readFileSync(new URL('../fixtures/unity-sorting.json', import.meta.url), 'utf8'),
  );
  for (const sample of native.cases) {
    const name = sample.label.replace('InFront', 'First');
    expect(result[name], sample.label).toEqual(sample.order);
  }
  expect(result.transformed).toEqual([1, 2, 0]);
  expect(result.ties).toEqual([0, 1, 2]);
  expect(result.empty).toEqual([0]);
});
