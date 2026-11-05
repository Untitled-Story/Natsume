import type { DeepReadonly as R, EffectPack } from '../pack.js';
import { MaterialT } from '../format/generated/noa/ir/material.js';
import { MaterialModel } from '../format/generated/noa/ir/material-model.js';
import type { SerializedValueT } from '../format/generated/noa/ir/serialized-value.js';
import { SerializedValueData as V } from '../format/generated/noa/ir/serialized-value-data.js';
import { ColorT } from '../format/generated/noa/ir/color.js';
import { RenderStateT } from '../format/generated/noa/ir/render-state.js';
import { TextureBindingT } from '../format/generated/noa/ir/texture-binding.js';
import { Vec2T } from '../format/generated/noa/ir/vec2.js';
import { SamplerT } from '../format/generated/noa/ir/sampler.js';
import { ColorSpace } from '../format/generated/noa/ir/color-space.js';
import { SupportChecks, type SupportIssue } from '../runtime/support-checks.js';

const unlitHash = '00caeea0345e4a8eed279ee8893d77fa53d37a1626d91fa644012a7a2224e700';
const litHash = 'afc864a0b8f613244f08d7d3ed52bc0fabe38bf5d39ce298d23f6f0038a97b29';
const addAlphaHash = 'f4c3959fbb391fd5e4722820c271a04f3d3ced65bd2029429033936e7ae264f9';
const textureHash = '09bc049fd22991be3a180c1550dd85a5f3cbdc1a7b764383cca275b3afbcf236';
const textureMipHash = 'f07136c5ab507bfcb309c1920a6afce6f1d5653f80c1c2f97e8ec0066ba58ac2';
const builtinGuid = '0000000000000000f000000000000000';
const resolved = new WeakMap<EffectPack, WeakMap<object, ResolvedSourceMaterial>>();

type ObjectValue = { readonly [key: string]: Value };
type Value = null | string | number | bigint | boolean | readonly Value[] | ObjectValue;

function read(value: R<SerializedValueT> | null): Value {
  const d = value?.data;
  if (!d) return null;
  if (value.dataType === V.ObjectValue && 'fields' in d)
    return Object.fromEntries(d.fields.map((f) => [String(f.name), read(f.value)]));
  if (value.dataType === V.ArrayValue && 'values' in d) return d.values.map(read);
  if ('value' in d) return d.value as Value;
  return null;
}
function object(value: Value | undefined): ObjectValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as ObjectValue)
    : {};
}

export interface SourceMaterialPass {
  readonly name: string;
  readonly lightMode: string;
  readonly enabled: boolean;
  readonly renderState: R<RenderStateT>;
}

export interface ResolvedSourceMaterial {
  readonly material: R<MaterialT>;
  readonly program:
    | 'urp-particles-unlit'
    | 'urp-lit-depth-only'
    | 'particle-add-alpha'
    | 'texture-vertex-color'
    | null;
  readonly surface: number;
  readonly drawColor: boolean;
  readonly globalMipBias: boolean;
  readonly passes: readonly SourceMaterialPass[];
  readonly builtinTexture: { readonly guid: string; readonly fileId: bigint } | null;
  readonly issues: readonly SupportIssue[];
}

/** Resolves only the audited source programs; the original pack remains immutable. */
export function resolveSourceMaterial(
  pack: EffectPack,
  material: R<MaterialT>,
): ResolvedSourceMaterial {
  const cached = resolved.get(pack)?.get(material);
  if (cached) return cached;
  const checks = new SupportChecks();
  const result = (values: Partial<ResolvedSourceMaterial> = {}): ResolvedSourceMaterial => ({
    material,
    program: null,
    surface: 0,
    drawColor: true,
    globalMipBias: false,
    passes: [],
    builtinTexture: null,
    issues: checks.issues,
    ...values,
  });
  if (material.model !== MaterialModel.UnityShader) return result();
  const field = `materials.${material.id}.sourceData`;
  let shader: Record<string, unknown>;
  try {
    const bytes = pack.getAssetBytes(material.shaderDataAssetId);
    shader = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    checks.require(
      false,
      'CAPABILITY',
      field,
      material.shaderDataAssetId,
      'Source shader data is unavailable',
    );
    return result();
  }
  const hash = shader.program_sha256;
  const knownRecipe = hash === addAlphaHash || hash === textureHash || hash === textureMipHash;
  if (hash !== unlitHash && hash !== litHash && !knownRecipe) {
    checks.require(
      false,
      'CAPABILITY',
      `materials.${material.id}.program_sha256`,
      hash,
      'Unknown source shader program',
    );
    return result();
  }
  const isUnlit = hash === unlitHash;
  const source = object(read(material.sourceData));
  checks.require(
    material.sourceData?.dataType === V.ObjectValue,
    'CAPABILITY',
    field,
    material.sourceData,
    'Source material properties are required',
  );
  const saved = object(source.m_SavedProperties);
  const floats = object(saved.m_Floats);
  const colors = object(saved.m_Colors);
  const scalar = (name: string, fallback: number): number => {
    const raw = floats[name];
    const value = raw === undefined ? fallback : Number(raw);
    checks.require(
      Number.isFinite(value),
      'CAPABILITY',
      `${field}.${name}`,
      raw,
      'Source material scalar must be finite',
    );
    return value;
  };
  const allowed = new Set(
    knownRecipe
      ? []
      : isUnlit
        ? ['_SURFACE_TYPE_TRANSPARENT', 'INSTANCING_ON', 'PROCEDURAL_INSTANCING_ON']
        : ['_SURFACE_TYPE_TRANSPARENT', '_ALPHAPREMULTIPLY_ON', 'INSTANCING_ON'],
  );
  const keywords = source.m_ValidKeywords ?? [];
  checks.require(
    Array.isArray(keywords) && keywords.every((v) => typeof v === 'string' && allowed.has(v)),
    'CAPABILITY',
    `${field}.m_ValidKeywords`,
    keywords,
    'Source material keyword variant has not been verified',
  );
  const surface = isUnlit ? scalar('_Surface', 0) : 0;
  const alphaToMask = isUnlit ? scalar('_AlphaToMask', 0) : 0;
  checks.require(
    alphaToMask === 0,
    'CAPABILITY',
    `${field}._AlphaToMask`,
    alphaToMask,
    'Source alpha-to-coverage requires an explicit multisample target',
  );
  const cull = knownRecipe ? (material.renderState?.cull ?? 0) : scalar('_Cull', 2);
  checks.require(
    Number.isInteger(cull) && cull >= 0 && cull <= 2,
    'CAPABILITY',
    `${field}._Cull`,
    cull,
    'Unsupported source culling',
  );
  // Unity BlendMode differs numerically from NOIR BlendFactor.
  const factors = [0, 1, 6, 2, 7, 4, 3, 8, 9, -1, 5];
  const factor = (name: string, fallback: number) => {
    const raw = scalar(name, fallback);
    const mapped = factors[raw];
    checks.require(
      mapped !== undefined && mapped >= 0,
      'CAPABILITY',
      `${field}.${name}`,
      raw,
      'Unsupported source blend factor',
    );
    return mapped ?? 0;
  };
  const forward = new RenderStateT();
  forward.cull = cull;
  if (isUnlit) {
    forward.srcRgb = factor('_SrcBlend', 1);
    forward.dstRgb = factor('_DstBlend', 0);
    forward.srcAlpha = factor('_SrcBlendAlpha', 1);
    forward.dstAlpha = factor('_DstBlendAlpha', 0);
    forward.rgbOp = forward.alphaOp = scalar('_BlendOp', 0);
    forward.depthWrite = scalar('_ZWrite', 1) !== 0;
  }
  checks.require(
    Number.isInteger(forward.rgbOp) && forward.rgbOp >= 0 && forward.rgbOp <= 4,
    'CAPABILITY',
    `${field}._BlendOp`,
    forward.rgbOp,
    'Unsupported source blend operation',
  );
  const depth = new RenderStateT();
  depth.cull = cull;
  depth.srcRgb = depth.srcAlpha = 1;
  depth.dstRgb = depth.dstAlpha = 0;
  depth.depthWrite = true;
  depth.colorWriteMask = 1; // NOIR bit zero is red; Unity ColorMask R is 8.
  const normal = Object.assign(new RenderStateT(), depth, { colorWriteMask: 15 });
  const disabled = source.disabledShaderPasses;
  // Unity keys pass enablement by LightMode, case-insensitively, not by Pass Name.
  const enabled = (tag: string) =>
    !Array.isArray(disabled) ||
    !disabled.some((name) => typeof name === 'string' && name.toLowerCase() === tag.toLowerCase());
  const shaderSource = object(shader.source as Value);
  const subShaders = object(shaderSource.m_ParsedForm).m_SubShaders;
  const sourcePasses = Array.isArray(subShaders) ? object(subShaders[0]).m_Passes : [];
  const sourcePass = Array.isArray(sourcePasses) ? object(sourcePasses[0]) : {};
  const sourceState = object(sourcePass.m_State);
  const tags = object(object(sourceState.m_Tags).tags);
  const knownTag = String(tags.LIGHTMODE ?? 'SRPDefaultUnlit');
  const passes: SourceMaterialPass[] = knownRecipe
    ? [
        {
          name: String(sourceState.m_Name ?? ''),
          lightMode: knownTag,
          enabled: enabled(knownTag),
          renderState: material.renderState!,
        },
      ]
    : isUnlit
      ? [
          {
            name: 'ForwardLit',
            lightMode: 'SRPDefaultUnlit',
            enabled: enabled('SRPDefaultUnlit'),
            renderState: forward,
          },
          {
            name: 'DepthOnly',
            lightMode: 'DepthOnly',
            enabled: enabled('DepthOnly'),
            renderState: depth,
          },
          {
            name: 'DepthNormalsOnly',
            lightMode: 'DepthNormalsOnly',
            enabled: enabled('DepthNormalsOnly'),
            renderState: normal,
          },
        ]
      : [
          {
            name: 'DepthOnly',
            lightMode: 'DepthOnly',
            enabled: enabled('DepthOnly'),
            renderState: depth,
          },
        ];
  const tint = isUnlit ? object(colors._BaseColor) : {};
  const channels = ['r', 'g', 'b', 'a'].map((k) => (tint[k] === undefined ? 1 : Number(tint[k])));
  checks.require(
    channels.every(Number.isFinite),
    'CAPABILITY',
    `${field}._BaseColor`,
    tint,
    'Source base color must be finite',
  );
  const effective = Object.assign(new MaterialT(), material, {
    model: knownRecipe
      ? hash === addAlphaHash
        ? MaterialModel.ParticleAddAlpha
        : MaterialModel.TextureVertexColor
      : MaterialModel.ParticleUnlit,
    tint: new ColorT(channels[0], channels[1], channels[2], channels[3]),
    renderState: knownRecipe ? material.renderState : isUnlit ? forward : depth,
    renderQueue: material.renderQueue === -1 ? (knownRecipe ? 3000 : 2000) : material.renderQueue,
    textures: [],
  });
  let builtinTexture: ResolvedSourceMaterial['builtinTexture'] = null;
  if (isUnlit || knownRecipe) {
    const slot = isUnlit ? '_BaseMap' : '_MainTex';
    const sourceBinding = object(object(saved.m_TexEnvs)[slot]);
    const texture = object(sourceBinding.m_Texture);
    let fileId = 0n;
    try {
      fileId = BigInt(String(texture.fileID ?? 0));
    } catch {
      checks.require(
        false,
        'CAPABILITY',
        `${field}.${slot}.fileID`,
        texture.fileID,
        'Source texture fileID must be an integer',
      );
    }
    const guid = String(texture.guid ?? '');
    if (isUnlit && fileId !== 0n && guid === builtinGuid && fileId === 10300n)
      builtinTexture = { guid, fileId };
    else if (fileId !== 0n) {
      const reference = pack.document.sourceExport?.references.find(
        (r) =>
          r.source?.fileId === fileId &&
          String(r.source.guid ?? '') === guid &&
          r.targetAssetId !== 0,
      );
      checks.require(
        reference,
        'CAPABILITY',
        `${field}.${slot}`,
        texture,
        'Source base texture has no resolved image asset',
      );
      if (reference) {
        const existing = material.textures.find(
          (binding) => binding.imageId === reference.targetAssetId,
        );
        const file = pack.document.sourceExport?.files?.find(
          (file) => file.assetId === reference.targetAssetId,
        );
        const importer = object(object(read(file?.metadata ?? null)).TextureImporter);
        const mipmaps = object(importer.mipmaps),
          settings = object(importer.textureSettings);
        const srgb = Number(mipmaps.sRGBTexture);
        const filter = Number(settings.filterMode),
          wrapU = Number(settings.wrapU),
          wrapV = Number(settings.wrapV);
        checks.require(
          existing ||
            ([0, 1].includes(srgb) &&
              [0, 1, 2].includes(filter) &&
              [0, 1, 2].includes(wrapU) &&
              [0, 1, 2].includes(wrapV)),
          'CAPABILITY',
          `${field}.${slot}.importer`,
          file?.metadata,
          'Source texture requires explicit encoding and sampler metadata',
        );
        const wrap = (value: number) => (value === 0 ? 1 : value === 1 ? 0 : 2);
        const st = isUnlit
          ? [1, 1, 0, 0]
          : [
              Number(object(sourceBinding.m_Scale).x ?? 1),
              Number(object(sourceBinding.m_Scale).y ?? 1),
              Number(object(sourceBinding.m_Offset).x ?? 0),
              Number(object(sourceBinding.m_Offset).y ?? 0),
            ];
        checks.require(
          st.every(Number.isFinite),
          'CAPABILITY',
          `${field}.${slot}.ST`,
          sourceBinding,
          'Source texture scale and offset must be finite',
        );
        effective.textures.push(
          new TextureBindingT(
            slot,
            reference.targetAssetId,
            0,
            new Vec2T(st[0], st[1]),
            new Vec2T(st[2], st[3]),
            existing?.colorSpace ?? (srgb === 1 ? ColorSpace.SRGB : ColorSpace.Linear),
            existing?.sampler
              ? structuredClone(existing.sampler)
              : new SamplerT(filter, filter === 0 ? 0 : 1, wrap(wrapU), wrap(wrapV)),
          ),
        );
      }
    }
  }
  const resolution = result({
    material: effective,
    program: knownRecipe
      ? hash === addAlphaHash
        ? 'particle-add-alpha'
        : 'texture-vertex-color'
      : isUnlit
        ? 'urp-particles-unlit'
        : 'urp-lit-depth-only',
    surface,
    drawColor: knownRecipe ? enabled(knownTag) : isUnlit && enabled('SRPDefaultUnlit'),
    globalMipBias: isUnlit || hash === textureMipHash,
    passes,
    builtinTexture,
  });
  let cache = resolved.get(pack);
  if (!cache) resolved.set(pack, (cache = new WeakMap()));
  cache.set(material, resolution);
  cache.set(effective, resolution);
  return resolution;
}
