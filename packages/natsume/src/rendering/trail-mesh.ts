import type { Texture } from 'pixi.js';
import type { DeepReadonly as R, EffectPack } from '../pack.js';
import type { MaterialT } from '../format/generated/noa/ir/material.js';
import type { ParticleRendererT } from '../format/generated/noa/ir/particle-renderer.js';
import { MeshRendererT } from '../format/generated/noa/ir/mesh-renderer.js';
import { MeshT } from '../format/generated/noa/mesh/mesh.js';
import { SubmeshT } from '../format/generated/noa/mesh/submesh.js';
import type { ParticleTrails } from '../runtime/particle-trails.js';
import { SceneMesh } from './scene-mesh.js';
import { TrailGeometry } from './trail-geometry.js';
import { VertexSemantic } from '../format/generated/noa/ir/vertex-semantic.js';

/** Independent trail material pass; particle material slots are never used as a fallback. */
export class TrailMesh extends SceneMesh {
  readonly trailGeometry = new TrailGeometry();
  constructor(
    readonly trails: ParticleTrails,
    definition: R<ParticleRendererT>,
    material: R<MaterialT>,
    texture: Texture,
    pack: EffectPack,
  ) {
    const renderer = new MeshRendererT();
    renderer.sortingLayerIndex = definition.sortingLayerRank;
    renderer.sortingOrder = definition.sortingOrder;
    const geometry = new MeshT();
    geometry.submeshes = [new SubmeshT()];
    super(trails.emitter.node, renderer, material, geometry, 0, texture, pack, 10);
    this.worldSpaceGeometry = true;
    this.definition.sortingFudge = definition.sortingFudge;
    this.shader!.resources.colorUniforms.uniforms.uUseCustom = definition.trailVertexStreams?.some(
      (s) => s.semantic === VertexSemantic.Custom1,
    )
      ? 1
      : 0;
    this.label = `Natsume trails ${trails.emitter.id}`;
    this.beforeSync = () => {
      this.trailGeometry.update(trails, this.environment?.viewPosition);
      const data = this.trailGeometry;
      this.visible = data.indexCount > 0;
      if (this.visible)
        this.updateDynamicGeometry(data.vertices, data.indices, data.vertexCount, data.indexCount);
    };
  }
}
