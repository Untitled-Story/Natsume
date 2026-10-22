import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { generateDescriptors } from './schema.mjs';

const provenance = JSON.parse(readFileSync('schemas/provenance.json', 'utf8'));
for (const [name, expected] of Object.entries(provenance.sha256)) {
  const hash = createHash('sha256')
    .update(readFileSync(`schemas/${name}`))
    .digest('hex');
  if (hash !== expected) throw new Error(`Schema differs from pinned baseline: ${name}`);
}
const flatc = process.env.NATSUME_FLATC ?? 'flatc';
if (
  execFileSync(flatc, ['--version'], { encoding: 'utf8' }).trim() !==
  `flatc version ${provenance.flatc}`
) {
  throw new Error(`Expected flatc ${provenance.flatc}`);
}
// Remove bindings for schema types that no longer exist.
rmSync('src/format/generated/noa', { recursive: true, force: true });
execFileSync(
  flatc,
  [
    '--ts',
    '--gen-object-api',
    '-o',
    'src/format/generated',
    'schemas/noir.fbs',
    'schemas/mesh.fbs',
  ],
  { stdio: 'inherit' },
);
// flatc emits trailing spaces in union helpers. Keep regeneration diff-clean.
function normalize(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) normalize(path);
    else if (entry.name.endsWith('.ts')) {
      const source = readFileSync(path, 'utf8');
      writeFileSync(path, source.replace(/[ \t]+$/gm, ''));
    }
  }
}
normalize('src/format/generated');
generateDescriptors();
