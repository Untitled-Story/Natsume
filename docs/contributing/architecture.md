# 架构

接口的使用说明在[指南](/guide/introduction)里，这里只讲实现。

## 分层

运行库位于 `packages/natsume/src/`，从底层到上层是：

| 目录               | 职责                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `format/`          | NOIR 和 NOMS 的二进制校验与语义检查。`generated/` 下是由 FlatBuffers 模式生成的绑定。                           |
| `loader/`          | 读取 ZIP、解析清单、校验哈希、解码 PNG 和 OpenEXR 像素，产出 `EffectPack`。                                     |
| `pack.ts`          | `EffectPack`：包数据的只读视图和查找方法。                                                                      |
| `runtime/`         | 模拟本体：粒子发射器、场景节点、动画与 Animator、Timeline、子发射器、碰撞与 Trigger、宿主行为，以及兼容性预检。 |
| `rendering/`       | 把模拟结果画到 Pixi：粒子和场景 Mesh、材质配方、Canvas 布局、相机、排序，以及各类环境输入的定义和校验。         |
| `particles/noise/` | Noise 模块使用的 Perlin 旋度场。                                                                                |

对外的接口集中在 `index.ts`。`EffectInstance`、`NatsumeRuntime`、`NatsumeNode` 以及各种句柄是使用者接触到的对象，其余模块是实现细节。带有 `@internal` 注释的成员不会出现在构建生成的类型声明里。

## 数据流

```text
loadPack()
   │  校验 ZIP、清单、哈希、FlatBuffers 布局和语义
   ▼
EffectPack（只读）
   │
   ├─ runtime.checkCompatibility(pack, options)   不分配资源，只收集问题
   │
   └─ runtime.instantiate(pack, options)
         │  先执行同一套检查，有阻塞项则抛出 NatsumeCompatibilityError
         ▼
      Simulation（时间、场景、发射器、动画、Timeline）
         │
         ▼
      EffectInstance（Pixi 容器、Mesh、行为、句柄）
         │
         ▼  每帧 effect.update(dt)
      模拟 → 回调 → 渲染同步
```

`Simulation` 持有模拟状态，包括时间、场景节点、各个粒子发射器、Animator 控制器和 Timeline Director。`EffectInstance` 在它外面加上 Pixi 的容器和 Mesh、宿主行为、事件订阅和环境输入，是对宿主公开的门面。

### 预检与实例化共用检查

兼容性检查由一组独立的"支持检查"函数组成，例如发射器、渲染器、材质、动画、Director 和环境的检查，它们都返回问题列表（`SupportIssue`）而不抛出异常。

- `checkCompatibility` 汇总这些结果，作为预检报告返回。
- `instantiate` 调用同一个汇总函数，有阻塞项就抛出。
- 各类环境的 `set*` 方法也复用对应的检查，保证三条路径的规则一致。

新增一种可能不被支持的配置时，在对应的支持检查里加入判断，让问题在预检阶段暴露。

## 设计约束

### 技术栈

- PixiJS v8、WebGL2 和纯 TypeScript。其他渲染器应另开项目。没有已测出的性能瓶颈时，不引入其他语言或外部语言依赖。
- pnpm workspace，ESM，严格的 TypeScript。粒子数据使用 TypedArray，并复用缓冲区。
- Vite 构建，tsc 类型检查，Vitest 单元测试，Playwright 浏览器回归测试，ESLint 与 Prettier。
- Unity 探针只用于开发时的核对，普通构建和测试不依赖 Unity。

### 能力要分层验证

Noa 负责编译资源和协议，Natsume 负责加载、模拟和渲染。"能编译"、"能读取"、"能执行"和"视觉一致"分别验证，不因为其中一层通过就认为后面的层也通过。

- 未实现的配置要明确报错，不静默降级。
- 近似行为要记录适用范围和误差。
- 单个模块可用，不代表所有组合都被支持，没有验证过的组合不标记为支持。

### 宿主与库的边界

- 每个实例有独立的 Pixi 容器，按包内的布局尺寸设置边界。定位、缩放和裁剪由宿主管理。
- 观察变换通过矩阵作用于元素，不创建完整的 Unity 相机系统。
- Pixi Application 扩展为每个应用创建独立的运行时。实例共享资源，由宿主显式推进模拟。
- MonoBehaviour 的数据交给 Script Bridge，库不自动运行 C#，也不猜测游戏专属的逻辑。
- Legacy 材质的雾效由实例环境设置，软粒子需要的背景线性深度纹理由宿主提供。背景深度与逻辑排序分开，纹理由宿主持有。

### 公开接口

接口说明以[指南](/guide/introduction)、[API 参考](/reference/api/)和代码为准。涉及新的公开 API 或功能边界的决定，应先讨论再实现。
