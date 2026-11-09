import { Application, type WebGLRenderer } from 'pixi.js';
import { NatsumeRuntime } from '../../src/runtime/runtime.js';

/** Creates a stopped WebGL2 application for the local package lifecycle runner. */
export async function createPlaybackHarness(scriptErrors: 'isolate' | 'throw' = 'isolate') {
  const app = new Application();
  await app.init({
    preference: 'webgl',
    preferWebGLVersion: 2,
    width: 640,
    height: 360,
    resolution: 1,
    backgroundAlpha: 0,
    autoStart: false,
  });
  const runtime = new NatsumeRuntime(app.renderer as WebGLRenderer, { scriptErrors });
  return { app, runtime };
}
