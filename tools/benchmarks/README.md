# Benchmarks

```sh
pnpm benchmark                         # CPU 模拟，不需要样本
pnpm benchmark:preview                 # 浏览器预览，默认 data/kirakira.noap
pnpm benchmark:preview path/to/fx.noap  # 指定样本
```

- `benchmark-particles.mjs`：20,000 粒子，运动与限速，关闭发射和 Noise。预热 80 步后运行 7 组，每组 120 步，记录平均步耗时的中位数和粒子数组占用。
- `benchmark-preview.mjs`：启动本地 Chromium，固定 1280×720、种子 12345、dt=1/60。预热 180 帧后测量 120 帧，记录更新与渲染提交耗时、WebGL 绘制次数、buffer 上传量、数组占用及纹理估算，并检查双实例纹理共享和反复创建销毁后的资源计数。

结果写入 `data/performance/`。浏览器脚本需要安装 Playwright Chromium，并提供本地 `.noap` 文件。

渲染提交耗时不是 GPU 执行耗时，纹理估算不是实际 VRAM。比较性能时使用相同设备、输入和渲染后端；输出中的 `device` 可用于识别 SwiftShader 等软件后端。

## 最近一次对照

2026-10-18 22:13 UTC；Apple M5、Node.js 26.11.1。相同的 20,000 粒子场景，出生时间修正前后各运行 7 组 × 120 步：

| 项目           |      修正前 |      修正后 |
| -------------- | ----------: | ----------: |
| 每步耗时中位数 |    8.844 ms |    8.584 ms |
| 粒子数组       | 1,520,000 B | 1,520,000 B |

此次测量未见 CPU 回退，约 3% 差异不足以单独证明提速。该场景关闭发射和 Noise，仅检查存量粒子的模拟循环。

`kirakira.noap` 的 Chromium / SwiftShader 预览，1280×720、98–128 粒子：更新中位数 / P95 为 0.10 / 0.20 ms，渲染提交为 0.80 / 1.00 ms；每帧 11 次绘制，平均上传约 28.1 kB。粒子与几何数组合计 5,904,256 B，纹理 RGBA8 估算 1,048,576 B；双实例纹理共享及反复销毁计数检查通过。软件渲染后端的结果不代表硬件 GPU 帧耗时。
