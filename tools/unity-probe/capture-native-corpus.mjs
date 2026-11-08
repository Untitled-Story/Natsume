import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, cp } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [inventoryArgument, compilerRootArgument, recoveryArgument, projectArgument] = process.argv
  .slice(2)
  .filter((value) => !value.startsWith('--'));
assert(
  projectArgument,
  'Usage: node tools/unity-probe/capture-native-corpus.mjs <inventory.json> <compiler-root> <recovery-directory> <new-project-directory> [--prepare-only]',
);
const inventoryPath = resolve(inventoryArgument),
  compilerRoot = resolve(compilerRootArgument),
  recovery = resolve(recoveryArgument),
  project = resolve(projectArgument);
assert(project.startsWith(join(root, 'data') + '/'), 'Capture project must be in ignored data/');
const inventoryBytes = await readFile(inventoryPath),
  inventory = JSON.parse(inventoryBytes);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const entries = inventory.results.flatMap((bundle) =>
  bundle.entries.map((entry) => ({
    bundle: bundle.bundle,
    prefab: resolve(compilerRoot, entry.prefab),
    original: entry.prefab,
  })),
);
assert.equal(entries.length, 391, 'The fixed inventory must contain all 391 entries');
assert.equal(inventory.results.length, 356, 'The fixed inventory must contain all 356 effects');
const roots = [
  ...new Set(
    entries.map((entry) =>
      entry.prefab.includes('/ExportedProject/Assets/')
        ? entry.prefab.slice(
            0,
            entry.prefab.indexOf('/ExportedProject/Assets/') + '/ExportedProject/Assets'.length,
          )
        : dirname(entry.prefab),
    ),
  ),
];
const assets = new Map(),
  paths = new Map(),
  conflicts = [],
  scripts = new Map();
async function collect(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) {
      await collect(path);
      continue;
    }
    if (item.name.endsWith('.meta') || item.name === 'unity.monoscripts.json') continue;
    let metadata;
    try {
      metadata = await readFile(path + '.meta', 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const guid = /^guid: ([0-9a-f]{32})$/m.exec(metadata)?.[1];
    if (!guid) continue;
    const bytes = await readFile(path),
      hash = sha(bytes),
      previous = assets.get(guid);
    paths.set(path, guid);
    if (previous && previous.sha256 !== hash) {
      conflicts.push({
        guid,
        first: previous.original,
        second: path,
        firstSha256: previous.sha256,
        secondSha256: hash,
      });
      continue;
    }
    if (!previous) assets.set(guid, { guid, original: path, sha256: hash, metadata, bytes });
  }
}
for (const directory of roots) {
  await collect(directory);
  try {
    for (const script of JSON.parse(
      await readFile(join(directory, 'unity.monoscripts.json'), 'utf8'),
    ).scripts)
      scripts.set(script.guid, script);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
await mkdir(project, { recursive: true });
const output = join(project, 'capture');
await mkdir(output, { recursive: true });
const provenance = {
  timestamp: new Date().toISOString(),
  inventory: inventoryPath,
  inventorySha256: sha(inventoryBytes),
  effects: inventory.results.length,
  entries: entries.length,
  sourceAssets: assets.size,
  conflicts,
};
await writeFile(join(output, 'preparation.json'), JSON.stringify(provenance, null, 2) + '\n');
assert.equal(
  conflicts.length,
  0,
  'Original GUIDs have conflicting payloads; inspect capture/preparation.json instead of choosing one',
);
await mkdir(join(project, 'Assets/Corpus'), { recursive: true });
await mkdir(join(project, 'Assets/Editor'), { recursive: true });
await mkdir(join(project, 'Packages'), { recursive: true });
await mkdir(join(project, 'ProjectSettings'), { recursive: true });
const editor =
  process.env.UNITY_EDITOR ??
  '/Applications/Unity/Hub/Editor/2022.3.21f1/Unity.app/Contents/MacOS/Unity';
const ui = resolve(
  dirname(editor),
  '../Resources/PackageManager/BuiltInPackages/com.unity.ugui/Runtime',
);
await cp(ui, join(project, 'Assets/UnityUI'), { recursive: true });
const timeline = resolve(process.env.UNITY_TIMELINE_PACKAGE ?? join(root, 'data/timeline-source'));
await cp(join(timeline, 'Runtime'), join(project, 'Assets/TimelineRuntime'), { recursive: true });
// Replace exported Unity dummy scripts with the matching actual installed source.
const runtimeSources = new Map();
async function findRuntime(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) await findRuntime(path);
    else if (item.name.endsWith('.cs')) runtimeSources.set(basename(path, '.cs'), path);
  }
}
await findRuntime(join(project, 'Assets/UnityUI'));
await findRuntime(join(project, 'Assets/TimelineRuntime'));
const missingScriptSources = [],
  dummyScripts = [];
for (const asset of assets.values()) {
  const script = scripts.get(asset.guid);
  if (asset.original.endsWith('.cs') && script?.namespace?.startsWith('Unity')) {
    const actual = runtimeSources.get(script.class_name);
    if (!actual) {
      missingScriptSources.push(script);
      continue;
    }
    await writeFile(actual + '.meta', asset.metadata);
    continue;
  }
  const target = join(project, 'Assets/Corpus', asset.guid, basename(asset.original));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, asset.bytes);
  await writeFile(target + '.meta', asset.metadata);
  if (asset.original.endsWith('.cs')) dummyScripts.push({ ...script, sha256: asset.sha256 });
}
const recovered = JSON.parse(await readFile(join(recovery, 'recovery.json'), 'utf8'));
for (const image of recovered)
  if (!assets.has(image.guid)) {
    const bytes = await readFile(join(recovery, image.guid + '.exr'));
    assert.equal(sha(bytes), image.sha256, 'Recovered source texture differs');
    const target = join(project, 'Assets/Recovered', image.guid + '.exr');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
    await cp(join(recovery, image.guid + '.exr.meta'), target + '.meta');
  }
const manifest = {
  timestamp: new Date().toISOString(),
  inventorySha256: sha(inventoryBytes),
  caveat:
    'Original prefabs with exported dummy game scripts; script execution and source-platform shader colors are not parity claims.',
  dummyScripts,
  missingScriptSources,
  entries: entries.map((entry, index) => ({
    index,
    bundle: entry.bundle,
    source: entry.original,
    sourceSha256: assets.get(paths.get(entry.prefab))?.sha256,
    guid: paths.get(entry.prefab),
  })),
};
assert(
  manifest.entries.every((entry) => entry.guid && entry.sourceSha256),
  'A fixed entry is absent from the staged source identity map',
);
await writeFile(
  join(project, 'Assets/capture-input.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);
await writeFile(
  join(project, 'Packages/manifest.json'),
  JSON.stringify(
    {
      dependencies: Object.fromEntries(
        [
          'particlesystem',
          'jsonserialize',
          'animation',
          'director',
          'ui',
          'imgui',
          'audio',
          'physics',
          'physics2d',
        ].map((name) => ['com.unity.modules.' + name, '1.0.0']),
      ),
    },
    null,
    2,
  ) + '\n',
);
await writeFile(
  join(project, 'ProjectSettings/ProjectVersion.txt'),
  'm_EditorVersion: 2022.3.21f1\n',
);
await cp(
  join(root, 'tools/unity-probe/project/Assets/Editor/NatsumeCorpusProbe.cs'),
  join(project, 'Assets/Editor/NatsumeCorpusProbe.cs'),
);
console.log(
  JSON.stringify({
    ...provenance,
    dummyScripts: dummyScripts.length,
    missingScriptSources: missingScriptSources.length,
    project,
  }),
);
if (!process.argv.includes('--prepare-only')) {
  const child = spawn(
    editor,
    [
      '-batchmode',
      '-noUpm',
      '-force-metal',
      ...(process.env.UNITY_LICENSING_IPC
        ? ['-licensingIpc', process.env.UNITY_LICENSING_IPC]
        : []),
      '-projectPath',
      project,
      '-executeMethod',
      'NatsumeCorpusProbe.Run',
      '-logFile',
      join(output, 'editor.log'),
    ],
    { env: { ...process.env, NATSUME_CORPUS_OUTPUT: output }, stdio: 'inherit' },
  );
  const code = await new Promise((accept) => child.on('exit', accept));
  assert.equal(code, 0, 'Unity native corpus capture failed; inspect capture/editor.log');
}
