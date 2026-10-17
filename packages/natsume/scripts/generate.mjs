import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
generateDescriptors();
