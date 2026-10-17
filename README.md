# Natsume

Natsume 是一个基于 PixiJS v8 和 WebGL2、用纯 TypeScript 编写的 Web 特效运行库。

Natsume 加载由 Noa 编译的 NOAP (Noa Package) 资源包，解析场景层级、动画、粒子系统、材质和纹理，在浏览器中模拟和渲染 Unity 特效。Noa 负责资源编译，Natsume 负责运行和渲染。

```text
Unity Prefab → Noa → NOAP (Noa Package) → Natsume → PixiJS
```

每个特效实例提供独立的 Pixi 容器，宿主可以自行定位、缩放和裁剪。自定义 MonoBehaviour 的序列化数据通过 Script Bridge 提供给宿主，由宿主实现对应行为。

项目目前处于早期开发阶段，支持部分 Unity 特性。未支持的运行配置会在实例化时报告错误；Noise 等近似行为与误差范围见 [Unity 行为对照](tools/unity-probe/MEASUREMENTS.md)。

## 使用

在已有 PixiJS 应用中加载 `.noap` 文件并创建实例：

```ts
import { type WebGLRenderer } from 'pixi.js';
import { loadPack, NatsumeRuntime } from 'natsume';

// app 为已初始化的 PixiJS Application，使用 WebGL2。
const runtime = new NatsumeRuntime(app.renderer as WebGLRenderer);
const pack = await loadPack('/effects/example.noap');
const effect = await runtime.instantiate(pack);

app.stage.addChild(effect.container);
effect.container.position.set(400, 300);
effect.play();

const tick = (ticker: { deltaMS: number }) => effect.update(ticker.deltaMS / 1000);
app.ticker.add(tick);
```

`loadPack` 接受 URL、`Uint8Array` 或 `ArrayBuffer`。同一个资源包可以创建多个独立实例；实例提供 `play()`、`pause()`、`restart()` 和 `stop()` 控制播放，宿主以秒调用 `update()` 推进模拟。

包含已支持 Noise 配置的特效，需要在实例化时显式传入 `{ approximateNoise: true }` 以允许 Curl Noise 近似。

不再使用时，解除更新回调并释放资源：

```ts
app.ticker.remove(tick);
effect.destroy();
pack.dispose();
runtime.destroy();
```

Natsume 不创建或销毁宿主的 Application、画布和 Renderer。当前包为私有 workspace 包，尚未发布到 npm。

## Script Bridge

在实例化前，用包内 MonoBehaviour 的真实身份注册行为。以下示例将该组件所在节点及其子树绘制到父节点原点，保留粒子模拟与深度：

```ts
runtime.registerScript(
  { assembly: 'Assembly-CSharp', namespace: 'MyGame', className: 'EffectController' },
  ({ effect, node }) => {
    const align = () => {
      const parent = node.parent;
      if (!parent) return;
      const world = node.worldMatrix,
        origin = parent.worldMatrix;
      const x = world[12]! - origin[12]!;
      const y = world[13]! - origin[13]!;
      const z = world[14]! - origin[14]!;
      const m = effect.displayMatrix;
      node.setRenderOffset({
        x: -(m[0]! * x + m[4]! * y + m[8]! * z),
        y: -(m[1]! * x + m[5]! * y + m[9]! * z),
      });
    };
    return { onEnable: align, update: align, onDisable: () => node.setRenderOffset(null) };
  },
);
```

`setRenderOffset()` 使用特效容器局部坐标，父子偏移相加；传 `null` 清除当前节点的偏移。设置立即生效，重播保留。宿主也可以通过 `effect.getNode(id)` 调用此接口；`effect.renderedNodes` 返回含已启用渲染器组件的节点，包括当前失活的节点。

## 开发与预览

需要 Node.js 24 或更新版本，以及 `package.json` 指定版本的 pnpm。在项目根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm dev
```

打开终端显示的本地地址，选择 `.noap` 文件即可预览。文件在浏览器本地读取。

```sh
pnpm build          # 构建运行库和预览页
pnpm typecheck      # 类型检查
pnpm test           # 单元测试
pnpm lint           # 代码检查
```

浏览器回归测试需要先安装 Chromium：

```sh
pnpm exec playwright install chromium
pnpm test:browser
```

运行库位于 `packages/natsume/`，预览页位于 `packages/playground/`。生成绑定已包含在源码中，普通构建无需安装 FlatBuffers 编译器。

[Unity 探针](tools/unity-probe/README.md) 与性能脚本位于 `tools/`，普通构建和测试无需安装 Unity。`data/`、`reference/` 和 `docs/` 为本地资料，不提交 Git；依赖本地 `.noap` 样本的测试在缺少文件时会跳过。

## 许可证

Copyright 2026 Untitled Story Orgnization

本项目采用 [Apache License 2.0](LICENSE) 许可证。第三方资源保留其原有授权。
