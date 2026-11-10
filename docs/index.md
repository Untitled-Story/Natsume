---
layout: home

hero:
  name: Natsume
  text: 在浏览器里运行 Unity 特效
  tagline: 基于 PixiJS v8 与 WebGL2，用纯 TypeScript 加载 NOAP 资源包，模拟并渲染粒子、动画与 Timeline。
  actions:
    - theme: brand
      text: 阅读简介
      link: /guide/introduction
    - theme: alt
      text: GitHub
      link: https://github.com/Untitled-Story/Natsume

features:
  - title: 宿主掌控
    details: 每个特效实例提供独立的 Pixi 容器，定位、缩放、裁剪和时间推进都由宿主决定。
  - title: 明确的兼容边界
    details: 未支持的配置会在预检或实例化时报告，不会悄悄降级；近似行为带有已测量的误差范围。
  - title: 脚本数据交给宿主
    details: 自定义 MonoBehaviour 的序列化数据通过 Script Bridge 提供，由宿主实现对应行为。
---
