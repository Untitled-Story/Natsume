# 简介

Natsume 是一个运行在浏览器里的 Unity 特效运行库，基于 PixiJS v8 和 WebGL2，使用纯 TypeScript 编写。

它读取由 Noa 编译的 NOAP（Noa Package）资源包，解析场景层级、动画、粒子系统、材质和纹理，在 Pixi 的渲染循环里模拟并绘制 Unity 特效。Noa 负责把 Unity 资源编译成资源包，Natsume 负责运行和渲染。

```text
Unity Prefab → Noa → NOAP (Noa Package) → Natsume → PixiJS
```

## 适用场景

如果你的 Web 项目已经使用 PixiJS，并且需要播放在 Unity 里制作的粒子特效，Natsume 可以直接接入现有的 `Application`。每个特效实例提供一个独立的 Pixi 容器，宿主像对待其他显示对象一样放置、缩放和裁剪它。

Natsume 不是 Unity 的完整移植。它不运行 C# 代码，不提供完整的 Unity 相机系统，也不生成三维光照环境。自定义 MonoBehaviour 的序列化数据会交给 Script Bridge，由宿主实现对应行为。

## 项目状态

项目处于早期开发阶段，只支持一部分 Unity 特性。

- 当前是私有 workspace 包，尚未发布到 npm。
- 已支持的粒子模块、动画和渲染范围见[支持范围](/reference/support)。
- 未支持的运行配置会在预检或实例化时报告错误，不会静默降级。
- Noise 等近似行为的适用范围和误差见 [Unity 行为差异](/reference/unity-differences)。

## 从哪里开始

- 想先跑起来：[快速开始](/guide/getting-started)。
- 想理解对象之间的关系和宿主的职责：[核心概念](/guide/concepts)。
- 想知道某个 Unity 功能能不能用：[支持范围](/reference/support)。
- 想参与开发：[开发环境](/contributing/development)。
