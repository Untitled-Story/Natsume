import {
  Buffer,
  BufferUsage,
  Geometry,
  GlMeshAdaptor,
  Mesh,
  MeshPipe,
  Shader,
  GlProgram,
  State,
  Texture,
  type WebGLRenderer,
} from 'pixi.js';
import { check } from '../errors.js';
import type { EffectPack, DeepReadonly as R } from '../pack.js';
import type { ParticleRendererT } from '../format/generated/noa/ir/particle-renderer.js';
import type { MaterialT } from '../format/generated/noa/ir/material.js';
import { MaterialModel } from '../format/generated/noa/ir/material-model.js';
import { RenderMode } from '../format/generated/noa/ir/render-mode.js';
import { Alignment } from '../format/generated/noa/ir/alignment.js';
import { ParticleSort } from '../format/generated/noa/ir/particle-sort.js';
import { BlendFactor as B } from '../format/generated/noa/ir/blend-factor.js';
import { CompareOp } from '../format/generated/noa/ir/compare-op.js';
import { ColorSpace } from '../format/generated/noa/ir/color-space.js';
import { CustomDataMode } from '../format/generated/noa/ir/custom-data-mode.js';
import { VertexSemantic } from '../format/generated/noa/ir/vertex-semantic.js';
import { mat4 } from 'gl-matrix';
import { color, random, scalar, sheetFrame } from '../runtime/parameters.js';
import type { Emitter } from '../runtime/emitter.js';
import type { ParticleEnvironment } from './particle-environment.js';

/** Dedicated pipe changes the two states Mesh's standard State cannot express,
 * and restores them so interleaved Pixi siblings/masks remain valid. */
class ParticleAdaptor extends GlMeshAdaptor {
  override execute(pipe: MeshPipe, mesh: Mesh): void {
    const renderer = pipe.renderer as WebGLRenderer,
      gl = renderer.gl;
    const mask = gl.getParameter(gl.COLOR_WRITEMASK) as boolean[];
    const previous = (mask[0] ? 8 : 0) | (mask[1] ? 4 : 0) | (mask[2] ? 2 : 0) | (mask[3] ? 1 : 0);
    const depth = gl.getParameter(gl.DEPTH_FUNC) as number;
    const write = (mesh as unknown as ParticleMesh).colorWriteMask;
    // The shader premultiplies the sampled straight-alpha PNG itself.
    // MeshPipe's automatic texture-alpha adjustment must not apply it again.
    mesh.state.blendMode = 'normal';
    const particle = mesh as unknown as ParticleMesh;
    particle.prepareEnvironment();
    // A parent Pixi ColorMask may narrow the material's write mask.
    renderer.colorMask.setMask(write & previous);
    gl.depthFunc(gl.LEQUAL);
    try {
      if (particle.straightAlpha) {
        renderer.state.set(mesh.state);
        const srcRgb = gl.getParameter(gl.BLEND_SRC_RGB),
          dstRgb = gl.getParameter(gl.BLEND_DST_RGB),
          srcAlpha = gl.getParameter(gl.BLEND_SRC_ALPHA),
          dstAlpha = gl.getParameter(gl.BLEND_DST_ALPHA);
        try {
          gl.blendFuncSeparate(
            gl.SRC_ALPHA,
            particle.additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA,
            gl.SRC_ALPHA,
            particle.additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA,
          );
          const shader = mesh.shader!;
          shader.groups[100] = renderer.globalUniforms.bindGroup;
          shader.groups[101] = pipe.localUniformsBindGroup;
          renderer.encoder.draw({ geometry: mesh.geometry, shader });
        } finally {
          gl.blendFuncSeparate(srcRgb, dstRgb, srcAlpha, dstAlpha);
        }
      } else super.execute(pipe, mesh);
    } finally {
      renderer.colorMask.setMask(previous);
      gl.depthFunc(depth);
    }
  }
}
export function ensureParticlePipe(renderer: WebGLRenderer): void {
  const pipes = renderer.renderPipes as unknown as Record<string, unknown>;
  pipes.natsumeParticles ??= new MeshPipe(renderer, new ParticleAdaptor());
}

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
const fragment = `#version 300 es
in vec2 vUV;
in vec4 vColor;
in float vCustom;
in float vDepth;
in vec2 vScreenUV;
uniform sampler2D uTexture;
uniform float uLinear;
uniform float uTextureSRGB;
uniform float uVertexSRGB;
uniform float uModel;
uniform vec4 uTint;
uniform vec4 uFog;
uniform vec3 uFogColor;
uniform float uSoft;
uniform float uInvFade;
uniform sampler2D uSceneDepth;
uniform vec4 uDepthUV;
out vec4 finalColor;
vec3 toLinear(vec3 c){return mix(c/12.92,pow((c+0.055)/1.055,vec3(2.4)),step(vec3(0.04045),c));}
void main(){
  vec4 texel=texture(uTexture,vUV);
  vec4 color=vColor;
  if(uLinear>0.5){if(uTextureSRGB>0.5)texel.rgb=toLinear(texel.rgb);if(uVertexSRGB>0.5)color.rgb=toLinear(color.rgb);}
  vec4 c=texel*color;
  if(uModel>0.5){
    vec4 tint=uTint;
    if(uLinear>0.5)tint.rgb=toLinear(tint.rgb);
    c*=tint;
    if(uModel>1.5){
      if(uSoft>0.5)c.a*=clamp(uInvFade*(texture(uSceneDepth,vScreenUV*uDepthUV.xy+uDepthUV.zw).r-vDepth),0.0,1.0);
      c*=2.0;c.a=clamp(c.a,0.0,1.0);
      float f=1.0;
      if(uFog.x>0.5&&uFog.x<1.5)f=clamp((uFog.z-vDepth)/(uFog.z-uFog.y),0.0,1.0);
      else if(uFog.x>1.5&&uFog.x<2.5)f=exp(-uFog.w*vDepth);
      else if(uFog.x>2.5)f=exp(-pow(uFog.w*vDepth,2.0));
      c.rgb=mix(uModel<2.5?vec3(0.0):uFogColor,c.rgb,f);
    }
    finalColor=c;
  }else finalColor=vec4(c.rgb*c.a,vCustom<=0.5?c.a:0.0);
}`;

export type SourceColorSpace = 'gamma' | 'linear';
export class ParticleMesh extends Mesh<Geometry, Shader> {
  override readonly renderPipeId = 'natsumeParticles';
  readonly colorWriteMask: number;
  readonly straightAlpha: boolean;
  readonly additive: boolean;
  environment: ParticleEnvironment | undefined;
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
  private readonly scratchColor = new Float32Array(4);
  private readonly rotationMatrix = mat4.create();
  private readonly binding;
  constructor(
    readonly emitter: Emitter,
    readonly definition: R<ParticleRendererT>,
    readonly materialDefinition: R<MaterialT>,
    texture: Texture,
    pack: EffectPack,
    environment?: ParticleEnvironment,
  ) {
    const material = materialDefinition;
    const legacy =
      material.model === MaterialModel.LegacyParticleAdditive ||
      material.model === MaterialModel.LegacyParticleAlphaBlend;
    const straight = legacy || material.model === MaterialModel.ParticleUnlit;
    const additive = material.model === MaterialModel.LegacyParticleAdditive;
    check(
      material.model === MaterialModel.ParticleAddAlpha || straight,
      'CAPABILITY',
      'Unsupported particle material model',
    );
    check(
      !legacy || environment,
      'HOST',
      'Legacy particles require an explicit particleEnvironment',
    );
    check(
      definition.mode === RenderMode.Billboard ||
        definition.mode === RenderMode.Mesh ||
        definition.mode === RenderMode.StretchedBillboard,
      'CAPABILITY',
      'Unsupported particle render mode',
    );
    check(
      definition.alignment === Alignment.World ||
        definition.alignment === Alignment.Local ||
        definition.alignment === Alignment.View,
      'CAPABILITY',
      'System ' +
        emitter.id +
        ': renderer alignment ' +
        Alignment[definition.alignment] +
        ' is unsupported',
    );
    check(definition.sort >= 0 && definition.sort <= 4, 'SEMANTIC', 'Invalid particle sort');
    check(Number.isFinite(definition.sortingFudge), 'SEMANTIC', 'Invalid sortingFudge');
    check(
      !definition.pivot ||
        [definition.pivot.x, definition.pivot.y, definition.pivot.z].every(Number.isFinite),
      'SEMANTIC',
      'Invalid renderer pivot',
    );
    check(
      !definition.flip ||
        [definition.flip.x, definition.flip.y, definition.flip.z].every(
          (value) => value >= 0 && value <= 1,
        ),
      'CAPABILITY',
      'Renderer flip values must be in [0,1]',
    );
    check(
      Number.isFinite(definition.minSize) &&
        Number.isFinite(definition.maxSize) &&
        definition.minSize >= 0 &&
        definition.maxSize >= definition.minSize,
      'SEMANTIC',
      'Renderer minSize/maxSize are invalid',
    );
    if (definition.mode === RenderMode.StretchedBillboard) {
      check(
        !definition.freeformStretching &&
          definition.rotateWithStretchDirection &&
          definition.cameraVelocityScale === 0 &&
          definition.velocityScale === 0,
        'CAPABILITY',
        'Stretched Billboard requires non-freeform, rotation with direction, zero camera/velocity scale',
      );
      emitter.renderVelocities ??= emitter.velocities.slice();
    }
    check(
      definition.materials.filter((id) => id !== 0).length === 1,
      'CAPABILITY',
      'Multiple materials unsupported',
    );
    const streams = new Map([
      [VertexSemantic.Position, 3],
      [VertexSemantic.Normal, 3],
      [VertexSemantic.Color, 4],
      [VertexSemantic.UV0, 2],
      [VertexSemantic.Custom1, 1],
    ]);
    check(
      definition.vertexStreams.every((s) => streams.get(s.semantic) === s.components) &&
        [
          VertexSemantic.Position,
          VertexSemantic.Color,
          VertexSemantic.UV0,
          ...(!straight ? [VertexSemantic.Custom1] : []),
        ].every((semantic) => definition.vertexStreams.some((s) => s.semantic === semantic)),
      'CAPABILITY',
      'Material requires compatible Position3/Color4/UV0_2 and optional Custom1_1 streams',
    );
    check(
      material.textures.length === 1 && material.textures[0]!.uvSet === 0,
      'CAPABILITY',
      'Only one UV0 texture is supported',
    );
    check(
      material.textures[0]!.colorSpace !== ColorSpace.Unspecified,
      'CAPABILITY',
      'Texture encoding must be explicit',
    );
    const state = material.renderState!;
    check(
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
      'Unsupported material render state',
    );
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
      check(
        definition.meshAssetIds.length === 1,
        'CAPABILITY',
        'Initial mesh renderer supports one mesh',
      );
      const mesh = pack.getMesh(definition.meshAssetIds[0]!);
      check(
        mesh && mesh.uv0.length === mesh.positions.length && mesh.submeshes.length === 1,
        'CAPABILITY',
        'Mesh requires UV0 and one submesh',
      );
      positions = mesh.positions;
      uv = mesh.uv0;
      meshIndices = mesh.indices;
    }
    check(
      positions.length * emitter.ages.length <= 1_000_000,
      'LIMIT',
      'Expanded mesh vertex budget exceeded',
    );
    const vertices = new Float32Array(positions.length * emitter.ages.length * 16);
    const indices = new Uint32Array(meshIndices.length * emitter.ages.length);
    for (let i = 0; i < emitter.ages.length; i++)
      for (let k = 0; k < meshIndices.length; k++)
        indices[i * meshIndices.length + k] = i * positions.length + meshIndices[k]!;
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
          uModel: { value: legacy ? (additive ? 2 : 3) : straight ? 1 : 0, type: 'f32' },
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
            value: material.textures[0]!.colorSpace === ColorSpace.SRGB ? 1 : 0,
            type: 'f32',
          },
        },
      },
    });
    const pixiState = new State();
    pixiState.depthTest = true;
    pixiState.depthMask = false;
    pixiState.cullMode = state.cull === 2 ? 'back' : 'none';
    super({ geometry, shader, state: pixiState, texture });
    this.straightAlpha = straight;
    this.additive = additive;
    this.environment = environment;
    this.vertices = vertices;
    this.vertexBuffer = vertexBuffer;
    this.indexBuffer = indexBuffer;
    this.indexData = indices;
    this.sortKeys = new Float64Array(emitter.ages.length);
    this.basePositions = positions;
    this.baseUV = uv;
    this.baseIndices = meshIndices;
    this.binding = material.textures[0]!;
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
    this.visible = e.node.activeInHierarchy && n > 0;
    if (!this.visible) return;
    this.shader!.resources.colorUniforms.uniforms.uLinear = colorSpace === 'linear' ? 1 : 0;
    e.updateSpace();
    const world = e.simulationMatrix,
      v = this.vertices,
      stride = this.basePositions.length,
      material = this.materialDefinition,
      tint = this.straightAlpha ? null : material.tint;
    mat4.fromQuat(this.rotationMatrix, e.node.worldRotation);
    const rotation = this.rotationMatrix,
      localScale = e.node.source.transform!.scale!,
      rotationSign = this.definition.mode === RenderMode.Billboard ? -1 : 1;
    for (let i = 0; i < n; i++) {
      const serial = e.serials[i]!,
        rnd = (c: number) => random(e.seed, serial, c),
        o = i * 3,
        t = e.ages[i]! / e.lifetimes[i]!;
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
      if (e.noiseSizes) {
        sx *= e.noiseSizes[o]!;
        sy *= e.noiseSizes[o + 1]!;
        sz *= e.noiseSizes[o + 2]!;
      }
      let stretchX = 0,
        stretchY = 0;
      const stretched = this.definition.mode === RenderMode.StretchedBillboard;
      if (stretched) {
        const velocity = e.renderVelocities!,
          vx = velocity[o]!,
          vy = velocity[o + 1]!,
          vz = velocity[o + 2]!;
        stretchX = world[0]! * vx + world[4]! * vy + world[8]! * vz;
        stretchY = world[1]! * vx + world[5]! * vy + world[9]! * vz;
        const length = Math.hypot(stretchX, stretchY);
        if (length > 1e-8) {
          stretchX /= length;
          stretchY /= length;
        } else {
          stretchX = stretchY = 0;
        }
      }
      // Native BakeMesh: World Billboard reverses particle Euler angles;
      // Mesh uses their original sign. Both use ZXY order.
      const cx = Math.cos(e.rotations[o]!),
        snx = Math.sin(e.rotations[o]!) * rotationSign,
        cy = Math.cos(e.rotations[o + 1]!),
        sny = Math.sin(e.rotations[o + 1]!) * rotationSign,
        cz = Math.cos(e.rotations[o + 2]!),
        snz = Math.sin(e.rotations[o + 2]!) * rotationSign;
      color(e.colorModule?.color ?? null, t, rnd(53), this.scratchColor);
      const sheet = e.sheet,
        cols = sheet?.columns ?? 1,
        rows = sheet?.rows ?? 1;
      const frame = sheetFrame(sheet, t, rnd(54), rnd(55)),
        col = frame % cols,
        row = Math.floor(frame / cols);
      const flip = this.definition.flip;
      const flipX = flip ? random(e.seed, e.serials[i]!, 57) < flip.x : false;
      const flipY = flip ? random(e.seed, e.serials[i]!, 58) < flip.y : false;
      const stream = e.custom?.streams.find(
        (s) => s.slot === 0 && s.mode === CustomDataMode.Vector,
      );
      const custom = scalar(stream?.vector[0], t, rnd(56));
      for (let j = 0; j < stride; j++) {
        const p = this.basePositions[j]!,
          uv = this.baseUV[j]!;
        let x = p.x * sx,
          y = p.y * sy,
          z = p.z * sz;
        if (this.definition.mode !== RenderMode.Mesh) {
          if (this.definition.pivot) {
            x -= this.definition.pivot.x * sx;
            y -= this.definition.pivot.y * sy;
            z -= this.definition.pivot.z * sz;
          }
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
        if (stretched) {
          // Native stretch anchors UV.x=0 at the particle, ignores Euler rotation,
          // and flips the transverse edge when lengthScale is negative.
          const along = uv.x * sy * localScale.y * this.definition.lengthScale,
            across = (uv.y - 0.5) * sx * localScale.x * Math.sign(this.definition.lengthScale);
          wx += -stretchX * along + stretchY * across;
          wy += -stretchY * along - stretchX * across;
        } else {
          if (this.definition.alignment === Alignment.Local) {
            const lx = rotation[0]! * x + rotation[4]! * y + rotation[8]! * z;
            const ly = rotation[1]! * x + rotation[5]! * y + rotation[9]! * z;
            z = rotation[2]! * x + rotation[6]! * y + rotation[10]! * z;
            x = lx;
            y = ly;
          }
          wx += rotation[0]! * x + rotation[4]! * y + rotation[8]! * z;
          wy += rotation[1]! * x + rotation[5]! * y + rotation[9]! * z;
          wz += rotation[2]! * x + rotation[6]! * y + rotation[10]! * z;
        }
        const w = matrix[3]! * wx + matrix[7]! * wy + matrix[11]! * wz + matrix[15]!;
        const k = (i * stride + j) * 16;
        v[k] = (matrix[0]! * wx + matrix[4]! * wy + matrix[8]! * wz + matrix[12]!) / w;
        v[k + 1] = (matrix[1]! * wx + matrix[5]! * wy + matrix[9]! * wz + matrix[13]!) / w;
        v[k + 2] = (matrix[2]! * wx + matrix[6]! * wy + matrix[10]! * wz + matrix[14]!) / w;
        // No bitmap upload flip: authored bottom-left Unity UVs are flipped here once.
        const sampledU = flipX ? 1 - uv.x : uv.x;
        const sampledV = flipY ? 1 - uv.y : uv.y;
        v[k + 3] =
          ((sampledU + col) / cols) * (this.binding.scale?.x ?? 1) + (this.binding.offset?.x ?? 0);
        v[k + 4] =
          1 -
          (((sampledV + (rows - 1 - row)) / rows) * (this.binding.scale?.y ?? 1) +
            (this.binding.offset?.y ?? 0));
        v[k + 5] = e.startColors[i * 4]! * this.scratchColor[0]! * (tint?.r ?? 1);
        v[k + 6] = e.startColors[i * 4 + 1]! * this.scratchColor[1]! * (tint?.g ?? 1);
        v[k + 7] = e.startColors[i * 4 + 2]! * this.scratchColor[2]! * (tint?.b ?? 1);
        v[k + 8] = e.startColors[i * 4 + 3]! * this.scratchColor[3]! * (tint?.a ?? 1);
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
      for (let i = 0; i < n; i++) {
        const source = order[i]!;
        for (let k = 0; k < this.baseIndices.length; k++)
          this.indexData[i * this.baseIndices.length + k] = source * stride + this.baseIndices[k]!;
      }
      this.indexBuffer.update(n * this.baseIndices.length * 4);
    }
    this.geometry.indexCount = n * this.baseIndices.length;
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
