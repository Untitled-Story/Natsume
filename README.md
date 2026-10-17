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

包含已支持 Noise 配置的特效，需要在实例化时显式传入 `{ approximateNoise: true }` 以允许 Curl Noise 近似。

不再使用时，解除更新回调并释放资源：

```ts
app.ticker.remove(tick);
effect.destroy();
pack.dispose();
app.destroy();
```

扩展为每个 Application 创建独立运行时，并随应用销毁；同一应用的实例共享纹理与 Bridge 注册。扩展不自动推进模拟，由宿主调用 `effect.update()`。注册需要在 `app.init()` 前完成，且应用必须使用 WebGL2。

也可以通过 `new NatsumeRuntime(renderer)` 手动管理运行时。当前包为私有 workspace 包，尚未发布到 npm。

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
  depth: 10,
  softParticles: { depthTexture: sceneDepthTexture },
});
```

`gravity` 是宿主提供的局部加速度，单位与粒子的位置和速度一致；当包中的 `gravityMultiplier` 非零时必须提供它。Natsume 不使用隐含的 Unity 默认重力。

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

| 模块                         | 已支持                                                                                                                                                                  | 未支持                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Main                         | 循环、初始寿命 / 速度 / 尺寸 / 旋转 / 颜色、种子；Local 模拟与缩放；有限预热                                                                                            | 重力、启动延迟、旋转翻转；World / Custom 模拟、Hierarchy / Shape 缩放；非 1 的 Simulation Speed |
| Emission                     | Rate over Time、Burst（含正间隔无限重复）                                                                                                                               | Rate over Distance；零间隔无限 Burst                                                            |
| Shape                        | Circle、Sphere / Hemisphere、Box 体积 / 壳 / 边、Cone 底面 / 体积、Edge；随机弧、Burst Spread、位置 / 方向扰动、Shape TRS                                               | 其他形状、Align to Direction、Loop / PingPong 扫描、Spread 量化                                 |
| Rotation over Lifetime       | Z 或分轴角速度、生命周期曲线积分                                                                                                                                        | 已测范围以外的步长与原生积分差异                                                                |
| Velocity over Lifetime       | Local 线性 / 轨道 / 径向速度、Speed Multiplier                                                                                                                          | World 空间                                                                                      |
| Limit Velocity over Lifetime | Local 标量限速、Dampen                                                                                                                                                  | 分轴限速、World 空间、Drag                                                                      |
| Noise                        | 显式启用的 Curl Noise 近似：High、1 octave、仅位置扰动                                                                                                                  | 其他 Quality、多 octave、Scroll、Remap、旋转 / 尺寸扰动；Unity 同种子轨迹                       |
| Texture Sheet Animation      | Lifetime、Whole Sheet、UV0                                                                                                                                              | Single Row、Speed / FPS 时间模式、Sprites 模式、其他 UV 通道                                    |
| Custom Data                  | Custom1.x Vector                                                                                                                                                        | 完整 Vector / Color、Custom2                                                                    |
| Renderer                     | World / 固定 +Z View Billboard、有限 Stretched Billboard、World / View 单 Mesh 与单材质；ParticleAddAlpha、ParticleUnlit、Legacy Additive / Alpha Blended、雾效与软粒子 | 其他对齐方式、横 / 竖 Billboard、粒子排序、Pivot / Flip、最小尺寸、多 Mesh / 材质、其他材质模型 |

预热限循环系统、Constant / Two Constants 寿命，按完整周期覆盖最大寿命；每发射器最多预模拟 30 秒，并限制总计算量。曲线寿命预热暂不支持。

Stretched Billboard 仅支持非 Freeform、`rotateWithStretchDirection=true`、`cameraVelocityScale=velocityScale=0`；按 Unity +Z 观察及 XY 速度平面计算。

共享参数支持 Constant / Two Constants / Curve / Two Curves，以及归一化时间下的 Step / Linear / 非加权 Hermite 曲线；不支持加权曲线、Perceptual Blend 渐变。Unity 原始内部循环码仅支持已核对的 `2`（钳制）。随机分布与 Noise 不复现 Unity 原生随机序列，误差见 [Unity 行为对照](tools/unity-probe/MEASUREMENTS.md)。

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
