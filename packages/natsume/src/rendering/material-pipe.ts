import type { SceneMesh } from './scene-mesh.js';
import type { StencilStateT } from '../format/generated/noa/ir/stencil-state.js';
import {
  GlMeshAdaptor,
  MeshPipe,
  Matrix,
  type Mesh,
  type Geometry,
  type Shader,
  type WebGLRenderer,
} from 'pixi.js';
import type { DeepReadonly as R } from '../pack.js';
import type { RenderStateT } from '../format/generated/noa/ir/render-state.js';
import { check } from '../errors.js';

export interface MaterialDraw extends Mesh<Geometry, Shader> {
  readonly materialDefinition: { readonly renderState: R<RenderStateT> | null };
  readonly uiStencil?: boolean;
  readonly spriteMaskPasses?: readonly SceneMesh[];
  readonly maskStencil?: R<StencilStateT>;
  prepareEnvironment(): void;
  drawMaterialPasses?(renderer: WebGLRenderer): void;
}

/** Executes source pass state, restoring GL values that Pixi does not track. */
class MaterialAdaptor extends GlMeshAdaptor {
  private readonly maskTransform = new Matrix();
  override execute(pipe: MeshPipe, mesh: Mesh<Geometry, Shader>): void {
    const passes = (mesh as MaterialDraw).spriteMaskPasses;
    const uniforms = pipe.localUniforms;
    const transform = uniforms.uniforms.uTransformMatrix;
    const silhouette = (pass: SceneMesh) => {
      // Auxiliary silhouettes are not Pixi children: use the same host transform
      // as the draw, with their own Bridge offset in effect-local coordinates.
      const matrix = this.maskTransform.copyFrom(transform);
      const dx = pass.position.x - mesh.position.x,
        dy = pass.position.y - mesh.position.y;
      matrix.tx += matrix.a * dx + matrix.c * dy;
      matrix.ty += matrix.b * dx + matrix.d * dy;
      uniforms.uniforms.uTransformMatrix = matrix;
      uniforms.update();
      try {
        this.executeSource(pipe, pass);
      } finally {
        uniforms.uniforms.uTransformMatrix = transform;
        uniforms.update();
      }
    };
    let entered = 0;
    try {
      if (passes)
        for (const pass of passes) {
          entered++;
          if (pass.visible) silhouette(pass);
        }
      this.executeSource(pipe, mesh);
    } finally {
      if (passes)
        for (let i = 0; i < entered; i++) {
          const pass = passes[i]!;
          if (!pass.visible) continue;
          const stencil = pass.materialDefinition.renderState!.stencil! as StencilStateT;
          stencil.reference = 0;
          try {
            silhouette(pass);
          } finally {
            stencil.reference = 1;
          }
        }
    }
  }
  private executeSource(pipe: MeshPipe, mesh: Mesh<Geometry, Shader>): void {
    const renderer = pipe.renderer as WebGLRenderer;
    const gl = renderer.gl;
    const draw = mesh as MaterialDraw;
    const state = draw.materialDefinition.renderState!;
    draw.prepareEnvironment();
    mesh.state.blendMode = 'normal';
    renderer.state.set(mesh.state);
    const stencil = draw.maskStencil ?? state.stencil;
    const activeStencil =
      stencil &&
      [stencil.front, stencil.back].some(
        (f) => f && (f.compare !== 7 || f.pass !== 0 || f.fail !== 0 || f.depthFail !== 0),
      );
    if (state.depthTest !== 7 || state.depthWrite || activeStencil) {
      const target = renderer.renderTarget.renderTarget;
      const allocate = !target.depth && !target.stencil;
      check(
        !activeStencil || target.stencil || !target.depthStencilTexture,
        'HOST',
        'Source stencil requires a render target with a stencil attachment',
      );
      if (!target.depth || (activeStencil && !target.stencil))
        renderer.renderTarget.ensureDepthStencil();
      if (allocate) {
        const depthMask = gl.getParameter(gl.DEPTH_WRITEMASK) as boolean;
        const depthClear = gl.getParameter(gl.DEPTH_CLEAR_VALUE) as number;
        gl.depthMask(true);
        gl.clearDepth(1);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.depthMask(depthMask);
        gl.clearDepth(depthClear);
      }
    }
    const enabled = activeStencil || draw.uiStencil ? gl.isEnabled(gl.STENCIL_TEST) : false;
    const hostReference = enabled ? (gl.getParameter(gl.STENCIL_REF) as number) : 0;
    const hostCompare = enabled ? (gl.getParameter(gl.STENCIL_FUNC) as number) : gl.ALWAYS;
    const compose = !!(enabled && draw.uiStencil && hostCompare === gl.EQUAL);
    const shift = compose ? Math.ceil(Math.log2(hostReference + 1)) : 0;
    const hostRead = compose
      ? ((1 << shift) - 1) & (gl.getParameter(gl.STENCIL_VALUE_MASK) as number)
      : 0;
    check(
      !activeStencil || !enabled || compose,
      'CAPABILITY',
      'Source stencil inside an active Pixi stencil mask requires mask composition',
    );
    if (compose && stencil)
      check(
        (stencil.reference | stencil.readMask | stencil.writeMask) << shift <= 255,
        'LIMIT',
        'Combined UI and Pixi masks exceed eight stencil bits',
      );
    const configureStencil = !!(activeStencil || compose);
    const compare = [
      gl.NEVER,
      gl.LESS,
      gl.EQUAL,
      gl.LEQUAL,
      gl.GREATER,
      gl.NOTEQUAL,
      gl.GEQUAL,
      gl.ALWAYS,
    ];
    const blend = [
      gl.ZERO,
      gl.ONE,
      gl.SRC_COLOR,
      gl.ONE_MINUS_SRC_COLOR,
      gl.SRC_ALPHA,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.DST_COLOR,
      gl.ONE_MINUS_DST_COLOR,
      gl.DST_ALPHA,
      gl.ONE_MINUS_DST_ALPHA,
    ];
    const operation = [gl.FUNC_ADD, gl.FUNC_SUBTRACT, gl.FUNC_REVERSE_SUBTRACT, gl.MIN, gl.MAX];
    const ops = [
      gl.KEEP,
      gl.ZERO,
      gl.REPLACE,
      gl.INCR,
      gl.DECR,
      gl.INVERT,
      gl.INCR_WRAP,
      gl.DECR_WRAP,
    ];
    const mask = gl.getParameter(gl.COLOR_WRITEMASK) as boolean[];
    const previousMask =
      (mask[0] ? 8 : 0) | (mask[1] ? 4 : 0) | (mask[2] ? 2 : 0) | (mask[3] ? 1 : 0);
    const depth = gl.getParameter(gl.DEPTH_FUNC) as number;
    const customBlend =
      state.srcRgb !== 1 ||
      state.dstRgb !== 5 ||
      state.srcAlpha !== 1 ||
      state.dstAlpha !== 5 ||
      state.rgbOp !== 0 ||
      state.alphaOp !== 0;
    const factors = customBlend
      ? [
          gl.BLEND_SRC_RGB,
          gl.BLEND_DST_RGB,
          gl.BLEND_SRC_ALPHA,
          gl.BLEND_DST_ALPHA,
          gl.BLEND_EQUATION_RGB,
          gl.BLEND_EQUATION_ALPHA,
        ].map((p) => gl.getParameter(p) as number)
      : [];
    const faces = configureStencil
      ? [
          [
            gl.STENCIL_FUNC,
            gl.STENCIL_REF,
            gl.STENCIL_VALUE_MASK,
            gl.STENCIL_WRITEMASK,
            gl.STENCIL_FAIL,
            gl.STENCIL_PASS_DEPTH_FAIL,
            gl.STENCIL_PASS_DEPTH_PASS,
          ],
          [
            gl.STENCIL_BACK_FUNC,
            gl.STENCIL_BACK_REF,
            gl.STENCIL_BACK_VALUE_MASK,
            gl.STENCIL_BACK_WRITEMASK,
            gl.STENCIL_BACK_FAIL,
            gl.STENCIL_BACK_PASS_DEPTH_FAIL,
            gl.STENCIL_BACK_PASS_DEPTH_PASS,
          ],
        ].map((params) => params.map((p) => gl.getParameter(p) as number))
      : [];
    const sourceMask = state.colorWriteMask;
    const write =
      (sourceMask & 1 ? 8 : 0) |
      (sourceMask & 2 ? 4 : 0) |
      (sourceMask & 4 ? 2 : 0) |
      (sourceMask & 8 ? 1 : 0);
    try {
      renderer.colorMask.setMask(write & previousMask);
      gl.depthFunc(compare[state.depthTest]!);
      if (customBlend)
        gl.blendFuncSeparate(
          blend[state.srcRgb]!,
          blend[state.dstRgb]!,
          blend[state.srcAlpha]!,
          blend[state.dstAlpha]!,
        );
      if (customBlend) gl.blendEquationSeparate(operation[state.rgbOp]!, operation[state.alphaOp]!);
      if (configureStencil) {
        gl.enable(gl.STENCIL_TEST);
        [stencil!.front!, stencil!.back!].forEach((f, i) => {
          const face = i === 0 ? gl.FRONT : gl.BACK;
          if (compose) {
            check(
              f.compare === 7 || f.compare === 2,
              'CAPABILITY',
              'UI/Pixi stencil composition requires Always or Equal',
            );
            gl.stencilFuncSeparate(
              face,
              gl.EQUAL,
              hostReference | (stencil!.reference << shift),
              hostRead | (f.compare === 7 ? 0 : stencil!.readMask << shift),
            );
            gl.stencilMaskSeparate(face, stencil!.writeMask << shift);
          } else {
            gl.stencilFuncSeparate(
              face,
              compare[f.compare]!,
              stencil!.reference,
              stencil!.readMask,
            );
            gl.stencilMaskSeparate(face, stencil!.writeMask);
          }
          gl.stencilOpSeparate(face, ops[f.fail]!, ops[f.depthFail]!, ops[f.pass]!);
        });
      }
      const shader = mesh.shader!;
      shader.groups[100] = renderer.globalUniforms.bindGroup;
      shader.groups[101] = pipe.localUniformsBindGroup;
      if (draw.drawMaterialPasses) draw.drawMaterialPasses(renderer);
      else renderer.encoder.draw({ geometry: mesh.geometry, shader });
    } finally {
      renderer.colorMask.setMask(previousMask);
      gl.depthFunc(depth);
      if (customBlend) gl.blendFuncSeparate(factors[0]!, factors[1]!, factors[2]!, factors[3]!);
      if (customBlend) gl.blendEquationSeparate(factors[4]!, factors[5]!);
      if (configureStencil) {
        faces.forEach((f, i) => {
          const face = i === 0 ? gl.FRONT : gl.BACK;
          gl.stencilFuncSeparate(face, f[0]!, f[1]!, f[2]!);
          gl.stencilMaskSeparate(face, f[3]!);
          gl.stencilOpSeparate(face, f[4]!, f[5]!, f[6]!);
        });
        if (!enabled) gl.disable(gl.STENCIL_TEST);
      }
    }
  }
}

export function ensureMaterialPipe(renderer: WebGLRenderer): void {
  const pipes = renderer.renderPipes as unknown as Record<string, unknown>;
  pipes.natsumeMaterials ??= new MeshPipe(renderer, new MaterialAdaptor());
}
