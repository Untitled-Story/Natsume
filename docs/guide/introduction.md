# 简介

Natsume 是一个基于 PixiJS v8 和 WebGL2、用纯 TypeScript 编写的 Web 特效运行库。

它加载由 Noa 编译的 NOAP（Noa Package）资源包，解析场景层级、动画、粒子系统、材质和纹理，在浏览器中模拟和渲染 Unity 特效。Noa 负责资源编译，Natsume 负责运行和渲染。

```text
Unity Prefab → Noa → NOAP (Noa Package) → Natsume → PixiJS
```

## 项目状态

项目处于早期开发阶段，只支持部分 Unity 特性，目前是私有 workspace 包，尚未发布到 npm。

未支持的运行配置会在实例化时报告错误；Noise 等近似行为与误差范围见仓库中的 [Unity 行为对照](https://github.com/Untitled-Story/Natsume/blob/main/tools/unity-probe/MEASUREMENTS.md)。
