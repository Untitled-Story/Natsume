import { describe, expect, it } from 'vitest';
import * as I from '../src/format/generated/noa/ir.js';
import type { EffectPack } from '../src/pack.js';
import { resolveSourceMaterial } from '../src/rendering/source-material.js';
import { defaultParticleMips } from '../src/rendering/default-particle.js';
import { materialSupport, usesGlobalMipBias } from '../src/rendering/material-support.js';

const unlit = '00caeea0345e4a8eed279ee8893d77fa53d37a1626d91fa644012a7a2224e700';
const lit = 'afc864a0b8f613244f08d7d3ed52bc0fabe38bf5d39ce298d23f6f0038a97b29';
function serialized(v: unknown): I.SerializedValueT {
  if (Array.isArray(v))
    return new I.SerializedValueT(
      I.SerializedValueData.ArrayValue,
      new I.ArrayValueT(v.map(serialized)),
    );
  if (v !== null && typeof v === 'object')
    return new I.SerializedValueT(
      I.SerializedValueData.ObjectValue,
      new I.ObjectValueT(
        Object.entries(v).map(
          ([name, value]) => new I.SerializedFieldT(name, null, serialized(value)),
        ),
      ),
    );
  if (typeof v === 'number')
    return new I.SerializedValueT(I.SerializedValueData.DoubleValue, new I.DoubleValueT(v));
  return new I.SerializedValueT(I.SerializedValueData.StringValue, new I.StringValueT(String(v)));
}
function fixture(hash = unlit, source: Record<string, unknown> = {}) {
  const material = new I.MaterialT();
  material.id = 4;
  material.model = I.MaterialModel.UnityShader;
  material.shaderDataAssetId = 1;
  material.renderQueue = -1;
  material.sourceData = serialized(source);
  const references: I.UnitySourceReferenceT[] = [];
  const pack = {
    document: { sourceExport: { references } },
    getAssetBytes: () => new TextEncoder().encode(JSON.stringify({ program_sha256: hash })),
  } as unknown as EffectPack;
  return { material, pack, references };
}
describe('verified source material recipes', () => {
  it.each([
    [
      'f4c3959fbb391fd5e4722820c271a04f3d3ced65bd2029429033936e7ae264f9',
      I.MaterialModel.ParticleAddAlpha,
      false,
    ],
    [
      'f07136c5ab507bfcb309c1920a6afce6f1d5653f80c1c2f97e8ec0066ba58ac2',
      I.MaterialModel.TextureVertexColor,
      true,
    ],
    [
      '09bc049fd22991be3a180c1550dd85a5f3cbdc1a7b764383cca275b3afbcf236',
      I.MaterialModel.TextureVertexColor,
      false,
    ],
  ] as const)(
    'reuses the established recipe for opaque source textures: %s',
    (hash, model, mip) => {
      const f = fixture(hash, {
        m_ValidKeywords: [],
        m_SavedProperties: {
          m_Colors: { _BaseColor: { r: 'Infinity' } }, // Not consumed by these programs.
          m_TexEnvs: {
            _MainTex: {
              m_Texture: { fileID: '2800000', guid: 'hdr' },
              m_Scale: { x: 2, y: 0.25 },
              m_Offset: { x: -0.5, y: 3 },
            },
          },
        },
      });
      f.material.renderState = new I.RenderStateT();
      f.material.renderState.depthWrite = true;
      f.material.renderState.srcRgb = I.BlendFactor.DstAlpha;
      f.material.renderState.colorWriteMask = 7;
      f.material.textures.push(
        new I.TextureBindingT('_MainTex', 42, 0, null, null, I.ColorSpace.Linear, new I.SamplerT()),
      );
      f.references.push(
        new I.UnitySourceReferenceT(
          0,
          '_MainTex',
          new I.SourceReferenceT('hdr', 2800000n),
          I.SourceResolution.Asset,
          0,
          42,
        ),
      );
      const r = resolveSourceMaterial(f.pack, f.material);
      expect(r.issues).toEqual([]);
      expect(r.drawColor).toBe(true);
      expect(r.globalMipBias).toBe(mip);
      expect(usesGlobalMipBias(f.pack, f.material)).toBe(mip);
      expect(usesGlobalMipBias(f.pack, r.material)).toBe(mip);
      expect(r.material.model).toBe(model);
      expect(r.material.renderQueue).toBe(3000);
      expect(r.material.renderState).toBe(f.material.renderState);
      expect(r.material.textures[0]).toMatchObject({
        slot: '_MainTex',
        imageId: 42,
        colorSpace: I.ColorSpace.Linear,
        scale: { x: 2, y: 0.25 },
        offset: { x: -0.5, y: 3 },
      });
      expect(r.material.tint).toMatchObject({ r: 1, g: 1, b: 1, a: 1 });
      const missingMip = materialSupport(f.material, f.pack).filter(
        (issue) => issue.field === 'renderEnvironment.globalMipBias',
      );
      expect(missingMip).toHaveLength(mip ? 1 : 0);
      expect(
        materialSupport(f.material, f.pack, { globalMipBias: 0 }).filter(
          (issue) => issue.severity === 'error',
        ),
      ).toEqual([]);
    },
  );
  it('retains the native built-in mip colors instead of averaging level zero', () => {
    const levels = defaultParticleMips();
    expect(levels.map((level) => level.length)).toEqual([16384, 4096, 1024, 256, 64, 16, 4]);
    expect([...levels[6]!]).toEqual([74, 74, 74, 41]);
    expect([...levels[5]!]).toEqual([
      70, 70, 70, 38, 74, 74, 74, 41, 74, 74, 74, 41, 78, 78, 79, 44,
    ]);
  });
  it.each(['SRPDefaultUnlit', 'srpdefaultunlit'])(
    'disables the color pass by LightMode %s',
    (tag) => {
      const f = fixture(unlit, { disabledShaderPasses: [tag, 'depthonly'] });
      const r = resolveSourceMaterial(f.pack, f.material);
      expect(r.drawColor).toBe(false);
      expect(r.passes.map((p) => p.enabled)).toEqual([false, false, true]);
    },
  );
  it('does not confuse a pass name with its LightMode', () => {
    const f = fixture(unlit, { disabledShaderPasses: ['ForwardLit', 'Always'] });
    expect(resolveSourceMaterial(f.pack, f.material).drawColor).toBe(true);
  });
  it('maps the shipped transparent unlit material without mutating source data', () => {
    const f = fixture(unlit, {
      m_ValidKeywords: ['_SURFACE_TYPE_TRANSPARENT'],
      disabledShaderPasses: ['DepthOnly'],
      m_SavedProperties: {
        m_Floats: {
          _Surface: 1,
          _SrcBlend: 5,
          _DstBlend: 10,
          _SrcBlendAlpha: 1,
          _DstBlendAlpha: 10,
          _ZWrite: 0,
        },
        m_Colors: { _BaseColor: { r: 2, g: 0.25, b: 0.5, a: 0.75 } },
        m_TexEnvs: {
          _BaseMap: {
            m_Texture: { fileID: '10300', guid: '0000000000000000f000000000000000' },
            m_Scale: { x: 7, y: 3 },
          },
        },
      },
    });
    const r = resolveSourceMaterial(f.pack, f.material);
    expect(r.issues).toEqual([]);
    expect(r.drawColor).toBe(true);
    expect(r.surface).toBe(1);
    expect(r.material.model).toBe(I.MaterialModel.ParticleUnlit);
    expect(r.material.tint).toMatchObject({ r: 2, g: 0.25, b: 0.5, a: 0.75 });
    expect(r.material.renderState).toMatchObject({
      srcRgb: I.BlendFactor.SrcAlpha,
      dstRgb: I.BlendFactor.OneMinusSrcAlpha,
      srcAlpha: I.BlendFactor.One,
      dstAlpha: I.BlendFactor.OneMinusSrcAlpha,
      depthWrite: false,
      cull: I.CullMode.Back,
    });
    expect(r.material.renderQueue).toBe(2000);
    expect(r.builtinTexture?.fileId).toBe(10300n);
    expect(r.passes.map((p) => [p.name, p.enabled])).toEqual([
      ['ForwardLit', true],
      ['DepthOnly', false],
      ['DepthNormalsOnly', true],
    ]);
    expect(f.material.model).toBe(I.MaterialModel.UnityShader);
    expect(f.material.tint).toBeNull();
    expect(resolveSourceMaterial(f.pack, r.material)).toBe(r);
  });
  it('keeps a depth-only source program distinct from a color material', () => {
    const f = fixture(lit, {
      m_ValidKeywords: ['_SURFACE_TYPE_TRANSPARENT', '_ALPHAPREMULTIPLY_ON'],
    });
    const r = resolveSourceMaterial(f.pack, f.material);
    expect(r.issues).toEqual([]);
    expect(r.drawColor).toBe(false);
    expect(r.passes).toHaveLength(1);
    expect(r.passes[0]).toMatchObject({
      name: 'DepthOnly',
      lightMode: 'DepthOnly',
      renderState: { colorWriteMask: 1, depthWrite: true, srcRgb: 1, dstRgb: 0 },
    });
    expect(r.builtinTexture).toBeNull();
  });
  it('uses white and opaque defaults only when the shader texture is unassigned', () => {
    const f = fixture();
    const r = resolveSourceMaterial(f.pack, f.material);
    expect(r.issues).toEqual([]);
    expect(r.surface).toBe(0);
    expect(r.material.tint).toMatchObject({ r: 1, g: 1, b: 1, a: 1 });
    expect(r.material.textures).toEqual([]);
    expect(r.builtinTexture).toBeNull();
  });
  it('resolves only the consumed BaseMap and ignores unused emission texture data', () => {
    const f = fixture(unlit, {
      m_SavedProperties: {
        m_TexEnvs: {
          _BaseMap: {
            m_Texture: { fileID: '9223372036854775807', guid: 'texture' },
            m_Scale: { x: 12, y: 7 },
            m_Offset: { x: 3, y: 4 },
          },
          _EmissionMap: { m_Texture: { fileID: '15', guid: 'unresolved' } },
        },
      },
    });
    f.references.push(
      new I.UnitySourceReferenceT(
        0,
        '_BaseMap',
        new I.SourceReferenceT('texture', 9223372036854775807n),
        I.SourceResolution.Asset,
        0,
        42,
      ),
    );
    f.material.textures = [new I.TextureBindingT('_BaseMap', 42)];
    const r = resolveSourceMaterial(f.pack, f.material);
    expect(r.issues).toEqual([]);
    expect(r.material.textures).toHaveLength(1);
    expect(r.material.textures[0]).toMatchObject({
      imageId: 42,
      uvSet: 0,
      scale: { x: 1, y: 1 },
      offset: { x: 0, y: 0 },
    });
  });
  it.each([
    { m_ValidKeywords: ['_SOFTPARTICLES_ON'] },
    { m_SavedProperties: { m_Floats: { _SrcBlend: 9 } } },
    { m_SavedProperties: { m_Floats: { _Cull: 7 } } },
    { m_SavedProperties: { m_Colors: { _BaseColor: { r: 'Infinity' } } } },
    { m_SavedProperties: { m_TexEnvs: { _BaseMap: { m_Texture: { fileID: 'invalid' } } } } },
    {
      m_SavedProperties: {
        m_TexEnvs: { _BaseMap: { m_Texture: { fileID: '100', guid: 'missing' } } },
      },
    },
  ])('blocks unsupported source semantics rather than choosing a fallback: %j', (source) => {
    const f = fixture(unlit, source);
    expect(
      resolveSourceMaterial(f.pack, f.material).issues.some((i) => i.severity === 'error'),
    ).toBe(true);
  });
  it('blocks a different program even with a familiar shader name', () => {
    const f = fixture('0'.repeat(64));
    f.material.sourceShader = 'Universal Render Pipeline/Particles/Unlit';
    expect(resolveSourceMaterial(f.pack, f.material)).toMatchObject({
      program: null,
      issues: [{ severity: 'error' }],
    });
  });
  it('requires importer metadata for a source-only external texture', () => {
    const f = fixture(unlit, {
      m_SavedProperties: { m_TexEnvs: { _BaseMap: { m_Texture: { fileID: '1', guid: 'hdr' } } } },
    });
    f.references.push(
      new I.UnitySourceReferenceT(
        0,
        '_BaseMap',
        new I.SourceReferenceT('hdr', 1n),
        I.SourceResolution.Asset,
        0,
        42,
      ),
    );
    expect(resolveSourceMaterial(f.pack, f.material).issues).toEqual([
      expect.objectContaining({
        severity: 'error',
        field: 'materials.4.sourceData._BaseMap.importer',
      }),
    ]);
  });
  it('preserves explicit linear encoding and importer sampler for source-only textures', () => {
    const f = fixture(unlit, {
      m_SavedProperties: { m_TexEnvs: { _BaseMap: { m_Texture: { fileID: '1', guid: 'hdr' } } } },
    });
    f.references.push(
      new I.UnitySourceReferenceT(
        0,
        '_BaseMap',
        new I.SourceReferenceT('hdr', 1n),
        I.SourceResolution.Asset,
        0,
        42,
      ),
    );
    Object.assign(f.pack.document.sourceExport!, {
      files: [
        {
          assetId: 42,
          metadata: serialized({
            TextureImporter: {
              mipmaps: { sRGBTexture: 0 },
              textureSettings: { filterMode: 2, wrapU: 0, wrapV: 2 },
            },
          }),
        },
      ],
    });
    const r = resolveSourceMaterial(f.pack, f.material);
    expect(r.issues).toEqual([]);
    expect(r.material.textures[0]).toMatchObject({
      colorSpace: I.ColorSpace.Linear,
      sampler: {
        minFilter: I.FilterMode.Trilinear,
        magFilter: I.FilterMode.Linear,
        wrapU: I.AddressMode.Repeat,
        wrapV: I.AddressMode.Mirror,
      },
    });
  });
  it('leaves normalized materials unchanged', () => {
    const f = fixture();
    f.material.model = I.MaterialModel.ParticleUnlit;
    expect(resolveSourceMaterial(f.pack, f.material).material).toBe(f.material);
  });
});
