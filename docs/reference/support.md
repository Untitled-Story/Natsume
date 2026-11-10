# 支持范围

Natsume 目前能执行的 Unity 功能按 [Unity 2022.3 粒子系统模块](https://docs.unity3d.com/2022.3/Documentation/Manual/ParticleSystemModules.html)，指的是 Natsume 的运行能力。包能够被读取，不代表其中的所有配置都能执行。

判断某个包能否运行，以[兼容性预检](/guide/loading-packs#兼容性预检)的结果为准。表格描述的是整体范围，预检才检查具体的配置。

## 已支持

这些模块的主要行为已实现，仍受后文的共享参数限制。

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

## 部分支持

源材质只支持按程序哈希核验的内置配方。未知的程序、未核验的 keyword 变体和任意自定义 Shader 不支持。DepthOnly 程序保留为没有前向颜色绘制，不提供完整的 URP 光照管线。

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
| Custom Data                  | Custom1 / Custom2 Vector（1 至 4 维）与 Color                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 已知材质只消费 Custom1.x，其余分量保留为求值数据                                                          |
| Renderer                     | Billboard、Horizontal / Vertical Billboard、普通 / Freeform Stretch；View / World / Local / Facing / Velocity 对齐；多 Mesh、均匀 / 加权选择；多材质叠加、实例内 Render Queue 交错与系统深度排序（第二槽保留给 Trails）；每个 Mesh 使用单 submesh；None / Distance / Oldest / Youngest / Depth 排序；Pivot、Flip、尺寸限制、allowRoll；ParticleAddAlpha、ParticleUnlit、Legacy Additive / Alpha Blended、雾效与软粒子；None、空材质、顶点色 / 多 UV、共享 Pass 状态、Sprite Mask Inside / Outside | 其他材质模型；已知无光照材质不消费 normalDirection                                                        |

### 共享参数

共享参数支持 Constant、Two Constants、Curve、Two Curves，以及 Step、Linear、Hermite、Weighted Bezier 曲线，Blend、Fixed、Perceptual Blend 渐变。

Unity 内部的循环码已核对 `0`、`1`、`2`、`3`、`4`、`5`、`8`，其他有效分支中的编码会报告不支持。随机分布比较统计量，Noise 的同种子场和轨迹按实测范围核对，误差见 [Unity 行为差异](/reference/unity-differences)。

### Renderer 细节

- 普通 Stretched Billboard 的三维长度使用完整速度，横向使用速度与视点射线的叉积，投影到视图平面后归一化。省略 `viewPosition` 时保留平行视线近似。
- Freeform Stretch 面向 `viewPosition`，沿完整的相对速度拉伸，支持 `rotateWithStretchDirection` 开关。速度与视线平行时使用稳定的朝向，不复现 Unity 的浮点朝向抖动。
- 两种 Stretch 都使用 `粒子速度 - viewVelocity × cameraVelocityScale`，相对速度为零时不产生可见面积。Freeform 的合成拉伸长度取绝对值，普通 Stretch 保留负长度的方向。
- 粒子内部排序使用仿射显示矩阵，Distance 与 Depth 都按变换后的 Z 深度排序。Oldest 与 Youngest 把指定年龄的粒子绘制在前方。
- 实例内的绘制顺序见[场景绘制](/guide/rendering#绘制顺序)。

### 预热

- 预热只用于有限循环的系统，按完整周期覆盖寿命上界。曲线使用 Hermite 控制点包络估计上界。
- 每个发射器最多 36,000 步和 1000 万容量步，整个实例最多 4000 万容量步。
- 三层预热与启动延迟的组合可能让 Unity 2022.3 停滞，Natsume 按已确认的规则继续播放，并返回 `DELAYED_GRAPH_PREWARM`。
- 共享池保留同根去重、独立根分别推进的关系。跨实例的原生调度差异和已测误差见 [Unity 行为差异](/reference/unity-differences)。

## 不支持

| 模块          | 未实现行为                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Timeline 扩展 | Audio、Signal / Marker、自定义轨道 / Playable、Infinite Clip、AvatarMask、prefab 实例化、自定义属性动画与非默认 clip-end action |
| Animator 扩展 | Avatar / Root Motion、IK / Mirror、AvatarMask、同步层、BlendTree、OverrideController、嵌套状态机、StateMachineBehaviour         |

这些功能当前没有实现。需要它们的包是否能运行，以预检结果为准。
