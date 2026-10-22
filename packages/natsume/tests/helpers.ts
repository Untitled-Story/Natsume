import { Builder } from 'flatbuffers';
import { zipSync, strToU8 } from 'fflate';
import { Document, DocumentT } from '../src/format/generated/noa/ir/document.js';
import { NodeT } from '../src/format/generated/noa/ir/node.js';
import { TransformT } from '../src/format/generated/noa/ir/transform.js';
import { Vec3T } from '../src/format/generated/noa/ir/vec3.js';
import { QuaternionT } from '../src/format/generated/noa/ir/quaternion.js';
import { EntryPointT } from '../src/format/generated/noa/ir/entry-point.js';

export function minimalDocument(): DocumentT {
  const document = new DocumentT();
  document.formatMajor = 2;
  document.nodes = [
    new NodeT(
      1,
      'root',
      0,
      true,
      new TransformT(new Vec3T(), new QuaternionT(0, 0, 0, 1), new Vec3T(1, 1, 1)),
    ),
  ];
  const entry = new EntryPointT(2, 'default', [1]);
  entry.hostCameraSlot = 'main-camera';
  document.entries = [entry];
  document.defaultEntryId = 2;
  return document;
}
export function encode(document: DocumentT): Uint8Array {
  const builder = new Builder(1024);
  const root = document.pack(builder);
  Document.finishDocumentBuffer(builder, root);
  return Uint8Array.from(builder.asUint8Array());
}
export async function archive(scene = encode(minimalDocument())) {
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', Uint8Array.from(scene))).toString(
    'hex',
  );
  const manifest = {
    format: 'noa-package',
    version: 1,
    noir_version: [2, 0],
    document: 'scene.noir',
    files: [{ path: 'scene.noir', kind: 'noir', byte_length: scene.length, sha256: hash }],
  };
  return zipSync(
    { 'manifest.json': strToU8(JSON.stringify(manifest)), 'scene.noir': scene },
    { level: 0 },
  );
}
