import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';
import { createServer } from 'vite';

assert(
  process.argv[2] && process.argv[3],
  'Provide a package index and its source repository root',
);
const index = JSON.parse(await readFile(resolve(process.argv[2]), 'utf8'));
const source = resolve(process.argv[3]);
const output = resolve(process.argv[4] ?? 'data/package-audit.json');
const root = fileURLToPath(new URL('../../', import.meta.url));
const server = await createServer({
  root: resolve(root, 'packages/natsume'),
  configFile: false,
  server: { middlewareMode: true },
});
const results = [];
const features = {},
  components = {},
  materials = {},
  shapes = {};
const count = (map, name) => {
  map[name] = (map[name] ?? 0) + 1;
};
let meshes = 0,
  sprites = 0;
try {
  const { loadPack } = await server.ssrLoadModule('/src/loader/load.ts');
  const { checkCompatibility } = await server.ssrLoadModule('/src/runtime/compatibility.ts');
  const { ComponentData: C } = await server.ssrLoadModule(
    '/src/format/generated/noa/ir/component-data.ts',
  );
  const { ParticleModuleData: M } = await server.ssrLoadModule(
    '/src/format/generated/noa/ir/particle-module-data.ts',
  );
  const { ShapeGeometry: G } = await server.ssrLoadModule(
    '/src/format/generated/noa/ir/shape-geometry.ts',
  );
  const { MaterialModel } = await server.ssrLoadModule(
    '/src/format/generated/noa/ir/material-model.ts',
  );
  for (const file of index.outputs) {
    let pack;
    try {
      const bytes = await readFile(resolve(source, file));
      pack = await loadPack(bytes);
      for (const f of pack.document.features) count(features, f.name + '@' + f.revision);
      for (const m of pack.document.materials) count(materials, MaterialModel[m.model]);
      for (const c of pack.components) {
        count(components, C[c.dataType]);
        if (c.dataType === C.ParticleSystem)
          for (const m of c.data.modules)
            if (m.dataType === M.ShapeModule) count(shapes, G[m.data.geometryType]);
      }
      const meshData = [],
        spriteData = [],
        shaderData = [];
      for (const a of pack.document.assets) {
        if (a.kind === 2) {
          meshes++;
          const m = pack.getMesh(a.id);
          meshData.push({
            id: a.id,
            vertices: m.positions.length,
            indices: m.indices.length,
            submeshes: m.submeshes.length,
            normals: m.normals.length,
            tangents: m.tangents.length,
            colors: m.colors.length,
            uv: m.texcoords.map((t) => ({ channel: t.channel, dimension: t.dimension })),
          });
        }
        if (a.kind === 4) {
          sprites++;
          spriteData.push({ id: a.id, ...a.sprite });
        }
        if (a.kind === 3) {
          const recipe = JSON.parse(new TextDecoder().decode(pack.getAssetBytes(a.id)));
          shaderData.push({
            id: a.id,
            model: recipe.model,
            revision: recipe.revision,
            programSha256: recipe.program_sha256,
            globalMipBias: recipe.global_mip_bias,
            globalMipBiasSlot: recipe.global_mip_bias_slot,
          });
        }
      }
      const report = checkCompatibility(
        pack,
        {
          seed: 12345,
          renderEnvironment: { globalMipBias: 0 },
          parentLayout: { width: 640, height: 360 },
          particleEnvironment: {
            fog: { mode: 'none' },
            gravity: [0, -9.81, 0],
            viewPosition: [0, 0, -1000],
          },
        },
        {
          maxTextureSize: 16384,
          availableTexturePixels: 268435456,
          cachedMaterialIds: new Set(),
          imageBitmapAvailable: true,
          hasScript: () => false,
          disposed: false,
        },
      );
      results.push({
        file,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        loaded: true,
        compatible: report.compatible,
        issues: report.issues,
        description: pack.describe(),
        meshes: meshData,
        sprites: spriteData,
        shaderData,
        assetDependencies: pack.document.assets.map((a) => ({
          id: a.id,
          kind: a.kind,
          image: a.sprite?.imageAssetId,
          mesh: a.sprite?.meshAssetId,
        })),
        renderEnvironments: pack.components
          .filter((c) => c.data.environment)
          .map((c) => ({ componentId: c.id, ...c.data.environment })),
        animations: pack.document.animations,
        particleShapesAndSheets: pack.components
          .filter((c) => c.dataType === C.ParticleSystem)
          .map((c) => ({
            componentId: c.id,
            modules: c.data.modules.filter(
              (m) => m.dataType === M.ShapeModule || m.dataType === M.TextureSheetModule,
            ),
          })),
      });
    } catch (error) {
      results.push({ file, loaded: false, error: error.message });
    } finally {
      pack?.dispose();
    }
  }
  const summary = {
    measuredAt: new Date().toISOString(),
    sourceCommit: index.source_commit,
    packages: results.length,
    loaded: results.filter((r) => r.loaded).length,
    compatible: results.filter((r) => r.compatible).length,
    meshes,
    sprites,
    features,
    components,
    materials,
    shapes,
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      { ...summary, results },
      (_, v) => (typeof v === 'bigint' ? v.toString() : v),
      2,
    ) + '\n',
  );
  console.log(JSON.stringify(summary, null, 2));
  assert.equal(summary.loaded, index.outputs.length, 'Some packages failed structural validation');
} finally {
  await server.close();
}
