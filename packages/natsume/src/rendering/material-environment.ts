import { Texture, type Shader } from 'pixi.js';
import { check } from '../errors.js';
import type { ParticleEnvironment } from './particle-environment.js';

/** Applies borrowed scene depth and fog inputs without taking texture ownership. */
export function applyMaterialEnvironment(
  shader: Shader,
  env: ParticleEnvironment | undefined,
): void {
  const u = shader.resources.colorUniforms.uniforms,
    f = u.uFog as Float32Array,
    fog = env?.fog;
  f.fill(0);
  if (fog && fog.mode !== 'none') {
    f[0] = fog.mode === 'linear' ? 1 : fog.mode === 'exp' ? 2 : 3;
    if (fog.mode === 'linear') {
      f[1] = fog.start;
      f[2] = fog.end;
    } else f[3] = fog.density;
    (u.uFogColor as Float32Array).set(fog.color);
  }
  const soft = env?.softParticles;
  check(!soft?.depthTexture.destroyed, 'HOST', 'Host depth texture has been destroyed');
  u.uSoft = soft ? 1 : 0;
  shader.resources.uSceneDepth = soft?.depthTexture.source ?? Texture.WHITE.source;
  (u.uDepthUV as Float32Array).set(soft?.uvTransform ?? [1, 1, 0, 0]);
}
