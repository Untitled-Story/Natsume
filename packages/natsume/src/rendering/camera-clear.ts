import { Texture } from 'pixi.js';
import { mat4 } from 'gl-matrix';
import { SceneMesh } from './scene-mesh.js';
import type { AuthoredCamera } from './camera-environment.js';
import type { EffectPack } from '../pack.js';
import { MeshRendererT } from '../format/generated/noa/ir/mesh-renderer.js';
import { MaterialT } from '../format/generated/noa/ir/material.js';
import { ColorT } from '../format/generated/noa/ir/color.js';
import { RenderStateT } from '../format/generated/noa/ir/render-state.js';
import { MeshT } from '../format/generated/noa/mesh/mesh.js';
import { Vec3T } from '../format/generated/noa/mesh/vec3.js';
import { SubmeshT } from '../format/generated/noa/mesh/submesh.js';
const clearColorContext = Object.freeze({ gamma: true, alphaClip: false });

/** Far-plane quad clears only this viewport and respects the host's transforms and masks. */
export class CameraClearMesh extends SceneMesh {
  private readonly identity = mat4.create();
  private readonly vertices = new Float32Array(36);
  private readonly indices = Uint32Array.from([0, 1, 2, 0, 2, 3]);
  constructor(
    readonly camera: AuthoredCamera,
    pack: EffectPack,
  ) {
    const source = new MeshT();
    source.positions = Array.from({ length: 4 }, () => new Vec3T());
    source.indices = [0, 1, 2, 0, 2, 3];
    source.submeshes = [new SubmeshT(0, 6)];
    const material = new MaterialT();
    material.model = 6;
    material.tint = new ColorT(1, 1, 1, 1);
    material.renderState = new RenderStateT();
    material.renderState.srcRgb = material.renderState.srcAlpha = 1;
    material.renderState.dstRgb = material.renderState.dstAlpha = 0;
    material.renderState.depthTest = 7;
    material.renderState.depthWrite = true;
    super(camera.node, new MeshRendererT(), material, source, 0, Texture.WHITE, pack);
    this.worldSpaceGeometry = true;
    this.label = `Natsume camera clear ${camera.id}`;
    for (let i = 0; i < 4; i++) this.vertices.fill(1, i * 9 + 5, i * 9 + 9);
    this.rendererColor = () => camera.definition.background ?? { r: 0, g: 0, b: 0, a: 0 };
    // Unity converts the serialized sRGB background before clearing a linear target.
    this.uiContext = () => clearColorContext;
  }
  updateClear(colorSpace: 'gamma' | 'linear'): void {
    const c = this.camera.definition,
      v = this.camera.viewport;
    for (let i = 0; i < 4; i++) {
      this.vertices[i * 9] = v[i === 1 || i === 2 ? 2 : 0]!;
      this.vertices[i * 9 + 1] = v[i >= 2 ? 3 : 1]!;
      this.vertices[i * 9 + 2] = 1;
    }
    this.updateDynamicGeometry(this.vertices, this.indices, 4, 6);
    (this.materialDefinition.renderState as RenderStateT).colorWriteMask = c.clear === 2 ? 0 : 15;
    this.sync(this.identity, colorSpace);
    this.visible = this.visible && c.clear !== 3;
  }
}
