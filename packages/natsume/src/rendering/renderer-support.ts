import { meshUV } from '../format/mesh-attributes.js';
import { MeshDistribution } from '../format/generated/noa/ir/mesh-distribution.js';
import { rendererVertexStride } from './mesh-selection.js';
import type { DeepReadonly as R, EffectPack } from '../pack.js';
import type { ParticleRendererT } from '../format/generated/noa/ir/particle-renderer.js';
import type { MaterialT } from '../format/generated/noa/ir/material.js';
import { MaterialModel } from '../format/generated/noa/ir/material-model.js';
import { RenderMode } from '../format/generated/noa/ir/render-mode.js';
import { Alignment } from '../format/generated/noa/ir/alignment.js';
import { VertexSemantic } from '../format/generated/noa/ir/vertex-semantic.js';
import { BlendFactor as B } from '../format/generated/noa/ir/blend-factor.js';
import { CompareOp } from '../format/generated/noa/ir/compare-op.js';
import { ColorSpace } from '../format/generated/noa/ir/color-space.js';
import { FilterMode } from '../format/generated/noa/ir/filter-mode.js';
import type { ParticleEnvironment } from './particle-environment.js';
import { SupportChecks, type SupportIssue } from '../runtime/support-checks.js';

export function rendererSupport(
  definition: R<ParticleRendererT>,
  material: R<MaterialT>,
  pack: EffectPack,
  capacity: number,
  environment?: ParticleEnvironment,
): readonly SupportIssue[] {
  const r = new SupportChecks();
  const legacy =
    material.model === MaterialModel.LegacyParticleAdditive ||
    material.model === MaterialModel.LegacyParticleAlphaBlend;
  const straight = legacy || material.model === MaterialModel.ParticleUnlit;
  const additive = material.model === MaterialModel.LegacyParticleAdditive;
  r.require(
    material.model === MaterialModel.ParticleAddAlpha || straight,
    'CAPABILITY',
    `materials.${material.id}.model`,
    material.model,
    'Unsupported particle material model',
  );
  r.require(
    !legacy || environment,
    'HOST',
    'particleEnvironment',
    environment,
    'Legacy particles require an explicit particleEnvironment',
  );
  r.require(
    definition.mode >= RenderMode.Billboard && definition.mode <= RenderMode.Mesh,
    'CAPABILITY',
    'mode',
    definition.mode,
    'Unsupported particle render mode',
  );
  r.require(
    definition.alignment !== Alignment.Facing ||
      definition.mode === RenderMode.HorizontalBillboard ||
      definition.mode === RenderMode.VerticalBillboard ||
      environment?.viewPosition,
    'HOST',
    'particleEnvironment.viewPosition',
    environment?.viewPosition,
    'Facing alignment requires particleEnvironment.viewPosition',
  );
  r.require(
    definition.sort >= 0 && definition.sort <= 4,
    'SEMANTIC',
    'sort',
    definition.sort,
    'Invalid particle sort',
  );
  r.require(
    Number.isFinite(definition.sortingFudge),
    'SEMANTIC',
    'sortingFudge',
    definition.sortingFudge,
    'Invalid sortingFudge',
  );
  r.require(
    !definition.pivot ||
      [definition.pivot.x, definition.pivot.y, definition.pivot.z].every(Number.isFinite),
    'SEMANTIC',
    'pivot',
    definition.pivot,
    'Invalid renderer pivot',
  );
  r.require(
    !definition.flip ||
      [definition.flip.x, definition.flip.y, definition.flip.z].every(
        (value) => value >= 0 && value <= 1,
      ),
    'CAPABILITY',
    'flip',
    definition.flip,
    'Renderer flip values must be in [0,1]',
  );
  r.require(
    Number.isFinite(definition.minSize) &&
      Number.isFinite(definition.maxSize) &&
      definition.minSize >= 0 &&
      definition.maxSize >= definition.minSize,
    'SEMANTIC',
    'minSize/maxSize',
    [definition.minSize, definition.maxSize],
    'Renderer minSize/maxSize are invalid',
  );
  if (definition.mode === RenderMode.StretchedBillboard) {
    r.require(
      !definition.freeformStretching || environment?.viewPosition,
      'HOST',
      'particleEnvironment.viewPosition',
      environment?.viewPosition,
      'Freeform stretch requires particleEnvironment.viewPosition',
    );
    for (const field of ['lengthScale', 'velocityScale', 'cameraVelocityScale'] as const)
      r.require(
        Number.isFinite(definition[field]),
        'SEMANTIC',
        field,
        definition[field],
        'Stretched Billboard scales must be finite',
      );
    if (definition.freeformStretching || !environment?.viewPosition)
      r.warn(
        definition.freeformStretching ? 'FREEFORM_PARALLEL_BASIS' : 'APPROXIMATE_STRETCH',
        'freeformStretching',
        definition.freeformStretching,
        definition.freeformStretching
          ? 'Freeform uses a stable heading when velocity is parallel to the view ray; Unity may jitter.'
          : 'Ordinary stretch without viewPosition uses parallel view rays; oblique velocities may differ from Unity.',
      );
  }
  r.require(
    definition.vertexStreams.every(
      (s) =>
        s.semantic >= 0 &&
        s.semantic <= VertexSemantic.VertexId &&
        s.components >= 1 &&
        s.components <= 4,
    ) &&
      [VertexSemantic.Position, VertexSemantic.Color, VertexSemantic.UV0].every((semantic) =>
        definition.vertexStreams.some(
          (s) =>
            s.semantic === semantic &&
            s.components ===
              (semantic === VertexSemantic.Position
                ? 3
                : semantic === VertexSemantic.Color
                  ? 4
                  : 2),
        ),
      ),
    'CAPABILITY',
    'vertexStreams',
    definition.vertexStreams,
    'Unsupported particle vertex stream',
  );
  r.require(
    material.textures.length === 1 && material.textures[0]?.uvSet === 0,
    'CAPABILITY',
    `materials.${material.id}.textures`,
    material.textures,
    'Only one UV0 texture is supported',
  );
  if (material.textures[0]) {
    const texture = material.textures[0];
    r.require(
      texture.colorSpace !== ColorSpace.Unspecified,
      'CAPABILITY',
      `materials.${material.id}.textures.0.colorSpace`,
      texture.colorSpace,
      'Texture encoding must be explicit',
    );
    r.require(
      texture.sampler?.minFilter !== FilterMode.Trilinear,
      'CAPABILITY',
      `materials.${material.id}.textures.0.sampler.minFilter`,
      texture.sampler?.minFilter,
      'Mipmapped sampling unsupported',
    );
  }
  const state = material.renderState;
  const neutralStencil =
    !state?.stencil ||
    [state.stencil.front, state.stencil.back].every(
      (face) =>
        face &&
        face.compare === CompareOp.Always &&
        face.pass === 0 &&
        face.fail === 0 &&
        face.depthFail === 0,
    );
  r.require(
    state &&
      neutralStencil &&
      state.depthTestSource === 0 &&
      state.srcRgb === (straight ? B.SrcAlpha : B.One) &&
      state.dstRgb === (additive ? B.One : B.OneMinusSrcAlpha) &&
      state.srcAlpha === (straight ? B.SrcAlpha : B.One) &&
      state.dstAlpha === (additive ? B.One : B.OneMinusSrcAlpha) &&
      state.rgbOp === 0 &&
      state.alphaOp === 0 &&
      state.depthTest === CompareOp.LessEqual &&
      !state.depthWrite &&
      (state.cull === 0 || (material.model === MaterialModel.ParticleUnlit && state.cull === 2)),
    'CAPABILITY',
    `materials.${material.id}.renderState`,
    state,
    'Unsupported material render state',
  );
  let count = 4;
  if (definition.mode === RenderMode.Mesh) {
    r.require(
      definition.meshAssetIds.length > 0,
      'CAPABILITY',
      'meshAssetIds',
      definition.meshAssetIds,
      'Mesh renderer requires geometry',
    );
    r.require(
      definition.meshDistribution === MeshDistribution.UniformRandom ||
        definition.meshDistribution === MeshDistribution.NonUniformRandom,
      'CAPABILITY',
      'meshDistribution',
      definition.meshDistribution,
      'Unknown mesh distribution',
    );
    if (definition.meshDistribution === MeshDistribution.NonUniformRandom)
      r.require(
        definition.meshWeights.length === definition.meshAssetIds.length &&
          definition.meshWeights.every((w) => Number.isFinite(w) && w >= 0) &&
          Number.isFinite(definition.meshWeights.reduce((a, b) => a + b, 0)),
        'SEMANTIC',
        'meshWeights',
        definition.meshWeights,
        'Mesh weights must be finite, nonnegative and match mesh slots',
      );
    for (const [index, id] of definition.meshAssetIds.entries()) {
      const mesh = pack.getMesh(id);
      r.require(
        mesh && meshUV(mesh).length === mesh.positions.length && mesh.submeshes.length === 1,
        'CAPABILITY',
        `meshAssetIds.${index}`,
        id,
        'Mesh requires UV0 and one submesh',
      );
      r.require(
        !mesh || mesh.colors.every((c) => c.x === 1 && c.y === 1 && c.z === 1 && c.w === 1),
        'CAPABILITY',
        `meshAssetIds.${index}.colors`,
        id,
        'Authored mesh vertex colors are not implemented',
      );
    }
    count = rendererVertexStride(definition, pack);
  }
  r.require(
    count * capacity <= 1_000_000,
    'LIMIT',
    'maxParticles*vertices',
    count * capacity,
    'Expanded mesh vertex budget exceeded',
  );
  return r.issues;
}
