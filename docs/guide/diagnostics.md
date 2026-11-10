# 诊断与错误

Natsume 用三种方式报告问题：抛出错误、预检报告和实例诊断。

| 渠道     | 何时出现               | 读取方式                                   |
| -------- | ---------------------- | ------------------------------------------ |
| 错误     | 操作无法继续           | `NatsumeError`，带有 `code`                |
| 预检报告 | 实例化之前             | `runtime.checkCompatibility()` 的 `issues` |
| 实例诊断 | 实例创建之后的运行期间 | `effect.diagnostics`                       |

## 错误

所有由 Natsume 主动抛出的错误都是 `NatsumeError`，包含一个 `code` 和一段说明。出错位置明确时，还有 `path`。

| `code`       | 含义                                                  |
| ------------ | ----------------------------------------------------- |
| `LIMIT`      | 超出资源包的大小或文件数量限制，或限制配置本身无效。  |
| `ZIP`        | 压缩包损坏或下载失败。                                |
| `MANIFEST`   | 清单缺失或内容不合法。                                |
| `HASH`       | 文件的 SHA-256 与清单不一致。                         |
| `BINARY`     | FlatBuffers 二进制布局无效。                          |
| `SEMANTIC`   | 文档的语义不合法，例如引用了不存在的对象。            |
| `VERSION`    | 包或契约的版本不被支持。                              |
| `CAPABILITY` | 包用到了尚未实现的能力或配置。                        |
| `HOST`       | 宿主提供的输入无效或缺失，包括环境、参数和未知的 ID。 |
| `DISPOSED`   | 访问了已销毁的包、实例或运行时。                      |

```ts
import { NatsumeError, NatsumeCompatibilityError } from '@untitled-story/natsume';

try {
  await runtime.instantiate(pack, options);
} catch (error) {
  if (error instanceof NatsumeCompatibilityError) {
    console.table(error.issues); // 完整的预检结果
  } else if (error instanceof NatsumeError) {
    console.error(error.code, error.message);
  }
}
```

`NatsumeCompatibilityError` 是 `NatsumeError` 的子类。它的 `code` 取自第一个阻塞项，完整列表在 `issues` 里。

## 预检问题

`checkCompatibility` 返回的每个 issue 有 `severity`。`'error'` 阻止实例化，`'warning'` 说明一个近似或需要宿主留意的行为。字段说明见[加载与预检](/guide/loading-packs#兼容性预检)。

## 实例诊断

实例创建时，预检中的警告会写入 `effect.diagnostics`。运行中产生的非致命信息也会累积在这里。每一项有 `code`、`message`，适用时还有 `componentId`。读取时返回的是副本。

```ts
for (const diagnostic of effect.diagnostics) {
  console.warn(diagnostic.code, diagnostic.message);
}
```

## 诊断码

### 近似行为

| 码                         | 说明                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `APPROXIMATE_NOISE`        | Noise 使用实测的 Perlin 旋度场，未实测的参数组合可能与 Unity 不同。                                                     |
| `APPROXIMATE_STRETCH`      | 普通 Stretch 没有提供 `viewPosition` 时使用平行视线近似，斜向速度可能与 Unity 不同。                                    |
| `FREEFORM_PARALLEL_BASIS`  | Freeform Stretch 在速度与视线平行时使用稳定的朝向，不复现 Unity 的抖动。                                                |
| `HOST_COLLISION_QUALITY`   | 碰撞的 quality 和 voxel 设置传给宿主的球体扫掠，不复现 Unity 原生体素缓存的历史。                                       |
| `NATSUME_RANDOM_SEQUENCE`  | 粒子的随机通道在 Natsume 内可复现，但与 Unity 原生种子的出生结果不同。                                                  |
| `SHARED_SUB_EMITTER_ORDER` | 共享子发射器默认使用稳定调度，Unity 的任务交错可能改变出生年龄和寿命边界的数量。可用 `subEmitterUpdateOrder` 指定顺序。 |
| `DELAYED_GRAPH_PREWARM`    | 三层预热与启动延迟的组合可能令 Unity 2022.3 停滞，Natsume 继续播放。                                                    |
| `OPAQUE_MATERIAL_IDENTITY` | Unity 的临时材质对象 ID 不在包内，同队列的不透明材质按包内声明的逆序分组。                                              |

### 排序与动画

| 码                                | 说明                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `NATSUME_ANIMATION_ORDER`         | 多个动画写入同一属性，按注册顺序执行。用 `setAnimationPriority` 指定谁最后写入。 |
| `SOURCE_ANIMATION_UNBOUND`        | 动画目标在 Animator 根节点下不存在，与 Unity 一样不应用该绑定。                  |
| `SOURCE_ANIMATION_DUPLICATE_PATH` | 动画路径有重复，使用同级顺序中第一个匹配的节点，与 Unity 一致。                  |
| `ANIMATION_EVENT_RECEIVER`        | 动画事件没有接收者。                                                             |
| `ANIMATION_EVENT_ERROR`           | 动画事件回调抛出了异常。                                                         |

### 材质、相机与环境

| 码                            | 说明                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `SOURCE_SHADER_NO_COLOR_PASS` | 保留的 Shader 没有启用的前向颜色 Pass，辅助的深度 Pass 不绘制到宿主的颜色目标。                    |
| `UNLIT_RENDER_ENVIRONMENT`    | 已知的无光照颜色 Pass 不使用阴影和探针光照，ShadowsOnly 抑制颜色绘制。                             |
| `CAMERA_SKYBOX_BACKGROUND`    | 相机的天空盒资源不在规范化契约里，Skybox 使用源背景色清屏。                                        |
| `CAMERA_HOST_RENDER_TARGET`   | 相机的 HDR、MSAA 和动态分辨率许可由宿主的绘制目标决定，不为每个相机分配独立目标。                  |
| `DEFAULT_GRAVITY`             | 粒子需要重力，但宿主没有提供 `gravity`（2D 重力源则是 `gravity2D`），使用 Unity 的默认值 `-9.81`。 |
| `DEFAULT_COLOR_SPACE`         | 包里没有源项目的色彩空间，默认使用 Gamma，可通过 `setSourceColorSpace` 修改。                      |

### 脚本与回调

| 码                               | 说明                                     |
| -------------------------------- | ---------------------------------------- |
| `UNKNOWN_SCRIPT`                 | 没有为该脚本注册工厂，序列化数据被保留。 |
| `SCRIPT_ERROR`                   | 宿主行为或 Bridge 行为抛出了异常。       |
| `PARTICLE_COLLISION_EVENT_ERROR` | 粒子碰撞回调抛出了异常。                 |
| `PARTICLE_TRIGGER_EVENT_ERROR`   | 粒子 Trigger 回调抛出了异常。            |
| `PARTICLE_STOP_EVENT_ERROR`      | 粒子系统停止回调抛出了异常。             |
| `PARTICLE_LIGHT_RELEASE_ERROR`   | 释放粒子灯光句柄时抛出了异常。           |

## 脚本错误策略

运行时有一个 `scriptErrors` 选项，决定宿主行为、Bridge 行为和各种回调抛出异常时怎么处理：

```ts
const runtime = new NatsumeRuntime(app.renderer, { scriptErrors: 'throw' });
```

| 取值                | 行为                                                       |
| ------------------- | ---------------------------------------------------------- |
| `'isolate'`（默认） | 记录诊断，跳过出错行为后续的回调，销毁时的清理仍然执行。   |
| `'throw'`           | 把异常交给宿主并中断本次操作，宿主可以在之后的调用里重试。 |

主动调用 `addBehavior` 时，工厂函数里的错误总是直接抛出。
