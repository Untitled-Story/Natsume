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
pnpm probe:unity --boundaries   # 发射、运动、外观与 BakeMesh 边界
pnpm probe:unity --random       # 随机分布与参数相关性
pnpm probe:unity --shape        # 位置扰动与 Burst Spread
pnpm probe:unity --basic-shapes     # 基础 Shape 区域、厚度、初速度分布
pnpm probe:unity --rotation-prewarm  # 生命周期旋转和预热
pnpm probe:unity --sweeps       # Shape 时间扫描、量化与方向对齐
pnpm probe:unity --spaces       # 模拟空间、世界重力与线性速度
pnpm probe:unity --sorting      # 透明粒子索引顺序
pnpm probe:unity --noise-fit    # 执行本地提供的 Noise 采样输入
pnpm probe:unity --prefab-layout # 原始 prefab 布局
```

脚本将 `project/` 模板复制到仓库的 `data/unity-probe/` 后运行。该目录是专用临时工程，请勿放入业务工程。测量结果和 Editor 日志写入 `data/unity-baselines/`，均由 Git 忽略。部分模式需要图形设备。

`--noise-fit` 需要先准备 `data/unity-baselines/noise-fit-input.json`。`--prefab-layout` 默认使用相邻 Noa 项目的 `data/scenario/effect/kirakira_01_rip/`；可通过 `NATSUME_PREFAB_SOURCE` 指定其他同结构资源目录。

## 更新回归数据

核对结果后，显式更新可提交的数值夹具：

```sh
pnpm probe:unity --boundaries --update-fixtures
pnpm probe:unity --random --update-fixtures
pnpm probe:unity --shape --update-fixtures
pnpm probe:unity --basic-shapes --update-fixtures
pnpm probe:unity --rotation-prewarm --update-fixtures
pnpm probe:unity --sweeps --update-fixtures
pnpm probe:unity --spaces --update-fixtures
pnpm probe:unity --sorting --update-fixtures
pnpm test
```

夹具位于 `packages/natsume/tests/fixtures/`，不包含原始游戏素材。详细测量结论、已测范围和近似差异见 [MEASUREMENTS.md](MEASUREMENTS.md)。
