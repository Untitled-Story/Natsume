import { Application, Mesh, extensions } from 'pixi.js';
import { NatsumePlugin, type NatsumeRuntime, type EffectPack, type EffectInstance } from 'natsume';
import { log } from './console.js';
import { OverlayView } from './overlay.js';
import type { ParticleMesh } from '../../natsume/src/rendering/particle-mesh.js';

extensions.add(NatsumePlugin);

const viewport = document.getElementById('viewport')!;
const playbackStatus = document.getElementById('playback-status')!;
const controls = document.querySelectorAll<
  HTMLButtonElement | HTMLSelectElement | HTMLInputElement
>('[data-playback]');
const focus = document.getElementById('focus') as HTMLSelectElement;
const gravityInput = document.getElementById('gravity-y') as HTMLInputElement;
let gravityY = -9.81;
const overlayButton = document.getElementById('overlay')!;
let overlay: OverlayView | undefined;
let overlayEnabled = false;
let app: Application | undefined,
  runtime: NatsumeRuntime | undefined,
  effect: EffectInstance | undefined;
let initializing: Promise<void> | undefined;
let observer: ResizeObserver | undefined;
let frame = 0;
let centerX = 0,
  centerY = 0,
  scale = 1;
const reported = new Set<string>();

async function init(): Promise<void> {
  if (initializing) return initializing;
  initializing = (async () => {
    const next = new Application();
    try {
      await next.init({
        preference: 'webgl',
        preferWebGLVersion: 2,
        width: Math.max(1, viewport.clientWidth),
        height: Math.max(1, viewport.clientHeight),
        background: 0x111416,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(devicePixelRatio, 2),
      });
      runtime = next.natsume;
      app = next;
      viewport.prepend(next.canvas);
      observer = new ResizeObserver(() => {
        next.renderer.resize(Math.max(1, viewport.clientWidth), Math.max(1, viewport.clientHeight));
        place();
      });
      observer.observe(viewport);
      next.ticker.add((ticker) => {
        if (!effect || effect.destroyed) return;
        try {
          effect.update(ticker.deltaMS / 1000);
          overlay?.apply(overlayEnabled);
          if (++frame % 8 === 0) stats();
        } catch (error) {
          effect.pause();
          log(error instanceof Error ? error.message : String(error), 'error');
          stats();
        }
      });
      log('WebGL2 就绪');
    } catch (error) {
      if (next.renderer) next.destroy(true);
      throw error;
    }
  })();
  try {
    await initializing;
  } catch (error) {
    initializing = undefined;
    throw error;
  }
}

function stats(): void {
  if (!effect || effect.destroyed) return;
  const state = {
    idle: '待播放',
    playing: '播放中',
    paused: '已暂停',
    draining: '停止发射',
    stopped: '已停止',
  }[effect.state];
  playbackStatus.textContent = `${state} · ${effect.particleCount} 粒子 · ${effect.time.toFixed(2)} s`;
  for (const diagnostic of effect.diagnostics) {
    const message = `${diagnostic.code}${diagnostic.componentId ? ` #${diagnostic.componentId}` : ''} · ${diagnostic.message}`;
    if (!reported.has(message)) {
      reported.add(message);
      log(message, 'warn');
    }
  }
}

function place(): void {
  if (!effect || !app || effect.destroyed) return;
  effect.container.scale.set(scale);
  effect.container.position.set(
    app.screen.width / 2 - centerX * scale,
    app.screen.height / 2 - centerY * scale,
  );
}

function fit(): void {
  if (!effect || !app) return;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  // Read only drawn vertices: capacity buffers also contain unused zeroes.
  for (const child of effect.container.children) {
    if (!(child instanceof Mesh) || !child.visible) continue;
    const selected = Number(focus.value);
    let node = (child as ParticleMesh).emitter.node;
    while (selected && node.id !== selected && node.parent) node = node.parent;
    if (selected && node.id !== selected) continue;
    const geometry = child.geometry;
    const attribute = geometry.getAttribute('aPosition');
    const vertices = attribute.buffer.data;
    const indices = geometry.indexBuffer?.data;
    if (!indices) continue;
    const stride = (attribute.stride || 12) / Float32Array.BYTES_PER_ELEMENT;
    const offset = (attribute.offset || 0) / Float32Array.BYTES_PER_ELEMENT;
    for (let i = 0; i < geometry.indexCount; i++) {
      const index = indices[i]! * stride + offset;
      const x = vertices[index]! + child.position.x,
        y = vertices[index + 1]! + child.position.y;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (minX === Infinity) {
    const selected = effect.getNode(Number(focus.value));
    if (selected) {
      const world = selected.worldMatrix,
        matrix = effect.displayMatrix;
      const x = world[12]!,
        y = world[13]!,
        z = world[14]!;
      const w = matrix[3]! * x + matrix[7]! * y + matrix[11]! * z + matrix[15]!;
      const offset = overlayEnabled ? overlay?.offset(selected) : undefined;
      const projectedX =
        (matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!) / w + (offset?.x ?? 0);
      const projectedY =
        (matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!) / w + (offset?.y ?? 0);
      minX = projectedX - 0.5;
      maxX = projectedX + 0.5;
      minY = projectedY - 0.5;
      maxY = projectedY + 0.5;
    } else {
      const bounds = effect.container.boundsArea;
      minX = bounds?.x ?? -50;
      minY = bounds?.y ?? -50;
      maxX = minX + (bounds?.width ?? 100);
      maxY = minY + (bounds?.height ?? 100);
    }
  }
  centerX = (minX + maxX) / 2;
  centerY = (minY + maxY) / 2;
  scale = Math.min(
    1000,
    Math.max(
      0.0001,
      Math.min(
        (app.screen.width * 0.75) / Math.max(1, maxX - minX),
        (app.screen.height * 0.75) / Math.max(1, maxY - minY),
      ),
    ),
  );
  place();
}

export function clearPreview(): void {
  effect?.destroy();
  effect = undefined;
  overlay = undefined;
  overlayEnabled = false;
  overlayButton.setAttribute('aria-pressed', 'false');
  reported.clear();
  controls.forEach((control) => {
    control.disabled = true;
  });
  playbackStatus.textContent = '未载入';
  focus.replaceChildren(new Option('全景', '0'));
}

export async function showPreview(pack: EffectPack, signal: AbortSignal): Promise<void> {
  await init();
  if (signal.aborted) return;
  const created = await runtime!.instantiate(pack, {
    seed: 12345,
    particleEnvironment: {
      fog: { mode: 'none' },
      viewPosition: [0, 0, -1000],
      gravity: [0, gravityY, 0],
    },
  });
  if (signal.aborted) {
    created.destroy();
    return;
  }
  clearPreview();
  effect = created;
  app!.stage.addChild(effect.container);
  effect.play();
  overlay = new OverlayView(effect);
  focus.replaceChildren(
    new Option('全景', '0'),
    ...effect.simulation.scene.ordered.map((node) => {
      let depth = 0,
        parent = node.parent;
      while (parent) {
        depth++;
        parent = parent.parent;
      }
      return new Option(`${'　'.repeat(depth)}${node.name} #${node.id}`, String(node.id));
    }),
  );
  fit();
  const entry = effect.simulation.entry;
  log(`预览环境 · 世界重力 (0, ${gravityY}, 0) · 无雾 · 软粒子关闭`);
  log(
    `播放入口 ${entry.name} #${entry.id} · 根节点 ${entry.roots.join(', ')} · 观察节点只调整取景`,
  );
  controls.forEach((control) => {
    control.disabled = false;
  });
  const size = effect.layoutSize;
  log(
    `实例已创建 · ${size ? `布局 ${size.width} × ${size.height} · ` : ''}${effect.sourceColorSpace === 'gamma' ? 'Gamma' : 'Linear'}`,
  );
  stats();
}

for (const [id, message, action] of [
  ['play', '播放', () => effect?.play()],
  ['pause', '暂停', () => effect?.pause()],
  ['restart', '重播', () => effect?.restart()],
  ['clear', '停止并清空粒子', () => effect?.stop('clear')],
] as const) {
  document.getElementById(id)!.addEventListener('click', () => {
    if (!effect || effect.destroyed) return;
    action();
    stats();
    log(message);
  });
}
document.getElementById('fit')!.addEventListener('click', fit);
gravityInput.addEventListener('change', () => {
  const next = gravityInput.valueAsNumber;
  if (!Number.isFinite(next)) {
    gravityInput.value = String(gravityY);
    log('重力 Y 必须是有限数字', 'error');
    return;
  }
  effect?.setParticleEnvironment({
    fog: { mode: 'none' },
    viewPosition: [0, 0, -1000],
    gravity: [0, next, 0],
  });
  gravityY = next;
  log(`预览环境 · 世界重力 (0, ${gravityY}, 0)`);
});
overlayButton.addEventListener('click', () => {
  if (!effect || effect.destroyed) return;
  overlayEnabled = !overlayEnabled;
  overlayButton.setAttribute('aria-pressed', String(overlayEnabled));
  overlay?.apply(overlayEnabled);
  fit();
  log(
    overlayEnabled
      ? '叠加观察：实验性抵消各顶层可见发射组相对父容器的屏幕平移，保留粒子状态、组内偏移及深度；尚未确认游戏实现。'
      : '原始布局：恢复包内节点位置',
  );
});
focus.addEventListener('change', () => {
  if (!effect || effect.destroyed) return;
  fit();
  const node = effect.getNode(Number(focus.value));
  log(node ? `观察 ${node.name} #${node.id}（含子节点，只调整取景）` : '观察全景（当前入口）');
});
viewport.addEventListener(
  'wheel',
  (event) => {
    if (!effect || !app) return;
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const x = event.clientX - rect.left - app.screen.width / 2;
    const y = event.clientY - rect.top - app.screen.height / 2;
    const previous = scale;
    scale = Math.min(1000, Math.max(0.0001, scale * Math.exp(-event.deltaY * 0.001)));
    centerX += x / previous - x / scale;
    centerY += y / previous - y / scale;
    place();
  },
  { passive: false },
);
let drag: { id: number; x: number; y: number } | undefined;
viewport.addEventListener('pointerdown', (event) => {
  if (!effect || event.button !== 0) return;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  viewport.setPointerCapture(event.pointerId);
  viewport.classList.add('dragging');
});
viewport.addEventListener('pointermove', (event) => {
  if (!drag || drag.id !== event.pointerId) return;
  centerX -= (event.clientX - drag.x) / scale;
  centerY -= (event.clientY - drag.y) / scale;
  drag.x = event.clientX;
  drag.y = event.clientY;
  place();
});
viewport.addEventListener('lostpointercapture', () => {
  drag = undefined;
  viewport.classList.remove('dragging');
});
viewport.addEventListener('pointerup', (event) => {
  if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
});

/** Local preview access for engineering checks; the library has no global state. */
export function getPreview(): {
  app: Application | undefined;
  runtime: NatsumeRuntime | undefined;
  effect: EffectInstance | undefined;
} {
  return { app, runtime, effect };
}
window.addEventListener('pagehide', () => {
  observer?.disconnect();
  clearPreview();
  runtime?.destroy();
  app?.destroy(true);
});
