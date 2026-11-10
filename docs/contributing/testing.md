# 测试与验证

Natsume 的验证分成几个层次，各自回答不同的问题。

| 层次       | 工具                  | 回答的问题                                                 |
| ---------- | --------------------- | ---------------------------------------------------------- |
| 单元测试   | Vitest                | 数据校验、曲线和随机分布、发射器、动画、预检规则是否正确   |
| 浏览器回归 | Playwright + Chromium | 在真实的 WebGL2 里，绘制、遮罩、排序和实例生命周期是否正确 |
| 原生对照   | Unity 探针            | Natsume 的数值与 Unity 的差多少                            |
| 性能基准   | `tools/benchmarks`    | 模拟和渲染提交的耗时与资源占用                             |

## 单元测试

```sh
pnpm test
```

测试位于 `packages/natsume/tests/`，不需要浏览器。大部分测试用 `tests/helpers.ts` 里的辅助函数在内存里拼出一个最小的包，再检查结果。

一部分测试读取本地的 [Noa](https://github.com/Untitled-Story/Noa) 导出和 Unity 测量产物，对应文件不存在时这些测试会被跳过，因此在一台干净的机器上跑通不代表这部分也被覆盖了。

## 浏览器回归测试

```sh
pnpm exec playwright install chromium
pnpm test:browser
```

测试位于 `packages/natsume/tests/browser/`。典型的组织方式是：`*-fixture.ts` 在页面里构造一个实例并返回测量结果，`*.spec.ts` 通过 `page.evaluate` 导入并断言。像素对照的用例会与 Unity 的原生像素比较，不应为了通过而放宽阈值。

配置里的开发服务器会自动启动，如果 4173 端口已有服务，会直接复用。

## Unity 探针

探针在本地的 Unity Editor 里测量曲线、粒子和网格的行为，输出 Natsume 回归测试使用的基线数据：

```sh
export UNITY_EDITOR=/Applications/Unity/Hub/Editor/2022.3.21f1/Unity.app/Contents/MacOS/Unity
pnpm probe:unity
```

需要已激活的 Unity 2022.3.21f1。有大量按模块划分的测量模式，用法和完整的选项列表见仓库里的 [tools/unity-probe/README.md](https://github.com/Untitled-Story/Natsume/blob/main/tools/unity-probe/README.md)。测量结果汇总在 [MEASUREMENTS.md](https://github.com/Untitled-Story/Natsume/blob/main/tools/unity-probe/MEASUREMENTS.md)。

## 性能基准

```sh
pnpm benchmark                          # CPU 模拟，不需要样本
pnpm benchmark:preview                  # 浏览器预览，需要本地的 .noap 样本
pnpm benchmark:preview path/to/fx.noap  # 指定样本
```

- `benchmark-particles.mjs` 用 20,000 个粒子测量模拟循环的每步耗时和粒子数组占用。
- `benchmark-preview.mjs` 在固定的 1280×720 和固定种子下测量更新与渲染提交耗时、绘制次数、缓冲区上传量，并检查多实例的纹理共享和反复创建销毁后的资源计数。

比较性能时要使用相同的设备、输入和渲染后端。渲染提交耗时不是 GPU 的执行耗时，纹理占用是估算值，不是实际的显存。使用软件渲染（例如 SwiftShader）得到的结果不代表硬件 GPU 的帧耗时。

## 修改后应该做什么

- 修改了模拟或绘制行为：补充或更新对应的单元测试，涉及绘制的再补浏览器测试。
- 引入新的近似行为：在支持检查里加入警告码，在[Unity 行为差异](/reference/unity-differences)里记录适用范围。
- 发现测试暴露的缺陷：修复行为，不要削弱或删除有意义的断言。
- 未支持的能力：在实现和验证完成之前，保持它被阻止。
