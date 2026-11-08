import { createPlaybackHarness } from './playback-harness.js';
import { scriptFieldPack, scriptIdentity } from '../script-field-fixtures.js';
import type { ScriptContext } from '../../src/runtime/runtime.js';
import { readBridgeDeclarations, registerPreviewBridges } from '../../../playground/src/bridge.js';

export async function verifyScriptFields() {
  const { app, runtime } = await createPlaybackHarness(),
    pack = scriptFieldPack();
  const contexts: ScriptContext[] = [],
    calls: (number | boolean)[] = [];
  let recursion = false;
  runtime.registerScript(
    scriptIdentity,
    (context) => {
      contexts.push(context);
      return {
        onAnimatedField(name, value) {
          if (name === 'mode') {
            calls.push(value);
            try {
              context.effect.update(1 / 60);
            } catch {
              recursion = true;
            }
          }
        },
      };
    },
    { animatedFields: { mode: 'int', weight: 'float', visible: 'bool' } },
  );
  const compatible = runtime.checkCompatibility(pack).compatible;
  const sideEffects = contexts.length;
  const a = await runtime.instantiate(pack),
    b = await runtime.instantiate(pack);
  a.play();
  const independent = contexts[0]!.fields.mode === 1 && contexts[1]!.fields.mode === 0;
  a.update(0.1);
  const coalesced = calls.length === 1;
  a.restart();
  const restarted = contexts[0]!.fields.mode === 1 && contexts[0]!.fields.weight === 4;
  a.destroy();
  b.destroy();
  let failed = 0;
  runtime.registerScript(
    scriptIdentity,
    () => ({
      onAnimatedField() {
        failed++;
        throw new Error('host failure');
      },
    }),
    { animatedFields: { mode: 'int', weight: 'float', visible: 'bool' } },
  );
  const failing = await runtime.instantiate(pack);
  failing.play();
  failing.update(0.1);
  const isolated = failed === 1 && failing.diagnostics.some((d) => d.code === 'SCRIPT_ERROR');
  failing.destroy();
  const cancelled: string[] = [];
  runtime.registerScript(
    scriptIdentity,
    ({ effect }) => ({
      onAnimatedField(name) {
        cancelled.push(name);
        effect.destroy();
      },
    }),
    { animatedFields: { mode: 'int', weight: 'float', visible: 'bool' } },
  );
  const dying = await runtime.instantiate(pack);
  dying.play();
  const destroyed = dying.destroyed && cancelled.length === 1;
  runtime.destroy();
  pack.dispose();
  app.destroy(true);
  return {
    compatible,
    sideEffects,
    independent,
    coalesced,
    restarted,
    recursion,
    isolated,
    destroyed,
  };
}

export async function verifyPreviewBridgeDeclaration() {
  const { app, runtime } = await createPlaybackHarness();
  const pack = scriptFieldPack();
  let malformed = false;
  try {
    readBridgeDeclarations('{"identity":{}}');
  } catch {
    malformed = true;
  }
  readBridgeDeclarations(
    JSON.stringify([
      {
        identity: scriptIdentity,
        animatedFields: { mode: 'int', weight: 'float', visible: 'bool' },
      },
    ]),
  );
  registerPreviewBridges(runtime);
  const effect = await runtime.instantiate(pack);
  effect.play();
  const compatible = runtime.checkCompatibility(pack).compatible;
  const mode = effect.simulation.bindings.scriptFields.get(4)!.mode;
  const declared = document.getElementById('console')!.textContent!.includes('未执行原游戏逻辑');
  let guarded = false;
  try {
    readBridgeDeclarations('[]');
  } catch {
    guarded = true;
  }
  effect.destroy();
  pack.dispose();
  runtime.destroy();
  app.destroy(true);
  return { malformed, compatible, mode, declared, guarded };
}
