import type { DeepReadonly as R, EffectPack } from '../pack.js';
import type { MaterialT } from '../format/generated/noa/ir/material.js';
import type { RenderEnvironmentT } from '../format/generated/noa/ir/render-environment.js';
import { MaterialModel as M } from '../format/generated/noa/ir/material-model.js';
import { SupportChecks, type SupportIssue } from '../runtime/support-checks.js';
import type { RenderEnvironment } from './render-environment.js';

export function usesGlobalMipBias(pack: EffectPack, material: R<MaterialT>): boolean {
  if (material.model !== M.TextureVertexColor) return false;
  const bytes = pack.getAssetBytes(material.shaderDataAssetId);
  return !!bytes && JSON.parse(new TextDecoder().decode(bytes)).global_mip_bias === true;
}

/** Shared source-pass validation; UI dynamic depth is resolved by Canvas separately. */
export function materialSupport(
  material: R<MaterialT>,
  pack: EffectPack,
  environment?: RenderEnvironment,
): readonly SupportIssue[] {
  const r = new SupportChecks();
  r.require(
    [
      M.ParticleAddAlpha,
      M.ParticleUnlit,
      M.LegacyParticleAdditive,
      M.LegacyParticleAlphaBlend,
      M.SpriteDefault,
      M.UIDefault,
      M.TextureVertexColor,
    ].includes(material.model),
    'CAPABILITY',
    `materials.${material.id}.model`,
    material.model,
    'Unsupported material model',
  );
  const stencil = material.renderState?.stencil;
  if (stencil)
    r.require(
      stencil.front &&
        stencil.back &&
        (['compare', 'pass', 'fail', 'depthFail'] as const).every(
          (k) => stencil.front![k] === stencil.back![k],
        ),
      'CAPABILITY',
      `materials.${material.id}.renderState.stencil`,
      stencil,
      'Independent stencil faces need a verified source pass',
    );
  r.require(
    material.renderState?.depthTestSource === 0,
    'CAPABILITY',
    `materials.${material.id}.renderState.depthTestSource`,
    material.renderState?.depthTestSource,
    'Canvas depth requires a Canvas drawing context',
  );
  r.require(
    material.textures.length <= 1,
    'CAPABILITY',
    `materials.${material.id}.textures`,
    material.textures.length,
    'Material recipe supports one texture',
  );
  for (const [i, binding] of material.textures.entries()) {
    r.require(
      binding.uvSet >= 0 && binding.uvSet <= 7,
      'CAPABILITY',
      `materials.${material.id}.textures.${i}.uvSet`,
      binding.uvSet,
      'Unsupported UV set',
    );
    r.require(
      binding.colorSpace !== 0,
      'CAPABILITY',
      `materials.${material.id}.textures.${i}.colorSpace`,
      binding.colorSpace,
      'Texture encoding must be explicit',
    );
  }
  r.require(
    !usesGlobalMipBias(pack, material) || environment?.globalMipBias !== undefined,
    'HOST',
    'renderEnvironment.globalMipBias',
    environment?.globalMipBias,
    'Material requires source-global-mip-bias',
  );
  return r.issues;
}

export function rendererEnvironmentSupport(
  environment: R<RenderEnvironmentT> | null,
): readonly SupportIssue[] {
  const r = new SupportChecks();
  if (
    environment &&
    (environment.castShadows ||
      environment.receiveShadows ||
      environment.lightProbes ||
      environment.reflectionProbes)
  )
    r.warn(
      'UNLIT_RENDER_ENVIRONMENT',
      'environment',
      environment,
      'Known unlit color passes do not consume shadow or probe lighting; ShadowsOnly suppresses color drawing.',
    );
  return r.issues;
}
