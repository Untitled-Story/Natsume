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

默认测量曲线与 Noise。其他模式每次选择一个：

```sh
pnpm probe:unity --animation    # 动画时钟、循环与多关键帧曲线
pnpm probe:unity --boundaries   # 发射、运动、外观与 BakeMesh 边界
pnpm probe:unity --random       # 随机分布与参数相关性
pnpm probe:unity --shape        # 位置扰动与 Burst Spread
pnpm probe:unity --basic-shapes     # 基础 Shape 区域、厚度、初速度分布
pnpm probe:unity --rotation-prewarm  # 生命周期旋转、预热窗口和首次更新余量
pnpm probe:unity --rect-layout  # 有符号 RectTransform 布局
pnpm probe:unity --noise-statistics # Noise 总体统计、三档首步位置、滚动轨迹、旋转与尺寸
pnpm probe:unity --custom-data  # 两组自定义流的 Vector / HDR Color
pnpm probe:unity --noise-options # Noise 参数行为与渲染尺寸
pnpm probe:unity --sweeps       # Shape 时间扫描、量化与方向对齐
pnpm probe:unity --spaces       # 模拟空间、世界重力与线性速度
pnpm probe:unity --stretch      # 拉伸长度、粒子速度与移动视图
pnpm probe:unity --meshes       # 多 Mesh、队列 / 系统排序、原生雾效 / 场景深度像素与 submesh 限制
pnpm probe:unity --sorting      # 透明粒子索引顺序
pnpm probe:unity --compatibility # 加权曲线、渐变、限速与序列帧
pnpm probe:unity --noise-fit    # 执行本地提供的 Noise 采样输入
pnpm probe:unity --prefab-layout # 原始 prefab 布局
```

脚本将 `project/` 模板复制到仓库的 `data/unity-probe/` 后运行。该目录是专用临时工程，请勿放入业务工程。测量结果和 Editor 日志写入 `data/unity-baselines/`，均由 Git 忽略。部分模式需要图形设备。

`--noise-fit` 需要先准备 `data/unity-baselines/noise-fit-input.json`。`--prefab-layout` 默认使用相邻 Noa 项目的 `data/scenario/effect/kirakira_01_rip/`；可通过 `NATSUME_PREFAB_SOURCE` 指定其他同结构资源目录。

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
pnpm probe:unity --custom-data --update-fixtures
pnpm probe:unity --sweeps --update-fixtures
pnpm probe:unity --spaces --update-fixtures
pnpm probe:unity --meshes --update-fixtures
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

```sh
node tools/unity-probe/verify-pack-lifecycle.mjs path/to/packages
```

读取目录中的 `.noap`，逐入口检查至少一个非循环发射周期，或两个循环周期，再加寿命窗口；固定步长 1/60 s，每 10 步提交一次 WebGL 绘制。覆盖暂停、停止发射后排空、清空、同种子重播、粒子有限值与容量、WebGL 错误及销毁后的纹理引用释放。单入口检查时长上限 1,000 秒，超出时报错。

宿主明确提供重力 `(0,-9.81,0)`、无雾、视点 `(0,0,-1000)` 和 640×360 外部布局，不绑定游戏脚本。结果写入 `data/unity-baselines/package-lifecycle.json`；通过表示运行与生命周期检查通过，不代表游戏画面或 Unity 最终像素相同。
