import type { DeepReadonly as R, EffectPack } from '../pack.js';
import type { ParticleRendererT } from '../format/generated/noa/ir/particle-renderer.js';
import { MeshDistribution } from '../format/generated/noa/ir/mesh-distribution.js';
import { RenderMode } from '../format/generated/noa/ir/render-mode.js';

/** Stable per-particle selection. Zero total weighting falls back to uniform. */
export function selectMesh(
  definition: R<ParticleRendererT>,
  uniformRandom: number,
  weightedRandom: number,
): number {
  const count = definition.meshAssetIds.length;
  if (count < 2) return 0;
  if (definition.meshDistribution === MeshDistribution.NonUniformRandom) {
    const total = definition.meshWeights.reduce((sum, weight) => sum + weight, 0);
    if (total > 0) {
      const target = weightedRandom * total;
      let end = 0;
      for (let i = 0; i < count; i++) {
        end += definition.meshWeights[i]!;
        if (target < end) return i;
      }
      return count - 1;
    }
  }
  return Math.min(count - 1, Math.floor(uniformRandom * count));
}

/** Per-particle vertex reservation; all mesh choices share one fixed stride. */
export function rendererVertexStride(definition: R<ParticleRendererT>, pack: EffectPack): number {
  return definition.mode === RenderMode.Mesh
    ? Math.max(0, ...definition.meshAssetIds.map((id) => pack.getMesh(id)?.positions.length ?? 0))
    : 4;
}
