import { ExtensionType, WebGLRenderer, type Application } from 'pixi.js';
import { check } from './errors.js';
import { NatsumeRuntime } from './runtime/runtime.js';

declare global {
  // PixiJS exposes this namespace for Application type extensions.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace PixiMixins {
    interface Application {
      /** Per-application runtime, available after init with NatsumePlugin registered. */
      readonly natsume: NatsumeRuntime;
    }
  }
}

const runtimes = new WeakMap<Application, NatsumeRuntime>();

/**
 * Creates a runtime on Application.init and destroys it on Application.destroy.
 * Register with extensions.add(NatsumePlugin) before initializing applications.
 * Requires WebGL2. Instances are advanced explicitly with effect.update(seconds).
 */
export const NatsumePlugin = {
  extension: ExtensionType.Application,
  init(this: Application): void {
    check(this.renderer instanceof WebGLRenderer, 'HOST', 'Natsume requires a WebGL2 renderer');
    check(!runtimes.has(this), 'HOST', 'Natsume is already initialized for this application');
    const runtime = new NatsumeRuntime(this.renderer);
    runtimes.set(this, runtime);
    Object.defineProperty(this, 'natsume', { configurable: true, get: () => runtime });
  },
  destroy(this: Application): void {
    const runtime = runtimes.get(this);
    if (!runtime) return;
    runtimes.delete(this);
    try {
      runtime.destroy();
    } finally {
      Reflect.deleteProperty(this, 'natsume');
    }
  },
};
