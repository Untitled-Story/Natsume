# 宿主行为与 Script Bridge

Natsume 不运行包里的 C# 代码。扩展实例行为有两种方式：

| 方式                              | 何时使用                     | 注册时机           |
| --------------------------------- | ---------------------------- | ------------------ |
| 宿主行为（`addBehavior`）         | 给实例附加与包无关的逻辑     | 实例创建之后，随时 |
| Script Bridge（`registerScript`） | 替代包里的某个 MonoBehaviour | 实例化之前         |

## 生命周期回调

两种方式使用同一组回调：

| 回调               | 时机                                                         |
| ------------------ | ------------------------------------------------------------ |
| `onEnable`         | 行为启用时。                                                 |
| `onDisable`        | 行为禁用时。                                                 |
| `beforeUpdate(dt)` | 动画和粒子模拟之前，收到宿主提交的帧间隔。                   |
| `update(dt)`       | 模拟之后，收到模拟时间实际推进的量，只在推进量大于零时执行。 |
| `lateUpdate(dt)`   | 动画字段通知之后、渲染同步之前，收到宿主提交的帧间隔。       |
| `destroy()`        | 行为被移除或实例销毁时。                                     |

每帧的顺序是：`beforeUpdate`、动画和粒子模拟、`update`、动画字段通知、`lateUpdate`、渲染同步。

- `beforeUpdate` 和 `lateUpdate` 每帧各执行一次，即使本帧还没有累积到一个模拟固定步。`update` 的步长是模拟实际推进的时间，可能与宿主的步长不同。
- 手动定位、`evaluate()` 和 `update(0)` 不执行帧回调。
- `beforeUpdate` 适合设置本帧的输入，`lateUpdate` 适合读取动画之后的节点位置并调整显示。
- 帧回调按添加的顺序执行。帧内新增的行为立即启用，从下一帧开始收到帧回调。禁用或移除立即阻止后续的回调。
- 回调里暂停、停止、重播或销毁实例，会取消当前帧剩下的阶段。帧回调里不能递归调用 `effect.update()`。
- 暂停和停止不会禁用行为，但不再执行帧回调。

## 宿主行为

宿主行为不需要包里存在 C# 组件。工厂在每次添加时执行一次，只接收当前的 `effect`：

```ts
const handle = effect.addBehavior(({ effect }) => {
  const node = effect.getNode(groupNodeId)!;
  const align = () => {
    const parent = node.parent;
    if (!parent) return;
    const position = node.containerPosition;
    const origin = parent.containerPosition;
    node.setRenderOffset({ x: origin.x - position.x, y: origin.y - position.y });
  };
  const clear = () => node.setRenderOffset(null);
  return { onEnable: align, lateUpdate: align, onDisable: clear, destroy: clear };
});

handle.setEnabled(false);
handle.setEnabled(true);
handle.remove();
```

这个示例把一个组根节点叠加到它父节点的位置，抵消两者之间的屏幕平移，保留模拟位置和深度。

`addBehavior` 返回的句柄：

| 成员                  | 说明                                                           |
| --------------------- | -------------------------------------------------------------- |
| `enabled`、`removed`  | 当前状态。                                                     |
| `setEnabled(enabled)` | 仅在状态改变时执行 `onEnable` 或 `onDisable`。                 |
| `remove()`            | 先禁用再执行 `destroy`。重复调用无效果，移除之后不能重新启用。 |

- 行为添加后立即启用，执行 `onEnable`。
- 实例销毁时自动清理所有行为。
- `restart()` 保留行为对象和它的启用状态，不重新执行工厂。

## Script Bridge

Bridge 用包内 MonoBehaviour 的真实身份注册行为，需要在 `instantiate` 之前完成：

```ts
runtime.registerScript(
  { assembly: 'Assembly-CSharp', namespace: 'MyGame', className: 'EffectController' },
  ({ effect, node, component, fields }) => ({
    onEnable() {},
    lateUpdate() {},
    onDisable() {},
  }),
);
```

工厂收到的上下文：

| 字段        | 说明                               |
| ----------- | ---------------------------------- |
| `effect`    | 所属的实例。                       |
| `node`      | 脚本组件所在的节点。               |
| `component` | 包内的组件数据，包含序列化的字段。 |
| `fields`    | 已声明的动画字段的当前值，见下文。 |

- Bridge 的启用和停用跟随包内节点和组件的状态。
- 没有为某个脚本注册工厂时，序列化数据被保留，并给出 `UNKNOWN_SCRIPT` 诊断。
- `pack.describe().scripts` 列出包里用到的脚本，方便决定要注册哪些。

### 被动画驱动的字段

脚本字段被动画驱动时，需要声明字段的类型，作为 `registerScript` 的第三个参数：

```ts
runtime.registerScript(
  { assembly: 'Assembly-CSharp', namespace: 'MyGame', className: 'MaterialSettings' },
  ({ fields }) => ({
    onAnimatedField(name, value) {
      if (name === 'mode') updateMaterialMode(value as number);
      // fields 始终包含本实例已声明字段的当前值
    },
  }),
  { animatedFields: { mode: 'int', intensity: 'float', visible: 'bool' } },
);
```

- 字段名必须与序列化字段一致，类型为 `float`、`int` 或 `bool`。
- 预检会检查声明、原始值和曲线类型，但不执行工厂。
- `fields` 是只读的，实例之间独立。重播会恢复原始值，然后重新采样。
- `onAnimatedField` 在一次操作结束、绘制之前，收到各字段最终的变化值。
- 声明字段不会实现原 C# 行为，实际效果由宿主的回调处理。
- 没有声明的脚本动画字段会阻止实例化。

### Bridge 的事件和字段回调

除了通用的生命周期回调，Bridge 还可以实现：

| 回调                                                                    | 说明                                                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `onAnimatedField(name, value)`                                          | 动画字段变化，见上文。                                                                |
| `onAnimationEvent(event)`                                               | 接收同一节点上 Animator 的事件，返回 `true` 表示已处理。                              |
| `onControlTimeStart()`、`onControlTime(seconds)`、`onControlTimeStop()` | Timeline Control 轨道的 `ITimeControl`，见 [Timeline](/guide/timeline#itimecontrol)。 |
| `onParticleSystemStopped(event)`                                        | 同一节点上粒子系统的停止回调，见[粒子系统](/guide/particles#停止事件)。               |

## 错误处理

行为里抛出的异常由运行时的 `scriptErrors` 选项处理，见[诊断与错误](/guide/diagnostics#脚本错误策略)。

- `'isolate'`（默认）：记录诊断并跳过出错行为后续的回调，销毁时的清理仍然执行。
- `'throw'`：把异常交给宿主并中断本次操作，宿主可以在后续的调用里重试。

销毁时即使某个清理回调抛出错误，其他行为也会继续清理。主动调用 `addBehavior` 时，工厂函数里的错误直接抛出。
