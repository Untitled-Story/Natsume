import type { DeepReadonly } from '../pack.js';
import type { MeshT } from './generated/noa/mesh/mesh.js';

/** Returns an authored UV channel; an absent channel stays absent. */
export function meshUV(mesh: DeepReadonly<MeshT>, channel = 0) {
  return mesh.texcoords.find((uv) => uv.channel === channel)?.values ?? [];
}
