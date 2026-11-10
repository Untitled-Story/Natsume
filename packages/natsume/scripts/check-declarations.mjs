import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

// Type-checks the built declarations with library checking on, which is how a strict
// consumer sees them. Errors reported inside node_modules are not ours to fix.
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
let output = '';
try {
  execFileSync(
    process.execPath,
    [
      tsc,
      '--ignoreConfig',
      '--noEmit',
      '--strict',
      '--target',
      'es2022',
      '--module',
      'esnext',
      '--moduleResolution',
      'bundler',
      '--lib',
      'es2022,dom',
      '--skipLibCheck',
      'false',
      'dist/index.d.ts',
    ],
    { encoding: 'utf8', stdio: 'pipe' },
  );
} catch (error) {
  output = String(error.stdout ?? '');
}
const own = output
  .split('\n')
  .filter((line) => /error TS\d+/.test(line) && !line.includes('node_modules'));
if (own.length) {
  console.error(own.join('\n'));
  console.error(`\n${own.length} error(s) in the built declarations`);
  process.exit(1);
}
console.log('Built declarations type-check cleanly');
