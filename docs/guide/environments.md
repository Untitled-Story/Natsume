# 环境配置

资源包只描述特效本身。重力、雾效、视点、显示尺寸这类信息属于宿主，宿主通过四组环境输入把它们交给实例。多数缺少的输入会在预检时被报告为阻塞项，只有重力和色彩空间有 Unity 的默认值，缺少时使用默认值并给出诊断。

| 环境   | 选项名                | 内容                                           | 什么时候需要                                       |
| ------ | --------------------- | ---------------------------------------------- | -------------------------------------------------- |
| 粒子   | `particleEnvironment` | 重力、雾效、视点、深度、软粒子、物理服务、灯光 | 使用 Legacy 材质、Facing 对齐、Freeform Stretch 等 |
| 渲染   | `renderEnvironment`   | 全局 mip 偏移、Sorting Layer 映射              | 材质读取全局 mip 偏移，或包里缺少排序层信息        |
| Canvas | `canvasEnvironment`   | 显示尺寸、视图和投影矩阵                       | 包里有屏幕 Canvas，且没有包内 Camera               |
| 相机   | `cameraEnvironment`   | 包内 Camera 使用的显示区域                     | 包里有 Camera                                      |

另外还有显示矩阵 `displayMatrix` 和源色彩空间 `sourceColorSpace` 两项实例选项。

不确定需要哪些输入时，先[做兼容性预检](/guide/loading-packs#兼容性预检)。预检报告会指出缺少什么。`pack.describe().requiredHostInputs` 也会列出包声明的输入槽名称。

## 读取、替换与更新

每组环境都有三个方法，以粒子环境为例：

```ts
effect.getParticleEnvironment(); // 读取当前值的副本
effect.setParticleEnvironment(environment); // 整体替换
effect.updateParticleEnvironment({ gravity: [0, -4, 0] }); // 合并修改
```

- `get*` 返回独立的副本。副本里的纹理、服务等宿主对象仍是借用，没有被复制。
- `set*` 整体替换，所以需要同时带上仍然必需的字段。
- `update*` 把传入的字段浅合并到当前环境，其余字段保持不变。传入 `undefined` 可以移除一个可选字段：

  ```ts
  effect.updateParticleEnvironment({ viewVelocity: [0, 0, 0] });
  effect.updateParticleEnvironment({ viewPosition: undefined });
  ```

- 合并是浅层的。`sortingLayers`、`displays`、`rigidbodyVelocities` 这类字段按整体替换，只改其中一项时需要先读出来再传回。
- 粒子环境的 `fog` 必须保留，合并结果缺少 `fog` 时会报错。

四组环境对应的方法名是 `getCameraEnvironment`、`getParticleEnvironment`、`getRenderEnvironment`、`getCanvasEnvironment`，`set*` 与 `update*` 同理。

### 校验

预检、实例创建和环境替换共用同一套校验规则。即使当前特效暂时用不到某个字段，传入的值也必须合法。替换会先检查全部输入以及当前特效的需求，任何一项失败都会保留原来的环境。

传入的数组和对象会被复制，后续对原对象的修改不会影响实例。需要修改时通过 `set*` 或 `update*` 提交。

## 二维宿主的预设

对于普通的二维场景，可以使用预设省去样板代码：

```ts
import {
  screenCanvasEnvironment,
  screenParticleEnvironment,
  stationaryRigidbodyVelocities,
} from 'natsume';

const effect = await runtime.instantiate(pack, {
  particleEnvironment: screenParticleEnvironment({
    rigidbodyVelocities: stationaryRigidbodyVelocities(pack),
  }),
  canvasEnvironment: screenCanvasEnvironment(app.screen.width, app.screen.height),
});
```

| 预设                                                  | 返回                                                                                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `screenParticleEnvironment(overrides?)`               | 无雾、重力 `[0, -9.81, 0]`、`fixedDeltaSeconds: 0.02`、视点 `[0, 0, -1000]` 的粒子环境。`overrides` 覆盖其中任意字段。 |
| `stationaryRigidbodyVelocities(pack)`                 | 为包里每个粒子系统声明的 Rigidbody 槽提供零速度。                                                                      |
| `screenCanvasEnvironment(width, height, display = 0)` | 1 个单位对应 1 个 Pixi 逻辑像素的正交视图，相机位于 `z = -1000` 朝向 +Z，近平面 0.1，远平面 2000。                     |

预设中的重力是 Unity 的默认值，不是从包里读取的。需要其他重力时请覆盖。不使用预设、也不提供 `gravity` 时，Natsume 在粒子需要重力的情况下使用同一个默认值，并给出 `DEFAULT_GRAVITY` 警告。

## 粒子环境

```ts
const particleEnvironment = {
  fog: { mode: 'none' },
  gravity: [0, -9.81, 0],
  fixedDeltaSeconds: 0.02,
  viewPosition: [0, 0, -10],
};
```

`fog` 是唯一始终必需的字段。

| 字段                                                  | 说明                                                                                                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fog`                                                 | 雾效。`{ mode: 'none' }`，`{ mode: 'linear', color, start, end }`，或 `{ mode: 'exp' \| 'exp2', color, density }`。颜色使用源项目的工作色彩空间。                        |
| `gravity`                                             | Unity 世界空间的加速度，单位与粒子的位置和速度一致。省略时，需要重力的粒子系统使用 Unity 的默认值 `[0, -9.81, 0]`，并给出 `DEFAULT_GRAVITY`。                            |
| `gravity2D`                                           | Physics2D 的重力，源设置使用 2D 重力时生效。省略时默认 `[0, -9.81]`，同样给出 `DEFAULT_GRAVITY`。                                                                        |
| `fixedDeltaSeconds`                                   | Unity 工程的 `fixedDeltaTime`，通常为 `0.02`。PauseAndCatchup 裁剪模式需要，必须是有限的正数。                                                                           |
| `viewPosition`                                        | 视点的 Unity 世界坐标。Facing 对齐和 Freeform Stretch 必须提供。                                                                                                         |
| `viewVelocity`                                        | 视图在世界空间的移动速度，每秒。省略表示视图静止。                                                                                                                       |
| `depth`                                               | 实例的视图深度，用于雾效和软粒子。可以是数值，也可以是 `[a, b, c, d]`，按 `ax + by + cz + d` 以 Unity 世界坐标计算。省略时使用 `effect.container.zIndex`，负值按零处理。 |
| `softParticles`                                       | 软粒子的背景深度纹理，见下文。省略则关闭软粒子。                                                                                                                         |
| `rigidbodyVelocities`                                 | 各 Rigidbody 槽的世界速度，单位每秒，以包内槽名为键。                                                                                                                    |
| `forceFields`、`physicsWorlds`、`colliders`、`lights` | 宿主提供的服务和模板，见[粒子系统](/guide/particles)。                                                                                                                   |

### 视点与 Stretch

`viewPosition` 用来构造粒子的朝向平面和普通 Stretch 的横向，不会自动修改显示矩阵。普通 Stretch 省略它时，会使用平行视线近似，并给出 `APPROXIMATE_STRETCH` 诊断。

两种 Stretch 都使用 `粒子速度 - viewVelocity × cameraVelocityScale` 作为相对速度。更新显示矩阵的同时，可以用 `updateParticleEnvironment` 更新 `viewVelocity`，让 Stretched Billboard 计入视图的移动。

### 深度与雾效

当前采用固定 +Z 观察和仿射深度，不提供完整的 Unity 相机。

### 软粒子

软粒子需要宿主提供背景的深度纹理：

```ts
softParticles: {
  depthTexture, // R 通道存线性观察距离，单位与 depth 相同
  uvTransform: [1, 1, 0, 0], // 可选：采样 UV 为 uv * [sx, sy] + [ox, oy]
}
```

- 纹理按屏幕左上角为原点的归一化 UV 采样。
- Natsume 只借用这张纹理，更新和销毁由宿主负责。
- `zIndex` 只是默认的逻辑深度，不会生成背景深度图。

### Rigidbody 速度

```ts
rigidbodyVelocities: { 'rigidbody-velocity:198043919389829319': [1, 0, 0] }
```

槽名可以从 `pack.describe().requiredHostInputs` 或 `stationaryRigidbodyVelocities(pack)` 得到。缺少包声明的 Rigidbody 输入会明确报错。Transform 模式的发射器速度由节点的世界位移计算，Custom 模式使用包内的自定义速度，这两种模式不读取 `rigidbodyVelocities`。

## 渲染环境

```ts
const renderEnvironment = {
  globalMipBias: 0,
  sortingLayers: { [-123456]: -1, 789012: 1 },
};
```

| 字段            | 说明                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------ |
| `globalMipBias` | 全局 mip 偏移，单位是 mip 层级，`0` 使用常规的采样层级。读取该输入的材质需要宿主显式提供。 |
| `sortingLayers` | Unity Sorting Layer ID 到排序值的映射，排序值越大越晚绘制。                                |

`sortingLayers` 只补充包里缺失的信息，不会覆盖已记录的层顺序。默认层始终是 0。无法确定某一层的顺序时，实例化会明确报错。

`setRenderEnvironment` 整体替换配置，需要同时保留仍然必需的 mip 偏移和层映射。缺少必需输入时保留原配置。已知的无光照材质配方不使用阴影、光照探针和反射探针，Natsume 也不生成三维光照环境。

## Canvas 环境

没有包内 Camera 时，屏幕 Canvas 需要宿主提供显示尺寸。Screen Space - Camera 的 Canvas 另外需要视图和投影矩阵：

```ts
const canvasEnvironment = {
  displays: { 0: { width: 1280, height: 720 } }, // Pixi 逻辑像素
  mainCamera: {
    viewMatrix, // 列主序，Unity 世界坐标到视图坐标
    projectionMatrix, // 列主序，WebGL 裁剪深度 [-1, 1]
    viewport: { x: 0, y: 0, width: 1, height: 1 }, // 左下角为原点，省略表示整个显示区域
  },
};
effect.setCanvasEnvironment(canvasEnvironment);
```

- 视图矩阵和投影矩阵都必须是 16 个有限数值，且可逆。
- World 模式的 Canvas 保留源世界的布局，沿用 `displayMatrix`；Overlay 和 Camera 模式的根布局由显示环境决定。
- 非法输入不会改变当前环境。

## 相机环境

包里有 Camera 时，宿主提供显示区域，Natsume 用矩阵变换几何：

```ts
const effect = await runtime.instantiate(pack, {
  cameraEnvironment: { targetDisplay: 0, width: 1280, height: 720, mainCameraId: 12 },
});
effect.setCameraEnvironment({ targetDisplay: 0, width: 1920, height: 1080, mainCameraId: 12 });
```

| 字段              | 说明                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------- |
| `targetDisplay`   | 非负整数。只有目标显示与它相同的包内 Camera 会被绘制。                                  |
| `width`、`height` | 显示区域，Pixi 逻辑像素，必须是正数。                                                   |
| `mainCameraId`    | 包内 Camera 组件的 ID。需要主视图的功能必须明确选择它，单相机或 Embedded 入口可以省略。 |

多个相机仍按源顺序绘制。ScreenCamera Canvas 优先使用其源 Camera 引用，否则使用选定的主相机。World Canvas 可以被多个相机观察，Overlay Canvas 只绘制一次。

相机的 HDR、MSAA 和动态分辨率许可由宿主的绘制目标决定，不会分配独立的相机目标，预检会返回 `CAMERA_HOST_RENDER_TARGET`。Skybox 缺少规范化的天空盒资源时，使用源背景色并返回诊断。

## 显示矩阵与色彩空间

```ts
const effect = await runtime.instantiate(pack, { displayMatrix });
effect.setDisplayMatrix(matrix); // 16 个有限数值，列主序
effect.setSourceColorSpace('linear'); // 'gamma' | 'linear'
```

- 显示矩阵把 Unity 世界坐标变换到 `effect.container` 的局部坐标，包含裁剪深度 Z。当前只支持仿射矩阵（最后一行是 `0, 0, 0, 1`），其他矩阵会报错。
- 默认矩阵把 +Y 翻转为向下，一个世界单位对应一个像素。
- 包里没有源项目的色彩空间时默认使用 Gamma，并给出 `DEFAULT_COLOR_SPACE` 诊断。
