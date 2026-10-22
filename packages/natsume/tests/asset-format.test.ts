import { Builder } from 'flatbuffers';
import { strToU8, zipSync } from 'fflate';
import { expect, it } from 'vitest';
import { loadPack } from '../src/loader/load.js';
import { parseManifest } from '../src/loader/manifest.js';
import { verifyBuffer } from '../src/format/verify.js';
import { validateDocument, validateMesh } from '../src/format/semantics.js';
import { meshUV } from '../src/format/mesh-attributes.js';
import { Simulation } from '../src/runtime/simulation.js';
import { checkCompatibility } from '../src/runtime/compatibility.js';
import { minimalDocument, encode } from './helpers.js';
import { DocumentT } from '../src/format/generated/noa/ir/document.js';
import { Mesh, MeshT } from '../src/format/generated/noa/mesh/mesh.js';
import { Vec3T as V3 } from '../src/format/generated/noa/mesh/vec3.js';
import { Vec4T as V4 } from '../src/format/generated/noa/mesh/vec4.js';
import { TexCoordT } from '../src/format/generated/noa/mesh/tex-coord.js';
import { SubmeshT } from '../src/format/generated/noa/mesh/submesh.js';
import { AssetT } from '../src/format/generated/noa/ir/asset.js';
import { AssetKind as A } from '../src/format/generated/noa/ir/asset-kind.js';
import { FeatureRequirementT as Feature } from '../src/format/generated/noa/ir/feature-requirement.js';
import { SpriteAssetT } from '../src/format/generated/noa/ir/sprite-asset.js';
import { Vec2T } from '../src/format/generated/noa/ir/vec2.js';
import { Vec4T } from '../src/format/generated/noa/ir/vec4.js';
import { SamplerT } from '../src/format/generated/noa/ir/sampler.js';
import { ComponentT } from '../src/format/generated/noa/ir/component.js';
import { ComponentData as C } from '../src/format/generated/noa/ir/component-data.js';
import { MeshFilterT } from '../src/format/generated/noa/ir/mesh-filter.js';
import { MeshRendererT } from '../src/format/generated/noa/ir/mesh-renderer.js';
import { ColorContextT } from '../src/format/generated/noa/ir/color-context.js';
import { UIMaskT } from '../src/format/generated/noa/ir/uimask.js';

function triangle() {
  const m = new MeshT();
  m.formatMajor = 2;
  m.positions = [new V3(-1, 0, 0), new V3(1, 0, 0), new V3(0, 1, 0)];
  m.indices = [2, 0, 1];
  m.submeshes = [new SubmeshT(0, 3)];
  return m;
}
function encodeMesh(mesh: MeshT) {
  const b = new Builder();
  Mesh.finishMeshBuffer(b, mesh.pack(b));
  return Uint8Array.from(b.asUint8Array());
}
function spriteDocument() {
  const d = minimalDocument();
  const s = new SpriteAssetT();
  s.meshAssetId = 42;
  s.imageAssetId = 91;
  s.rect = new Vec4T(0, 0, 4, 4);
  s.textureRect = new Vec4T(0, 0, 4, 4);
  s.pivot = new Vec2T(-0.25, 1.2585158);
  s.border = new Vec4T();
  s.sampler = new SamplerT();
  d.assets = [new AssetT(703, A.Sprite, s), new AssetT(91, A.Image), new AssetT(42, A.Mesh)];
  d.features = [new Feature('asset.sprite'), new Feature('mesh.nomesh', 2)];
  return d;
}
async function packBytes(d: DocumentT, assets: Record<string, Uint8Array>) {
  const files = { 'scene.noir': encode(d), ...assets };
  const entries = [];
  for (const [path, bytes] of Object.entries(files)) {
    const id = /^assets\/(\d+)\./.exec(path)?.[1];
    entries.push({
      path,
      kind: path.endsWith('noir') ? 'noir' : path.endsWith('nomesh') ? 'mesh' : 'image',
      ...(id ? { asset_id: Number(id) } : {}),
      byte_length: bytes.length,
      sha256: Buffer.from(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))).toString(
        'hex',
      ),
    });
  }
  return zipSync(
    {
      ...files,
      'manifest.json': strToU8(
        JSON.stringify({
          format: 'noa-package',
          version: 1,
          noir_version: [2, 0],
          document: 'scene.noir',
          files: entries,
        }),
      ),
    },
    { level: 0 },
  );
}
function pngHeader() {
  const p = new Uint8Array(24);
  p.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const v = new DataView(p.buffer);
  v.setUint32(16, 4);
  v.setUint32(20, 4);
  return p;
}

it('rejects omitted, old and unknown major versions before interpreting changed layouts', async () => {
  for (const version of [0, 1, 3]) {
    const d = minimalDocument();
    d.formatMajor = version;
    expect(() => verifyBuffer(encode(d), 'noir')).toThrow(/version/);
    expect(() => validateDocument(d)).toThrow(/version/);
    const m = triangle();
    m.formatMajor = version;
    expect(() => verifyBuffer(encodeMesh(m), 'mesh')).toThrow(/version/);
    expect(() => validateMesh(m)).toThrow(/version/);
    expect(() =>
      parseManifest(
        strToU8(
          JSON.stringify({
            format: 'noa-package',
            version: 1,
            noir_version: [version, 0],
            document: 'scene.noir',
            files: [],
          }),
        ),
      ),
    ).toThrow(/version/);
  }
  const d = minimalDocument();
  d.semanticsRevision = 2;
  expect(() => verifyBuffer(encode(d), 'noir')).toThrow(/revision/);
});

it('preserves all UV dimensions, original triangle order, HDR colors and missing attributes', () => {
  const m = triangle();
  m.texcoords = Array.from({ length: 8 }, (_, channel) => {
    const dim = (channel % 4) + 1;
    return new TexCoordT(
      channel,
      dim,
      m.positions.map(
        () => new V4(0.1, dim >= 2 ? -0.2 : 0, dim >= 3 ? 0.3 : 0, dim === 4 ? 0.4 : 0),
      ),
    );
  });
  m.colors = m.positions.map(() => new V4(2, -1, 0.5, 0.25));
  validateMesh(m);
  verifyBuffer(encodeMesh(m), 'mesh');
  expect(m.indices).toEqual([2, 0, 1]);
  expect(meshUV(m)).toBe(m.texcoords[0]!.values);
  expect(m.normals).toEqual([]);
  expect(m.tangents).toEqual([]);
  expect(m.colors[0]).toMatchObject({ x: 2, y: -1, w: 0.25 });
  m.texcoords = [];
  expect(meshUV(m)).toEqual([]);
});

it('rejects invalid UV attributes and triangle or submesh ranges', () => {
  for (const mutate of [
    (m: MeshT) => {
      m.texcoords = [
        new TexCoordT(
          8,
          2,
          m.positions.map(() => new V4()),
        ),
      ];
    },
    (m: MeshT) => {
      m.texcoords = [
        new TexCoordT(
          0,
          0,
          m.positions.map(() => new V4()),
        ),
      ];
    },
    (m: MeshT) => {
      m.texcoords = [new TexCoordT(0, 2, [])];
    },
    (m: MeshT) => {
      m.texcoords = [
        new TexCoordT(
          0,
          2,
          m.positions.map(() => new V4(0, 0, 1, 0)),
        ),
      ];
    },
    (m: MeshT) => {
      const t = new TexCoordT(
        0,
        2,
        m.positions.map(() => new V4()),
      );
      m.texcoords = [t, t];
    },
    (m: MeshT) => {
      m.colors = [new V4()];
    },
    (m: MeshT) => {
      m.tangents = m.positions.map(() => new V4(NaN));
    },
    (m: MeshT) => {
      m.indices[0] = -1;
    },
    (m: MeshT) => {
      m.indices[0] = 3;
    },
    (m: MeshT) => {
      m.submeshes[0]!.firstIndex = 1;
    },
  ]) {
    const m = triangle();
    mutate(m);
    expect(() => validateMesh(m)).toThrow();
  }
});

it('loads forward Sprite dependencies by ID without inventing a Sprite file or clamping pivot', async () => {
  const d = spriteDocument();
  const p = await loadPack(
    await packBytes(d, {
      'assets/42.nomesh': encodeMesh(triangle()),
      'assets/91.png': pngHeader(),
    }),
  );
  expect(p.document.assets).toHaveLength(3);
  expect(p.manifest.files).toHaveLength(3);
  expect(p.document.assets[0]!.sprite!.pivot!.y).toBeCloseTo(1.2585158);
  expect(p.getAssetBytes(703)).toBeUndefined();
  expect(p.getMesh(42)!.indices).toEqual([2, 0, 1]);
  const report = checkCompatibility(
    p,
    {},
    {
      maxTextureSize: 4096,
      availableTexturePixels: 1e8,
      cachedMaterialIds: new Set(),
      imageBitmapAvailable: true,
      hasScript: () => false,
      disposed: false,
    },
  );
  expect(report.issues).toContainEqual(
    expect.objectContaining({ code: 'CAPABILITY', field: 'features.asset.sprite' }),
  );
  expect(() => new Simulation(p)).toThrow(/not implemented/);
  p.dispose();
});

it('rejects missing or mismatched Sprite dependencies and external files for inline assets', async () => {
  for (const kind of [A.Mesh, A.ShaderData]) {
    const d = spriteDocument();
    d.assets[1]!.kind = kind;
    expect(() => validateDocument(d)).toThrow(/asset kind/);
  }
  const d = spriteDocument();
  await expect(
    loadPack(
      await packBytes(d, {
        'assets/42.nomesh': encodeMesh(triangle()),
        'assets/91.png': pngHeader(),
        'assets/703.png': pngHeader(),
      }),
    ),
  ).rejects.toThrow(/asset sets/);
  d.assets[0]!.sprite!.meshAssetId = 0;
  expect(() => validateDocument(d)).toThrow(/asset kind/);
});

it('requires explicit mesh revision and keeps legitimate empty geometry distinct from dangling references', () => {
  const d = minimalDocument();
  d.colorContext = new ColorContextT(0);
  d.features = [new Feature('scene.mesh-renderer'), new Feature('color.authored')];
  d.components = [
    new ComponentT(3, 1, true, C.MeshFilter, new MeshFilterT()),
    new ComponentT(4, 1, true, C.MeshRenderer, new MeshRendererT(3, [])),
  ];
  expect(() => validateDocument(d)).not.toThrow();
  (d.components[0]!.data as MeshFilterT).meshAssetId = 42;
  expect(() => validateDocument(d)).toThrow(/asset kind/);
  const s = spriteDocument();
  s.features[1]!.revision = 1;
  expect(() => validateDocument(s)).toThrow(/mesh.nomesh@1/);
});

it('keeps an empty UI mask valid and rejects unrelated Graphic component IDs', () => {
  const d = minimalDocument();
  d.features = [new Feature('ui.canvas')];
  d.components = [new ComponentT(3, 1, true, C.UIMask, new UIMaskT())];
  expect(() => validateDocument(d)).not.toThrow();
  (d.components[0]!.data as UIMaskT).graphicComponentId = 3;
  expect(() => validateDocument(d)).toThrow(/own UIImage/);
});
