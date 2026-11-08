# Unity Probe

Unity Probe 用本地 Unity Editor 测量曲线、粒子和网格行为，为 Natsume 提供对照数据。它是开发辅助工具，Natsume 的构建和普通测试不需要 Unity 或 C# 工具链。

```text
合成测试场景 → Unity Editor → 数值记录 → Natsume 回归测试
```

## 使用

需要已激活的 Unity **2022.3.21f1**、Node.js 24 或更新版本，以及项目的 pnpm 依赖。在仓库根目录运行：

```sh
export UNITY_EDITOR=/Applications/Unity/Hub/Editor/2022.3.21f1/Unity.app/Contents/MacOS/Unity
pnpm probe:unity
```

Editor 默认许可证通道与 Hub 不一致时，可用 `UNITY_LICENSING_IPC` 指定已运行 Hub 的通道名称；不复制或修改许可证。探针关闭 UPM，避免无关包解析影响测量。

默认测量曲线与 Noise。其他模式每次选择一个：

```sh
pnpm probe:unity --sub-emitters # 子发射器继承、触发时序、Burst 与连续发射
pnpm probe:unity --sub-emitters --playback # 实际 Play 的预热、分支和启动延迟
pnpm probe:unity --sub-emitters --shared # 实际 Play 的共享目标、重复槽与停止行为
pnpm probe:unity --sub-emitters --shared --single # 独立进程重复检查同一共享案例
pnpm probe:unity --sub-emitters --shared --job-workers 0 --update-fixtures # 串行共享目标对照
pnpm probe:unity --sub-emitters --shared --job-workers 0 --trace-order --update-fixtures # 同时记录原生执行顺序
pnpm probe:unity --trails       # 拖尾几何、纹理模式、宽度颜色与死亡边界
pnpm probe:unity --animator-controller # 参数、状态选路、过渡 / 中断与多层混合
pnpm probe:unity --animator-playback # 实际 Play 时钟、可见性、裁剪与事件
pnpm probe:unity --animation    # 动画时钟、循环与多关键帧曲线
pnpm probe:unity --particle-modules # 力、速度颜色、速度继承、发射器速度寿命与随机统计
pnpm probe:unity --external-forces # 力场过滤、列表合并、局部坐标与年龄乘数
pnpm probe:unity --particle-collisions # 平面 / World 反弹、阻尼、寿命与初始穿透
pnpm probe:unity --collider-force # 实际 Play 的刚体受力、尺寸 / 速度 / 角度乘数
pnpm probe:unity --particle-triggers # 实际 Play 的事件帧、Kill、Collider 查询与子发射器
pnpm probe:unity --particle-lights # 实际 Play 的颜色、范围、强度和年龄曲线像素
pnpm probe:unity --light-distribution # 灯光分配、数量限制、死亡补位与随机统计
pnpm probe:unity --ring-buffer # 环形年龄、循环范围、重力 / Force 与替换后 Death 位置
pnpm probe:unity --ring-playback # 实际 Play 环形计数、年龄与延迟 Death 事件帧
pnpm probe:unity --renderer-shapes # Renderer 来源、模拟空间、动态变换、缩放和 Sprite 翻转
pnpm probe:unity --mesh-shapes # Mesh 发射、子网格、顶点色、扫描与退化几何
pnpm probe:unity --particle-clocks # Scaled / Unscaled、timeScale=0 与 Simulation Speed
pnpm probe:unity --particle-main # StopAction、停止 / 清空、子系统和残留拖尾
pnpm probe:unity --particle-culling --realtime --validation # timeScale=0 / 0.25 / 1 / 2 独立验证
pnpm probe:unity --particle-culling --realtime # 普通 Play 的四种裁剪模式
pnpm probe:unity --particle-culling # 相机离屏 / 恢复与物理固定步长扫描
pnpm probe:unity --events       # 类型化事件、循环端点与启停顺序
pnpm probe:unity --boundaries   # 发射、运动、外观与 BakeMesh 边界
pnpm probe:unity --random       # 随机分布与参数相关性
pnpm probe:unity --shape        # 位置扰动与 Burst Spread
pnpm probe:unity --basic-shapes     # 基础 Shape 区域、厚度、初速度分布
pnpm probe:unity --shape-textures   # 纹理 UV、裁剪、颜色与批次边界
pnpm probe:unity --uv-flips         # 逐粒子 UV 翻转、图集区域、mask 与频率
pnpm probe:unity --cameras          # 源相机投影、清屏、层裁剪、多相机与 Canvas
pnpm probe:unity --source-materials # 源程序公式、LightMode、内置纹理与 HDR 采样
pnpm probe:unity --rotation-prewarm  # 生命周期旋转、预热窗口和首次更新余量
pnpm probe:unity --rect-layout  # 有符号 RectTransform 布局
pnpm probe:unity --noise-statistics # Noise 总体统计、三档首步位置、滚动轨迹、旋转与尺寸
pnpm probe:unity --custom-data  # 两组自定义流的 Vector / HDR Color
pnpm probe:unity --noise-options # Noise 参数行为与渲染尺寸
pnpm probe:unity --sweeps       # Shape 时间扫描、量化与方向对齐
pnpm probe:unity --spaces       # 模拟空间、世界重力与线性速度
pnpm probe:unity --stretch      # 拉伸长度、粒子速度与移动视图
pnpm probe:unity --meshes       # 多 Mesh、队列 / 系统排序、原生雾效 / 场景深度像素与 submesh 限制
pnpm probe:unity --canvas       # 三种 Canvas 布局、视口、像素与 Pixel Perfect
pnpm probe:unity --images       # Image 填充、裁边网格、平铺顶点上限
pnpm probe:unity --ui-masks     # 嵌套 UI 遮罩、软裁切与 CanvasGroup
pnpm probe:unity --sub-emitters --transforms --update-fixtures # 非均匀缩放 / 三维旋转与子发射器继承
pnpm probe:unity --sub-emitters --shared --case 52 --job-workers 0 --update-fixtures # 独立注册对照；单独保存，不覆盖完整组
pnpm probe:unity --sprite-masks # Sprite / 粒子遮罩、阈值、排序范围
pnpm probe:unity --sprite-shapes # Sprite placement、空引用、Donut 分布与扫描
pnpm probe:unity --sprite-rendering # Sprite 翻转、pivot、九宫格、连续 / Adaptive 平铺
pnpm probe:unity --sprite-sheets # Sprite 序列帧时间边界、几何缩放与 UV
pnpm probe:unity --scene-materials # 普通 Mesh、submesh 槽、Pass 状态、UV 与 mip 偏移
pnpm probe:unity --sorting      # 透明粒子索引顺序
pnpm probe:unity --compatibility # 加权曲线、渐变、限速与序列帧
pnpm probe:unity --noise-fit    # 执行本地提供的 Noise 采样输入
pnpm probe:unity --prefab-layout # 原始 prefab 布局
```

脚本将 `project/` 模板复制到仓库的 `data/unity-probe/` 后运行。该目录是专用临时工程，请勿放入业务工程。测量结果和 Editor 日志写入 `data/unity-baselines/`，均由 Git 忽略。部分模式需要图形设备。UI 探针从指定 Editor 安装中复制 UGUI Runtime 到忽略的临时工程；不分发 Unity 源码。

`--source-materials` 将已核对的 Metal 程序公式翻译成 ShaderLab，测量 Gamma / Linear、Surface、混合、HDR 材质色和 LightMode 选择；不直接执行原始编译程序。内置纹理从 Unity 原生资源读取；HDR 另将原始 ASTC 压缩字节直接上传，避免将 EXR 导入器处理混入采样误差。

原始 HDR 对照另设 `NATSUME_SOURCE_HDR` 为恢复的 EXR 绝对路径；EXR 所在目录的上一级放置同名 `.texture.bin` / `.texture.json`，保存原始压缩数据与 Texture2D 元数据。缺少这些输入时探针仍测合成 HALF 纹理，完整源材质浏览器验收则要求原始 ASTC 记录。内置纹理另测 7 级 mip，以及两种颜色空间、三种尺寸和三种 mip bias 的 18 组采样。

`--noise-fit` 需要先准备 `data/unity-baselines/noise-fit-input.json`。`--prefab-layout` 默认使用相邻 Noa 项目的 `data/scenario/effect/kirakira_01_rip/`；可通过 `NATSUME_PREFAB_SOURCE` 指定其他同结构资源目录。

`--job-workers N` 指定 Unity 后台工作线程数。共享子发射器在并行更新时存在重跑差异，只有 `--job-workers 0` 可更新该模式的回归基准。设置 `NATSUME_SHARED_MARKERS=1` 可给两个父系统添加左右位置标记；输出保留子粒子位置和种子以追踪来源。

`--trace-order` 需要 macOS arm64 和 Xcode Command Line Tools。通过 LLDB 记录 72 组、120 个更新帧的实际粒子作业执行顺序，与同次运行的数量、年龄组成独立回归夹具；初始化帧另计。原始记录保存在忽略目录中，使用 Natsume 的 `subEmitterUpdateOrder` 回放，不按案例编号修正结果。

`--scene-materials` 另外生成受控多 submesh Prefab。用相邻 Noa 编译后，浏览器测试检查真实导出几何、材质动画与实例生命周期：

```sh
../Noa/target/debug/noa compile data/unity-probe/Assets/SceneMaterialProbe/scene.prefab --output data/scene-mesh.noap --json
pnpm exec playwright test scene-materials.spec.ts
```

控制器探针保存受控 Prefab 与原生逐帧数据。用本地 Noa 生成对照包后运行回归：

```sh
node tools/unity-probe/compile-controller-packages.mjs
pnpm --filter natsume exec vitest run tests/animator-controller-native.test.ts tests/animator-controller.test.ts
```

编译器默认取相邻 Noa 的 `target/debug/noa`，可用 `NOA_BIN` 指定。原生数据、独立编译源与 `.noap` 输出均留在忽略目录；缺少原生数据时仅跳过原生回放，普通控制器测试仍执行。

## 扩展 Noise 采样

`--noise-statistics` 可读取本地 JSON，自定粒子数和参数组合：

```json
{
  "count": 2048,
  "cases": [{ "label": "low", "seed": 31415, "pointSeed": 1265982, "quality": 0, "frequency": 0.1 }]
}
```

`count` 范围为 1–65,536；`quality` 为 Low=0、Medium=1、High=2。可另设 `strength`、`damping`、`scroll`、`octaves`、`multiplier` 和 `scale`。各组使用固定空间窗口 `[-16,16)`，记录第 1 / 15 / 60 帧的总体统计。

```sh
NATSUME_NOISE_STATISTICS_INPUT="$PWD/path/to/input.json" pnpm probe:unity --noise-statistics
```

自定义结果写入 `data/unity-baselines/noise-statistics-custom/`，保留默认测量；不允许与 `--update-fixtures` 同用。

## Timeline 对照

另需未修改的 [Unity Timeline 1.7.6 源码](https://github.com/needle-mirror/com.unity.timeline/tree/1.7.6)。设置本地目录后运行：

```sh
export UNITY_TIMELINE_PACKAGE=/absolute/path/to/com.unity.timeline
node tools/unity-probe/probe-timeline.mjs
node tools/unity-probe/compile-timeline-packages.mjs
node tools/unity-probe/probe-timeline.mjs --playback
pnpm --filter natsume exec vitest run tests/timeline-native.test.ts tests/timeline-playback-native.test.ts
```

编译步骤默认使用相邻 Noa 仓库的 `target/debug/noa`，可用 `NOA_BIN` 指定。探针把 Timeline Runtime 复制到独立本地工程，不修改通用探针工程或添加 Natsume 运行依赖；编译器通过原生 MonoScript 身份表识别轨道。覆盖非空轨道求值、停止恢复、共享粒子目标，以及实际 PlayerLoop 的时钟、循环与事件顺序。

## 更新回归数据

核对结果后，显式更新本地数值夹具：

```sh
pnpm probe:unity --update-fixtures
pnpm probe:unity --boundaries --update-fixtures
pnpm probe:unity --random --update-fixtures
pnpm probe:unity --shape --update-fixtures
pnpm probe:unity --basic-shapes --update-fixtures
pnpm probe:unity --rotation-prewarm --update-fixtures
pnpm probe:unity --rect-layout --update-fixtures
pnpm probe:unity --noise-options --update-fixtures
pnpm probe:unity --noise-statistics --update-fixtures
pnpm probe:unity --animation --update-fixtures
pnpm probe:unity --animation-bindings --update-fixtures
pnpm probe:unity --custom-data --update-fixtures
pnpm probe:unity --sweeps --update-fixtures
pnpm probe:unity --spaces --update-fixtures
pnpm probe:unity --meshes --update-fixtures
pnpm probe:unity --canvas       # 三种 Canvas 布局、视口、像素与 Pixel Perfect
pnpm probe:unity --images       # Image 填充、裁边网格、平铺顶点上限
pnpm probe:unity --ui-masks     # 嵌套 UI 遮罩、软裁切与 CanvasGroup
pnpm probe:unity --sprite-masks # Sprite / 粒子遮罩、阈值、排序范围
pnpm probe:unity --sprite-shapes # Sprite placement、空引用、Donut 分布与扫描
pnpm probe:unity --sprite-rendering # Sprite 翻转、pivot、九宫格、连续 / Adaptive 平铺
pnpm probe:unity --sprite-sheets # Sprite 序列帧时间边界、几何缩放与 UV
pnpm probe:unity --scene-materials --update-fixtures
pnpm probe:unity --sorting --update-fixtures
pnpm probe:unity --stretch --update-fixtures
pnpm probe:unity --compatibility --update-fixtures
pnpm test
```

夹具位于 `data/unity-baselines/fixtures/`，由 Git 忽略；缺少文件时，对应的 Unity 对照测试会跳过。详细测量结论、已测范围和近似差异见 [MEASUREMENTS.md](MEASUREMENTS.md)。

## 误差汇总

```sh
node tools/unity-probe/measure.mjs --refresh-unity
```

依次刷新全部数值探针（不包含原始 prefab 布局和外部拟合输入），运行单元与浏览器对比，将最大绝对差、误差 RMS、比较次数与输入哈希写入 `data/unity-baselines/measurements.json`。已测输入数值相同时保留夹具文件内容，避免纯格式变动。省略 `--refresh-unity` 可复用本地原生结果。

完整浏览器测量需要本地 `data/kirakira.noap`；其他游戏样本存在时一并运行功能回归。原生完整输出和逐项误差记录位于 `data/unity-baselines/`。汇总区分 Unity 数值对照与解析像素对照；已知近似的测量不等于严格一致性验收。

## 本地包生命周期

批量审计 Noa 编译索引中的资源包：

```sh
node tools/unity-probe/audit-packages.mjs path/to/compile-successes.json path/to/Noa data/package-audit.json
```

校验结构、资源文件与引用，记录组件、材质配方、环境、动画、形状、Sprite 和网格属性，并运行兼容性预检。该检查不创建图形设备；读取或预检通过不代表实际绘制通过。

当前 NOIR/NOMS 1.0 源数据契约使用固定编译清单审计：

```sh
node tools/unity-probe/audit-source-packages.mjs path/to/compiler-baseline.json path/to/Noa data/source-package-audit.json
```

校对清单中的包哈希，严格读取所有入口，归类源 Shader 程序、动画绑定完整身份和组件类型，逐包记录宿主输入、未解析引用及兼容性阻塞。源图保留成功不代表其中的组件、动画或 Shader 已可执行。原始审计结果保存在本地，不提交 Git。

```sh
node tools/unity-probe/verify-pack-lifecycle.mjs path/to/packages
# 可选第二参数：宿主 Sorting Layer ID → rank 的 JSON 文件
node tools/unity-probe/verify-pack-lifecycle.mjs path/to/packages path/to/sorting-layers.json
# 可选第三参数：独立报告路径，便于分批运行
node tools/unity-probe/verify-pack-lifecycle.mjs path/to/packages path/to/sorting-layers.json data/lifecycle.json
# 固定清单验收：核对 356 个效果、391 个入口及每包 SHA-256
node tools/unity-probe/verify-pack-lifecycle.mjs path/to/packages path/to/sorting-layers.json data/playback/report.json \
  --inventory path/to/compiler-inventory.json --compiler-root path/to/Noa --require-all --capture-frames
# macOS 可另加 --metal，使用完整 Chromium 的 Metal 后端；报告记录实际 Renderer
```

读取目录中的 `.noap`，逐入口检查至少一个非循环发射周期，或两个循环周期，再加寿命窗口；固定步长 1/60 s，每 10 步提交一次 WebGL 绘制。覆盖暂停、停止发射后排空、清空、同种子重播、粒子有限值与容量、WebGL 错误及销毁后的纹理引用释放。单入口检查时长上限 1,000 秒，超出时报错。

宿主明确提供重力 `(0,-9.81,0)`、无雾、静止 Rigidbody、视点 `(0,0,-1000)`、`fixedDeltaSeconds: 0.02` 和 640×360 显示区域。测试 Bridge 仅声明 `Sekai.Core.Live.ParticleShaderSettings`（含整数字段 `mode`）、`Sekai.ScenarioEffector` 及 `Sekai.ParentRectFitter`，记录动画字段变化；不执行原游戏 C#，后两者没有声明动画字段。其他未声明脚本阻止验收。

检查起始、稳定播放、结束、排空和重播帧的有限几何、实际像素及双实例独立性。无源 Camera/Canvas 的包由宿主缩放完整几何边界以便观察，保留节点相对布局。PNG 使用 WebGL 原始 RGB 叠黑底，报告分别记录 RGB 非零像素和 Alpha 覆盖，避免漏掉 Alpha 为零的加法绘制。报告与截图保存在本地 `data/`；通过表示运行与生命周期检查通过，不代表游戏画面或 Unity 最终像素相同。

## 原始 Prefab 批量采样

固定清单导入原始资源，按 GUID 与 SHA-256 去重；冲突立即停止。恢复的原始 EXR 必须匹配记录的 SHA-256。

```sh
node tools/unity-probe/capture-native-corpus.mjs \
  path/to/compiler-inventory.json path/to/Noa \
  path/to/recovered-exr data/unity-corpus-probe --prepare-only
# 去掉 --prepare-only 后启动 Editor，输出原生 PNG、节点姿态与粒子状态。
```

采样时间为 0、1/60、0.25、0.5、1 秒及发射周期加寿命窗口（最长 60 秒），对根粒子系统显式 `Play(true)`。使用实际 Unity UGUI / Timeline 实现；导出游戏脚本保持原始占位定义且禁用，不能代表游戏行为。原平台 Shader 不受当前 Editor 支持时，PNG 不能作为颜色误差参考；Overlay Canvas 同样不纳入相机截图一致性结论。

## 字段转换与显式播放

将 `project/Assets` 同步到本地探针工程后，可直接执行以下方法：

| Editor 方法                    | 输出环境变量                   | 测量                                       |
| ------------------------------ | ------------------------------ | ------------------------------------------ |
| `NatsumeScriptFieldProbe.Run`  | `NATSUME_SCRIPT_FIELDS_OUTPUT` | int / bool / 枚举转换，首关键帧前的 active |
| `NatsumeParticlePlayProbe.Run` | `NATSUME_COMPAT_OUTPUT`        | 自动播放关闭、重复 Play、停止与存活粒子    |

输出变量为本地 JSON 的绝对路径。Editor 使用 `-batchmode -noUpm -projectPath` 和 `-executeMethod` 指定工程及方法；第二项进入实际 Play 模式，按 1/60 s 采样。
