import assert from 'node:assert/strict';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Supply an unmodified com.unity.timeline 1.7.x package through UNITY_TIMELINE_PACKAGE.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
assert(process.env.UNITY_EDITOR, 'Set UNITY_EDITOR');
assert(process.env.UNITY_TIMELINE_PACKAGE, 'Set UNITY_TIMELINE_PACKAGE to Timeline 1.7.x source');
const project = resolve(root, 'data/unity-timeline-probe');
const playback = process.argv.includes('--playback');
const output = resolve(root, 'data/unity-baselines', playback ? 'timeline-playback' : 'timeline');
await mkdir(output, { recursive: true });
await cp(resolve(root, 'tools/unity-probe/project'), project, { recursive: true });
await cp(
  resolve(root, 'tools/unity-probe/timeline'),
  resolve(project, 'Assets/TimelineProbeSource'),
  { recursive: true },
);
await cp(
  resolve(process.env.UNITY_TIMELINE_PACKAGE, 'Runtime'),
  resolve(project, 'Assets/TimelineRuntime'),
  { recursive: true },
);
await writeFile(
  resolve(project, 'Packages/manifest.json'),
  JSON.stringify(
    {
      dependencies: {
        'com.unity.modules.particlesystem': '1.0.0',
        'com.unity.modules.jsonserialize': '1.0.0',
        'com.unity.modules.animation': '1.0.0',
        'com.unity.modules.director': '1.0.0',
        'com.unity.timeline': 'file:' + resolve(process.env.UNITY_TIMELINE_PACKAGE),
      },
    },
    null,
    2,
  ),
);
// Match the ordinary probe's local UI reference without downloading UI packages.
await cp(
  resolve(
    dirname(process.env.UNITY_EDITOR),
    '../Resources/PackageManager/BuiltInPackages/com.unity.ugui/Runtime',
  ),
  resolve(project, 'Assets/UnityUI'),
  { recursive: true },
);
const child = spawn(
  process.env.UNITY_EDITOR,
  [
    '-batchmode',
    '-noUpm',
    '-nographics',
    '-projectPath',
    project,
    '-executeMethod',
    playback ? 'NatsumeTimelinePlaybackProbe.Run' : 'NatsumeTimelineProbe.Run',
    '-logFile',
    resolve(output, 'editor.log'),
  ],
  {
    env: { ...process.env, NATSUME_COMPAT_OUTPUT: resolve(output, 'unity-2022.3.21f1.json') },
    stdio: 'inherit',
  },
);
const code = await new Promise((accept) => child.on('exit', accept));
assert.equal(code, 0, 'Timeline probe failed; inspect editor.log');
console.log(output);
