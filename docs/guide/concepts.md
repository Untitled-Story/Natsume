# 核心概念

## 三类对象

| 对象             | 创建方式                                        | 职责                                                                                    |
| ---------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| `EffectPack`     | `loadPack()`                                    | 资源包的只读数据：节点、组件、动画、材质、纹理和网格。不依赖渲染器，也不持有 GPU 资源。 |
| `NatsumeRuntime` | `app.natsume` 或 `new NatsumeRuntime(renderer)` | 绑定一个 Pixi 渲染器。管理实例共享的纹理缓存和 Script Bridge 注册。                     |
| `EffectInstance` | `runtime.instantiate(pack, options)`            | 一次播放。持有模拟状态、Pixi 容器、动画和粒子，由宿主推进时间。                         |

它们的关系如下：

```text
loadPack() ──► EffectPack ──┐
                            ├─► runtime.instantiate() ──► EffectInstance ──► container（Pixi Container）
Pixi Application ──► NatsumeRuntime ─┘
```

- 一个包可以创建多个互相独立的实例。
- 一个 Pixi `Application` 对应一个运行时。同一个运行时下的实例共享纹理，Script Bridge 的注册也只需做一次。
- 需要操作实例内部的对象时，通过实例取得句柄：`getNode()` 返回节点，`getAnimator()` 返回 Animator 句柄，`getDirector()` 返回 Director 句柄。句柄在 `restart()` 之后仍然有效，实例销毁后失效。

## 宿主与库的分工

Natsume 把"模拟和绘制"与"决定怎么摆放和驱动"分开。库负责前者，宿主负责后者。

库负责：

- 读取资源包，检查兼容性。
- 模拟粒子、动画和 Timeline。
- 把结果绘制到实例的 Pixi 容器里。
- 把包内的 MonoBehaviour 序列化数据交给 Script Bridge。

宿主负责：

- 把 `effect.container` 放进场景，并决定位置、缩放和裁剪。
- 每帧调用 `effect.update()` 推进时间。
- 提供重力、雾效、显示尺寸、视图矩阵等环境输入。
- 持有并释放自己提供的对象，例如软粒子所需的深度纹理、物理查询服务和灯光模板。Natsume 只借用它们。
- 实现自定义脚本的行为。Natsume 不运行 C#，也不猜测游戏专属的逻辑。

缺少的输入不会被默认值悄悄补上。比如粒子的重力倍率不为零时，宿主必须提供 `gravity`，Natsume 不使用隐含的 Unity 默认重力。

## 能力验证的几个层次

一个 Unity 特性是否可用，要分开看四件事：

1. Noa 能否把它编译进资源包。
2. Natsume 能否读取这份数据。
3. Natsume 能否执行它。
4. 画面是否与 Unity 一致。

"能读取"不代表"能执行"。已知但尚未实现的能力会在预检和实例化时被明确阻止；近似行为会附带说明和已测的误差范围。判断某项功能是否可用，以[支持范围](/reference/support)为准。

## 时间

Natsume 没有自己的时钟，所有模拟都由 `effect.update(seconds)` 推进。

- 普通动画按 1/60 秒的固定步采样，然后推进粒子。
- 使用 Unscaled 时间的粒子和动画需要宿主传入 `unscaledDeltaSeconds`。
- 使用 AnimatePhysics 的 Animator 需要宿主传入本帧的物理步 `physicsSteps`。
- 只有活动的对象实际用到某种时钟时，才要求对应的参数，缺少时会报错。

细节见[播放与更新](/guide/playback)。

## 坐标

- 粒子的位置、速度和尺寸使用 Unity 世界单位。
- 节点的世界矩阵也是 Unity 世界空间的矩阵。
- 绘制时，实例通过显示矩阵把世界坐标变换到 `effect.container` 的局部坐标。默认的显示矩阵把 Unity 的 +Y 翻转为 Pixi 向下的 Y 轴，一个世界单位对应一个像素。
- `effect.worldToContainer([x, y, z])` 和 `node.containerPosition` 提供这一换算，宿主不需要自己做矩阵运算。

## 标识符

资源包里的对象用数字 ID 标识，包括节点、组件和入口。粒子系统、Animator、Director 等接口都以组件 ID 为参数。获取 ID 的方式有两种：

```ts
// 在包里按路径和类型查找
const spark = pack.findNodesByPath('Root/Effect/Spark')[0]!;
const system = pack.findComponents('ParticleSystem', spark.id)[0]!;

// 在实例里列出
effect.particleSystems; // [{ id, nodeId, timelineControlled }]
```

详见[加载与预检](/guide/loading-packs#查找节点和组件)。

## 生命周期与所有权

| 对象   | 释放方式            | 说明                                                             |
| ------ | ------------------- | ---------------------------------------------------------------- |
| 实例   | `effect.destroy()`  | 释放实例的 GPU 资源，并清理宿主行为和 Bridge 行为。              |
| 资源包 | `pack.dispose()`    | 清空包内缓存的文件、网格和解码后的像素。之后再访问包数据会报错。 |
| 运行时 | `runtime.destroy()` | 销毁所有未释放的实例。通过插件创建的运行时随应用销毁。           |
