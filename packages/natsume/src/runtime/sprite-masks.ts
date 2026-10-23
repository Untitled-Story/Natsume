import { Texture } from 'pixi.js';
import type { EffectPack, DeepReadonly as R } from '../pack.js';
import type { Simulation } from './simulation.js';
import { ComponentData as C } from '../format/generated/noa/ir/component-data.js';
import type { SpriteMaskT } from '../format/generated/noa/ir/sprite-mask.js';
import type { ParticleRendererT } from '../format/generated/noa/ir/particle-renderer.js';
import type { SpriteRendererT } from '../format/generated/noa/ir/sprite-renderer.js';
import { MaterialT } from '../format/generated/noa/ir/material.js';
import { RenderStateT } from '../format/generated/noa/ir/render-state.js';
import { StencilStateT } from '../format/generated/noa/ir/stencil-state.js';
import { StencilFaceT } from '../format/generated/noa/ir/stencil-face.js';
import { MeshRendererT } from '../format/generated/noa/ir/mesh-renderer.js';
import { SpriteRendererT as SpriteDefinition } from '../format/generated/noa/ir/sprite-renderer.js';
import { SceneMesh } from '../rendering/scene-mesh.js';
import type { ParticleMesh } from '../rendering/particle-mesh.js';
import { spriteGeometry } from '../rendering/sprite-geometry.js';
import { spriteMaterial } from '../rendering/sprite-material.js';
import { spriteTextureKey } from '../rendering/sprite-texture.js';
/** Builds shared alpha silhouettes; each affected draw brackets its own union and cleanup. */
export async function createSpriteMasks(
  pack: EffectPack,
  simulation: Simulation,
  acquire: (m: R<MaterialT>, key: string) => Promise<Texture>,
) {
  const masks: { source: R<SpriteMaskT>; mesh: SceneMesh }[] = [];
  try {
    for (const c of pack.components) {
      if (c.dataType !== C.SpriteMask || !simulation.scene.nodes.has(c.nodeId)) continue;
      const source = c.data as R<SpriteMaskT>;
      if (!source.spriteAssetId) continue;
      const sprite = pack.document.assets.find((a) => a.id === source.spriteAssetId)!.sprite!;
      const base = new MaterialT();
      base.model = 6;
      base.renderState = new RenderStateT();
      base.renderState.colorWriteMask = 0;
      base.renderState.cull = 0;
      base.renderState.depthTest = 7;
      base.renderState.depthWrite = false;
      const face = new StencilFaceT();
      face.compare = 7;
      face.pass = 2;
      base.renderState.stencil = new StencilStateT(1, 1, 1, face, face);
      const material = spriteMaterial(base, sprite),
        texture = await acquire(material, spriteTextureKey(sprite));
      const mesh = new SceneMesh(
        simulation.scene.nodes.get(c.nodeId)!,
        new MeshRendererT(),
        material,
        spriteGeometry(pack, sprite, new SpriteDefinition()),
        0,
        texture,
        pack,
      );
      mesh.alphaCutoff = source.alphaCutoff;
      mesh.uiStencil = true;
      mesh.animationEnabled = () => simulation.bindings.enabled.get(c.id) ?? false;
      masks.push({ source, mesh });
    }
  } catch (error) {
    for (const { mesh } of masks) mesh.destroy();
    throw error;
  }
  return {
    meshes: masks.map((m) => m.mesh),
    attach(mesh: SceneMesh | ParticleMesh, definition: R<SpriteRendererT> | R<ParticleRendererT>) {
      if (!definition.maskInteraction) return;
      const rank =
          'sortingLayerRank' in definition
            ? definition.sortingLayerRank
            : definition.sortingLayerIndex,
        order = definition.sortingOrder;
      mesh.spriteMaskPasses = masks
        .filter(
          ({ source: m }) =>
            !m.customRange ||
            ((rank > m.backLayerIndex || (rank === m.backLayerIndex && order > m.backOrder)) &&
              (rank < m.frontLayerIndex || (rank === m.frontLayerIndex && order <= m.frontOrder))),
        )
        .map((m) => m.mesh);
      const face = new StencilFaceT();
      face.compare = 2;
      mesh.maskStencil = new StencilStateT(
        definition.maskInteraction === 1 ? 1 : 0,
        1,
        0,
        face,
        face,
      );
      mesh.uiStencil = true;
    },
  };
}
