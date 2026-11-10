import { copyFileSync } from 'node:fs';

// The license lives at the repository root, but npm only packs files from the package directory.
copyFileSync(new URL('../../../LICENSE', import.meta.url), new URL('../LICENSE', import.meta.url));
