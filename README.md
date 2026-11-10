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
import { Application, extensions } from 'pixi.js';
import { loadPack, NatsumePlugin } from 'natsume';

extensions.add(NatsumePlugin);

const app = new Application();
await app.init({ preference: 'webgl', preferWebGLVersion: 2 });
document.body.append(app.canvas);

const runtime = app.natsume;
const pack = await loadPack('/effects/example.noap');
const effect = await runtime.instantiate(pack);

app.stage.addChild(effect.container);
effect.container.position.set(400, 300);
effect.play();

const tick = (ticker: { deltaMS: number }) => effect.update(ticker.deltaMS / 1000);
app.ticker.add(tick);
```

`loadPack` 接受 URL、`Uint8Array` 或 `ArrayBuffer`。同一个资源包可以创建多个独立实例；实例提供 `play()`、`pause()`、`restart()` 和 `stop()` 控制播放，宿主以秒调用 `update()` 推进模拟。

粒子系统、Animator、Director 等接口使用包内组件 ID，可按节点路径和组件类型查找：

```ts
const spark = pack.findNodesByPath('Root/Effect/Spark')[0]!;
const system = pack.findComponents('ParticleSystem', spark.id)[0]!;
effect.getParticles(system.id);
```

路径从场景根节点开始，以 `/` 连接节点名称，返回全部同名匹配。类型名与 `pack.describe().components` 的键一致，返回组件的 `data` 按类型收窄；省略节点 ID 时查找整个包。

当前读取 NOAP v1、NOIR 1.0（`noa.effects/1.0`）和 NOMS 1.0（`noa.mesh/1.0`）；旧包需要用新版 Noa 重新编译。源图、源材质和源动画可读取，缺少执行支持或源依赖时会在兼容性检查中明确报错。Sprite 描述符内联于 NOIR，通过资产 ID 引用图像和网格，没有独立文件。NOMS 保留源顶点属性、UV0–UV7 和三角形顺序，绘制能力仍受下方支持范围限制。

`loadPack` 校验结构与已知契约，可用于检查尚未支持绘制的包；未知必需能力直接报错。已知但未实现的必需能力由 `checkCompatibility` 和实例化明确阻止。

Noise 的 Low / Medium / High 使用原生实测的一维 / 二维 / 三维 Perlin Curl 结构与种子偏移；实例保留近似诊断。

创建前可调用 `runtime.checkCompatibility(pack, options)`，一次查看当前入口的阻塞项与近似说明：

```ts
const options = {
  particleEnvironment: {
    fog: { mode: 'none' as const },
    gravity: [0, -9.81, 0] as const,
    viewPosition: [0, 0, -10] as const,
  },
};
const report = runtime.checkCompatibility(pack, options);
console.table(report.issues);
if (report.compatible) {
  const effect = await runtime.instantiate(pack, options);
  app.stage.addChild(effect.container);
  effect.play();
}
```

每项包含 `severity`、`code`、`packageName`、`componentId`（适用时）、`field`、`value` 和 `message`。预检不分配粒子缓冲区、不解码纹理，也不执行 Bridge 工厂。`instantiate` 复用同一检查，有阻塞项时抛出 `NatsumeCompatibilityError`，可从 `error.issues` 读取完整结果。预检通过仍可能遇到纹理解码、脚本执行或图形设备错误。

不再使用时，解除更新回调并释放资源：

```ts
app.ticker.remove(tick);
effect.destroy();
pack.dispose();
app.destroy();
```

扩展为每个 Application 创建独立运行时，并随应用销毁；同一应用的实例共享纹理与 Bridge 注册。扩展不自动推进模拟，由宿主调用 `effect.update()`。注册需要在 `app.init()` 前完成，且应用必须使用 WebGL2。

也可以通过 `new NatsumeRuntime(renderer)` 手动管理运行时。当前包为私有 workspace 包，尚未发布到 npm。

## 动画

支持平面 Animator Controller：Float / Int / Bool / Trigger、条件与过渡、中断、Entry / AnyState / Exit、多层 Override / Additive、层权重、状态速度 / 相位 / 时间参数、tag 和 Write Defaults。保留无 Controller、空层及空 Motion。绑定覆盖节点启用、TRS、Rect、组件启用、粒子参数 / 颜色、材质和 Sprite 颜色。

```ts
const animator = effect.getAnimator(animatorId);
animator.setFloat('speed', 1.2);
animator.setTrigger('play');
animator.setLayerWeight(1, 0.5);
const state = animator.getCurrentState(); // 空层为 undefined
const transition = animator.getTransition();
effect.playAnimatorState(animatorId, 'Idle', 0); // 层序号默认 0
```

参数名称与类型不匹配会报错。句柄按实例隔离，restart 后仍有效；销毁后不可使用。Base Layer 的有效权重始终为 1。状态查询保留已完成的循环数；空 Motion 不创建替代片段。

Normal 动画按 1/60 s 固定步先采样，再推进粒子。UnscaledTime 使用宿主提供的未缩放秒数；AnimatePhysics 按宿主提供的物理步逐次推进。仅实际使用相应模式的活动 Animator 要求额外时钟：

```ts
effect.update(deltaSeconds, {
  unscaledDeltaSeconds,
  physicsSteps: [0.02], // 本帧的物理步；没有物理步时传 []
});
animator.setVisible(visible); // 默认 true，控制源 culling mode
```

Cull Update Transforms 在不可见时继续推进状态和事件、停止属性写回；Cull Completely 冻结状态。暂停及停止排空冻结全部动画。`setNodeActive` 立即生效，下一次动画求值可覆盖。入口 ApplyClip 只应用起点，PlayClip 持续播放。

旋转支持归一化四元数与 Unity ZXY。缺失通道保留动作入口值；Write Defaults 恢复 Animator 启动时的属性值。关闭组件保留状态；节点失活按源 keep-state / write-defaults 设置处理。restart 恢复包初值、参数默认值及源层权重。粒子参数保持源模式，材质覆盖按 Renderer 和实例隔离。

多个 Animator 或入口 PlayClip 重叠写入时默认按注册顺序执行，PlayClip 在 Animator 之后；同优先级重叠会给出 `NATSUME_ANIMATION_ORDER` 警告。宿主可以指定覆盖顺序：

```ts
// 数值越大越晚写入；默认 0。下一固定步生效，切状态和重播保留。
effect.setAnimationPriority({ animatorId: 12 }, 10);
effect.setAnimationPriority({ clipId: 56 }, 20);
```

重新启用的 Animator 重新注册；切状态保持原顺序。设置不同优先级后，该对写入者不再产生顺序警告。零时长 Animator Motion 继续写回固定姿态；ApplyClip 保持一次性采样。

宿主可以订阅类型化动画事件：

```ts
const unsubscribe = effect.onAnimationEvent((event) => {
  console.log(event.name, event.stringParameter, event.objectParameter);
  return true; // 确认已处理；不返回 true 时保留 RequireReceiver 检查。
});
unsubscribe();
```

Bridge 行为可实现 `onAnimationEvent(event)`，接收同节点 Animator 的事件。事件保留源字符串、数字和对象引用（包括 bigint fileID），不按名称自动调用方法。订阅者先于 Bridge，事件先于该固定步的轨道采样和粒子推进；正向初始化、循环末端与同时间戳按源顺序派发，倒放按反向顺序派发。ApplyClip 只采样起点，不派发持续播放事件。

回调异常记录诊断，RequireReceiver 无人确认时给出警告；停止、暂停、重播、切状态或销毁取消当前失效批次。回调中启动的新状态，其起始事件延至下一固定步；递归 update 会报错。Avatar / Root Motion、IK / Mirror、AvatarMask、同步层、BlendTree、OverrideController、嵌套状态机和 StateMachineBehaviour 不在当前平面控制器范围。

## Director 与 Timeline

执行 Group、Activation、Animation 和 Control 轨道，包含混合、外插、嵌套 Director、粒子与 Bridge 时间控制；空资产保持为空。

```ts
const director = effect.getDirector(directorComponentId);
director.play();
director.pause();
director.setTime(1.5); // 只设置时间
director.evaluate(); // 立即应用，包括激活与受控粒子

director.setBinding({ guid: trackGuid, fileId: trackFileId }, { componentId: animatorId });
director.setBinding({ exposedName: 'subject' }, { nodeId: targetNodeId });
director.stop();
```

`fileId` 使用 bigint。Activation / Control 绑定节点，Animation 绑定 Animator；目标须属于当前实例，`null` 清除绑定。动画重绑定按相对节点路径与组件序号匹配；无效目标在修改播放图前报错。句柄与绑定覆盖在 restart 后保留，销毁后句柄失效。

GameTime 每次 `effect.update(dt)` 推进一次；UnscaledGameTime 和当前无音轨 DSP 使用 `unscaledDeltaSeconds`。Manual 只由 `setTime` / `evaluate` 采样。Timeline 在 Animator 后、普通粒子前执行；手动 Evaluate 不派发持续播放事件。Timeline 的 Transform 缺失通道使用动画流默认值（位置为 0，缩放为 1）。

`stop()` 回到源 initial time，结束状态在下一次 `effect.update()` 边界恢复；pause 保留当前激活状态。Control 使用实例内现有粒子池；向后定位会重新模拟，昂贵定位受模拟预算限制。受控粒子在释放轨道后保持暂停，宿主可用 restart 恢复普通播放。

Control 的 ITimeControl 由 Bridge 行为接收：

```ts
return {
  onControlTimeStart() {
    /* 进入控制区间 */
  },
  onControlTime(seconds) {
    /* 应用片段局部时间 */
  },
  onControlTimeStop() {
    /* 离开区间或停止 */
  },
};
```

回调异常隔离；回调改变播放状态后取消失效采样。禁用脚本仍可接收 ITimeControl，普通 onEnable / update 继续遵守组件启用状态。嵌套控制闭环明确报错。

## 场景绘制

MeshFilter / MeshRenderer 使用包内真实三角网格，支持可选顶点色、UV0–UV7、材质纹理 ST 和多 submesh。材质槽依次对应 submesh，多出的槽重复最后一个 submesh；空 Mesh、空槽不绘制。粒子 Renderer 的 None 保留模拟，ShadowsOnly 不绘制颜色。

粒子与普通 Mesh 共用混合、ColorMask、深度测试 / 写入、剔除和 stencil 状态。支持已核验的 SpriteDefault 与 TextureVertexColor 材质配方；SpriteRenderer 支持真实网格、源 UV、颜色、翻转、Simple / Sliced / Tiled、Adaptive 平铺、越界 pivot 和动画；支持 Canvas、Image、UI 遮罩及 Sprite Mask；UI / Sprite 遮罩可与宿主 Pixi stencil mask 组合。任意自定义源 stencil 的组合仍需单独验证。

源 Shader 按程序 SHA-256 自动匹配内置配方，支持已核验的 URP/Particles/Unlit 程序；未知程序或变体由 `checkCompatibility` 明确拒绝。配方保留源混合、深度、剔除、队列和 LightMode 开关，要求提供 `renderEnvironment.globalMipBias`。已核验的 URP/Lit 程序只保存 DepthOnly，不向普通颜色目标绘制，也不补造光照 Pass。

支持 Unity 内置 Default-Particle 纹理及其原生 mip 链，以及 Image / SourceData 中的单部件、无压缩扫描线 RGBA HALF OpenEXR；HDR 以半浮点上传，不裁剪到 8-bit。外部源纹理必须带明确的颜色空间和采样设置；Image 也支持 PNG，ShapeTexture 的 CPU 采样当前仅支持 PNG。Linear 过滤保留已测颜色插值近似，误差见测量文档。源场景组件和动画是否可执行仍分别经过兼容性检查。

Mesh / Sprite Shape 支持静态资产与实例内 Renderer 来源、Vertex / Edge / Triangle 采样、法线偏移、顶点色与扫描；源变换随节点更新，Renderer 启用状态与 Sprite 翻转 / tint 不影响发射。Donut 使用环面采样。Sprite 序列保留源图像与 UV，同图集共享纹理，跨图像按粒子顺序分段绘制。

Shape Texture 支持 RGBA 阈值裁剪、颜色 / Alpha 调制和最近点 / 双线性取色；Mesh / Sprite 使用指定 UV 通道，基本形状使用原生形状映射。CPU 像素按包缓存并在释放包时回收。

Texture Sheet 的 U / V 翻转按粒子独立采样概率；Sprite 在自身图集区域内翻转。UV mask 只控制帧映射，不关闭翻转。已知内置材质不消费的顶点流保留声明，不额外扩展顶点缓冲；源 Shader 的消费规则另行检查。

包内 Camera 支持透视 / 正交、物理投影、五种 Gate Fit、自定义矩阵、viewport、层裁剪、浮点绘制顺序和投影 / 启用动画。宿主提供显示区域，Natsume 用矩阵变换几何：

```ts
const effect = await runtime.instantiate(pack, {
  cameraEnvironment: { targetDisplay: 0, width: 1280, height: 720, mainCameraId: 12 },
});
effect.setCameraEnvironment({ targetDisplay: 0, width: 1920, height: 1080, mainCameraId: 12 });
```

`mainCameraId` 是包内 Camera 组件 ID；单相机或 Embedded 入口可省略。多相机仍按源顺序绘制，需要主视图的功能必须明确选择。ScreenCamera Canvas 优先使用其源 Camera 引用，否则使用选定主相机；World Canvas 可由多个相机观察，Overlay 仅绘制一次。

Skybox 缺少规范化天空盒资源时使用源背景色，并返回诊断。HDR / MSAA / 动态分辨率许可由宿主绘制目标决定，不分配独立相机目标；预检返回 `CAMERA_HOST_RENDER_TARGET`。

Canvas 支持 Overlay / Camera / World；Image 支持 Simple / Sliced / Tiled / Filled、九宫格、径向填充、裁边 Sprite 和 Pixel Perfect。CanvasGroup 处理透明度继承；UIMask 与 RectMask2D 支持嵌套、padding 和 softness。Sprite Mask 对 Sprite / 粒子支持 Inside / Outside、alpha cutoff 和排序范围。

没有包内 Camera 时，屏幕 Canvas 需要宿主提供显示尺寸；Camera 模式另需视图及投影矩阵：

```ts
const canvasEnvironment = {
  displays: { 0: { width: 1280, height: 720 } }, // Pixi 逻辑像素
  mainCamera: {
    viewMatrix, // 列主序，Unity 世界坐标 → 视图坐标
    projectionMatrix, // 列主序，WebGL 裁剪深度 [-1, 1]
    viewport: { x: 0, y: 0, width: 1, height: 1 }, // 左下原点
  },
};
const effect = await runtime.instantiate(pack, { canvasEnvironment });
effect.setCanvasEnvironment(canvasEnvironment); // 整体替换；非法输入不改变当前环境
```

World Canvas 保留源世界布局，沿用 `displayMatrix`；Overlay / Camera 的根布局由显示环境驱动。Sorting Layer 顺序优先读取包内 Renderer 的层 ID 与序号；缺失时使用宿主 `renderEnvironment.sortingLayers`，默认层始终为 0，仍无法确定时明确报错。额外 UI 顶点通道不改变当前已核验、只消费位置 / 颜色 / UV 的无光照配方。

```ts
const renderEnvironment = {
  globalMipBias: 0, // 仅读取该输入的材质需要
  sortingLayers: { [-123456]: -1, 789012: 1 }, // Unity Sorting Layer ID → 排序值
};
const effect = await runtime.instantiate(pack, { canvasEnvironment, renderEnvironment });
effect.setRenderEnvironment(renderEnvironment);
```

排序值越大越晚绘制。映射只补包内缺失的信息，不覆盖已记录的层顺序；输入会拷贝，实例之间独立。`setRenderEnvironment` 整体替换配置，须同时保留仍必需的 mip bias 和层映射；缺少必需输入时保留原配置。

遮罩增加额外绘制：每个受影响的 Sprite / 粒子 pass 前后绘制适用的 Sprite Mask；UIMask 使用进入 / 退出 pass。UI 层级、Sprite Mask 与宿主 Pixi mask 共用 8-bit stencil；存在 Sprite Mask 时保留一位，合计超出容量会报错。

读取全局 mip 偏移的材质要求宿主显式提供输入：

```ts
const effect = await runtime.instantiate(pack, {
  renderEnvironment: { globalMipBias: 0 },
});
effect.setRenderEnvironment({ globalMipBias: -0.5 });
```

偏移单位为 mip 层级，0 使用常规采样层级；setter 替换整个配置。已知无光照配方不消费阴影和光照 / 反射探针，相关设置会给出说明；Natsume 不生成三维光照环境。

## 粒子状态查询

```ts
const particles = effect.getParticles(systemId);
for (const particle of particles) {
  console.log(particle.id, particle.position, particle.velocity);
}
```

返回当前存活粒子的独立快照。位置、速度和尺寸采用 Unity 世界单位，旋转为模拟空间内的弧度；包含当前颜色、年龄、初始寿命和剩余寿命。ID 在该系统内保持到粒子死亡，数组压缩不改变 ID；重播后 ID 重新计数。

宿主检测到碰撞、触发或需要手动发射时，通知源系统的子发射器槽：

```ts
const particle = effect.getParticles(systemId)[0];
if (particle) effect.emitSubEmitter(systemId, slot, particle.id);
effect.emitSubEmitter(systemId, slot); // 对所有存活粒子触发
```

`systemId` 为源 ParticleSystem 组件 ID，`slot` 为源包中的零起始槽序号，空槽不发射。Birth / Death 由运行时自动触发；Collision / Trigger 根据宿主物理查询自动触发，也可与 Manual 一样由宿主通知。失效粒子 ID 或不存在的系统 / 槽会报错。

多个独立根共享子系统时，默认使用稳定调度。Unity 的任务交错可能改变出生年龄及寿命边界的数量，运行时保留 `SHARED_SUB_EMITTER_ORDER` 诊断。宿主可显式指定每个固定步的执行顺序；例如仅含 A、B 和共享子系统的实例：

```ts
const effect = await runtime.instantiate(pack, {
  subEmitterUpdateOrder: [childId, parentAId, childId, parentBId],
});
effect.setSubEmitterUpdateOrder([childId, childId, parentAId, parentBId]);
effect.setSubEmitterUpdateOrder(undefined); // 恢复默认调度
```

数组使用 ParticleSystem 组件 ID，必须包含实例内全部系统；每个系统按可达的独立根数出现，同根重复槽和菱形路径只算一次。停止后多余的共享池更新自动跳过，排空阶段保留一次更新。配置复制后从下一固定步生效，重播保留；不改变预热历史。未知、遗漏或过量 ID 会报错，失败更新保留原配置。NOAP 不包含 Unity 全局任务队列，指定顺序不保证复现其他场景的任务交错。

拖尾历史使用实例共享、可复用的点池：

```ts
const effect = await runtime.instantiate(pack, { maxTrailPoints: 65_536 });
```

`maxTrailPoints` 默认 65,536，包含存活粒子与死亡后残留的历史点。超限时报错，宿主可提高上限；不会静默截断拖尾。拖尾使用 Renderer 的第二材质槽和独立顶点流；该槽为空时不绘制拖尾。

## 粒子绘制环境

Legacy Additive / Alpha Blended 材质需要显式提供环境。普通二维预览可关闭雾效；未提供 `depth` 时使用 `effect.container.zIndex`，负值按零处理：

```ts
const effect = await runtime.instantiate(pack, {
  particleEnvironment: { fog: { mode: 'none' }, gravity: [0, -9.81, 0] },
});
effect.container.zIndex = 10;

// 可在暂停时更新；颜色使用源项目工作色彩空间。
effect.setParticleEnvironment({
  fog: { mode: 'linear', color: [0.5, 0.5, 0.5], start: 5, end: 30 },
  gravity: [0, -9.81, 0],
  viewVelocity: [0, 0, 0],
  depth: 10,
  softParticles: { depthTexture: sceneDepthTexture },
});
```

`gravity` 是宿主提供的 Unity 世界空间加速度，单位与粒子的位置和速度一致；当包中的 `gravityMultiplier` 非零时必须提供它。Natsume 不使用隐含的 Unity 默认重力。

`viewVelocity` 为视图在 Unity 世界空间中的移动速度，单位为每秒；省略时视图静止。更新显示矩阵时，可同步用 `setParticleEnvironment` 更新它，让 Stretched Billboard 计入视图移动。该方法替换整个环境配置，需要一并保留重力等输入。

只改部分字段时使用 `update*Environment`，可读取当前值用 `get*Environment`（Particle / Render / Canvas / Camera 各一组）：

```ts
effect.updateParticleEnvironment({ viewVelocity: [0, 0, 0] }); // 其余字段保持不变
effect.updateParticleEnvironment({ viewPosition: undefined }); // undefined 移除可选字段
const current = effect.getParticleEnvironment(); // 独立副本；宿主对象仍为借用
```

更新是浅合并：`sortingLayers`、`displays`、`rigidbodyVelocities` 等字段按整体替换，校验失败时保留原环境。

预检、实例创建与环境替换使用同一套环境校验规则，包括固定步长、2D 重力、Rigidbody 速度和宿主绑定；即使当前特效暂未使用某个字段，传入的值也必须合法。环境替换会先检查全部输入与当前特效的需求，失败时保留原环境。

`viewPosition` 为视点的 Unity 世界坐标；Facing 对齐和 Freeform Stretch 必须提供，例如 `viewPosition: [0, 0, -10]`。它用于构造粒子的朝向平面与普通 Stretch 的横向，不会自动修改显示矩阵。普通 Stretch 省略该项时使用平行视线近似，并返回诊断。

雾效支持 `none`、`linear`、`exp`、`exp2`。`depth` 也可传 `[a, b, c, d]`，以 Unity 世界坐标计算 `ax + by + cz + d`。当前采用固定 +Z 观察与仿射深度，不提供完整 Unity 相机。

软粒子需要宿主提供背景深度纹理：R 通道存线性观察距离，与粒子 `depth` 使用相同单位；未提供纹理则关闭软粒子。纹理按屏幕左上原点的归一化 UV 采样，可用 `uvTransform: [sx, sy, ox, oy]` 调整。Natsume 借用纹理，由宿主管理其更新和销毁；`zIndex` 仅是默认的逻辑深度，不会生成背景深度图。

2D 重力与 Rigidbody 速度按源设置选择；速度值使用 Unity 世界单位／秒，通过包内宿主槽名绑定：

```ts
effect.setParticleEnvironment({
  fog: { mode: 'none' },
  gravity: [0, -9.81, 0],
  gravity2D: [0, -9.81],
  rigidbodyVelocities: { 'rigidbody-velocity:198043919389829319': [1, 0, 0] },
});
```

槽名可从 `pack.describe().requiredHostInputs` 查询；缺少已声明的 Rigidbody 输入会明确报错。Transform 模式由节点世界位移计算速度；Custom 模式使用包内自定义速度。环境更新会复制向量，后续变化通过 setter 提交。

外部力场通过 `particleEnvironment.forceFields` 绑定；单个引用绑定一个 `ParticleForceField`，世界搜索槽绑定力场数组。`sample(query, out)` 接收世界位置、速度、年龄与步长，将世界加速度写入 `out[0..2]`。引用按对象身份去重。

World 碰撞通过 `particleEnvironment.physicsWorlds` 绑定 `ParticlePhysicsWorld`：`sweepSphere(query, outHits)` 填写碰撞对象、进度、表面点和法线。查询包含 3D/2D、层掩码、动态 / 内部筛选、quality、voxelSize 和 maxShapes。Natsume 执行粒子响应；动态 Collider 的 `applyForce(force, point)` 接收世界空间力和作用点。宿主拥有这些服务与物理对象；查询缓冲仅在调用期间有效。

```ts
const unsubscribe = effect.onParticleCollision((event) => {
  console.log(event.systemId, event.particleId, event.colliderId, event.planeNodeId);
});
unsubscribe();
```

仅启用 Collision Send Messages 的系统派发公开事件；碰撞子发射器独立自动触发。回调在当前粒子步之后派发，异常记录到 diagnostics；回调内停止、重播或销毁会取消本批失效事件。

Trigger 引用通过 `particleEnvironment.colliders` 绑定。Collider 的 `sweepSphere(query)` 判断整步球体扫掠是否相交，包含起点和终点重叠；`overlapSphere(query)` 提供静态重叠。事件使用 `effect.onParticleTrigger(callback)` 订阅，`kind` 为 `inside / outside / enter / exit`，`colliders` 保留源槽号与宿主身份。只有 Callback 派发公开事件；Kill 和 Callback 均自动触发 Trigger 子发射器。

粒子灯光通过 `particleEnvironment.lights[slot]` 绑定宿主模板。模板提供 `color`、`range`、`intensity` 和 `create()`；返回的句柄实现 `update(state)`、`destroy()`。位置和范围使用世界单位，`state` 及其数组只在调用期间有效。Natsume 复用句柄并在粒子死亡、停止清空、替换模板或实例销毁时释放；模板由宿主持有。

Unscaled 粒子使用 `effect.update(dt, { unscaledDeltaSeconds })`；缺少所需时钟会报错。宿主用 `effect.setParticleSystemVisible(systemId, visible)` 提供可见性，默认可见，设置跨重播保留。PauseAndCatchup 需要 `particleEnvironment.fixedDeltaSeconds`（Unity 工程通常为 `0.02`）；Unscaled 固定步按本次缩放 / 未缩放时钟比例计算。停止回调用 `effect.onParticleSystemStopped(callback)` 订阅，也会调用同节点 Bridge 的 `onParticleSystemStopped(event)`；事件包含 `systemId` 和 `nodeId`；激活节点上的禁用 Bridge 组件也会收到回调。Disable 停用所属节点，Destroy 销毁该节点及子层级；`restart()` 恢复节点并重建已销毁的 Bridge 行为。

`effect.play()` 遵守包内自动播放设置。手动系统由宿主或 Bridge 显式启动：

```ts
effect.play();
effect.playParticleSystem(systemId, { withChildren: true });
```

`withChildren` 默认 `true`；传 `false` 仅启动指定系统。调用时实例须在播放中，不激活失活节点，也不接管 Timeline 控制的系统。按 Unity 的实际 `Play` 行为重置发射时间，保留已有粒子，下一模拟步开始发射；重播恢复作者设置，需要手动启动的系统须再次调用。预览用“启动粒子”执行此操作。

## 宿主行为

无需包内存在 C# 组件，宿主可直接给实例添加行为。工厂每次添加时执行一次，只接收当前 `effect`，不提供序列化组件或字段：

```ts
const overlay = effect.addBehavior(({ effect }) => {
  const node = effect.getNode(groupNodeId)!;
  const align = () => {
    const parent = node.parent;
    if (!parent) return;
    const world = node.worldMatrix;
    const origin = parent.worldMatrix;
    const x = world[12]! - origin[12]!;
    const y = world[13]! - origin[13]!;
    const z = world[14]! - origin[14]!;
    const m = effect.displayMatrix;
    node.setRenderOffset({
      x: -(m[0]! * x + m[4]! * y + m[8]! * z),
      y: -(m[1]! * x + m[5]! * y + m[9]! * z),
    });
  };
  const clear = () => node.setRenderOffset(null);
  return { onEnable: align, lateUpdate: align, onDisable: clear, destroy: clear };
});

overlay.setEnabled(false);
overlay.setEnabled(true);
overlay.remove();
```

`groupNodeId` 指要叠加的组根节点；示例抵消该组相对父节点的屏幕平移，保留模拟位置和深度。playground 的 `OverlayView` 将同一计算应用到各最外层可渲染组，已通过 `addBehavior` 的 `lateUpdate` 接入。

行为添加后立即启用，执行 `onEnable`；`setEnabled` 仅在状态改变时执行 `onEnable` / `onDisable`。`remove()` 先禁用再执行 `destroy`，重复移除无效果，之后不能重新启用。实例销毁自动清理行为；`restart()` 保留行为对象和启用状态，不重新执行工厂。暂停、停止不会禁用行为，但不再执行帧回调。`enabled` / `removed` 可读取句柄状态。

播放或排空期间，每帧顺序为：`beforeUpdate` → 动画和粒子模拟 → `update` → 动画字段通知 → `lateUpdate` → 渲染同步。`beforeUpdate` / `lateUpdate` 接收宿主提交的正步长，每帧各执行一次，即使本帧尚未累积到一个模拟固定步。现有 `update` 接收模拟时间实际推进量，仅在推进量大于零时执行；模拟使用固定步并限制积压，因此它与宿主步长可能不同。手动 seek、`evaluate()`、`update(0)` 不执行帧回调。`beforeUpdate` 适合设置本帧输入，`lateUpdate` 适合读取动画后的节点位置并调整显示。

帧回调按添加顺序执行；帧内添加的行为立即启用，从下一帧开始接收帧回调；禁用或移除立即阻止后续回调。回调内暂停、停止、重播或销毁实例会取消当前帧剩余阶段。帧回调不能递归调用 `effect.update()`。

生命周期及帧回调沿用 runtime 的 `scriptErrors`：`isolate` 记录诊断并跳过失败行为后续回调，仍执行销毁清理；`throw` 将异常交给宿主并中断本次操作，宿主可在后续调用中重试。销毁时即使某个清理回调抛错，也会继续清理其他行为。主动调用 `addBehavior` 的工厂错误直接抛出。

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
    return { onEnable: align, lateUpdate: align, onDisable: () => node.setRenderOffset(null) };
  },
);
```

Bridge 同样支持 `beforeUpdate`、`update`、`lateUpdate`，帧阶段与宿主行为一致；启停仍跟随包内节点及组件状态。`setRenderOffset()` 使用特效容器局部坐标，父子偏移相加；传 `null` 清除当前节点的偏移。设置立即生效，重播保留。宿主也可以通过 `effect.getNode(id)` 调用此接口；`effect.renderedNodes` 返回含已启用渲染器组件的节点，包括当前失活的节点。

脚本字段被动画驱动时，第三个参数须声明字段类型：

```ts
runtime.registerScript(
  { assembly: 'Assembly-CSharp', namespace: 'MyGame', className: 'MaterialSettings' },
  ({ fields }) => ({
    onAnimatedField(name, value) {
      if (name === 'mode') updateMaterialMode(value as number);
      // fields 始终包含本实例已声明字段的当前值。
    },
  }),
  { animatedFields: { mode: 'int', intensity: 'float', visible: 'bool' } },
);
```

字段名必须与序列化字段一致，类型为 `float`、`int` 或 `bool`。预检检查声明、原始值及曲线类型，不执行工厂。`fields` 只读、实例间独立，重播恢复原始值后重新采样；`onAnimatedField` 在一次操作结束、绘制前接收各字段最终的变化值。字段声明不实现原 C# 行为，实际效果由宿主回调处理；未声明的脚本动画字段阻止实例化。回调沿用 `scriptErrors` 策略，回调中改变播放状态或销毁实例会取消本批剩余通知。

## 模块支持状态

按 [Unity 2022.3 粒子系统模块](https://docs.unity3d.com/2022.3/Documentation/Manual/ParticleSystemModules.html) 分类如下。以下指 Natsume 的运行能力；包能读取不代表其中的配置都能执行。

### Supported

以下模块的主要行为已实现，仍受下方共享参数限制。

| 模块                      | 支持范围                                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Color over Lifetime       | 生命周期颜色；Blend / Fixed 渐变及双渐变随机插值                                                                                  |
| Size over Lifetime        | 生命周期尺寸；统一或分轴缩放，三轴共用随机插值因子                                                                                |
| Size by Speed             | 速度区间、统一 / 分轴尺寸乘数及四种参数模式                                                                                       |
| Rotation by Speed         | 速度区间、Z / 分轴角速度积分及四种参数模式                                                                                        |
| Animation                 | 平面参数化状态机、过渡 / 中断、多层混合、三种时钟 / 裁剪、已支持绑定、类型化事件与 Bridge                                         |
| Timeline                  | PlayableDirector 四种时钟、三种 wrap；Group / Activation / Animation / Control、片段混合与外插、动态绑定、嵌套控制与 ITimeControl |
| Trails                    | PerParticle / Ribbon、五种纹理模式、颜色 / 宽度 / 寿命、World Space、死亡残留、多 Ribbon 与子发射器分组、独立材质与顶点流         |
| Inherit Velocity          | Initial / Current；Transform / Rigidbody / Custom 发射器速度；Local 空间沿用 Unity 忽略继承的行为                                 |
| Lifetime by Emitter Speed | 出生时按发射器世界速度采样寿命乘数，含零宽区间                                                                                    |
| Force over Lifetime       | Local / World、四种标量参数、稳定或逐帧随机、旋转与非均匀缩放                                                                     |
| Color by Speed            | 速度区间、四种颜色参数、HDR 输入及粒子颜色量化                                                                                    |
| External Forces           | LayerMask / List / LayerMaskAndList；宿主世界空间力场采样、身份去重、动态启用与年龄乘数                                           |
| Triggers                  | Inside / Outside / Enter / Exit、Ignore / Kill / Callback；宿主球体扫掠、三种 Collider 查询、重复槽与自动子发射器                 |
| Lights                    | 宿主模板与独立灯光句柄、随机 / 均匀分配、数量上限、粒子颜色 / 尺寸 / Alpha 与年龄曲线                                             |

速度取样包含重力、Velocity 和 Limit，不包含 Speed Multiplier 与 Noise 位移。零宽区间按 Unity 的端点规则处理。

### Partial

源材质仅支持按程序哈希核验的内置配方；未知程序、未核验的 keyword 变体和任意自定义 Shader 不支持。DepthOnly 程序保留为无前向颜色绘制，不提供完整 URP 光照管线。

| 模块                         | 已支持                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 未支持                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Sub Emitters                 | Birth / Death / 自动 Collision / Trigger、宿主 Manual；概率与五项继承、共享池、重复槽、多级 DAG、连续发射、组合预热                                                                                                                                                                                                                                                                                                                                                                               | 共享池按串行根调度；Unity 并行与全局注册顺序存在差异，返回 `SHARED_SUB_EMITTER_ORDER`；延迟预热例外见下文 |
| Collision                    | Planes 节点 +Y 平面；World 3D/2D 宿主球体扫掠、反弹 / 阻尼 / 寿命 / 杀死速度、半径、层 / 动态 / 内部筛选、Collider Force、碰撞事件及自动子发射器                                                                                                                                                                                                                                                                                                                                                  | Medium / Low 原生体素缓存历史由宿主查询策略决定                                                           |
| Main                         | 循环、初始寿命 / 速度 / 尺寸 / 旋转 / 颜色、旋转翻转、种子；2D / 3D 环境重力、三种发射器速度、启动延迟、Simulation Speed；Local / World / Custom 模拟，Hierarchy / Local / Shape 缩放；有限预热；RingBuffer 两种保留模式、循环范围与替换后延迟 Death；Scaled / Unscaled、StopAction、Automatic / Pause / PauseAndCatchup / AlwaysSimulate 可见性裁剪                                                                                                                                              | duration 至少 1/60 s，容量与预热预算有限                                                                  |
| Emission                     | Rate over Time / Distance、Burst，含正间隔与零间隔无限重复                                                                                                                                                                                                                                                                                                                                                                                                                                        | 短周期重复 Burst 保留已量化的末步计数差异                                                                 |
| Shape                        | Circle、Sphere / Hemisphere、Box 体积 / 壳 / 边、Cone 底面 / 体积、Edge、Rectangle、Mesh Vertex / Edge / Triangle（子网格、法线与顶点色），MeshRenderer / SpriteRenderer 来源；Random / Loop / PingPong / Burst Spread、Spread 量化、位置 / 方向扰动、Align to Direction、Shape TRS                                                                                                                                                                                                               | 其他形状                                                                                                  |
| Rotation over Lifetime       | Z 或分轴角速度、生命周期曲线积分                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 已测范围以外的步长与原生积分差异                                                                          |
| Velocity over Lifetime       | Local / World 线性、轨道 / 偏移 / 径向速度，Speed Multiplier                                                                                                                                                                                                                                                                                                                                                                                                                                      | 复杂空间、非均匀缩放与旋转的所有交叉组合尚未验收                                                          |
| Limit Velocity over Lifetime | Local / World 标量与分轴限速、Dampen、Drag，含尺寸 / 速度乘算                                                                                                                                                                                                                                                                                                                                                                                                                                     | 任意剪切与非均匀缩放组合尚未验收                                                                          |
| Noise                        | 三档实测 Perlin Curl 场与种子偏移；多 octave、Scroll、Remap、位置 / 旋转 / 尺寸影响                                                                                                                                                                                                                                                                                                                                                                                                               | 尺寸及未穷举的参数组合；误差见测量文档                                                                    |
| Texture Sheet Animation      | Grid / 有序 Sprite 帧（可跨纹理）；Lifetime / Speed / FPS；Whole Sheet / Single Row；Fixed / Random 行；MeshIndex 行；UV mask                                                                                                                                                                                                                                                                                                                                                                     |                                                                                                           |
| Custom Data                  | Custom1 / Custom2 Vector（1–4 维）与 Color                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 已知材质只消费 Custom1.x，其余分量保留为求值数据                                                          |
| Renderer                     | Billboard、Horizontal / Vertical Billboard、普通 / Freeform Stretch；View / World / Local / Facing / Velocity 对齐；多 Mesh、均匀 / 加权选择；多材质叠加、实例内 Render Queue 交错与系统深度排序（第二槽保留给 Trails）；每个 Mesh 使用单 submesh；None / Distance / Oldest / Youngest / Depth 排序；Pivot、Flip、尺寸限制、allowRoll；ParticleAddAlpha、ParticleUnlit、Legacy Additive / Alpha Blended、雾效与软粒子；None、空材质、顶点色 / 多 UV、共享 Pass 状态、Sprite Mask Inside / Outside | 其他材质模型；已知无光照材质不消费 normalDirection                                                        |

普通 Stretched Billboard 的三维长度使用完整速度，横向使用速度与视点射线的叉积，投影视图平面后归一化；省略 `viewPosition` 时保留平行视线近似。Freeform Stretch 面向 `viewPosition`，沿完整相对速度拉伸，支持 `rotateWithStretchDirection` 开关；速度与视线平行时采用稳定朝向，不复现 Unity 的浮点朝向抖动。

粒子内部排序使用仿射显示矩阵，Distance 与 Depth 均按变换后的 Z 深度排序；Oldest / Youngest 将指定年龄的粒子绘制在前方。

实例内先绘制不透明队列（≤2500），再绘制透明队列；每个阶段依次比较 Sorting Layer、Order 和 Render Queue。透明队列按系统世界包围盒中心的视图深度从远到近绘制；不透明队列先按材质分组，同材质从近到远绘制。`sortingFudge` 以世界单位加到系统排序深度，负值表示更近；粒子移动或显示矩阵变化时重新排序。完全同序的 pass 保留组件与材质槽顺序。

Unity 临时材质对象 ID 不在 NOAP 中；同队列不透明材质分组使用包内材质声明逆序，预检返回 `OPAQUE_MATERIAL_IDENTITY` 说明该身份边界。宿主仍通过特效容器控制不同实例及其他 Pixi 对象的顺序。

三层预热与启动延迟组合可能令 Unity 2022.3 停滞；Natsume 按已确认规则继续播放，并返回 `DELAYED_GRAPH_PREWARM`。共享池保留同根去重、独立根分别推进的关系；跨实例原生调度差异和已测误差见 [Unity 行为对照](tools/unity-probe/MEASUREMENTS.md)。

预热限循环系统，按完整周期覆盖寿命上界；曲线使用 Hermite 控制点包络估计上界。每发射器最多 36,000 步 / 1000 万容量步，实例总计最多 4000 万容量步。

两种 Stretch 均使用 `粒子速度 - viewVelocity × cameraVelocityScale`；零相对速度时不产生可见面积。Freeform 的合成拉伸长度取绝对值，普通 Stretch 保留负长度方向。

共享参数支持 Constant / Two Constants / Curve / Two Curves，以及 Step / Linear / Hermite / Weighted Bezier 曲线、Blend / Fixed / Perceptual Blend 渐变。Unity 内部循环码已核对 `0 / 1 / 2 / 3 / 4 / 5 / 8`，其他有效分支中的编码会报告不支持。随机分布比较统计量；Noise 的同种子场与轨迹已按实测范围核对，误差见 [Unity 行为对照](tools/unity-probe/MEASUREMENTS.md)。

### Unsupported

| 模块          | 未实现行为                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Timeline 扩展 | Audio、Signal / Marker、自定义轨道 / Playable、Infinite Clip、AvatarMask、prefab 实例化、自定义属性动画与非默认 clip-end action |
| Animator 扩展 | Avatar / Root Motion、IK / Mirror、AvatarMask、同步层、BlendTree、OverrideController、嵌套状态机、StateMachineBehaviour         |

## 开发与预览

需要 Node.js 24 或更新版本，以及 `package.json` 指定版本的 pnpm。在项目根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm dev
```

打开终端显示的本地地址，选择 `.noap` 文件即可预览。文件在浏览器本地读取。

包需要脚本动画字段时，先用“Bridge 声明”导入 JSON，再选择 `.noap`。例如：

```json
[
  {
    "identity": {
      "assembly": "Assembly-CSharp",
      "namespace": "MyGame",
      "className": "MaterialSettings"
    },
    "animatedFields": { "mode": "int" }
  }
]
```

预览只记录字段变化，不执行原游戏逻辑。更换声明需刷新页面；正式行为通过 TypeScript Bridge 注册。预览显式使用静止 Rigidbody、无雾和关闭软粒子的环境。

缺少项目排序层信息时，用“排序层”导入 ID 到排序值的 JSON 映射，例如 `{"-123456": 2}`；不自动猜测未知层的顺序。

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

[Unity 探针](tools/unity-probe/README.md) 与性能脚本位于 `tools/`，普通构建和测试无需安装 Unity。

## 许可证

本项目采用 [Apache License 2.0](LICENSE) 许可证。第三方资源保留其原有授权。
