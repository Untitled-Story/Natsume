# 场景绘制

Natsume 把包里的网格、Sprite、UI、遮罩和相机绘制到实例的 Pixi 容器里，宿主可以控制实例的位置和部分渲染输入。粒子 Renderer 的具体支持情况见[支持范围](/reference/support)。

## 放置实例

每个实例有一个独立的 Pixi 容器 `effect.container`。Natsume 按包内的布局尺寸设置容器的边界，位置、缩放、遮罩和层级都由宿主决定：

```ts
app.stage.addChild(effect.container);
effect.container.position.set(400, 300);
effect.container.scale.set(2);
effect.container.zIndex = 10;
```

- `effect.layoutSize` 返回包内的布局尺寸（如果有）。
- 入口的根节点使用拉伸的外部锚点时，需要在实例化选项里提供 `parentLayout: { width, height }`。
- 不同实例以及其他 Pixi 对象之间的顺序，由宿主通过容器控制。

## 网格与材质

`MeshFilter` 加 `MeshRenderer` 使用包内的真实三角网格，支持：

- 可选的顶点色。
- UV0 到 UV7。
- 材质纹理的 ST（缩放与偏移）。
- 多个 submesh。材质槽依次对应 submesh，多出的槽重复使用最后一个 submesh。

空 Mesh 和空的材质槽不绘制。粒子 Renderer 的渲染模式为 None 时仍然保留模拟，ShadowsOnly 不绘制颜色。

粒子和普通 Mesh 共用混合、ColorMask、深度测试与写入、剔除和 stencil 状态。

### 材质配方

Natsume 不执行任意 Shader。它按源 Shader 程序的 SHA-256 匹配内置的材质配方，目前包括已核验的 SpriteDefault、TextureVertexColor 和 URP/Particles/Unlit。粒子 Renderer 另外支持 ParticleAddAlpha、ParticleUnlit，以及 Legacy 的 Additive 与 Alpha Blended 材质模型。

配方保留源材质的混合、深度、剔除、渲染队列和 LightMode 开关。未知的程序和未核验的 keyword 变体会被预检明确拒绝。已核验的 URP/Lit 程序只保留 DepthOnly，不向普通颜色目标绘制，也不补造光照 Pass。

读取全局 mip 偏移的材质要求宿主提供 `renderEnvironment.globalMipBias`，见[环境配置](/guide/environments#渲染环境)。

### 纹理

- 支持 Unity 内置的 Default-Particle 纹理及其原生 mip 链。
- Image 和 SourceData 中支持单部件、无压缩扫描线的 RGBA HALF OpenEXR。HDR 以半浮点上传，不会裁剪到 8 位。
- Image 也支持 PNG。ShapeTexture 的 CPU 采样目前只支持 PNG。
- 外部的源纹理必须带有明确的色彩空间和采样设置。
- Linear 过滤保留了已测量的颜色插值近似，误差见 [Unity 行为差异](/reference/unity-differences)。

同一个资源包的纹理在同一运行时内共享。同一图集的 Sprite 共享纹理，跨图像的序列按粒子顺序分段绘制。

## Sprite

SpriteRenderer 支持真实网格、源 UV、颜色、翻转、Simple、Sliced、Tiled 和 Adaptive 平铺、越界的 pivot，以及动画。Sprite 描述符内联在 NOIR 里，通过资产 ID 引用图像和网格，没有独立的文件。

## Canvas 与 UI

- Canvas 支持 Overlay、Camera 和 World 三种模式。
- Image 支持 Simple、Sliced、Tiled、Filled、九宫格、径向填充、裁边 Sprite 和 Pixel Perfect。
- CanvasGroup 处理透明度的继承。
- UIMask 与 RectMask2D 支持嵌套、padding 和 softness。

没有包内 Camera 时，屏幕 Canvas 需要宿主提供显示尺寸，见[环境配置](/guide/environments#canvas-环境)。

## 遮罩

Sprite Mask 对 Sprite 和粒子支持 Inside 与 Outside、alpha cutoff 和排序范围。UI 遮罩和 Sprite 遮罩可以与宿主的 Pixi stencil mask 组合。任意自定义的源 stencil 组合仍需要单独验证。

遮罩会增加额外的绘制：每个受影响的 Sprite 或粒子 pass 前后会绘制适用的 Sprite Mask，UIMask 使用进入和退出两个 pass。

UI 层级、Sprite Mask 和宿主的 Pixi mask 共用 8 位的 stencil。存在 Sprite Mask 时会保留一位，合计超出容量时会报错。

## 包内相机

包内的 Camera 支持：

- 透视和正交投影。
- 物理相机投影和五种 Gate Fit。
- 自定义投影矩阵。
- viewport、层裁剪和浮点的绘制顺序。
- 投影和启用状态的动画。

宿主提供显示区域，Natsume 用矩阵变换几何，不创建完整的 Unity 相机系统。提供方式见[环境配置](/guide/environments#相机环境)。

## 绘制顺序

实例内部按下面的规则排序：

1. 先绘制不透明队列（渲染队列不大于 2500），再绘制透明队列。
2. 每个阶段依次比较 Sorting Layer、Order 和 Render Queue。
3. 透明队列按系统世界包围盒中心的视图深度，从远到近绘制。
4. 不透明队列先按材质分组，同一材质从近到远绘制。
5. `sortingFudge` 以世界单位加到系统的排序深度上，负值表示更近。
6. 完全同序的 pass 保留组件和材质槽的顺序。

粒子移动或显示矩阵变化时会重新排序。粒子系统内部的排序（Distance、Depth、Oldest、Youngest）使用仿射显示矩阵的 Z 深度。

Sorting Layer 的顺序优先读取包内 Renderer 的层 ID 与序号。缺失时使用宿主提供的 `renderEnvironment.sortingLayers`，仍无法确定时会报错。

## 渲染偏移与坐标换算

宿主可以平移某个节点的渲染结果，而不改变模拟状态：

```ts
const node = effect.getNode(nodeId)!;
node.setRenderOffset({ x: 20, y: -10 }); // 特效容器的局部坐标
node.setRenderOffset(null); // 清除
```

- 偏移作用于该节点的渲染器和全部后代，父子的偏移相加。
- 设置立即生效，`restart()` 后保留，模拟位置和深度不变。
- `effect.renderedNodes` 返回含有渲染器组件的节点，包括当前失活的节点。

要在 Unity 世界坐标和容器坐标之间换算，使用：

```ts
effect.worldToContainer([x, y, z]); // 世界点 → 容器局部坐标 { x, y }
node.containerPosition; // 节点原点在容器局部的位置，不含渲染偏移
```

例如，把一个节点叠加到它父节点的位置：

```ts
const position = node.containerPosition;
const origin = node.parent!.containerPosition;
node.setRenderOffset({ x: origin.x - position.x, y: origin.y - position.y });
```
