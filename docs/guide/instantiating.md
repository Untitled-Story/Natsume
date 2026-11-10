# 创建实例

```ts
const effect = await runtime.instantiate(pack, options);
```

`instantiate` 先执行与[预检](/guide/loading-packs#兼容性预检)相同的检查，有阻塞项时抛出 `NatsumeCompatibilityError`。检查通过后创建渲染资源并返回 `EffectInstance`，返回时实例处于 `idle` 状态，需要调用 `play()` 才开始播放。

所有选项都是可选的。

## 选项

| 选项                    | 说明                                                                    |
| ----------------------- | ----------------------------------------------------------------------- |
| `entryId`               | 要播放的入口 ID。省略时使用包的默认入口。                               |
| `seed`                  | 粒子随机数的种子，0 到 4294967295 的整数。省略时每个实例随机取一个。    |
| `parentLayout`          | 父级布局尺寸 `{ width, height }`，入口根节点使用拉伸的外部锚点时需要。  |
| `particleEnvironment`   | 粒子环境，见[环境配置](/guide/environments#粒子环境)。                  |
| `renderEnvironment`     | 渲染环境，见[环境配置](/guide/environments#渲染环境)。                  |
| `canvasEnvironment`     | Canvas 环境，见[环境配置](/guide/environments#canvas-环境)。            |
| `cameraEnvironment`     | 相机环境，见[环境配置](/guide/environments#相机环境)。                  |
| `displayMatrix`         | 初始显示矩阵，见[环境配置](/guide/environments#显示矩阵与色彩空间)。    |
| `sourceColorSpace`      | 源项目的色彩空间，`'gamma'` 或 `'linear'`。                             |
| `subEmitterUpdateOrder` | 共享子系统的执行顺序，见[粒子系统](/guide/particles#共享子系统的调度)。 |
| `maxTrailPoints`        | 实例内拖尾历史点的上限，见[粒子系统](/guide/particles#拖尾)。           |

### 入口

一个包可以包含多个入口，每个入口有自己的根节点。实例只创建所选入口下的节点。入口的 ID 和名称可以从 `pack.document.entries` 读取，实例创建后可以通过 `effect.entry` 查看当前入口。`entryId` 不存在时抛出 `HOST` 错误。

### 种子

相同的包、相同的选项和相同的 `seed` 会让粒子的随机通道产生相同的序列，方便复现问题或做截图对比。省略 `seed` 时，每次创建的实例随机取值，每次播放的出生结果都不同。

Natsume 的随机序列与 Unity 原生种子产生的序列不同，所以固定种子也不会得到与 Unity 一致的粒子出生结果。实例化时会因此给出 `NATSUME_RANDOM_SEQUENCE` 诊断。

### 重力

重力通过 `particleEnvironment.gravity` 提供。`InstanceOptions` 里还有一个顶层的 `gravity` 字段，只在 `particleEnvironment.gravity` 缺失时作为回退值使用，新代码不需要它。
