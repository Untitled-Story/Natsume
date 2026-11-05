import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, dirname, basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const [
  baselinePath,
  compilerRootPath,
  executablePath,
  recoveryRootPath,
  outputRootPath,
  ledgerPath,
] = process.argv.slice(2);
assert(
  ledgerPath,
  'Usage: node tools/unity-probe/recompile-source-packages.mjs <baseline.json> <compiler-root> <noa-executable> <recovery-root> <output-directory> <inventory.json>',
);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const compilerRoot = resolve(compilerRootPath);
const executable = resolve(executablePath);
const recoveryRoot = resolve(recoveryRootPath);
const outputRoot = resolve(outputRootPath);
const outputLedger = resolve(ledgerPath);
const run = promisify(execFile);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) =>
  JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? String(v) : v), 2) + '\n';
const baselineBytes = await readFile(resolve(baselinePath));
const baseline = JSON.parse(baselineBytes);
const recoveryBytes = await readFile(join(recoveryRoot, 'recovery.json'));
const recoveries = JSON.parse(recoveryBytes);
const recoveryByGuid = new Map(recoveries.map((r) => [r.guid, r]));
assert.equal(recoveryByGuid.size, recoveries.length, 'Duplicate recovery GUID');
for (const row of recoveries) {
  const bytes = await readFile(join(recoveryRoot, row.guid + '.exr'));
  assert.equal(sha256(bytes), row.sha256, `Recovered texture differs: ${row.guid}`);
  assert.equal(bytes.length, row.bytes, `Recovered texture length differs: ${row.guid}`);
  const metadata = await readFile(join(recoveryRoot, row.guid + '.exr.meta'), 'utf8');
  assert(metadata.includes(`guid: ${row.guid}`), `Recovered texture GUID differs: ${row.guid}`);
}
await access(outputLedger).then(
  () =>
    assert.fail('Output inventory already exists; select a fresh path to preserve prior evidence'),
  (error) => assert.equal(error.code, 'ENOENT'),
);
const tasks = baseline.results.flatMap((bundle) =>
  bundle.entries.map((entry) => ({
    bundle: bundle.bundle,
    entry,
    output: join(outputRoot, bundle.bundle, basename(entry.prefab, '.prefab') + '.noap'),
  })),
);
assert.equal(new Set(tasks.map((t) => t.output)).size, tasks.length, 'Duplicate output paths');
for (const task of tasks)
  assert.notEqual(
    task.output,
    resolve(compilerRoot, task.entry.output),
    'Would overwrite baseline',
  );
const { stdout: commit } = await run('git', ['rev-parse', 'HEAD'], { cwd: compilerRoot });
const { stdout: worktree } = await run('git', ['status', '--porcelain'], { cwd: compilerRoot });
const protocolHashes = {};
for (const name of ['noir.fbs', 'mesh.fbs', 'noap.schema.json', 'shader-data.schema.json'])
  protocolHashes[name] = sha256(await readFile(join(compilerRoot, 'schemas', name)));
const compilerHash = sha256(await readFile(executable));
const sourceSummary = (pack) => {
  const d = pack.document;
  const source = d.sourceExport;
  const types = {};
  for (const c of d.components)
    if (c.dataType === 18) {
      const o = source.objects[c.data.sourceObjectIndex];
      const key = `${o.classId}:${o.typeName}`;
      types[key] = (types[key] ?? 0) + 1;
    }
  return {
    normalization: d.normalization,
    dependencies: d.dependencies,
    nodes: d.nodes.length,
    components: d.components.length,
    materials: d.materials.length,
    animations: d.animations.length,
    sourceComponents: types,
    unresolved: source?.references.filter((r) => r.resolution >= 4) ?? [],
    sourceFiles: source?.files.map((f) => ({ path: f.path, guid: f.guid, assetId: f.assetId })),
    entries: d.entries.map((e) => ({ id: e.id, name: e.name, roots: e.roots })),
  };
};
const server = await createServer({
  root,
  configFile: false,
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false },
});
const results = new Array(tasks.length);
let cursor = 0;
try {
  const { loadPack } = await server.ssrLoadModule('/packages/natsume/src/loader/load.ts');
  const worker = async () => {
    while (cursor < tasks.length) {
      const index = cursor++;
      const task = tasks[index];
      const result = {
        prefab: task.entry.prefab,
        originalOutput: task.entry.output,
        originalSha256: task.entry.sha256,
        output: task.output,
      };
      let original, rebuilt;
      try {
        const originalBytes = await readFile(resolve(compilerRoot, task.entry.output));
        assert.equal(sha256(originalBytes), task.entry.sha256, 'Original package hash differs');
        original = await loadPack(new Uint8Array(originalBytes));
        result.original = sourceSummary(original);
        result.prefabSha256 = sha256(await readFile(resolve(compilerRoot, task.entry.prefab)));
        await mkdir(dirname(task.output), { recursive: true });
        const started = performance.now();
        const processResult = await run(
          executable,
          [
            'compile',
            resolve(compilerRoot, task.entry.prefab),
            '--search',
            recoveryRoot,
            '--output',
            task.output,
            '--json',
          ],
          { cwd: compilerRoot, maxBuffer: 16 * 1024 * 1024 },
        );
        result.seconds = (performance.now() - started) / 1000;
        result.returncode = 0;
        result.stdout = processResult.stdout;
        result.stderr = processResult.stderr;
        const bytes = await readFile(task.output);
        result.sha256 = sha256(bytes);
        rebuilt = await loadPack(new Uint8Array(bytes));
        result.rebuilt = sourceSummary(rebuilt);
        result.recoveredAssets = [];
        for (const file of rebuilt.document.sourceExport?.files ?? []) {
          const recovery = recoveryByGuid.get(file.guid);
          if (!recovery) continue;
          assert(file.assetId, `Recovered file has no packaged asset: ${file.guid}`);
          const payload = rebuilt.getAssetBytes(file.assetId);
          assert(payload, `Recovered file payload missing: ${file.guid}`);
          assert.equal(sha256(payload), recovery.sha256, 'Recovered payload hash differs');
          result.recoveredAssets.push({
            guid: file.guid,
            assetId: file.assetId,
            sourcePath: file.path,
            sha256: recovery.sha256,
            references: rebuilt.document.sourceExport.references.filter(
              (r) => r.source.guid === file.guid,
            ),
          });
        }
        assert.equal(
          result.rebuilt.dependencies,
          0,
          'Rebuilt package dependencies remain unresolved',
        );
        assert.equal(
          result.rebuilt.unresolved.length,
          0,
          'Rebuilt source reference remains unresolved',
        );
        result.packageChecks = 'strict-load+manifest-lengths+sha256+source-reference-ledger';
      } catch (error) {
        result.error = error.message;
        result.returncode ??= error.code ?? 1;
        result.stderr ??= error.stderr ?? '';
      } finally {
        original?.dispose();
        rebuilt?.dispose();
      }
      results[index] = result;
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
} finally {
  await server.close();
}
assert.equal(sha256(await readFile(executable)), compilerHash, 'Compiler changed during batch');
for (const [name, hash] of Object.entries(protocolHashes))
  assert.equal(sha256(await readFile(join(compilerRoot, 'schemas', name))), hash);
const recovered = new Set(results.flatMap((r) => r.recoveredAssets?.map((a) => a.guid) ?? []));
const inventory = {
  format: 'natsume-package-inventory',
  version: 1,
  timestamp: new Date().toISOString(),
  originalInventory: { path: resolve(baselinePath), sha256: sha256(baselineBytes) },
  recovery: { path: recoveryRoot, manifestSha256: sha256(recoveryBytes), guids: [...recovered] },
  compiler: {
    root: compilerRoot,
    commit: commit.trim(),
    worktree: worktree.trim(),
    executable,
    executableSha256: compilerHash,
    protocolHashes,
  },
  denominator: baseline.results.length,
  summary: {
    effects: baseline.results.length,
    packages: results.length,
    passed: results.filter((r) => !r.error).length,
    failed: results.filter((r) => r.error).length,
    unchanged: results.filter((r) => r.originalSha256 === r.sha256).length,
    changed: results.filter((r) => r.sha256 && r.originalSha256 !== r.sha256).length,
    recoveredGuids: recovered.size,
    recoveredPackages: results.filter((r) => r.recoveredAssets?.length).length,
  },
  results: baseline.results.map((bundle) => ({
    bundle: bundle.bundle,
    entries: results.filter((_, i) => tasks[i].bundle === bundle.bundle),
  })),
};
assert.equal(inventory.results.flatMap((r) => r.entries).length, tasks.length);
await mkdir(dirname(outputLedger), { recursive: true });
await writeFile(outputLedger, json(inventory));
console.log(json({ ...inventory.summary, inventory: relative(root, outputLedger) }));
process.exitCode = inventory.summary.failed || recovered.size !== recoveries.length ? 1 : 0;
