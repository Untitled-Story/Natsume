import type { EffectPack } from '../pack.js';
import type { RenderEnvironment } from './render-environment.js';
import { ComponentData as C } from '../format/generated/noa/ir/component-data.js';
/** Canvas stores layer IDs; other source renderers also serialize the project rank. */
export function canvasSortingRank(
  pack: EffectPack,
  id: number,
  environment?: RenderEnvironment,
): number | undefined {
  if (id === 0) return 0;
  for (const c of pack.components) {
    if (
      c.dataType !== C.ParticleRenderer &&
      c.dataType !== C.SpriteRenderer &&
      c.dataType !== C.MeshRenderer
    )
      continue;
    const d = c.data as {
      sortingLayerId?: number;
      sourceSortingLayerId?: number;
      sortingLayerRank?: number;
      sortingLayerIndex?: number;
    };
    if ((d.sortingLayerId ?? d.sourceSortingLayerId) === id)
      return d.sortingLayerRank ?? d.sortingLayerIndex;
  }
  return environment?.sortingLayers?.[id];
}
