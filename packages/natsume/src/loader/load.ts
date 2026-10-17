import { ByteBuffer } from 'flatbuffers';
import { check } from '../errors.js';
import { EffectPack } from '../pack.js';
import { Document } from '../format/generated/noa/ir/document.js';
import { Mesh, type MeshT } from '../format/generated/noa/mesh/mesh.js';
import { verifyBuffer } from '../format/verify.js';
import { validateDocument, validateMesh } from '../format/semantics.js';
import { parseJson, parseManifest, record, verifyFiles } from './manifest.js';
import { DEFAULT_LIMITS, readZip, type LoadLimits } from './zip.js';

export interface LoadOptions {
  signal?: AbortSignal;
  limits?: Partial<LoadLimits>;
}
function validateShader(bytes: Uint8Array, path: string) {
  const shader = parseJson(bytes, path);
  check(
    record(shader) &&
      shader.format === 'noa-shader-data' &&
      shader.version === 1 &&
      shader.model === 'particle-add-alpha' &&
      shader.revision === 1,
    'VERSION',
    'Unsupported shader recipe',
    path,
  );
  const allowed = [
    'format',
    'version',
    'model',
    'revision',
    'program_sha256',
    'color_formula',
    'output_policy',
    'outputs',
    'source_outputs',
    'alpha_mode',
    'rgb_premultiply',
    'source_passes',
    'source_program_encoding',
    'source_program_hex',
  ];
  check(
    Object.keys(shader).every((key) => allowed.includes(key)) &&
      allowed.every((key) => key in shader),
    'SEMANTIC',
    'Invalid shader recipe properties',
    path,
  );
  check(
    shader.output_policy === 'primary-color' &&
      JSON.stringify(shader.outputs) === '[0]' &&
      JSON.stringify(shader.source_outputs) === '[0,1,2]' &&
      shader.rgb_premultiply === true,
    'SEMANTIC',
    'Unsupported shader output policy',
    path,
  );
  check(
    typeof shader.program_sha256 === 'string' &&
      /^[0-9a-f]{64}$/.test(shader.program_sha256) &&
      typeof shader.color_formula === 'string' &&
      Array.isArray(shader.source_passes) &&
      shader.source_program_encoding === 'unity-metal-lz4' &&
      typeof shader.source_program_hex === 'string' &&
      /^(?:[0-9a-f]{2})+$/.test(shader.source_program_hex),
    'SEMANTIC',
    'Invalid shader provenance',
    path,
  );
  const mode = shader.alpha_mode;
  check(
    record(mode) &&
      Object.keys(mode).length === 4 &&
      mode.stream === 0 &&
      mode.component === 0 &&
      mode.comparison === 'less_equal' &&
      mode.threshold === 0.5,
    'SEMANTIC',
    'Unsupported shader alpha mode',
    path,
  );
}

async function download(url: string | URL, signal: AbortSignal | undefined, maxBytes: number) {
  const response = await fetch(url, signal ? { signal } : {});
  check(response.ok, 'ZIP', `Fetch failed: HTTP ${response.status}`);
  const length = response.headers.get('content-length');
  if (length !== null) check(Number(length) <= maxBytes, 'LIMIT', 'Download size limit exceeded');
  check(response.body, 'ZIP', 'Response body missing');
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      check(size <= maxBytes, 'LIMIT', 'Download size limit exceeded');
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** Load and inspect a NOAP without creating Pixi objects or assuming execution support. */
export async function loadPack(
  source: string | URL | Uint8Array | ArrayBuffer,
  options: LoadOptions = {},
): Promise<EffectPack> {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  for (const value of Object.values(limits))
    check(
      Number.isSafeInteger(value) && value > 0,
      'LIMIT',
      'Limits must be positive safe integers',
    );
  options.signal?.throwIfAborted();
  const input =
    typeof source === 'string' || source instanceof URL
      ? await download(source, options.signal, limits.maxPackageBytes)
      : source;
  // Copy once so caller mutation cannot race asynchronous hashing and parsing.
  const size = input instanceof ArrayBuffer ? input.byteLength : input.length;
  check(size <= limits.maxPackageBytes, 'LIMIT', 'Package size limit exceeded');
  const bytes =
    input instanceof ArrayBuffer ? new Uint8Array(input.slice(0)) : Uint8Array.from(input);
  const files = readZip(bytes, limits),
    manifestBytes = files.get('manifest.json');
  check(manifestBytes, 'MANIFEST', 'Missing manifest.json');
  const manifest = parseManifest(manifestBytes);
  await verifyFiles(manifest, files);
  options.signal?.throwIfAborted();
  const scene = files.get(manifest.document);
  check(scene, 'MANIFEST', 'Missing scene.noir');
  verifyBuffer(scene, 'noir');
  const document = Document.getRootAsDocument(new ByteBuffer(scene)).unpack();
  validateDocument(document);
  check(
    document.assets.length === manifest.files.filter((file) => file.asset_id !== undefined).length,
    'MANIFEST',
    'NOIR/manifest asset sets differ',
  );
  const meshes = new Map<number, MeshT>();
  for (const asset of document.assets) {
    const file = manifest.files.find((file) => file.asset_id === asset.id);
    check(
      file && file.kind === ['unknown', 'image', 'mesh', 'shader_data'][asset.kind],
      'MANIFEST',
      'NOIR/manifest asset kind differs',
    );
    const data = files.get(file.path);
    check(data, 'MANIFEST', 'Missing asset', file.path);
    if (asset.kind === 2) {
      verifyBuffer(data, 'mesh');
      const mesh = Mesh.getRootAsMesh(new ByteBuffer(data)).unpack();
      validateMesh(mesh);
      meshes.set(asset.id, mesh);
    }
    if (asset.kind === 3) validateShader(data, file.path);
    if (asset.kind === 1)
      check(
        data.length >= 24 &&
          [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => data[i] === byte) &&
          new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(16) > 0 &&
          new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(20) > 0,
        'SEMANTIC',
        'Invalid PNG header',
        file.path,
      );
  }
  options.signal?.throwIfAborted();
  return new EffectPack(document, manifest, files, meshes);
}
