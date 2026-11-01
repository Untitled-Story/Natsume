import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';

// Uses the compiler's fixed entry inventory, never a directory glob that can omit failures.
const [indexPath, compilerRoot, outputPath] = process.argv.slice(2);
assert(
  indexPath && compilerRoot && outputPath,
  'Usage: node tools/unity-probe/audit-source-packages.mjs <compiler-baseline.json> <compiler-root> <output.json>',
);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const inventoryBytes = await readFile(resolve(indexPath));
const baseline = JSON.parse(inventoryBytes.toString('utf8'));
const protocol = JSON.parse(
  await readFile(resolve(root, 'packages/natsume/schemas/provenance.json'), 'utf8'),
);
const server = await createServer({
  root,
  configFile: false,
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false },
});
const results = [],
  programs = new Map(),
  bindings = new Map(),
  types = new Map();
const counts = (map, key, example) => {
  const row = map.get(key) ?? { count: 0, example };
  row.count++;
  map.set(key, row);
};
const options = {
  seed: 12345,
  sourceColorSpace: 'gamma',
  parentLayout: { width: 640, height: 360 },
  renderEnvironment: { globalMipBias: 0, sortingLayers: { '-348333445': 2 } },
  particleEnvironment: {
    gravity: [0, -9.81, 0],
    fog: { mode: 'none' },
    viewPosition: [0, 0, -1000],
    viewVelocity: [0, 0, 0],
  },
  canvasEnvironment: {
    displays: { 0: { width: 640, height: 360 } },
    mainCamera: {
      viewMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, -1000, 1],
      projectionMatrix: [
        2 / 640,
        0,
        0,
        0,
        0,
        2 / 360,
        0,
        0,
        0,
        0,
        -2 / 1999.9,
        0,
        0,
        0,
        -2000.1 / 1999.9,
        1,
      ],
    },
  },
};
try {
  const { loadPack } = await server.ssrLoadModule('/packages/natsume/src/loader/load.ts');
  const { ComponentData, AnimationProperty, MaterialModel, SourceResolution } =
    await server.ssrLoadModule('/packages/natsume/src/format/generated/noa/ir.js');
  const { checkCompatibility } = await server.ssrLoadModule(
    '/packages/natsume/src/runtime/compatibility.ts',
  );
  for (const bundle of baseline.results)
    for (const entry of bundle.entries) {
      const row = { bundle: bundle.bundle, prefab: entry.prefab, file: entry.output };
      let pack;
      try {
        assert(entry.output, 'Compiler entry has no package');
        const bytes = new Uint8Array(await readFile(resolve(compilerRoot, entry.output)));
        row.sha256 = createHash('sha256').update(bytes).digest('hex');
        assert(
          !entry.sha256 || entry.sha256 === row.sha256,
          'Package differs from compiler inventory',
        );
        pack = await loadPack(bytes);
        const d = pack.document,
          s = d.sourceExport;
        row.loaded = true;
        row.normalization = d.normalization;
        row.dependencies = d.dependencies;
        row.requiredFeatures = d.features.filter((f) => f.required);
        row.hostInputs = pack.describe().requiredHostInputs;
        row.sourceDiagnostics = s?.diagnostics;
        row.unresolved = s?.references.flatMap((r, i) =>
          r.resolution >= SourceResolution.MissingAsset ? [{ index: i, ...r }] : [],
        );
        row.sourceComponents = d.components
          .filter((c) => c.dataType === ComponentData.UnityComponent)
          .map((c) => {
            const object = s?.objects[c.data.sourceObjectIndex];
            const detail = {
              id: c.id,
              nodeId: c.nodeId,
              enabled: c.enabled,
              sourceObjectIndex: c.data.sourceObjectIndex,
              source: object && {
                fileIndex: object.fileIndex,
                fileId: object.fileId,
                classId: object.classId,
                typeName: object.typeName,
                script: object.script,
              },
            };
            counts(types, `${object?.classId}:${object?.typeName}`, {
              file: row.file,
              componentId: c.id,
            });
            return detail;
          });
        row.sourceBindings = d.animations.flatMap((a) =>
          a.tracks.flatMap((t, i) => {
            if (t.binding.property !== AnimationProperty.SourceBinding) return [];
            const source = t.binding.source;
            counts(
              bindings,
              JSON.stringify(source, (_, v) => (typeof v === 'bigint' ? String(v) : v)),
              { file: row.file, animationId: a.id, track: i },
            );
            return [{ animationId: a.id, track: i, binding: t.binding }];
          }),
        );
        row.sourceMaterials = d.materials
          .filter((m) => m.model === MaterialModel.UnityShader)
          .map((m) => {
            const recipe = JSON.parse(
              new TextDecoder().decode(pack.getAssetBytes(m.shaderDataAssetId)),
            );
            counts(programs, recipe.program_sha256, {
              file: row.file,
              materialId: m.id,
              source: recipe.source,
            });
            return { id: m.id, program: recipe.program_sha256, sourceShader: m.sourceShader };
          });
        row.entries = d.entries.map((e) => ({
          id: e.id,
          ...checkCompatibility(
            pack,
            { ...options, entryId: e.id },
            {
              disposed: false,
              maxTextureSize: 4096,
              availableTexturePixels: 64 * 1024 * 1024,
              imageBitmapAvailable: true,
              cachedMaterialIds: new Set(),
              hasScript: () => false,
            },
          ),
        }));
      } catch (error) {
        row.error = error.message;
      } finally {
        pack?.dispose();
      }
      results.push(row);
    }
  const expected = baseline.results.reduce((n, b) => n + b.entries.length, 0);
  assert(results.length === expected, 'Inventory entries were omitted');
  const summary = {
    effects: baseline.results.length,
    packages: results.length,
    loaded: results.filter((r) => r.loaded).length,
    errors: results.filter((r) => r.error).length,
    compatible: results.filter((r) => !r.error && r.entries.every((e) => e.compatible)).length,
    sourcePrograms: programs.size,
    sourceBindingIdentities: bindings.size,
    sourceComponentTypes: types.size,
  };
  const json = JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      inventorySha256: createHash('sha256').update(inventoryBytes).digest('hex'),
      protocol,
      summary,
      hostConfiguration: options,
      sourcePrograms: Object.fromEntries(programs),
      sourceBindings: Object.fromEntries(bindings),
      sourceComponentTypes: Object.fromEntries(types),
      results,
    },
    (_, v) => (typeof v === 'bigint' ? String(v) : v),
    2,
  );
  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  await writeFile(resolve(outputPath), json + '\n');
  console.log(JSON.stringify(summary));
  process.exitCode = summary.errors ? 1 : 0;
} finally {
  await server.close();
}
