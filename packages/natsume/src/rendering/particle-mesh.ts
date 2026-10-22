import { usesGlobalMipBias } from './material-support.js';
import type { RenderEnvironment } from './render-environment.js';
import { materialFragment as fragment } from './material-fragment.js';
export { ensureMaterialPipe as ensureParticlePipe } from './material-pipe.js';
import { meshUV } from '../format/mesh-attributes.js';
import { speedSize } from '../runtime/speed-modules.js';
import { selectMesh, rendererVertexStride } from './mesh-selection.js';
import { rendererSupport } from './renderer-support.js';
import { stretchInverseLength } from './stretch-normalization.js';
import { assertSupport } from '../runtime/support-checks.js';
import { Buffer, BufferUsage, Geometry, Mesh, Shader, GlProgram, State, Texture } from 'pixi.js';
import { check } from '../errors.js';
import type { EffectPack, DeepReadonly as R } from '../pack.js';
import type { ParticleRendererT } from '../format/generated/noa/ir/particle-renderer.js';
import type { MaterialT } from '../format/generated/noa/ir/material.js';
import { MaterialModel } from '../format/generated/noa/ir/material-model.js';
import { RenderMode } from '../format/generated/noa/ir/render-mode.js';
import { Alignment } from '../format/generated/noa/ir/alignment.js';
import { ParticleSort } from '../format/generated/noa/ir/particle-sort.js';
import { ColorSpace } from '../format/generated/noa/ir/color-space.js';
import { VertexSemantic } from '../format/generated/noa/ir/vertex-semantic.js';
import { mat4, vec3 } from 'gl-matrix';
import { color, random, scalar, sheetFrame } from '../runtime/parameters.js';
import type { Emitter } from '../runtime/emitter.js';
import type { ParticleEnvironment } from './particle-environment.js';

const EMPTY_UV = Object.freeze({ x: 0, y: 0 });
const vertex = `#version 300 es
in vec3 aPosition;
in vec2 aUV;
in vec4 aColor;
in float aCustom;
in vec2 aCenter;
in vec2 aEdgeX;
in vec2 aEdgeY;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform vec4 uColor;
uniform float uMaxSize;
uniform float uMinSize;
uniform float uModel;
uniform float uDepthMode;
uniform float uDepthConstant;
out vec2 vUV;
out vec4 vColor;
out float vCustom;
out float vDepth;
out vec2 vScreenUV;
void main(){
  mat3 transform=uProjectionMatrix*uWorldTransformMatrix*uTransformMatrix;
  vec3 p=transform*vec3(aPosition.xy,1.0);
  vec2 center=(transform*vec3(aCenter,1.0)).xy;
  vec2 extent=abs((transform*vec3(aEdgeX,0.0)).xy)+abs((transform*vec3(aEdgeY,0.0)).xy);
  float size=max(max(extent.x,extent.y)*0.5,0.000001);
  float factor=clamp(uMaxSize/size,uMinSize/size,1.0);
  p.xy=center+(p.xy-center)*factor;
  gl_Position=vec4(p.xy,aPosition.z,1.0);
  vScreenUV=vec2(p.x*0.5+0.5,0.5-p.y*0.5);
  vDepth=max(0.0,uDepthMode>0.5?aCustom:uDepthConstant);
  vec4 host=uColor*uWorldColorAlpha;
  vec3 tint=host.a>0.0?host.rgb/host.a:vec3(0.0);
  vUV=aUV;vColor=aColor*vec4(tint,host.a);vCustom=aCustom;
}`;

export type SourceColorSpace = 'gamma' | 'linear';
export class ParticleMesh extends Mesh<Geometry, Shader> {
  override readonly renderPipeId = 'natsumeMaterials';
  readonly colorWriteMask: number;
  readonly straightAlpha: boolean;
  readonly additive: boolean;
  environment: ParticleEnvironment | undefined;
  renderEnvironment: RenderEnvironment | undefined;
  private readonly needsMipBias: boolean;
  get node() {
    return this.emitter.node;
  }
  /** @internal View-axis bounds center in world units, before sortingFudge. */
  sortingDepth = 0;
  private readonly vertices: Float32Array;
  private readonly vertexBuffer: Buffer;
  private readonly indexBuffer: Buffer;
  private readonly indexData: Uint32Array;
  private readonly sortKeys: Float64Array;
  private readonly particleOrder: number[] = [];
  private readonly basePositions: readonly {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  }[];
  private readonly baseUV: readonly { readonly x: number; readonly y: number }[];
  private readonly baseIndices: readonly number[];
  private readonly pivotSize: readonly number[];
  private readonly meshChoices;
  private readonly meshSelections: Uint32Array;
  private readonly vertexStride: number;
  private readonly scratchColor = new Float32Array(4);
  private readonly rotationMatrix = mat4.create();
  private readonly viewForward = vec3.create();
  private readonly stretchView = new Float32Array(9);
  private readonly viewUp = vec3.create();
  private readonly basisRight = vec3.create();
  private readonly basisUp = vec3.create();
  private readonly basisForward = vec3.create();
  private readonly binding;
  private readonly inverseFade;
  animationEnabled = () => true;
  constructor(
    readonly emitter: Emitter,
    readonly definition: R<ParticleRendererT>,
    readonly materialDefinition: R<MaterialT>,
    texture: Texture,
    pack: EffectPack,
    environment?: ParticleEnvironment,
    renderEnvironment?: RenderEnvironment,
  ) {
    const material = materialDefinition;
    const legacy =
      material.model === MaterialModel.LegacyParticleAdditive ||
      material.model === MaterialModel.LegacyParticleAlphaBlend;
    const straight = material.model !== MaterialModel.ParticleAddAlpha;
    const additive = material.model === MaterialModel.LegacyParticleAdditive;
    const state = material.renderState!;
    assertSupport(
      rendererSupport(
        definition,
        material,
        pack,
        emitter.main.maxParticles,
        environment,
        renderEnvironment,
      ),
    );
    if (
      definition.alignment === Alignment.Velocity ||
      definition.mode === RenderMode.StretchedBillboard
    )
      emitter.renderVelocities ??= emitter.velocities.slice();
    let positions: typeof ParticleMesh.prototype.basePositions = [
      { x: -0.5, y: -0.5, z: 0 },
      { x: 0.5, y: -0.5, z: 0 },
      { x: 0.5, y: 0.5, z: 0 },
      { x: -0.5, y: 0.5, z: 0 },
    ];
    let uv: typeof ParticleMesh.prototype.baseUV = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    let meshIndices: readonly number[] = [0, 1, 2, 0, 2, 3];
    if (definition.mode === RenderMode.StretchedBillboard)
      uv = [
        { x: 0, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 0 },
        { x: 0, y: 0 },
      ];
    if (definition.mode === RenderMode.Mesh) {
      const mesh = pack.getMesh(definition.meshAssetIds[0]!);
      check(mesh, 'SEMANTIC', 'Missing mesh');
      positions = mesh.positions;
      uv = meshUV(mesh, material.textures[0]?.uvSet ?? 0);
      meshIndices = mesh.indices;
    }
    const choices =
      definition.mode === RenderMode.Mesh
        ? definition.meshAssetIds.map((id) => {
            const mesh = pack.getMesh(id)!;
            const min = [Infinity, Infinity, Infinity],
              max = [-Infinity, -Infinity, -Infinity];
            for (const p of mesh.positions)
              for (const [axis, key] of (['x', 'y', 'z'] as const).entries()) {
                min[axis] = Math.min(min[axis]!, p[key]);
                max[axis] = Math.max(max[axis]!, p[key]);
              }
            return {
              positions: mesh.positions,
              uv: meshUV(mesh, material.textures[0]?.uvSet ?? 0),
              colors: mesh.colors,
              indices: mesh.indices,
              pivotSize: max.map((value, axis) => value - min[axis]!),
            };
          })
        : [];
    const stride = rendererVertexStride(definition, pack);
    const vertices = new Float32Array(stride * emitter.ages.length * 16);
    const indices = new Uint32Array(
      Math.max(meshIndices.length, ...choices.map((m) => m.indices.length)) * emitter.ages.length,
    );
    for (let i = 0; i < emitter.ages.length; i++)
      for (let k = 0; k < meshIndices.length; k++)
        indices[i * meshIndices.length + k] = i * stride + meshIndices[k]!;
    const vertexBuffer = new Buffer({
      data: vertices,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    });
    const indexBuffer = new Buffer({
      data: indices,
      usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
    });
    const geometry = new Geometry({
      attributes: {
        aPosition: { buffer: vertexBuffer, format: 'float32x3', stride: 64, offset: 0 },
        aUV: { buffer: vertexBuffer, format: 'float32x2', stride: 64, offset: 12 },
        aColor: { buffer: vertexBuffer, format: 'float32x4', stride: 64, offset: 20 },
        aCustom: { buffer: vertexBuffer, format: 'float32', stride: 64, offset: 36 },
        aCenter: { buffer: vertexBuffer, format: 'float32x2', stride: 64, offset: 40 },
        aEdgeX: { buffer: vertexBuffer, format: 'float32x2', stride: 64, offset: 48 },
        aEdgeY: { buffer: vertexBuffer, format: 'float32x2', stride: 64, offset: 56 },
      },
      indexBuffer,
    });
    const shader = new Shader({
      glProgram: GlProgram.from({ name: 'natsume-particle-add-alpha', vertex, fragment }),
      resources: {
        uTexture: texture.source,
        uSceneDepth: Texture.WHITE.source,
        colorUniforms: {
          uMipBias: { value: 0, type: 'f32' },
          uModel: {
            value: legacy
              ? additive
                ? 2
                : 3
              : material.model === MaterialModel.SpriteDefault
                ? 4
                : material.model === MaterialModel.UIDefault
                  ? 5
                  : material.model === MaterialModel.TextureVertexColor
                    ? 6
                    : straight
                      ? 1
                      : 0,
            type: 'f32',
          },
          uTint: {
            value: new Float32Array([
              material.tint?.r ?? 1,
              material.tint?.g ?? 1,
              material.tint?.b ?? 1,
              material.tint?.a ?? 1,
            ]),
            type: 'vec4<f32>',
          },
          uDepthMode: { value: 0, type: 'f32' },
          uDepthConstant: { value: 0, type: 'f32' },
          uFog: { value: new Float32Array(4), type: 'vec4<f32>' },
          uFogColor: { value: new Float32Array(3), type: 'vec3<f32>' },
          uSoft: { value: 0, type: 'f32' },
          uInvFade: {
            value: material.floats.find((p) => p.name === '_InvFade')?.value ?? 1,
            type: 'f32',
          },
          uDepthUV: { value: new Float32Array([1, 1, 0, 0]), type: 'vec4<f32>' },
          uVertexSRGB: { value: definition.applyActiveColorSpace ? 1 : 0, type: 'f32' },
          uMaxSize: {
            value: definition.mode !== RenderMode.Mesh ? definition.maxSize : 1e20,
            type: 'f32',
          },
          uMinSize: {
            value: definition.mode !== RenderMode.Mesh ? definition.minSize : 0,
            type: 'f32',
          },
          uLinear: { value: 0, type: 'f32' },
          uTextureSRGB: {
            value: material.textures[0]?.colorSpace === ColorSpace.SRGB ? 1 : 0,
            type: 'f32',
          },
        },
      },
    });
    const pixiState = new State();
    pixiState.depthTest = true;
    pixiState.depthMask = state.depthWrite;
    pixiState.cullMode = state.cull === 2 ? 'back' : state.cull === 1 ? 'front' : 'none';
    super({ geometry, shader, state: pixiState, texture });
    this.needsMipBias = usesGlobalMipBias(pack, material);
    this.renderEnvironment = renderEnvironment;
    this.straightAlpha = straight;
    this.additive = additive;
    this.environment = environment;
    this.vertices = vertices;
    this.vertexBuffer = vertexBuffer;
    this.indexBuffer = indexBuffer;
    this.indexData = indices;
    this.sortKeys = new Float64Array(emitter.ages.length);
    this.meshChoices = choices;
    this.meshSelections = new Uint32Array(emitter.ages.length);
    this.vertexStride = stride;
    this.basePositions = positions;
    this.baseUV = uv;
    this.baseIndices = meshIndices;
    this.pivotSize = [1, 1, 1];
    if (definition.mode === RenderMode.Mesh) {
      const min = [Infinity, Infinity, Infinity],
        max = [-Infinity, -Infinity, -Infinity];
      for (const p of positions)
        for (const [axis, key] of (['x', 'y', 'z'] as const).entries()) {
          min[axis] = Math.min(min[axis]!, p[key]);
          max[axis] = Math.max(max[axis]!, p[key]);
        }
      this.pivotSize = max.map((value, axis) => value - min[axis]!);
    }
    this.binding = material.textures[0];
    this.inverseFade = material.floats.find((p) => p.name === '_InvFade');
    const mask = state.colorWriteMask;
    this.colorWriteMask =
      (mask & 1 ? 8 : 0) | (mask & 2 ? 4 : 0) | (mask & 4 ? 2 : 0) | (mask & 8 ? 1 : 0);
    this.label = `Natsume renderer ${emitter.id}`;
    this.visible = false;
  }
  /** @internal Refreshes host inputs immediately before each draw, including paused instances. */
  prepareEnvironment(): void {
    const env = this.environment,
      fog = env?.fog,
      u = this.shader!.resources.colorUniforms.uniforms;
    u.uMipBias = this.needsMipBias ? (this.renderEnvironment?.globalMipBias ?? 0) : 0;
    u.uDepthMode = Array.isArray(env?.depth) ? 1 : 0;
    u.uDepthConstant = typeof env?.depth === 'number' ? env.depth : (this.parent?.zIndex ?? 0);
    check(
      Number.isFinite(u.uDepthConstant),
      'HOST',
      'Container zIndex must be finite for particle depth',
    );
    const f = u.uFog as Float32Array;
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
    this.shader!.resources.uSceneDepth = soft?.depthTexture.source ?? Texture.WHITE.source;
    (u.uDepthUV as Float32Array).set(soft?.uvTransform ?? [1, 1, 0, 0]);
  }
  sync(matrix: ArrayLike<number>, colorSpace: SourceColorSpace): void {
    const e = this.emitter,
      n = e.count;
    this.visible = this.animationEnabled() && e.node.activeInHierarchy && n > 0;
    if (!this.visible) return;
    const uniforms = this.shader!.resources.colorUniforms.uniforms,
      tintColor = this.materialDefinition.tint;
    if (tintColor)
      (uniforms.uTint as Float32Array).set([tintColor.r, tintColor.g, tintColor.b, tintColor.a]);
    uniforms.uInvFade = this.inverseFade?.value ?? 1;
    this.shader!.resources.colorUniforms.uniforms.uLinear = colorSpace === 'linear' ? 1 : 0;
    e.updateSpace();
    const world = e.simulationMatrix,
      v = this.vertices,
      stride = this.vertexStride,
      material = this.materialDefinition,
      tint = this.straightAlpha ? null : material.tint;
    if (this.definition.alignment === Alignment.Local)
      mat4.fromQuat(this.rotationMatrix, e.node.worldRotation);
    else mat4.identity(this.rotationMatrix);
    vec3.set(this.viewForward, matrix[2]!, matrix[6]!, matrix[10]!);
    if (vec3.length(this.viewForward) < 1e-8) vec3.set(this.viewForward, 0, 0, 1);
    vec3.normalize(this.viewForward, this.viewForward);
    let minimumX = Infinity,
      minimumY = Infinity,
      minimumZ = Infinity,
      maximumX = -Infinity,
      maximumY = -Infinity,
      maximumZ = -Infinity;
    vec3.set(this.basisRight, matrix[0]!, matrix[4]!, matrix[8]!);
    vec3.cross(this.viewUp, this.viewForward, this.basisRight);
    if (vec3.length(this.viewUp) < 1e-8) vec3.set(this.viewUp, 0, 1, 0);
    vec3.normalize(this.viewUp, this.viewUp);
    const rotation = this.rotationMatrix,
      localScale = { x: e.particleScale[0]!, y: e.particleScale[1]!, z: e.particleScale[2]! },
      rotationSign = this.definition.mode === RenderMode.Billboard ? -1 : 1;
    const normalizeStretch =
      this.definition.mode === RenderMode.StretchedBillboard &&
      !this.definition.freeformStretching &&
      this.definition.lengthScale !== 0;
    const stretchView = this.stretchView;
    if (normalizeStretch) {
      for (let axis = 0; axis < 3; axis++) {
        const scale =
          Math.fround(Math.hypot(matrix[axis]!, matrix[axis + 4]!, matrix[axis + 8]!)) || 1;
        for (let column = 0; column < 3; column++)
          stretchView[axis + column * 3] = matrix[axis + column * 4]! / scale;
      }
    }
    if (this.definition.alignment === Alignment.View) {
      vec3.cross(this.basisRight, this.viewUp, this.viewForward);
      if (vec3.length(this.basisRight) < 1e-8) vec3.set(this.basisRight, 1, 0, 0);
      vec3.normalize(this.basisRight, this.basisRight);
      vec3.cross(this.basisUp, this.viewForward, this.basisRight);
      for (let axis = 0; axis < 3; axis++) {
        rotation[axis] = this.basisRight[axis]!;
        rotation[axis + 4] = this.basisUp[axis]!;
        rotation[axis + 8] = this.viewForward[axis]!;
      }
    }
    for (let i = 0; i < n; i++) {
      const serial = e.serials[i]!,
        rnd = (c: number) => random(e.seed, serial, c),
        o = i * 3,
        t = e.ages[i]! / e.lifetimes[i]!;
      const meshIndex = selectMesh(this.definition, rnd(70), rnd(71));
      this.meshSelections[i] = meshIndex;
      const choice = this.meshChoices[meshIndex];
      const positions = choice?.positions ?? this.basePositions;
      const uvs = choice?.uv ?? this.baseUV;
      const pivotSize = choice?.pivotSize ?? this.pivotSize;
      const plane =
        this.definition.mode === RenderMode.HorizontalBillboard ||
        this.definition.mode === RenderMode.VerticalBillboard;
      if (
        !plane &&
        (this.definition.alignment === Alignment.Facing ||
          this.definition.alignment === Alignment.Velocity)
      ) {
        const position = this.environment?.viewPosition;
        const px = e.positions[o]!,
          py = e.positions[o + 1]!,
          pz = e.positions[o + 2]!;
        if (this.definition.alignment === Alignment.Facing) {
          vec3.set(
            this.basisForward,
            world[0]! * px + world[4]! * py + world[8]! * pz + world[12]! - position![0],
            world[1]! * px + world[5]! * py + world[9]! * pz + world[13]! - position![1],
            world[2]! * px + world[6]! * py + world[10]! * pz + world[14]! - position![2],
          );
        } else if (this.definition.alignment === Alignment.Velocity) {
          const velocity = e.renderVelocities ?? e.velocities;
          vec3.set(
            this.basisForward,
            world[0]! * velocity[o]! + world[4]! * velocity[o + 1]! + world[8]! * velocity[o + 2]!,
            world[1]! * velocity[o]! + world[5]! * velocity[o + 1]! + world[9]! * velocity[o + 2]!,
            world[2]! * velocity[o]! + world[6]! * velocity[o + 1]! + world[10]! * velocity[o + 2]!,
          );
        } else vec3.copy(this.basisForward, this.viewForward);
        if (vec3.length(this.basisForward) < 1e-8) vec3.copy(this.basisForward, this.viewForward);
        vec3.normalize(this.basisForward, this.basisForward);
        if (this.definition.alignment === Alignment.Velocity)
          vec3.cross(this.basisRight, this.viewForward, this.basisForward);
        else vec3.cross(this.basisRight, this.viewUp, this.basisForward);
        if (vec3.length(this.basisRight) < 1e-8) {
          vec3.cross(
            this.basisRight,
            Math.abs(this.basisForward[1]!) > 0.99 ? [1, 0, 0] : [0, 1, 0],
            this.basisForward,
          );
        }
        vec3.normalize(this.basisRight, this.basisRight);
        vec3.cross(this.basisUp, this.basisForward, this.basisRight);
        for (let axis = 0; axis < 3; axis++) {
          rotation[axis] = this.basisRight[axis]!;
          rotation[4 + axis] = this.basisUp[axis]!;
          rotation[8 + axis] = this.basisForward[axis]!;
        }
      }
      const size = e.sizeModule;
      let sx = e.startSizes[o]!,
        sy = e.startSizes[o + 1]!,
        sz = e.startSizes[o + 2]!;
      if (size) {
        // Unity shares one lifetime-size random factor across separate axes.
        const factor = rnd(50),
          uniform = scalar(size.size?.x, t, factor, 1);
        sx *= uniform;
        sy *= size.separateAxes ? scalar(size.size?.y, t, factor, 1) : uniform;
        sz *= size.separateAxes ? scalar(size.size?.z, t, factor, 1) : uniform;
      }
      if (e.sizeBySpeed) {
        const size = e.sizeBySpeed;
        const speed = e.moduleSpeeds![i]!;
        const factor = rnd(73);
        sx *= speedSize(size, speed, factor, 0);
        sy *= speedSize(size, speed, factor, 1);
        sz *= speedSize(size, speed, factor, 2);
      }
      if (e.noiseSizes) {
        sx *= e.noiseSizes[o]!;
        sy *= e.noiseSizes[o + 1]!;
        sz *= e.noiseSizes[o + 2]!;
      }
      let stretchX = 0,
        stretchY = 0,
        stretchZ = 0,
        stretchWidthX = 0,
        stretchWidthY = 0,
        stretchWidthZ = 0,
        stretchLength = 0,
        stretchSpeed = 0,
        freeformFactor = 1;
      const stretched = this.definition.mode === RenderMode.StretchedBillboard;
      if (stretched) {
        const velocity = e.renderVelocities!,
          vx = velocity[o]!,
          vy = velocity[o + 1]!,
          vz = velocity[o + 2]!;
        const view = this.environment?.viewVelocity,
          cameraScale = this.definition.cameraVelocityScale;
        stretchX =
          world[0]! * vx + world[4]! * vy + world[8]! * vz - (view?.[0] ?? 0) * cameraScale;
        stretchY =
          world[1]! * vx + world[5]! * vy + world[9]! * vz - (view?.[1] ?? 0) * cameraScale;
        stretchZ =
          world[2]! * vx + world[6]! * vy + world[10]! * vz - (view?.[2] ?? 0) * cameraScale;
        const length = Math.hypot(stretchX, stretchY, stretchZ);
        stretchSpeed = length;
        let lengthNormalization = 1;
        if (normalizeStretch && length > 1e-8) {
          // Native normalization runs after rotating velocity into view space.
          // Remove host display scaling before reproducing its Float32 lookup boundary.
          const viewX = Math.fround(
            Math.fround(
              Math.fround(stretchView[0]! * stretchX) + Math.fround(stretchView[3]! * stretchY),
            ) + Math.fround(stretchView[6]! * stretchZ),
          );
          const viewY = Math.fround(
            Math.fround(
              Math.fround(stretchView[1]! * stretchX) + Math.fround(stretchView[4]! * stretchY),
            ) + Math.fround(stretchView[7]! * stretchZ),
          );
          const viewZ = Math.fround(
            Math.fround(
              Math.fround(stretchView[2]! * stretchX) + Math.fround(stretchView[5]! * stretchY),
            ) + Math.fround(stretchView[8]! * stretchZ),
          );
          const squaredLength = Math.fround(
            Math.fround(Math.fround(viewX * viewX) + Math.fround(viewY * viewY)) +
              Math.fround(viewZ * viewZ),
          );
          lengthNormalization = length * stretchInverseLength(squaredLength);
        }
        stretchLength =
          sy * localScale.y * this.definition.lengthScale * lengthNormalization +
          length * this.definition.velocityScale;
        if (length > 1e-8) {
          stretchX /= length;
          stretchY /= length;
          stretchZ /= length;
          const position = this.environment?.viewPosition;
          if (position) {
            const px = e.positions[o]!,
              py = e.positions[o + 1]!,
              pz = e.positions[o + 2]!;
            const rx = world[0]! * px + world[4]! * py + world[8]! * pz + world[12]! - position[0];
            const ry = world[1]! * px + world[5]! * py + world[9]! * pz + world[13]! - position[1];
            const rz = world[2]! * px + world[6]! * py + world[10]! * pz + world[14]! - position[2];
            stretchWidthX = stretchY * rz - stretchZ * ry;
            stretchWidthY = stretchZ * rx - stretchX * rz;
            stretchWidthZ = stretchX * ry - stretchY * rx;
            // Unity projects the ray/velocity cross product before normalizing.
            const dot =
              stretchWidthX * this.viewForward[0]! +
              stretchWidthY * this.viewForward[1]! +
              stretchWidthZ * this.viewForward[2]!;
            stretchWidthX -= dot * this.viewForward[0]!;
            stretchWidthY -= dot * this.viewForward[1]!;
            stretchWidthZ -= dot * this.viewForward[2]!;
          }
          let width = Math.hypot(stretchWidthX, stretchWidthY, stretchWidthZ);
          if (width < 1e-8) {
            stretchWidthX = stretchY * this.viewForward[2]! - stretchZ * this.viewForward[1]!;
            stretchWidthY = stretchZ * this.viewForward[0]! - stretchX * this.viewForward[2]!;
            stretchWidthZ = stretchX * this.viewForward[1]! - stretchY * this.viewForward[0]!;
            width = Math.hypot(stretchWidthX, stretchWidthY, stretchWidthZ);
          }
          if (width > 1e-8) {
            stretchWidthX /= width;
            stretchWidthY /= width;
            stretchWidthZ /= width;
          } else {
            // Axial velocity without a usable ray has no unique transverse edge.
            const px = e.positions[o]!,
              py = e.positions[o + 1]!,
              pz = e.positions[o + 2]!;
            const wx = world[0]! * px + world[4]! * py + world[8]! * pz + world[12]!;
            const wy = world[1]! * px + world[5]! * py + world[9]! * pz + world[13]!;
            const radial = Math.hypot(wx, wy);
            stretchWidthX = radial > 1e-8 ? (-Math.sign(stretchZ) * wy) / radial : 1;
            stretchWidthY = radial > 1e-8 ? (Math.sign(stretchZ) * wx) / radial : 0;
          }
        } else {
          stretchX = stretchY = stretchZ = 0;
        }
      }
      if (stretched && this.definition.freeformStretching) {
        const position = this.environment!.viewPosition!;
        const px = e.positions[o]!,
          py = e.positions[o + 1]!,
          pz = e.positions[o + 2]!;
        vec3.set(
          this.basisForward,
          world[0]! * px + world[4]! * py + world[8]! * pz + world[12]! - position[0],
          world[1]! * px + world[5]! * py + world[9]! * pz + world[13]! - position[1],
          world[2]! * px + world[6]! * py + world[10]! * pz + world[14]! - position[2],
        );
        if (vec3.length(this.basisForward) < 1e-8) vec3.copy(this.basisForward, this.viewForward);
        vec3.normalize(this.basisForward, this.basisForward);
        if (this.definition.rotateWithStretchDirection) {
          const dot =
            this.basisForward[0]! * stretchX +
            this.basisForward[1]! * stretchY +
            this.basisForward[2]! * stretchZ;
          vec3.set(
            this.basisRight,
            -stretchX + this.basisForward[0]! * dot,
            -stretchY + this.basisForward[1]! * dot,
            -stretchZ + this.basisForward[2]! * dot,
          );
        } else vec3.cross(this.basisRight, this.viewUp, this.basisForward);
        // A parallel velocity has no projected heading; keep a stable world-up basis.
        if (vec3.length(this.basisRight) < 1e-6)
          vec3.cross(
            this.basisRight,
            Math.abs(this.basisForward[1]!) > 0.99 ? [1, 0, 0] : [0, 1, 0],
            this.basisForward,
          );
        vec3.normalize(this.basisRight, this.basisRight);
        vec3.cross(this.basisUp, this.basisForward, this.basisRight);
        // Native Freeform keeps the stretch magnitude when the combined length is negative.
        freeformFactor = Math.abs(
          this.definition.lengthScale +
            (stretchSpeed * this.definition.velocityScale) /
              Math.max(1e-8, Math.abs(sy * localScale.y)),
        );
        if (stretchSpeed < 1e-8) sx = sy = sz = 0;
      }
      // Native BakeMesh: World Billboard reverses particle Euler angles;
      // Mesh uses their original sign. Both use ZXY order.
      const tiltSign =
        this.definition.mode === RenderMode.Billboard &&
        this.definition.alignment === Alignment.View
          ? 1
          : rotationSign;
      const roll =
        !stretched &&
        !this.definition.allowRoll &&
        (this.definition.alignment === Alignment.View ||
          this.definition.alignment === Alignment.Facing)
          ? Math.atan2(-this.viewUp[0]!, this.viewUp[1]!)
          : 0;
      const cx = Math.cos(e.rotations[o]!),
        snx = Math.sin(e.rotations[o]!) * tiltSign,
        cy = Math.cos(e.rotations[o + 1]!),
        sny = Math.sin(e.rotations[o + 1]!) * tiltSign,
        cz = Math.cos(e.rotations[o + 2]! + roll),
        snz = Math.sin(e.rotations[o + 2]! + roll) * rotationSign;
      color(e.colorModule?.color ?? null, t, rnd(53), this.scratchColor);
      const sheet =
          e.sheet && e.sheet.uvChannelMask & (1 << (this.binding?.uvSet ?? 0))
            ? e.sheet
            : undefined,
        cols = sheet?.columns ?? 1,
        rows = sheet?.rows ?? 1;
      const frame = sheetFrame(
          sheet,
          t,
          rnd(54),
          rnd(55),
          e.ages[i]!,
          Math.hypot(
            (e.renderVelocities ?? e.velocities)[o]!,
            (e.renderVelocities ?? e.velocities)[o + 1]!,
            (e.renderVelocities ?? e.velocities)[o + 2]!,
          ),
          rnd(59),
          // Native MeshIndex rows use the uniform choice, even for weighted geometry.
          this.definition.mode === RenderMode.Mesh
            ? Math.min(
                this.definition.meshAssetIds.length - 1,
                Math.floor(rnd(70) * this.definition.meshAssetIds.length),
              )
            : 0,
        ),
        col = frame % cols,
        row = Math.floor(frame / cols);
      const flip = this.definition.flip;
      const flipX = flip ? random(e.seed, e.serials[i]!, 57) < flip.x : false;
      const flipY = flip ? random(e.seed, e.serials[i]!, 58) < flip.y : false;
      const custom = this.definition.vertexStreams.some(
        (s) => s.semantic === VertexSemantic.Custom1,
      )
        ? (e.customData?.[i * 8] ?? 0)
        : 0;
      for (let j = 0; j < positions.length; j++) {
        const p = positions[j]!,
          uv = uvs[j] ?? EMPTY_UV;
        let x = p.x * sx,
          y = p.y * sy,
          z = p.z * sz;
        const pivot = this.definition.pivot;
        if (pivot && !stretched) {
          // Unity adds the offset before particle rotation. Billboard depth
          // uses width; Mesh offsets use the mesh's unscaled bounds.
          x += pivot.x * sx * pivotSize[0]!;
          y += pivot.y * sy * pivotSize[1]!;
          z += pivot.z * (this.definition.mode === RenderMode.Mesh ? sz : sx) * pivotSize[2]!;
        }
        let a = x * cz - y * snz;
        y = x * snz + y * cz;
        x = a;
        a = y * cx - z * snx;
        z = y * snx + z * cx;
        y = a;
        a = x * cy + z * sny;
        z = -x * sny + z * cy;
        x = a;
        // Local scaling inherits the emitter's own scale, excluding ancestor
        // scale from particle sizes. Position still follows the node hierarchy.
        const px = e.positions[o]!,
          py = e.positions[o + 1]!,
          pz = e.positions[o + 2]!;
        let wx = world[0]! * px + world[4]! * py + world[8]! * pz + world[12]!,
          wy = world[1]! * px + world[5]! * py + world[9]! * pz + world[13]!,
          wz = world[2]! * px + world[6]! * py + world[10]! * pz + world[14]!;
        x *= localScale.x;
        y *= localScale.y;
        z *= localScale.z;
        if (plane) {
          // Native axis-locked quads normalize their corners, rotate Z, then scale.
          const angle = -e.rotations[o + 2]!,
            c = Math.cos(angle),
            s = Math.sin(angle);
          const px = p.x + (pivot?.x ?? 0),
            py = p.y + (pivot?.y ?? 0);
          const ax = (px * c - py * s) * sx * localScale.x * Math.SQRT1_2;
          const ay = (px * s + py * c) * sy * localScale.y * Math.SQRT1_2;
          if (this.definition.mode === RenderMode.HorizontalBillboard) {
            wx += ax;
            wy += (pivot?.z ?? 0) * sx * localScale.x;
            wz += ay;
          } else {
            vec3.cross(this.basisRight, [0, 1, 0], this.viewForward);
            if (vec3.length(this.basisRight) < 1e-8) vec3.set(this.basisRight, 1, 0, 0);
            vec3.normalize(this.basisRight, this.basisRight);
            wx += ax * this.basisRight[0]!;
            wy += ay;
            wz += ax * this.basisRight[2]! + (pivot?.z ?? 0) * sx * localScale.x;
          }
        } else if (stretched && this.definition.freeformStretching) {
          const qx = (uv.x - 0.5 + (pivot?.x ?? 0)) * sx * localScale.x;
          const qy = (uv.y - 0.5 + (pivot?.y ?? 0)) * sy * localScale.y;
          const ax = qx * cz + qy * snz,
            ay = -qx * snz + qy * cz;
          let dx = this.basisRight[0]! * ax + this.basisUp[0]! * ay;
          let dy = this.basisRight[1]! * ax + this.basisUp[1]! * ay;
          let dz = this.basisRight[2]! * ax + this.basisUp[2]! * ay;
          const stretch = (dx * stretchX + dy * stretchY + dz * stretchZ) * (freeformFactor - 1);
          dx += stretchX * stretch;
          dy += stretchY * stretch;
          dz += stretchZ * stretch;
          wx += dx;
          wy += dy;
          wz += dz;
        } else if (stretched) {
          // Native stretch anchors UV.x=0 at the particle, ignores Euler rotation,
          // and flips the transverse edge when the combined length is negative.
          const along = uv.x * stretchLength - 2 * (pivot?.y ?? 0) * sy * localScale.y,
            across = (uv.y - 0.5 + (pivot?.x ?? 0)) * sx * localScale.x * Math.sign(stretchLength);
          wx += -stretchX * along + stretchWidthX * across;
          wy += -stretchY * along + stretchWidthY * across;
          wz += -stretchZ * along + stretchWidthZ * across;
        } else {
          wx += rotation[0]! * x + rotation[4]! * y + rotation[8]! * z;
          wy += rotation[1]! * x + rotation[5]! * y + rotation[9]! * z;
          wz += rotation[2]! * x + rotation[6]! * y + rotation[10]! * z;
        }
        minimumX = Math.min(minimumX, wx);
        minimumY = Math.min(minimumY, wy);
        minimumZ = Math.min(minimumZ, wz);
        maximumX = Math.max(maximumX, wx);
        maximumY = Math.max(maximumY, wy);
        maximumZ = Math.max(maximumZ, wz);
        const w = matrix[3]! * wx + matrix[7]! * wy + matrix[11]! * wz + matrix[15]!;
        const k = (i * stride + j) * 16;
        v[k] = (matrix[0]! * wx + matrix[4]! * wy + matrix[8]! * wz + matrix[12]!) / w;
        v[k + 1] = (matrix[1]! * wx + matrix[5]! * wy + matrix[9]! * wz + matrix[13]!) / w;
        v[k + 2] = (matrix[2]! * wx + matrix[6]! * wy + matrix[10]! * wz + matrix[14]!) / w;
        // No bitmap upload flip: authored bottom-left Unity UVs are flipped here once.
        const sampledU = flipX ? 1 - uv.x : uv.x;
        const sampledV = flipY ? 1 - uv.y : uv.y;
        v[k + 3] =
          ((sampledU + col) / cols) * (this.binding?.scale?.x ?? 1) +
          (this.binding?.offset?.x ?? 0);
        v[k + 4] =
          1 -
          (((sampledV + (rows - 1 - row)) / rows) * (this.binding?.scale?.y ?? 1) +
            (this.binding?.offset?.y ?? 0));
        v[k + 5] =
          e.startColors[i * 4]! *
          this.scratchColor[0]! *
          (tint?.r ?? 1) *
          (choice?.colors[j]?.x ?? 1);
        v[k + 6] =
          e.startColors[i * 4 + 1]! *
          this.scratchColor[1]! *
          (tint?.g ?? 1) *
          (choice?.colors[j]?.y ?? 1);
        v[k + 7] =
          e.startColors[i * 4 + 2]! *
          this.scratchColor[2]! *
          (tint?.b ?? 1) *
          (choice?.colors[j]?.z ?? 1);
        v[k + 8] =
          e.startColors[i * 4 + 3]! *
          this.scratchColor[3]! *
          (tint?.a ?? 1) *
          (choice?.colors[j]?.w ?? 1);
        const depth = this.environment?.depth;
        v[k + 9] =
          this.straightAlpha && Array.isArray(depth)
            ? depth[0]! * wx + depth[1]! * wy + depth[2]! * wz + depth[3]!
            : custom;
      }
      if (this.definition.mode !== RenderMode.Mesh) {
        const k = i * stride * 16,
          cx = (v[k]! + v[k + 32]!) * 0.5,
          cy = (v[k + 1]! + v[k + 33]!) * 0.5,
          ex = v[k + 16]! - v[k]!,
          ey = v[k + 17]! - v[k + 1]!,
          fx = v[k + 48]! - v[k]!,
          fy = v[k + 49]! - v[k + 1]!;
        for (let j = 0; j < stride; j++) {
          const o = k + j * 16;
          v[o + 10] = cx;
          v[o + 11] = cy;
          v[o + 12] = ex;
          v[o + 13] = ey;
          v[o + 14] = fx;
          v[o + 15] = fy;
        }
      }
    }
    this.sortingDepth =
      (this.viewForward[0]! * (minimumX + maximumX) +
        this.viewForward[1]! * (minimumY + maximumY) +
        this.viewForward[2]! * (minimumZ + maximumZ)) *
      0.5;
    const sort = this.definition.sort;
    if (sort !== ParticleSort.None) {
      const order = this.particleOrder,
        keys = this.sortKeys;
      order.length = n;
      for (let index = 0; index < n; index++) {
        order[index] = index;
        if (sort === ParticleSort.OldestFirst || sort === ParticleSort.YoungestFirst) {
          keys[index] = e.ages[index]! * (sort === ParticleSort.OldestFirst ? -1 : 1);
          continue;
        }
        const o = index * 3;
        const px = e.positions[o]!;
        const py = e.positions[o + 1]!;
        const pz = e.positions[o + 2]!;
        const wx = world[0]! * px + world[4]! * py + world[8]! * pz + world[12]!;
        const wy = world[1]! * px + world[5]! * py + world[9]! * pz + world[13]!;
        const wz = world[2]! * px + world[6]! * py + world[10]! * pz + world[14]!;
        // The display transform is affine (orthographic): Distance equals Depth.
        keys[index] = matrix[2]! * wx + matrix[6]! * wy + matrix[10]! * wz + matrix[14]!;
      }
      order.sort((a, b) => keys[b]! - keys[a]! || a - b);
    }
    if (sort !== ParticleSort.None || this.meshChoices.length > 1) {
      let offset = 0;
      for (let i = 0; i < n; i++) {
        const source = sort === ParticleSort.None ? i : this.particleOrder[i]!;
        const indices = this.meshChoices[this.meshSelections[source]!]?.indices ?? this.baseIndices;
        for (const index of indices) this.indexData[offset++] = source * stride + index;
      }
      this.indexBuffer.update(offset * 4);
      this.geometry.indexCount = offset;
    } else this.geometry.indexCount = n * this.baseIndices.length;
    this.vertexBuffer.update(n * stride * 64);
    // Invalidate local bounds after vertex changes (needed for masks/culling).
    this.onViewUpdate();
  }
  override destroy(): void {
    const geometry = this.geometry,
      shader = this.shader;
    super.destroy();
    geometry.destroy();
    this.vertexBuffer.destroy();
    this.indexBuffer.destroy();
    shader?.destroy();
  }
}
