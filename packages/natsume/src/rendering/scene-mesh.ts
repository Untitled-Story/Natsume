import type { StencilStateT } from '../format/generated/noa/ir/stencil-state.js';
import { check } from '../errors.js';
import { applyMaterialEnvironment } from './material-environment.js';
import type { ParticleEnvironment } from './particle-environment.js';
import { Buffer, BufferUsage, Geometry, GlProgram, Mesh, Shader, State, Texture } from 'pixi.js';
import { mat4 } from 'gl-matrix';
import type { DeepReadonly as R, EffectPack } from '../pack.js';
import type { MeshT } from '../format/generated/noa/mesh/mesh.js';
import type { MeshRendererT } from '../format/generated/noa/ir/mesh-renderer.js';
import type { MaterialT } from '../format/generated/noa/ir/material.js';
import type { ColorT } from '../format/generated/noa/ir/color.js';
import type { SceneNode } from '../runtime/scene.js';
import { MaterialModel as M } from '../format/generated/noa/ir/material-model.js';
import { meshUV } from '../format/mesh-attributes.js';
import { materialFragment } from './material-fragment.js';
import { usesGlobalMipBias } from './material-support.js';
import type { RenderEnvironment } from './render-environment.js';
import type { SourceColorSpace } from './particle-mesh.js';

const vertex = `#version 300 es
in vec3 aPosition;
in vec2 aUV;
in vec4 aColor;
uniform mat4 uDisplayWorld;
uniform mat4 uSourceWorld;
uniform vec4 uTextureST;
uniform vec4 uDepth;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform vec4 uColor;
uniform vec4 uRendererColor;
uniform mat4 uUIClipMatrix;
out vec2 vUV;
out vec4 vColor;
out float vCustom;
out float vDepth;
out vec2 vScreenUV;
out vec2 vUIPosition;
out vec3 vCanvasPosition;
void main(){
  vec4 world=uDisplayWorld*vec4(aPosition,1.0);
  vCanvasPosition=vec3(world.xy,world.w);
  vUIPosition=(uUIClipMatrix*uSourceWorld*vec4(aPosition,1.0)).xy;
  vec3 p=uProjectionMatrix*uWorldTransformMatrix*uTransformMatrix*vec3(world.xy,world.w);
  gl_Position=vec4(p.xy,world.z,world.w);
  vec4 host=uColor*uWorldColorAlpha;
  vColor=aColor*uRendererColor*vec4(host.a>0.0?host.rgb/host.a:vec3(0.0),host.a);
  vUV=aUV*uTextureST.xy+uTextureST.zw;vUV.y=1.0-vUV.y;vCustom=0.0;vDepth=max(0.0,dot(uDepth,uSourceWorld*vec4(aPosition,1.0)));vScreenUV=vec2(p.x/world.w*.5+.5,.5-p.y/world.w*.5);
}`;

/** Ordinary renderers map material slots to submeshes; surplus slots repeat the final submesh. */
export function sceneMaterialPasses(
  definition: R<MeshRendererT>,
  mesh?: R<MeshT>,
): readonly { slot: number; submesh: number }[] {
  if (!mesh?.submeshes.length) return [];
  if (definition.environment?.castShadows === 3) return [];
  return definition.materials.flatMap((id, slot) =>
    id ? [{ slot, submesh: Math.min(slot, mesh.submeshes.length - 1) }] : [],
  );
}

export class SceneMesh extends Mesh<Geometry, Shader> {
  override readonly renderPipeId = 'natsumeMaterials';
  canvasViewport: readonly number[] | undefined;
  spriteMaskPasses: readonly SceneMesh[] | undefined;
  maskStencil: R<StencilStateT> | undefined;
  alphaCutoff = -1;
  sortingDepth = 0;
  readonly definition: {
    readonly sortingLayerRank: number;
    readonly sortingOrder: number;
    readonly sortingFudge: number;
  };
  readonly transform = mat4.create();
  renderEnvironment: RenderEnvironment | undefined;
  environment: ParticleEnvironment | undefined;
  animationEnabled = () => true;
  rendererColor: (() => R<Pick<ColorT, 'r' | 'g' | 'b' | 'a'>>) | undefined;
  sortAtPivot = false;
  private readonly buffers: Buffer[];
  private readonly needsMipBias: boolean;
  private boundsCenter: readonly number[];
  geometryProvider: (() => R<MeshT> | undefined) | undefined;
  uiSortGroup: number | undefined;
  uiSequence = 0;
  uiOverlay = false;
  sortAtNode: SceneNode | undefined;
  uiStencil = false;
  clipContext:
    | (() =>
        | { matrix: ArrayLike<number>; rect: ArrayLike<number>; softness: ArrayLike<number> }
        | undefined)
    | undefined;
  beforeSync: (() => void) | undefined;
  uiContext: (() => { gamma: boolean; alphaClip: boolean }) | undefined;
  constructor(
    readonly node: SceneNode,
    definition: R<MeshRendererT>,
    readonly materialDefinition: R<MaterialT>,
    mesh: R<MeshT>,
    submesh: number,
    texture: Texture,
    pack: EffectPack,
  ) {
    const binding = materialDefinition.textures[0];
    const uv = meshUV(mesh, binding?.uvSet ?? 0);
    const data = new Float32Array(mesh.positions.length * 9);
    for (let i = 0; i < mesh.positions.length; i++) {
      const p = mesh.positions[i]!,
        t = uv[i],
        c = mesh.colors[i];
      data.set(
        [p.x, p.y, p.z, t?.x ?? 0, t?.y ?? 0, c?.x ?? 1, c?.y ?? 1, c?.z ?? 1, c?.w ?? 1],
        i * 9,
      );
    }
    const part = mesh.submeshes[submesh]!;
    const vb = new Buffer({ data, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    const ib = new Buffer({
      data: Uint32Array.from(
        mesh.indices.slice(part.firstIndex, part.firstIndex + part.indexCount),
      ),
      usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
    });
    const geometry = new Geometry({
      attributes: {
        aPosition: { buffer: vb, format: 'float32x3', stride: 36, offset: 0 },
        aUV: { buffer: vb, format: 'float32x2', stride: 36, offset: 12 },
        aColor: { buffer: vb, format: 'float32x4', stride: 36, offset: 20 },
      },
      indexBuffer: ib,
    });
    const model = materialDefinition.model;
    const code =
      model === M.ParticleAddAlpha
        ? 0
        : model === M.LegacyParticleAdditive
          ? 2
          : model === M.LegacyParticleAlphaBlend
            ? 3
            : model === M.SpriteDefault
              ? 4
              : model === M.UIDefault
                ? 5
                : model === M.TextureVertexColor
                  ? 6
                  : 1;
    const shader = new Shader({
      glProgram: GlProgram.from({
        name: 'natsume-scene-material',
        vertex,
        fragment: materialFragment,
      }),
      resources: {
        uTexture: texture.source,
        uSceneDepth: Texture.WHITE.source,
        colorUniforms: {
          uDisplayWorld: { value: mat4.create(), type: 'mat4x4<f32>' },
          uSourceWorld: { value: mat4.create(), type: 'mat4x4<f32>' },
          uTextureST: { value: new Float32Array([1, 1, 0, 0]), type: 'vec4<f32>' },
          uDepth: { value: new Float32Array(4), type: 'vec4<f32>' },
          uModel: { value: code, type: 'f32' },
          uMipBias: { value: 0, type: 'f32' },
          uUIAlphaClip: { value: 0, type: 'f32' },
          uMaskCutoff: { value: -1, type: 'f32' },
          uCanvasClip: { value: 0, type: 'f32' },
          uCanvasRect: { value: new Float32Array(4), type: 'vec4<f32>' },
          uUIClipMatrix: { value: mat4.create(), type: 'mat4x4<f32>' },
          uUIClip: { value: 0, type: 'f32' },
          uUIRect: { value: new Float32Array(4), type: 'vec4<f32>' },
          uUISoftness: { value: new Float32Array(2), type: 'vec2<f32>' },
          uTextureSampleAdd: { value: new Float32Array(4), type: 'vec4<f32>' },
          uTint: { value: new Float32Array([1, 1, 1, 1]), type: 'vec4<f32>' },
          uRendererColor: { value: new Float32Array([1, 1, 1, 1]), type: 'vec4<f32>' },
          uLinear: { value: 0, type: 'f32' },
          uTextureSRGB: { value: binding?.colorSpace === 1 ? 1 : 0, type: 'f32' },
          uVertexSRGB: { value: 0, type: 'f32' },
          uFog: { value: new Float32Array(4), type: 'vec4<f32>' },
          uFogColor: { value: new Float32Array(3), type: 'vec3<f32>' },
          uSoft: { value: 0, type: 'f32' },
          uInvFade: { value: 1, type: 'f32' },
          uDepthUV: { value: new Float32Array([1, 1, 0, 0]), type: 'vec4<f32>' },
        },
      },
    });
    const state = new State();
    state.depthTest = true;
    state.depthMask = materialDefinition.renderState!.depthWrite;
    state.cullMode =
      materialDefinition.renderState!.cull === 2
        ? 'front'
        : materialDefinition.renderState!.cull === 1
          ? 'back'
          : 'none';
    super({ geometry, shader, state, texture });
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (const p of mesh.positions)
      for (const [i, k] of (['x', 'y', 'z'] as const).entries()) {
        min[i] = Math.min(min[i]!, p[k]);
        max[i] = Math.max(max[i]!, p[k]);
      }
    this.boundsCenter = min.map((v, i) => (Number.isFinite(v) ? (v + max[i]!) * 0.5 : 0));
    this.buffers = [vb, ib];
    this.needsMipBias = usesGlobalMipBias(pack, materialDefinition);
    this.definition = {
      sortingLayerRank: definition.sortingLayerIndex,
      sortingOrder: definition.sortingOrder,
      sortingFudge: 0,
    };
    this.label = `Natsume mesh ${node.id}`;
    // Preserve source geometry; ST and origin conversion are applied to UV once.
  }
  private updateGeometry(mesh: R<MeshT>): void {
    const uv = meshUV(mesh, this.materialDefinition.textures[0]?.uvSet ?? 0),
      data = new Float32Array(mesh.positions.length * 9);
    for (let i = 0; i < mesh.positions.length; i++) {
      const p = mesh.positions[i]!,
        t = uv[i],
        c = mesh.colors[i];
      data.set(
        [p.x, p.y, p.z, t?.x ?? 0, t?.y ?? 0, c?.x ?? 1, c?.y ?? 1, c?.z ?? 1, c?.w ?? 1],
        i * 9,
      );
    }
    this.buffers[0]!.data = data;
    this.buffers[1]!.data = Uint32Array.from(mesh.indices);
    this.geometry.indexCount = mesh.indices.length;
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (const p of mesh.positions)
      for (const [i, k] of (['x', 'y', 'z'] as const).entries()) {
        min[i] = Math.min(min[i]!, p[k]);
        max[i] = Math.max(max[i]!, p[k]);
      }
    this.boundsCenter = min.map((v, i) => (Number.isFinite(v) ? (v + max[i]!) * 0.5 : 0));
    this.onViewUpdate();
  }
  prepareEnvironment(): void {
    const u = this.shader!.resources.colorUniforms.uniforms;
    u.uMipBias = this.needsMipBias ? (this.renderEnvironment?.globalMipBias ?? 0) : 0;
    applyMaterialEnvironment(this.shader!, this.environment);
    const binding = this.materialDefinition.textures[0];
    (u.uTextureST as Float32Array).set([
      binding?.scale?.x ?? 1,
      binding?.scale?.y ?? 1,
      binding?.offset?.x ?? 0,
      binding?.offset?.y ?? 0,
    ]);
    const depth = this.environment?.depth;
    check(
      typeof depth !== 'undefined' || Number.isFinite(this.parent?.zIndex ?? 0),
      'HOST',
      'Container zIndex must be finite for material depth',
    );
    (u.uDepth as Float32Array).set(
      Array.isArray(depth)
        ? depth
        : [0, 0, 0, typeof depth === 'number' ? depth : (this.parent?.zIndex ?? 0)],
    );
    u.uInvFade = this.materialDefinition.floats.find((f) => f.name === '_InvFade')?.value ?? 1;
    const c = this.materialDefinition.tint;
    (u.uTint as Float32Array).set(c ? [c.r, c.g, c.b, c.a] : [1, 1, 1, 1]);
    u.uCanvasClip = this.canvasViewport ? 1 : 0;
    if (this.canvasViewport) (u.uCanvasRect as Float32Array).set(this.canvasViewport);
    const clip = this.clipContext?.();
    u.uUIClip = clip ? 1 : 0;
    if (clip) {
      (u.uUIClipMatrix as Float32Array).set(clip.matrix);
      (u.uUIRect as Float32Array).set(clip.rect);
      (u.uUISoftness as Float32Array).set(clip.softness);
    }
    const ui = this.uiContext?.();
    u.uVertexSRGB = ui?.gamma ? 1 : 0;
    u.uUIAlphaClip = ui?.alphaClip ? 1 : 0;
    u.uMaskCutoff = this.alphaCutoff;
    const add = this.materialDefinition.vectors.find((v) => v.name === '_TextureSampleAdd')?.value;
    (u.uTextureSampleAdd as Float32Array).set(add ? [add.x, add.y, add.z, add.w] : [0, 0, 0, 0]);
    const r = this.rendererColor?.();
    (u.uRendererColor as Float32Array).set(r ? [r.r, r.g, r.b, r.a] : [1, 1, 1, 1]);
  }
  sync(matrix: ArrayLike<number>, colorSpace: SourceColorSpace): void {
    this.visible = this.animationEnabled() && this.node.activeInHierarchy;
    if (!this.visible) return;
    this.beforeSync?.();
    if (!this.visible) return;
    const geometry = this.geometryProvider?.();
    if (geometry) this.updateGeometry(geometry);
    // Unity compensates odd negative object scale when classifying triangle faces.
    const cull = this.materialDefinition.renderState!.cull;
    if (cull !== 0)
      this.state.clockwiseFrontFace = (cull === 2) !== mat4.determinant(this.node.worldMatrix) < 0;
    mat4.multiply(this.transform, matrix as mat4, this.node.worldMatrix);
    const u = this.shader!.resources.colorUniforms.uniforms;
    (u.uDisplayWorld as Float32Array).set(this.transform);
    (u.uSourceWorld as Float32Array).set(this.node.worldMatrix);
    u.uLinear = colorSpace === 'linear' ? 1 : 0;
    this.sortingDepth = this.sortAtPivot
      ? this.transform[14]!
      : this.transform[2]! * this.boundsCenter[0]! +
        this.transform[6]! * this.boundsCenter[1]! +
        this.transform[10]! * this.boundsCenter[2]! +
        this.transform[14]!;
    if (this.sortAtNode) {
      const w = this.sortAtNode.worldMatrix;
      this.sortingDepth =
        matrix[2]! * w[12]! + matrix[6]! * w[13]! + matrix[10]! * w[14]! + matrix[14]!;
    }
    this.prepareEnvironment();
  }
  override destroy(): void {
    const geometry = this.geometry,
      shader = this.shader;
    super.destroy();
    geometry.destroy();
    for (const b of this.buffers) b.destroy();
    shader?.destroy();
  }
}
