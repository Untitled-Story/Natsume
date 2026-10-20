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

支持单层、无过渡 Animator 的 NodeActive 多关键帧轨道，包括零时长初始化、循环、末帧停留、非负状态速度和 `[0,1]` 内的 cycle offset。偏移只作用于循环片段；`effect.playAnimatorState(animatorId, stateIdOrName)` 从起点重新播放状态。

动画按 1/60 s 固定步先采样，再推进粒子；暂停、停止排空和过载丢弃的时间不推进动画。`setNodeActive` 立即生效，下一个固定步可被动画覆盖。入口 ApplyClip 只应用起点，PlayClip 持续播放。

Transform、布局、粒子 / 材质动画和事件派发尚未实现；不支持倒放、多层混合、状态过渡及禁用 Animator 时写回默认值。新增必需能力仍会明确拒绝加载。

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

`viewPosition` 为视点的 Unity 世界坐标；Facing 对齐和 Freeform Stretch 必须提供，例如 `viewPosition: [0, 0, -10]`。它用于构造粒子的朝向平面与普通 Stretch 的横向，不会自动修改显示矩阵。普通 Stretch 省略该项时使用平行视线近似，并返回诊断。

雾效支持 `none`、`linear`、`exp`、`exp2`。`depth` 也可传 `[a, b, c, d]`，以 Unity 世界坐标计算 `ax + by + cz + d`。当前采用固定 +Z 观察与仿射深度，不提供完整 Unity 相机。

软粒子需要宿主提供背景深度纹理：R 通道存线性观察距离，与粒子 `depth` 使用相同单位；未提供纹理则关闭软粒子。纹理按屏幕左上原点的归一化 UV 采样，可用 `uvTransform: [sx, sy, ox, oy]` 调整。Natsume 借用纹理，由宿主管理其更新和销毁；`zIndex` 仅是默认的逻辑深度，不会生成背景深度图。

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

## 模块支持状态

按 [Unity 2022.3 粒子系统模块](https://docs.unity3d.com/2022.3/Documentation/Manual/ParticleSystemModules.html) 分类：Supported 2 项、Partial 10 项、Unsupported 12 项。以下指 Natsume 的运行能力；包能读取不代表其中的配置都能执行。

### Supported

以下模块的主要行为已实现，仍受下方共享参数限制。

| 模块                | 支持范围                                           |
| ------------------- | -------------------------------------------------- |
| Color over Lifetime | 生命周期颜色；Blend / Fixed 渐变及双渐变随机插值   |
| Size over Lifetime  | 生命周期尺寸；统一或分轴缩放，三轴共用随机插值因子 |

### Partial

| 模块                         | 已支持                                                                                                                                                                                                                                                                                                                                                                                                                | 未支持                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Main                         | 循环、初始寿命 / 速度 / 尺寸 / 旋转 / 颜色、旋转翻转、种子；环境重力、启动延迟、Simulation Speed；Local / World / Custom 模拟，Hierarchy / Local / Shape 缩放；有限预热                                                                                                                                                                                                                                               | duration 需至少 1/60 s；容量与预热预算有限         |
| Emission                     | Rate over Time / Distance、Burst，含正间隔与零间隔无限重复                                                                                                                                                                                                                                                                                                                                                            | 短周期重复 Burst 保留已量化的末步计数差异          |
| Shape                        | Circle、Sphere / Hemisphere、Box 体积 / 壳 / 边、Cone 底面 / 体积、Edge；Random / Loop / PingPong / Burst Spread、Spread 量化、位置 / 方向扰动、Align to Direction、Shape TRS                                                                                                                                                                                                                                         | 其他形状                                           |
| Rotation over Lifetime       | Z 或分轴角速度、生命周期曲线积分                                                                                                                                                                                                                                                                                                                                                                                      | 已测范围以外的步长与原生积分差异                   |
| Velocity over Lifetime       | Local / World 线性、轨道 / 偏移 / 径向速度，Speed Multiplier                                                                                                                                                                                                                                                                                                                                                          | 复杂空间、非均匀缩放与旋转的所有交叉组合尚未验收   |
| Limit Velocity over Lifetime | Local / World 标量与分轴限速、Dampen、Drag，含尺寸 / 速度乘算                                                                                                                                                                                                                                                                                                                                                         | 任意剪切与非均匀缩放组合尚未验收                   |
| Noise                        | 三档实测 Perlin Curl 场与种子偏移；多 octave、Scroll、Remap、位置 / 旋转 / 尺寸影响                                                                                                                                                                                                                                                                                                                                   | 尺寸及未穷举的参数组合；误差见测量文档             |
| Texture Sheet Animation      | Grid；Lifetime / Speed / FPS；Whole Sheet / Single Row；Fixed / Random 行；MeshIndex 行；UV mask                                                                                                                                                                                                                                                                                                                      | Sprites 模式；已知材质仅采样 UV0                   |
| Custom Data                  | Custom1 / Custom2 Vector（1–4 维）与 Color                                                                                                                                                                                                                                                                                                                                                                            | 已知材质只消费 Custom1.x，其余分量保留为求值数据   |
| Renderer                     | Billboard、Horizontal / Vertical Billboard、普通 / Freeform Stretch；View / World / Local / Facing / Velocity 对齐；多 Mesh、均匀 / 加权选择；多材质叠加、实例内 Render Queue 交错与系统深度排序（第二槽保留给 Trails）；每个 Mesh 使用单 submesh；None / Distance / Oldest / Youngest / Depth 排序；Pivot、Flip、尺寸限制、allowRoll；ParticleAddAlpha、ParticleUnlit、Legacy Additive / Alpha Blended、雾效与软粒子 | 其他材质模型；已知无光照材质不消费 normalDirection |

普通 Stretched Billboard 的三维长度使用完整速度，横向使用速度与视点射线的叉积，投影视图平面后归一化；省略 `viewPosition` 时保留平行视线近似。Freeform Stretch 面向 `viewPosition`，沿完整相对速度拉伸，支持 `rotateWithStretchDirection` 开关；速度与视线平行时采用稳定朝向，不复现 Unity 的浮点朝向抖动。

粒子内部排序使用仿射显示矩阵，Distance 与 Depth 均按变换后的 Z 深度排序；Oldest / Youngest 将指定年龄的粒子绘制在前方。

实例内先绘制不透明队列（≤2500），再绘制透明队列；每个阶段依次比较 Sorting Layer、Order 和 Render Queue。透明队列按系统世界包围盒中心的视图深度从远到近绘制；不透明队列先按材质分组，同材质从近到远绘制。`sortingFudge` 以世界单位加到系统排序深度，负值表示更近；粒子移动或显示矩阵变化时重新排序。完全同序的 pass 保留组件与材质槽顺序。

Unity 临时材质对象 ID 不在 NOAP 中；同队列不透明材质分组使用包内材质声明逆序，预检返回 `OPAQUE_MATERIAL_IDENTITY` 说明该身份边界。宿主仍通过特效容器控制不同实例及其他 Pixi 对象的顺序。

预热限循环系统，按完整周期覆盖寿命上界；曲线使用 Hermite 控制点包络估计上界。每发射器最多 36,000 步 / 1000 万容量步，实例总计最多 4000 万容量步。

两种 Stretch 均使用 `粒子速度 - viewVelocity × cameraVelocityScale`；零相对速度时不产生可见面积。Freeform 的合成拉伸长度取绝对值，普通 Stretch 保留负长度方向。

共享参数支持 Constant / Two Constants / Curve / Two Curves，以及 Step / Linear / Hermite / Weighted Bezier 曲线、Blend / Fixed / Perceptual Blend 渐变。Unity 内部循环码已核对 `0 / 1 / 2 / 3 / 4 / 5 / 8`，其他有效分支中的编码会报告不支持。随机分布比较统计量；Noise 的同种子场与轨迹已按实测范围核对，误差见 [Unity 行为对照](tools/unity-probe/MEASUREMENTS.md)。

### Unsupported

| 模块                      | 未实现行为             |
| ------------------------- | ---------------------- |
| Inherit Velocity          | 继承发射器速度         |
| Lifetime by Emitter Speed | 根据发射器速度设置寿命 |
| Force over Lifetime       | 生命周期内施加力       |
| Color by Speed            | 根据速度改变颜色       |
| Size by Speed             | 根据速度改变尺寸       |
| Rotation by Speed         | 根据速度改变旋转速度   |
| External Forces           | 外部力场               |
| Collision                 | 平面及场景碰撞         |
| Triggers                  | 碰撞区域检测与事件     |
| Sub Emitters              | 由粒子事件触发子发射器 |
| Lights                    | 粒子灯光               |
| Trails                    | 粒子拖尾与带状连接     |

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

[Unity 探针](tools/unity-probe/README.md) 与性能脚本位于 `tools/`，普通构建和测试无需安装 Unity。

## 许可证

本项目采用 [Apache License 2.0](LICENSE) 许可证。第三方资源保留其原有授权。
