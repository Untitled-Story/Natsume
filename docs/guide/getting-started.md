# 快速开始

下面在已有的 PixiJS 应用里加载一个 `.noap` 文件并播放。

## 前提条件

- PixiJS `^8.22.0`。
- Pixi 渲染器必须使用 WebGL2。Natsume 在初始化时检查这一点，其他后端会直接报错。
- 一个由 [Noa](https://github.com/Untitled-Story/Noa) 编译的 `.noap` 资源包。
- 支持 `crypto.subtle` 的环境。加载时用它校验文件的 SHA-256，浏览器里通常需要 HTTPS 或 localhost。

Natsume 目前是私有 workspace 包，没有发布到 npm。在 workspace 内部使用时，把它声明为依赖：

```json
{
  "dependencies": {
    "natsume": "workspace:*",
    "pixi.js": "8.22.0"
  }
}
```

## 加载并播放

```ts
import { Application, extensions } from 'pixi.js';
import {
  loadPack,
  NatsumePlugin,
  screenCanvasEnvironment,
  screenParticleEnvironment,
  stationaryRigidbodyVelocities,
} from 'natsume';

extensions.add(NatsumePlugin); // 必须在 app.init() 之前注册

const app = new Application();
await app.init({ preference: 'webgl', preferWebGLVersion: 2 });
document.body.append(app.canvas);

const pack = await loadPack('/effects/example.noap');
const effect = await app.natsume.instantiate(pack, {
  particleEnvironment: screenParticleEnvironment({
    rigidbodyVelocities: stationaryRigidbodyVelocities(pack),
  }),
  canvasEnvironment: screenCanvasEnvironment(app.screen.width, app.screen.height),
  renderEnvironment: { globalMipBias: 0 },
});

app.stage.addChild(effect.container);
effect.container.position.set(400, 300);
effect.play();

const tick = (ticker: { deltaMS: number }) => effect.update(ticker.deltaMS / 1000);
app.ticker.add(tick);
```

这段代码做了五件事：

1. `NatsumePlugin` 为每个 `Application` 创建一个运行时，之后可以通过 `app.natsume` 访问。
2. `loadPack` 读取并校验资源包，返回 `EffectPack`。
3. `instantiate` 创建特效实例。三个环境参数是宿主提供的输入，下文有说明。
4. `effect.container` 是普通的 Pixi 容器，添加到场景里并设置位置即可。
5. Natsume 不会自己推进时间，需要在 ticker 里用秒为单位调用 `effect.update()`。

### 环境参数

资源包里的材质、粒子和 UI 往往依赖宿主才知道的信息，比如重力、视点位置和显示尺寸。上面的示例使用预设为二维宿主提供这些输入：

- `screenParticleEnvironment` 返回无雾、Unity 默认重力、视点在 `z = -1000` 的粒子环境。
- `stationaryRigidbodyVelocities` 为包声明的每个 Rigidbody 槽提供零速度。
- `screenCanvasEnvironment` 生成 1 个单位对应 1 个 Pixi 逻辑像素的正交视图。

这些预设只是常用的起点。不同的包需要的输入不同，建议在实例化之前先[做兼容性预检](/guide/loading-packs#兼容性预检)，预检会列出缺少或不被支持的项。各项环境的含义见[环境配置](/guide/environments)。

## 释放资源

不再使用时，按下面的顺序释放：

```ts
app.ticker.remove(tick);
effect.destroy();
pack.dispose();
app.destroy();
```

同一个资源包可以创建多个互相独立的实例，所有实例都销毁后再调用 `pack.dispose()`。应用销毁时，插件创建的运行时会随之销毁。

## 在预览页里查看

仓库自带一个预览页，可以直接打开本地的 `.noap` 文件：

```sh
pnpm install --frozen-lockfile
pnpm dev
```

打开终端里显示的地址，选择文件即可。文件只在浏览器本地读取，不会上传。预览页的实现位于 `packages/playground/`，可以作为接入代码的参考。

## 下一步

- [核心概念](/guide/concepts)：Pack、Runtime、Instance 的关系，以及宿主和库各自负责什么。
- [加载与预检](/guide/loading-packs)：加载选项、检查包内容、预检报告。
- [播放与更新](/guide/playback)：播放控制和时间推进。
