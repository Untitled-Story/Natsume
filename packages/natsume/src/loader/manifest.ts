import { check, NatsumeError } from '../errors.js';

export interface ManifestFile {
  readonly path: string;
  readonly kind: 'noir' | 'image' | 'mesh' | 'shader_data';
  readonly asset_id?: number;
  readonly byte_length: number;
  readonly sha256: string;
}
export interface Manifest {
  readonly format: 'noa-package';
  readonly version: 1;
  readonly noir_version: readonly [2, 0];
  readonly document: 'scene.noir';
  readonly files: readonly ManifestFile[];
}

export function parseJson(bytes: Uint8Array, path: string): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new NatsumeError('MANIFEST', 'Invalid UTF-8 JSON', path);
  }
}
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: readonly string[]) {
  check(
    Object.keys(value).every((key) => allowed.includes(key)),
    'MANIFEST',
    'Unknown manifest property',
  );
}

export function parseManifest(bytes: Uint8Array): Manifest {
  const value = parseJson(bytes, 'manifest.json');
  check(record(value), 'MANIFEST', 'Manifest must be an object');
  keys(value, ['format', 'version', 'noir_version', 'document', 'files']);
  check(
    value.format === 'noa-package' &&
      value.version === 1 &&
      value.document === 'scene.noir' &&
      Array.isArray(value.noir_version) &&
      value.noir_version.length === 2 &&
      value.noir_version[0] === 2 &&
      value.noir_version[1] === 0,
    'VERSION',
    'Unsupported manifest version',
  );
  check(Array.isArray(value.files) && value.files.length > 0, 'MANIFEST', 'Missing files');
  const paths = new Set<string>(),
    ids = new Set<number>();
  for (const file of value.files) {
    check(record(file), 'MANIFEST', 'Invalid file entry');
    keys(file, ['path', 'kind', 'asset_id', 'byte_length', 'sha256']);
    check(
      typeof file.path === 'string' && !paths.has(file.path),
      'MANIFEST',
      'Duplicate or invalid file path',
    );
    paths.add(file.path);
    check(
      typeof file.sha256 === 'string' && /^[0-9a-f]{64}$/.test(file.sha256),
      'MANIFEST',
      'Invalid SHA-256',
      file.path,
    );
    check(
      Number.isSafeInteger(file.byte_length) && Number(file.byte_length) >= 0,
      'MANIFEST',
      'Invalid byte length',
      file.path,
    );
    if (file.kind === 'noir') {
      check(file.path === 'scene.noir' && !('asset_id' in file), 'MANIFEST', 'Invalid scene entry');
    } else {
      const id = file.asset_id;
      check(
        typeof id === 'number' &&
          Number.isInteger(id) &&
          id > 0 &&
          id <= 0xffffffff &&
          !ids.has(id),
        'MANIFEST',
        'Invalid or duplicate asset ID',
      );
      ids.add(id);
      const extension = { image: 'png', mesh: 'nomesh', shader_data: 'shader.json' }[
        String(file.kind)
      ];
      check(
        extension && file.path === `assets/${id}.${extension}`,
        'MANIFEST',
        'Asset path/kind mismatch',
        file.path,
      );
    }
  }
  check(paths.has('scene.noir'), 'MANIFEST', 'Missing scene.noir');
  return value as unknown as Manifest;
}

export async function verifyFiles(
  manifest: Manifest,
  files: Map<string, Uint8Array>,
): Promise<void> {
  check(
    files.size === manifest.files.length + 1,
    'MANIFEST',
    'Archive and manifest file sets differ',
  );
  check(globalThis.crypto?.subtle, 'CAPABILITY', 'Web Crypto SHA-256 is required');
  // Sequential hashing bounds peak memory for large packages.
  for (const entry of manifest.files) {
    const bytes = files.get(entry.path);
    check(
      bytes && bytes.length === entry.byte_length,
      'MANIFEST',
      'Missing file or incorrect length',
      entry.path,
    );
    const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
    const hash = Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join(
      '',
    );
    check(hash === entry.sha256, 'HASH', 'SHA-256 mismatch', entry.path);
  }
}
