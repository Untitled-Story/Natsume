# Natsume

Natsume 是一个基于 PixiJS v8 和 WebGL2、用纯 TypeScript 编写的 Web 特效运行库。

它加载由 [Noa](https://github.com/Untitled-Story/Noa) 编译的 NOAP（Noa Package）资源包，解析场景层级、动画、粒子系统、材质和纹理，在浏览器中模拟和渲染 Unity 特效。Noa 负责资源编译，Natsume 负责运行和渲染。

```text
Unity Prefab → Noa → NOAP (Noa Package) → Natsume → PixiJS
```

每个特效实例提供独立的 Pixi 容器，宿主可以自行定位、缩放和裁剪。自定义 MonoBehaviour 的序列化数据通过 Script Bridge 提供给宿主，由宿主实现对应行为。

当前是预发布版本（alpha），只支持一部分 Unity 特性，范围见[支持范围](docs/reference/support.md)。未支持的运行配置会在预检或实例化时报告错误。

## 快速开始

```sh
npm install @untitled-story/natsume pixi.js
```

```ts
import { Application, extensions } from 'pixi.js';
import { loadPack, NatsumePlugin } from '@untitled-story/natsume';

extensions.add(NatsumePlugin);

const app = new Application();
await app.init({ preference: 'webgl', preferWebGLVersion: 2 });
document.body.append(app.canvas);

const pack = await loadPack('/effects/example.noap');
const effect = await app.natsume.instantiate(pack);

app.stage.addChild(effect.container);
effect.container.position.set(400, 300);
effect.play();

app.ticker.add((ticker) => effect.update(ticker.deltaMS / 1000));
```

多数资源包还需要宿主提供重力、视点和显示尺寸等环境输入，实例化前可以用 `runtime.checkCompatibility(pack, options)` 预检。完整的用法见文档。

## 文档

在线文档：<https://untitled-story.github.io/Natsume/>。文档源码位于 `docs/`，使用 VitePress 构建，本地预览：

```sh
pnpm install --frozen-lockfile
pnpm docs:dev
```

内容包括快速开始、核心概念、各功能的使用指南、支持范围、与 Unity 的行为差异、API 参考，以及面向贡献者的架构和测试说明。

## 开发

需要 Node.js 24 或更新版本，以及 `package.json` 指定版本的 pnpm。

```sh
pnpm dev            # 预览页，选择本地 .noap 文件
pnpm build          # 构建运行库和预览页
pnpm typecheck      # 类型检查
pnpm test           # 单元测试
pnpm test:browser   # 浏览器回归测试，需要先安装 Chromium
pnpm lint           # 代码检查
```

运行库位于 `packages/natsume/`，预览页位于 `packages/playground/`，Unity 探针和性能脚本位于 `tools/`。详见文档中的开发环境一页。

## 许可证

本项目采用 [Apache License 2.0](LICENSE) 许可证。第三方资源保留其原有授权。
