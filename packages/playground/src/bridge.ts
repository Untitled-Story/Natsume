import type { NatsumeRuntime, ScriptDeclaration, ScriptIdentity } from '@untitled-story/natsume';
import { log } from './console.js';

interface Declaration extends ScriptDeclaration {
  readonly identity: ScriptIdentity;
}
let declarations: Declaration[] = [];
let registered = false;

/** Parses data only; declarations never execute source JavaScript or C#. */
export function readBridgeDeclarations(text: string): void {
  if (registered) throw new Error('请刷新页面，在选择 .noap 前导入 Bridge 声明');
  const input: unknown = JSON.parse(text);
  if (!Array.isArray(input)) throw new Error('Bridge 声明必须为数组');
  const next: Declaration[] = [];
  const identities = new Set<string>();
  for (const entry of input) {
    if (!entry || typeof entry !== 'object') throw new Error('无效 Bridge 声明');
    const { identity, animatedFields = {} } = entry;
    if (
      !identity ||
      typeof identity.assembly !== 'string' ||
      typeof identity.namespace !== 'string' ||
      typeof identity.className !== 'string' ||
      !identity.className ||
      !animatedFields ||
      typeof animatedFields !== 'object' ||
      Array.isArray(animatedFields) ||
      Object.entries(animatedFields).some(
        ([name, type]) => !name || !['float', 'int', 'bool'].includes(String(type)),
      )
    )
      throw new Error('Bridge 需要 identity 和 float / int / bool 类型的 animatedFields');
    const key = JSON.stringify([identity.assembly, identity.namespace, identity.className]);
    if (identities.has(key)) throw new Error('Bridge 脚本身份重复');
    identities.add(key);
    next.push({ identity, animatedFields });
  }
  declarations = next;
}

export function registerPreviewBridges(runtime: NatsumeRuntime): void {
  if (registered) return;
  registered = true;
  for (const { identity, animatedFields } of declarations) {
    runtime.registerScript(
      identity,
      ({ node }) => ({
        onAnimatedField(name, value) {
          log(`Bridge · ${identity.className} #${node.id} · ${name} = ${value}`);
        },
      }),
      { animatedFields: animatedFields ?? {} },
    );
    log(`Bridge 声明 · ${identity.namespace}.${identity.className} · 未执行原游戏逻辑`, 'warn');
  }
}
