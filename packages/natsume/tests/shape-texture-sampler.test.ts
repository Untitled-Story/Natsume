import { expect, it } from 'vitest';
import { zlibSync } from 'fflate';
import { decodePngPixels } from '../src/loader/png-pixels.js';
import { ShapeTextureSampler } from '../src/runtime/shape-texture.js';
import { ShapeTextureT } from '../src/format/generated/noa/ir/shape-texture.js';
import { EffectPack } from '../src/pack.js';
import { minimalDocument } from './helpers.js';
import { AssetT } from '../src/format/generated/noa/ir/asset.js';
import * as I from '../src/format/generated/noa/ir.js';
import { MeshT } from '../src/format/generated/noa/mesh/mesh.js';
import { Vec3T } from '../src/format/generated/noa/mesh/vec3.js';
import { Vec4T } from '../src/format/generated/noa/mesh/vec4.js';
import { TexCoordT } from '../src/format/generated/noa/mesh/tex-coord.js';
import { SubmeshT } from '../src/format/generated/noa/mesh/submesh.js';
import { particleSource, constant } from './particle-fixtures.js';
import { Simulation } from '../src/runtime/simulation.js';
import { crc32 } from '../src/loader/zip.js';

function png(
  scanlines = [0, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255, 0, 64, 128, 192, 255],
): Uint8Array {
  const u32 = (v: number) => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const chunks: Uint8Array[] = [];
  for (const [name, data] of [
    ['IHDR', [...u32(2), ...u32(2), 8, 6, 0, 0, 0]],
    ['IDAT', Array.from(zlibSync(Uint8Array.from(scanlines)))],
    ['IEND', []],
  ] as [string, number[]][]) {
    const c = new Uint8Array(data.length + 12);
    c.set(u32(data.length));
    c.set(
      Array.from(name).map((x) => x.charCodeAt(0)),
      4,
    );
    c.set(data, 8);
    c.set(u32(crc32(c.subarray(4, c.length - 4))), c.length - 4);
    chunks.push(c);
  }
  const out = new Uint8Array(8 + chunks.reduce((n, c) => n + c.length, 0));
  out.set([137, 80, 78, 71, 13, 10, 26, 10]);
  let o = 8;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
it('rejects corrupted chunks and oversized or truncated scanlines', () => {
  const bytes = png();
  bytes[29]! ^= 1;
  expect(() => decodePngPixels(bytes)).toThrow('checksum');
  expect(() => decodePngPixels(png(Array(19).fill(0)))).toThrow('scanline length');
  expect(() => decodePngPixels(png(Array(17).fill(0)))).toThrow('scanline length');
});
it('samples nearest and bilinear pixels with bottom-left UVs and clip threshold', () => {
  const bytes = png();
  expect(decodePngPixels(bytes).width).toBe(2);
  const doc = minimalDocument();
  doc.assets = [new AssetT(7, 1)];
  const pack = new EffectPack(
    doc,
    { files: [{ path: 'a.png', asset_id: 7, kind: 'image' }] } as never,
    new Map([['a.png', bytes]]),
    new Map(),
  );
  try {
    const out = new Float64Array(12);
    out.fill(1, 6, 10);
    out[10] = 0.75;
    out[11] = 0.75;
    const s = new ShapeTextureSampler(pack, new ShapeTextureT(7, 3, 0.1, 0, true, true, false));
    expect(s.sample(out)).toBe(true);
    expect(Array.from(out.slice(6, 10))).toEqual([0, 1, 0, 1]);
    out.fill(1, 6, 10);
    out[10] = 0;
    out[11] = 0;
    expect(s.sample(out)).toBe(false);
    expect(Array.from(out.slice(6, 10))).toEqual([0, 0, 1, 0]);
  } finally {
    pack.dispose();
  }
});
it('compacts clipped mesh births without changing accepted source positions', () => {
  const bytes = png(),
    doc = minimalDocument();
  doc.assets = [new AssetT(7, 1), new AssetT(8, 2)];
  const mesh = new MeshT();
  mesh.positions = [
    new Vec3T(0, 0, 0),
    new Vec3T(0.25, 0, 0),
    new Vec3T(0.5, 0, 0),
    new Vec3T(0.75, 0, 0),
  ];
  mesh.normals = mesh.positions.map(() => new Vec3T(0, 0, 1));
  mesh.colors = [];
  mesh.indices = [0, 1, 2, 1, 3, 2];
  mesh.submeshes = [new SubmeshT(0, 6)];
  mesh.texcoords = [
    new TexCoordT(
      0,
      2,
      mesh.positions.map((p) => new Vec4T(p.x, 0)),
    ),
  ];
  const source = particleSource();
  source.main!.playOnEnable = true;
  source.main!.maxParticles = 8;
  source.modules = [
    new I.ParticleModuleT(
      I.ParticleModuleData.ShapeModule,
      new I.ShapeModuleT(
        new I.ShapeTextureT(7, 3, 0.2, 0, false, false, false),
        I.ShapeGeometry.MeshShape,
        new I.MeshShapeT(0, 8, 0, 0, false, false, 0, 1, constant(1)),
        structuredClone(doc.nodes[0]!.transform),
      ),
    ),
    new I.ParticleModuleT(
      I.ParticleModuleData.EmissionModule,
      new I.EmissionModuleT(constant(0), constant(0), [new I.BurstT(0, constant(4), 1, 0, 1)]),
    ),
  ];
  doc.components = [new I.ComponentT(3, 1, true, I.ComponentData.ParticleSystem, source)];
  const pack = new EffectPack(
    doc,
    { files: [{ path: 'a.png', asset_id: 7, kind: 'image' }] } as never,
    new Map([['a.png', bytes]]),
    new Map([[8, mesh]]),
  );
  try {
    const sim = new Simulation(pack, { seed: 77 });
    sim.play();
    const e = sim.emitters.get(3)!;
    expect(e.count).toBe(1);
    for (let i = 0; i < e.count; i++) {
      expect(e.serials[i]).toBeLessThan(4);
      expect(e.positions[i * 3]).toBe(mesh.positions[e.serials[i]!]!.x);
    }
  } finally {
    pack.dispose();
  }
});
