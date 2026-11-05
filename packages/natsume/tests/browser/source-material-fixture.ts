import {
  Application,
  BufferImageSource,
  Container,
  RenderTexture,
  Texture,
  type WebGLRenderer,
} from 'pixi.js';
import {
  ArrayValueT,
  AssetT,
  ColorT,
  DocumentT,
  FeatureRequirementT,
  MaterialT,
  MaterialModel,
  MeshRendererT,
  ObjectValueT,
  SerializedFieldT,
  SerializedValueData as V,
  SerializedValueT,
  SourceExportT,
  SourceReferenceT,
  SourceResolution,
  StringValueT,
  UnitySourceFileT,
  UnitySourceReferenceT,
  Vec3T,
  Vec4T,
} from '../../src/format/generated/noa/ir.js';
import { MeshT, SubmeshT, TexCoordT } from '../../src/format/generated/noa/mesh.js';
import { EffectPack } from '../../src/pack.js';
import { loadPack, NatsumeRuntime } from '../../src/index.js';
import { defaultParticleMips } from '../../src/rendering/default-particle.js';
import { decodeExrPixels } from '../../src/loader/exr-pixels.js';
import { ensureMaterialPipe } from '../../src/rendering/material-pipe.js';
import { SceneMesh } from '../../src/rendering/scene-mesh.js';
import { resolveSourceMaterial } from '../../src/rendering/source-material.js';
import { Scene } from '../../src/runtime/scene.js';
import type { ManifestFile } from '../../src/loader/manifest.js';

interface SourceCase {
  label: string;
  linear: boolean;
  surface: number;
  tint: number[];
  vertex: number[];
  st: number[];
  src: number;
  dst: number;
  srcAlpha: number;
  dstAlpha: number;
  op: number;
}
type SourceObject = { [key: string]: unknown };

function serialized(value: unknown): SerializedValueT {
  if (Array.isArray(value))
    return new SerializedValueT(V.ArrayValue, new ArrayValueT(value.map(serialized)));
  if (value !== null && typeof value === 'object')
    return new SerializedValueT(
      V.ObjectValue,
      new ObjectValueT(
        Object.entries(value).map(
          ([key, child]) => new SerializedFieldT(key, null, serialized(child)),
        ),
      ),
    );
  return new SerializedValueT(V.StringValue, new StringValueT(value === null ? '' : String(value)));
}

function sourcePack(
  base: EffectPack,
  source: SourceObject,
  shader: SourceObject,
  exr?: Uint8Array,
): EffectPack {
  const document = structuredClone(base.document) as DocumentT;
  const assetId = Math.max(...document.assets.map((asset) => asset.id)) + 1;
  document.assets.push(new AssetT(assetId, 3));
  document.features.push(new FeatureRequirementT('material.unity-source', 1, true));
  for (const material of document.materials) {
    material.model = MaterialModel.UnityShader;
    material.shaderDataAssetId = assetId;
    material.sourceData = serialized(source);
    material.tint = new ColorT(1, 1, 1, 1);
    material.textures = [];
  }
  const path = `assets/${assetId}.shader.json`;
  const bytes = new TextEncoder().encode(JSON.stringify(shader));
  const files: ManifestFile[] = [
    ...base.manifest.files,
    {
      path,
      kind: 'shader_data',
      asset_id: assetId,
      byte_length: bytes.length,
      sha256: '0'.repeat(64),
    },
  ];
  const contents = new Map<string, Uint8Array>([[path, bytes]]);
  if (exr) {
    const imageId = assetId + 1,
      guid = '0123456789abcdef0123456789abcdef';
    document.assets.push(new AssetT(imageId, 5));
    const imagePath = `assets/${imageId}.bin`;
    files.push({
      path: imagePath,
      kind: 'source_data',
      asset_id: imageId,
      byte_length: exr.length,
      sha256: '0'.repeat(64),
    });
    contents.set(imagePath, exr);
    document.sourceExport = new SourceExportT(
      0,
      [
        new UnitySourceFileT(
          'probe.exr',
          guid,
          imageId,
          serialized({
            TextureImporter: {
              mipmaps: { sRGBTexture: 0 },
              textureSettings: { filterMode: 0, wrapU: 1, wrapV: 1 },
            },
          }),
        ),
      ],
      [],
      [
        new UnitySourceReferenceT(
          0,
          'm_SavedProperties.m_TexEnvs._BaseMap.m_Texture',
          new SourceReferenceT(guid, 2800000n),
          SourceResolution.Asset,
          0,
          imageId,
        ),
      ],
    );
  }
  return new EffectPack(
    document,
    {
      ...base.manifest,
      files,
    },
    contents,
    new Map(
      document.assets.flatMap((asset) => {
        const mesh = base.getMesh(asset.id);
        return mesh ? [[asset.id, structuredClone(mesh) as MeshT]] : [];
      }),
    ),
  );
}

function quad(color: number[]): MeshT {
  const mesh = new MeshT();
  mesh.positions = [
    new Vec3T(-1, -1, 0),
    new Vec3T(1, -1, 0),
    new Vec3T(1, 1, 0),
    new Vec3T(-1, 1, 0),
  ];
  mesh.colors = mesh.positions.map(() => new Vec4T(color[0], color[1], color[2], color[3]));
  mesh.texcoords = [
    new TexCoordT(0, 2, [
      new Vec4T(0, 0, 0, 0),
      new Vec4T(1, 0, 0, 0),
      new Vec4T(1, 1, 0, 0),
      new Vec4T(0, 1, 0, 0),
    ]),
  ];
  mesh.indices = [0, 1, 2, 0, 2, 3];
  mesh.submeshes = [new SubmeshT(0, 6)];
  return mesh;
}

/** Executes the ordinary source-material mesh path, including real source resolution. */
export async function measureSourceMaterials(input: {
  bytes: number[];
  shader: SourceObject;
  depthShader: SourceObject;
  source: SourceObject;
  cases: SourceCase[];
  exr: number[];
  hdrPoints: { x: number; y: number }[];
}) {
  const app = new Application();
  await app.init({
    preference: 'webgl',
    preferWebGLVersion: 2,
    width: 64,
    height: 64,
    autoStart: false,
    antialias: false,
    backgroundAlpha: 0,
  });
  const renderer = app.renderer as WebGLRenderer;
  ensureMaterialPipe(renderer);
  const base = await loadPack(Uint8Array.from(input.bytes));
  const results: Record<string, number[]> = {};
  const matrix = [4, 0, 0, 0, 0, -4, 0, 0, 0, 0, 0.001, 0, 4, 4, 0, 1];
  const texture = new Texture({
    source: new BufferImageSource({
      resource: new Uint8Array([
        77, 128, 230, 51, 230, 204, 26, 179, 204, 51, 153, 128, 26, 179, 77, 230,
      ]),
      width: 2,
      height: 2,
      alphaMode: 'no-premultiply-alpha',
      minFilter: 'nearest',
      magFilter: 'nearest',
    }),
  });
  const target = RenderTexture.create({ width: 8, height: 8, antialias: false });
  const container = new Container();
  for (const sample of input.cases) {
    const source = structuredClone(input.source);
    const saved = source.m_SavedProperties as SourceObject;
    const floats = saved.m_Floats as SourceObject;
    Object.assign(floats, {
      _Surface: sample.surface,
      _Cull: 0,
      _SrcBlend: sample.src,
      _DstBlend: sample.dst,
      _SrcBlendAlpha: sample.srcAlpha,
      _DstBlendAlpha: sample.dstAlpha,
      _BlendOp: sample.op,
      _ZWrite: 0,
    });
    (saved.m_Colors as SourceObject)._BaseColor = {
      r: sample.tint[0],
      g: sample.tint[1],
      b: sample.tint[2],
      a: sample.tint[3],
    };
    (saved.m_TexEnvs as SourceObject)._BaseMap = {
      m_Texture: { fileID: 10300, guid: '0000000000000000f000000000000000' },
      m_Scale: { x: sample.st[0], y: sample.st[1] },
      m_Offset: { x: sample.st[2], y: sample.st[3] },
    };
    const pack = sourcePack(base, source, input.shader);
    const material = pack.document.materials[0]!;
    const resolution = resolveSourceMaterial(pack, material);
    if (resolution.issues.some((issue) => issue.severity === 'error'))
      throw new Error(JSON.stringify(resolution.issues));
    const scene = new Scene(pack, pack.document.entries[0]!.roots);
    const mesh = new SceneMesh(
      scene.ordered[0]!,
      new MeshRendererT(),
      material,
      quad(sample.vertex),
      0,
      texture,
      pack,
    );
    container.addChild(mesh);
    mesh.renderEnvironment = { globalMipBias: 0 };
    mesh.sync(matrix, sample.linear ? 'linear' : 'gamma');
    renderer.render({ container, target, clear: true, clearColor: [0.12, 0.23, 0.34, 0.45] });
    results[sample.label] = Array.from(renderer.extract.pixels({ target }).pixels);
    container.removeChild(mesh);
    mesh.destroy();
    pack.dispose();
  }
  const builtinTexture = new Texture({
    source: new BufferImageSource({
      resource: defaultParticleMips()[0]!,
      width: 64,
      height: 64,
      alphaMode: 'no-premultiply-alpha',
      minFilter: 'nearest',
      magFilter: 'nearest',
    }),
  });
  const builtinPack = sourcePack(base, input.source, input.shader);
  const builtinMaterial = Object.assign(new MaterialT(), builtinPack.document.materials[0]);
  const builtinSource = structuredClone(input.source);
  const saved = builtinSource.m_SavedProperties as SourceObject;
  Object.assign(saved.m_Floats as SourceObject, {
    _Surface: 1,
    _Cull: 0,
    _SrcBlend: 1,
    _DstBlend: 0,
    _SrcBlendAlpha: 1,
    _DstBlendAlpha: 0,
    _ZWrite: 0,
  });
  (saved.m_Colors as SourceObject)._BaseColor = { r: 1, g: 1, b: 1, a: 1 };
  builtinMaterial.sourceData = serialized(builtinSource);
  const builtinNode = new Scene(builtinPack, builtinPack.document.entries[0]!.roots).ordered[0]!;
  const builtinMesh = new SceneMesh(
    builtinNode,
    new MeshRendererT(),
    builtinMaterial,
    quad([1, 1, 1, 1]),
    0,
    builtinTexture,
    builtinPack,
  );
  const builtinTarget = RenderTexture.create({ width: 64, height: 64, antialias: false });
  container.addChild(builtinMesh);
  builtinMesh.renderEnvironment = { globalMipBias: 0 };
  builtinMesh.sync([32, 0, 0, 0, 0, -32, 0, 0, 0, 0, 0.001, 0, 32, 32, 0, 1], 'gamma');
  renderer.render({ container, target: builtinTarget, clear: true });
  const builtinPixels = Array.from(renderer.extract.pixels({ target: builtinTarget }).pixels);
  renderer.resize(96, 80);
  renderer.render({ container, target: builtinTarget, clear: true });
  const resizedPixels = renderer.extract.pixels({ target: builtinTarget }).pixels;
  const resizeStable = builtinPixels.every((value, index) => value === resizedPixels[index]);
  const previousDepth = renderer.gl.getParameter(renderer.gl.DEPTH_FUNC) as number;
  renderer.gl.depthFunc(renderer.gl.GREATER);
  renderer.colorMask.setMask(13);
  const hostMask = renderer.gl.getParameter(renderer.gl.COLOR_WRITEMASK) as boolean[];
  renderer.render({ container, target: builtinTarget, clear: true });
  const restoredMask = renderer.gl.getParameter(renderer.gl.COLOR_WRITEMASK) as boolean[];
  const hostStateRestored =
    renderer.gl.getParameter(renderer.gl.DEPTH_FUNC) === renderer.gl.GREATER &&
    hostMask.every((value, index) => value === restoredMask[index]);
  renderer.gl.depthFunc(previousDepth);
  renderer.colorMask.setMask(15);
  container.removeChild(builtinMesh);
  builtinMesh.destroy();
  builtinTarget.destroy(true);
  builtinTexture.destroy(true);
  const hdr = decodeExrPixels(Uint8Array.from(input.exr));
  const hdrTexture = new Texture({
    source: new BufferImageSource({
      resource: hdr.rgba,
      width: hdr.width,
      height: hdr.height,
      format: 'rgba16float',
      alphaMode: 'no-premultiply-alpha',
      minFilter: 'nearest',
      magFilter: 'nearest',
    }),
  });
  const hdrTarget = RenderTexture.create({
    width: hdr.width,
    height: hdr.height,
    format: 'rgba32float',
    antialias: false,
  });
  const hdrMesh = new SceneMesh(
    builtinNode,
    new MeshRendererT(),
    builtinMaterial,
    quad([1, 1, 1, 1]),
    0,
    hdrTexture,
    builtinPack,
  );
  hdrMesh.shader!.resources.colorUniforms.uniforms.uTextureSRGB = 0;
  container.addChild(hdrMesh);
  hdrMesh.renderEnvironment = { globalMipBias: 0 };
  hdrMesh.sync(
    [
      hdr.width / 2,
      0,
      0,
      0,
      0,
      -hdr.height / 2,
      0,
      0,
      0,
      0,
      0.001,
      0,
      hdr.width / 2,
      hdr.height / 2,
      0,
      1,
    ],
    'gamma',
  );
  renderer.render({ container, target: hdrTarget, clear: true });
  const gl = renderer.gl;
  const hdrPixels = new Float32Array(hdr.width * hdr.height * 4);
  gl.readPixels(0, 0, hdr.width, hdr.height, gl.RGBA, gl.FLOAT, hdrPixels);
  const hdrSamples = input.hdrPoints.map(({ x, y }) => ({
    x,
    y,
    value: Array.from(hdrPixels.slice((y * hdr.width + x) * 4, (y * hdr.width + x + 1) * 4)),
  }));
  container.removeChild(hdrMesh);
  hdrMesh.destroy();
  hdrTexture.destroy(true);
  hdrTarget.destroy(true);
  const runtime = new NatsumeRuntime(renderer);
  const options = { sourceColorSpace: 'gamma' as const, renderEnvironment: { globalMipBias: 0 } };
  const effect = await runtime.instantiate(builtinPack, options);
  const effect2 = await runtime.instantiate(builtinPack, options);
  const cache = runtime as unknown as { textures: Map<EffectPack, Map<string, { refs: number }>> };
  const cached = cache.textures.get(builtinPack)?.get('builtin:10300');
  const sharedRefs = cached?.refs;
  effect.destroy();
  const retained = cache.textures.get(builtinPack)?.get('builtin:10300')?.refs;
  effect2.destroy();
  const released = !cache.textures.get(builtinPack)?.size;
  const hdrSource = structuredClone(builtinSource);
  ((hdrSource.m_SavedProperties as SourceObject).m_TexEnvs as SourceObject)._BaseMap = {
    m_Texture: { fileID: 2800000, guid: '0123456789abcdef0123456789abcdef' },
  };
  const hdrPack = sourcePack(base, hdrSource, input.shader, Uint8Array.from(input.exr));
  const hdrEffect = await runtime.instantiate(hdrPack, options);
  const hdrEffect2 = await runtime.instantiate(hdrPack, options);
  const hdrEntries = cache.textures.get(hdrPack);
  const hdrLease = hdrEntries?.values().next().value as unknown as {
    promise: Promise<Texture>;
    refs: number;
  };
  const runtimeHdrTexture = await hdrLease.promise;
  const hdrFormat = runtimeHdrTexture.source.format;
  const hdrResources = hdrEntries?.size;
  hdrEffect.destroy();
  hdrEffect2.destroy();
  const hdrReleased = !cache.textures.get(hdrPack)?.size;
  hdrPack.dispose();
  const depthPack = sourcePack(base, input.source, input.depthShader);
  const depthEffect = await runtime.instantiate(depthPack, options);
  const depthDraws = depthEffect.container.children.length;
  depthEffect.destroy();
  const unknownPack = sourcePack(base, input.source, {
    ...input.shader,
    program_sha256: '0'.repeat(64),
  });
  const unknown = runtime.checkCompatibility(unknownPack, options);
  let rejected = false;
  try {
    await runtime.instantiate(unknownPack, options);
  } catch {
    rejected = true;
  }
  const glError = gl.getError();
  runtime.destroy();
  depthPack.dispose();
  unknownPack.dispose();
  builtinPack.dispose();
  texture.destroy(true);
  target.destroy(true);
  container.destroy();
  base.dispose();
  app.destroy(true);
  return {
    results,
    builtinPixels,
    hdrSamples,
    hdrWidth: hdr.width,
    hdrHeight: hdr.height,
    lifecycle: {
      sharedRefs,
      retained,
      released,
      depthDraws,
      unknownRejected: !unknown.compatible && rejected,
      hdrFormat,
      hdrResources,
      hdrReleased,
      resizeStable,
      hostStateRestored,
      glError,
    },
  };
}

/** Uses the runtime-acquired builtin texture with its actual mip and sampler settings. */
export async function measureBuiltinFiltering(input: {
  bytes: number[];
  shader: SourceObject;
  source: SourceObject;
  cases: { label: string; linear: boolean; size: number; bias: number }[];
}) {
  const app = new Application();
  await app.init({
    preference: 'webgl',
    preferWebGLVersion: 2,
    width: 64,
    height: 64,
    autoStart: false,
    antialias: false,
    backgroundAlpha: 0,
  });
  const renderer = app.renderer as WebGLRenderer;
  const runtime = new NatsumeRuntime(renderer);
  const base = await loadPack(Uint8Array.from(input.bytes));
  const source = structuredClone(input.source);
  const saved = source.m_SavedProperties as SourceObject;
  Object.assign(saved.m_Floats as SourceObject, {
    _Surface: 1,
    _Cull: 0,
    _SrcBlend: 1,
    _DstBlend: 0,
    _SrcBlendAlpha: 1,
    _DstBlendAlpha: 0,
    _ZWrite: 0,
  });
  (saved.m_Colors as SourceObject)._BaseColor = { r: 1, g: 1, b: 1, a: 1 };
  const pack = sourcePack(base, source, input.shader);
  const effect = await runtime.instantiate(pack, {
    sourceColorSpace: 'gamma',
    renderEnvironment: { globalMipBias: 0 },
  });
  const cache = runtime as unknown as {
    textures: Map<EffectPack, Map<string, { promise: Promise<Texture> }>>;
  };
  const texture = await cache.textures.get(pack)!.get('builtin:10300')!.promise;
  const node = new Scene(pack, pack.document.entries[0]!.roots).ordered[0]!;
  const container = new Container();
  const results: Record<string, number[]> = {};
  for (const sample of input.cases) {
    const size = sample.size;
    const target = RenderTexture.create({ width: size, height: size, antialias: false });
    const mesh = new SceneMesh(
      node,
      new MeshRendererT(),
      pack.document.materials[0]!,
      quad([1, 1, 1, 1]),
      0,
      texture,
      pack,
    );
    mesh.renderEnvironment = { globalMipBias: sample.bias };
    container.addChild(mesh);
    mesh.sync(
      [size / 2, 0, 0, 0, 0, -size / 2, 0, 0, 0, 0, 0.001, 0, size / 2, size / 2, 0, 1],
      sample.linear ? 'linear' : 'gamma',
    );
    renderer.render({ container, target, clear: true });
    results[sample.label] = Array.from(renderer.extract.pixels({ target }).pixels);
    container.removeChild(mesh);
    mesh.destroy();
    target.destroy(true);
  }
  const sampler = {
    min: texture.source.style.minFilter,
    mag: texture.source.style.magFilter,
    mip: texture.source.style.mipmapFilter,
    autoMip: texture.source.autoGenerateMipmaps,
  };
  const glError = renderer.gl.getError();
  container.destroy();
  effect.destroy();
  runtime.destroy();
  pack.dispose();
  base.dispose();
  app.destroy(true);
  return { results, sampler, glError };
}
