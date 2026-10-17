# T0 基线

Unity 2022.3.21f1，24 类模块：**2 Supported / 9 Partial / 13 Unsupported**。Supported 沿用 README 的主要行为口径，仍受共享参数限制。

- [modules.json](modules.json)：配置范围、NOIR 类型、Noa 导出路径、运行实现、测试与证据缺口。`wire` 表示协议有对应类型，`exporter` 表示有转换分支，均不保证所有配置可用；具体限制见 `unsupported`。Unsupported 的实现引用仅用于定位拒绝分支。
- [pins.json](pins.json)：schema 来源、固定 Noa 提交、导出器及 Unity 数值摘录 SHA-256。
- [measurements.json](measurements.json)：本轮性能与资源计数快照。
- [Unity 行为对照](../unity-probe/MEASUREMENTS.md)：已测配置、数值容差及近似误差。

```sh
pnpm baseline:check
# 可选：核对固定提交的 Noa 导出器源码
NATSUME_NOA_ROOT=/path/to/Noa pnpm baseline:check
pnpm benchmark t0-cpu
pnpm benchmark:preview # 默认 data/kirakira.noap；可传其他本地文件
```

检查支持分类、引用文件及固定数据指纹，不把文件存在当作行为验证。普通检查无需 Noa checkout 或本地样本；预览基准缺样本时明确失败。原始性能输出写入 `data/performance/`，不含样本内容。

CPU 场景 `synthetic-motion-limit-combined-v1` 使用测试工厂生成 20,000 粒子，关闭发射及 Noise，预热 80 步，7 组各 120 步。记录每组平均耗时的中位数；不可与旧版本依赖本地样本的 benchmark 直接比较。

预览基准固定 1280×720、种子 12345、dt=1/60，重播后预热 180 帧，再测 120 帧。Update 包含模拟和几何同步；Render Submission 是 JavaScript 向 WebGL 提交的耗时，**不是 GPU 执行时间**。上传按实际 WebGL bufferData / bufferSubData 参数统计，绘制按实际 draw 调用统计，均为测量区间每帧均值，不含预热上传。

内存只统计发射器直接 TypedArray 和渲染几何数组，按 ArrayBuffer 去重；纹理按 RGBA8 像素估算，不是进程内存或实际 VRAM。资源检查覆盖双实例纹理共享、全部实例销毁、连续三轮创建销毁及 pack/runtime 销毁后的注册表、像素预算与舞台引用；不能证明浏览器驱动不存在泄漏。

本轮 Chromium 使用 **SwiftShader 软件后端**；硬件 GPU 时间未测。性能值只适合同设备、同输入、同后端复测，不设跨设备性能门槛。

协议更新前保留本轮 `pins.json` / `measurements.json` 快照，再有意识地更新当前基线；指纹失败应核对变更内容，不能仅重新生成哈希。后续模块状态变化时同步 README 与 `modules.json`，保留历史测量的场景、源码指纹和设备信息。
