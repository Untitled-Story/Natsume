# 加载与预检

## 加载资源包

```ts
import { loadPack } from '@untitled-story/natsume';

const pack = await loadPack('/effects/example.noap');
```

`loadPack` 接受 URL 字符串、`URL`、`Uint8Array` 或 `ArrayBuffer`，返回 `EffectPack`。第二个参数可以传入选项：

```ts
const controller = new AbortController();
const pack = await loadPack(url, {
  signal: controller.signal,
  limits: { maxPackageBytes: 128 * 1024 * 1024 },
});
```

| 选项     | 说明                                                         |
| -------- | ------------------------------------------------------------ |
| `signal` | `AbortSignal`，用于取消下载。                                |
| `limits` | 覆盖默认的资源包大小限制，见下表。每个值必须是正的安全整数。 |

| 限制              | 默认值 |
| ----------------- | ------ |
| `maxPackageBytes` | 64 MiB |
| `maxFiles`        | 4096   |
| `maxFileBytes`    | 32 MiB |

### 加载时检查什么

`loadPack` 校验压缩包结构、清单、文件的 SHA-256、FlatBuffers 二进制布局和场景语义。它不创建渲染资源，也不需要宿主的任何输入，因此可以用来检查尚未支持绘制的包。

遇到未知的必需能力时，`loadPack` 直接报错。已知但尚未实现的必需能力不在这里拦截，而是由预检和实例化阻止。

### 支持的格式

当前读取 NOAP v1、NOIR 1.0（`noa.effects/1.0`）和 NOMS 1.0（`noa.mesh/1.0`）。旧格式的包需要用新版 [Noa](https://github.com/Untitled-Story/Noa) 重新编译。详见[包格式](/reference/package-format)。

## 查看包的内容

`EffectPack` 的数据是只读的，加载完成后可以直接检查：

```ts
const info = pack.describe();
info.counts; // { nodes, components, animations, materials, assets }
info.components; // 按组件类型统计的数量，例如 { ParticleSystem: 16 }
info.scripts; // 包里用到的自定义脚本及出现次数
info.requiredHostInputs; // 宿主需要提供的输入槽名称
info.features; // 包声明的能力需求
```

`describe()` 只描述数据，不判断能否播放，`playbackReady` 始终为 `false`。是否可播放以预检结果为准。

### 查找节点和组件

粒子系统、Animator、Director 等接口都以组件 ID 为参数。`EffectPack` 提供几种查找方式：

```ts
pack.getNode(id);
pack.getComponent(id);
pack.getComponents(nodeId);

pack.findNodes('Spark'); // 按名称，返回全部同名节点
pack.findNodesByPath('Root/Effect/Spark'); // 按路径
pack.findComponents('ParticleSystem'); // 按组件类型，整个包
pack.findComponents('Animator', nodeId); // 限定在某个节点
```

`findNodesByPath` 从场景根节点开始，用 `/` 连接节点名称，返回全部匹配。名称中含有 `/` 的节点无法用路径匹配。

`findComponents` 的类型名与 `describe().components` 的键一致，返回组件的 `data` 会按类型收窄，可以直接读取该类型的字段：

```ts
const [system] = pack.findComponents('ParticleSystem');
system?.data.main; // ParticleSystem 的 Main 模块数据
```

实例上也有对应的运行时清单：`effect.entry`、`effect.nodes` 和 `effect.particleSystems`。

## 兼容性预检

在实例化之前，可以用 `checkCompatibility` 一次查看当前入口的阻塞项和近似说明：

```ts
const options = {
  particleEnvironment: screenParticleEnvironment(),
  canvasEnvironment: screenCanvasEnvironment(1280, 720),
};

const report = app.natsume.checkCompatibility(pack, options);
console.table(report.issues);

if (report.compatible) {
  const effect = await app.natsume.instantiate(pack, options);
}
```

报告的 `compatible` 为 `true` 表示没有阻塞项。每个 issue 包含：

| 字段          | 说明                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------- |
| `severity`    | `'error'` 表示阻塞，`'warning'` 表示近似或需要注意的行为。                               |
| `code`        | 问题码。错误使用 `ErrorCode`，警告使用具体的诊断码，见[诊断与错误](/guide/diagnostics)。 |
| `packageName` | 包名，缺失时使用入口根节点的名称。                                                       |
| `componentId` | 相关组件的 ID，适用时才有。                                                              |
| `field`       | 出问题的字段路径。                                                                       |
| `value`       | 该字段的当前值。                                                                         |
| `message`     | 说明。                                                                                   |

预检的特点：

- 不分配粒子缓冲区，不解码纹理，也不执行 Bridge 工厂，开销很小。
- `instantiate` 复用同一套检查。有阻塞项时抛出 `NatsumeCompatibilityError`，完整的问题列表在 `error.issues` 里。
- 预检通过不能保证一定成功。纹理解码、脚本执行和图形设备仍可能出错。

预检会连同你传入的环境一起检查，所以应该传入和实例化时相同的 `options`。

## 释放

```ts
pack.dispose();
```

`dispose()` 清空包内缓存的文件、网格和解码后的像素，可以重复调用。释放之后再读取包数据会抛出 `DISPOSED` 错误。建议在所有使用该包的实例都销毁之后再调用。
