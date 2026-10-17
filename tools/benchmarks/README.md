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
