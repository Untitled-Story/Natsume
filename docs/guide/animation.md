# 动画

Natsume 执行包里的 Animator Controller。支持范围是平面控制器：

- 参数：Float、Int、Bool、Trigger。
- 状态机：条件与过渡、中断、Entry、AnyState、Exit。
- 多层：Override 与 Additive、层权重。
- 状态：速度、相位、时间参数、tag 和 Write Defaults。
- 无 Controller、空层和空 Motion 的情况也会保留。

可以驱动的属性包括节点启用、TRS、Rect、组件启用、粒子参数与颜色、材质和 Sprite 颜色。

Avatar 与 Root Motion、IK 与 Mirror、AvatarMask、同步层、BlendTree、OverrideController、嵌套状态机和 StateMachineBehaviour 不在支持范围内，见[支持范围](/reference/support)。

## 控制 Animator

```ts
const animator = effect.getAnimator(animatorId);

animator.setFloat('speed', 1.2);
animator.setTrigger('play');
animator.setLayerWeight(1, 0.5);

animator.getCurrentState(); // 空层返回 undefined
animator.getTransition(); // 当前过渡信息

effect.playAnimatorState(animatorId, 'Idle', 0); // 按名称或 ID 播放状态，层序号默认 0
```

- 参数的名称和类型不匹配时会报错。
- 句柄按实例隔离，`restart()` 之后仍然有效，实例销毁后不可使用。
- Base Layer 的有效权重始终为 1。
- 状态查询保留已完成的循环数。空 Motion 不会创建替代片段。

`animatorId` 是 Animator 组件的 ID。

## 时钟

Animator 的更新模式决定它使用哪个时钟：

| 更新模式       | 时钟                                         |
| -------------- | -------------------------------------------- |
| Normal         | 按 1/60 秒的固定步先采样，再推进粒子。       |
| UnscaledTime   | 使用宿主传入的 `unscaledDeltaSeconds`。      |
| AnimatePhysics | 按宿主传入的物理步 `physicsSteps` 逐次推进。 |

```ts
effect.update(deltaSeconds, {
  unscaledDeltaSeconds,
  physicsSteps: [0.02],
});
```

只有活动的 Animator 实际使用相应的模式时，才要求对应的参数。生成物理步的方法见[播放与更新](/guide/playback#用-fixedstepclock-生成物理步)。

## 可见性与裁剪

```ts
animator.setVisible(visible); // 默认 true，对应源的 culling mode
```

- Cull Update Transforms：不可见时继续推进状态和事件，但停止属性写回。
- Cull Completely：不可见时冻结状态。
- 暂停和停止排空期间，所有动画都被冻结。

## 状态与属性的细节

- `setNodeActive` 立即生效，下一次动画求值可能覆盖它。
- 入口的 ApplyClip 只应用起点，PlayClip 持续播放。
- 旋转支持归一化四元数和 Unity 的 ZXY 欧拉角。
- 缺失的通道保留动作入口时的值。Write Defaults 恢复 Animator 启动时的属性值。
- 关闭组件时保留其状态。节点失活时，按源的 keep-state 与 write-defaults 设置处理。
- `restart()` 恢复包的初始值、参数默认值和源的层权重。
- 粒子参数保持源的模式。材质覆盖按 Renderer 和实例隔离。
- 零时长的 Animator Motion 继续写回固定姿态，ApplyClip 保持一次性采样。

## 写入顺序

多个 Animator 或入口的 PlayClip 重叠写入同一属性时，默认按注册顺序执行，PlayClip 在 Animator 之后。同优先级的重叠写入会给出 `NATSUME_ANIMATION_ORDER` 警告。

宿主可以指定覆盖顺序：

```ts
// 数值越大越晚写入，默认 0。下一个固定步生效，切换状态和重播时保留。
effect.setAnimationPriority({ animatorId: 12 }, 10);
effect.setAnimationPriority({ clipId: 56 }, 20);
```

- 重新启用的 Animator 会重新注册，切换状态不改变原来的顺序。
- 为一对写入者设置不同的优先级之后，它们不再产生顺序警告。

## 动画事件

宿主可以订阅类型化的动画事件：

```ts
const unsubscribe = effect.onAnimationEvent((event) => {
  console.log(event.name, event.stringParameter, event.objectParameter);
  return true; // 确认已处理；不返回 true 时保留 RequireReceiver 检查
});
unsubscribe();
```

Bridge 行为可以实现 `onAnimationEvent(event)`，接收同一节点上 Animator 的事件，见[宿主行为与 Script Bridge](/guide/behaviors#bridge-的事件和字段回调)。

事件的细节：

- 事件保留源的字符串、数字和对象引用，包括 `bigint` 的 fileID。不会按名称自动调用方法。
- 订阅者先于 Bridge 收到事件。事件先于该固定步的轨道采样和粒子推进派发。
- 正向的初始化、循环末端和同时间戳的事件按源顺序派发，倒放按反向顺序。
- ApplyClip 只采样起点，不派发持续播放事件。
- 回调抛出的异常记录为诊断。RequireReceiver 的事件无人确认时给出警告。
- 停止、暂停、重播、切换状态或销毁会取消当前已失效的批次。
- 回调里启动的新状态，其起始事件延迟到下一个固定步。在回调里递归调用 `update` 会报错。
