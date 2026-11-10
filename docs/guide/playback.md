# 播放与更新

## 播放状态

`effect.state` 取下列值之一：

| 状态       | 含义                           |
| ---------- | ------------------------------ |
| `idle`     | 已创建，尚未播放。             |
| `playing`  | 正在播放。                     |
| `paused`   | 已暂停。                       |
| `draining` | 已停止发射，现有粒子自然消失。 |
| `stopped`  | 已停止。                       |

另外可以读取 `effect.time`（已模拟的时间）和 `effect.particleCount`（当前存活的粒子数）。

## 控制播放

```ts
effect.play();
effect.pause();
effect.restart();
effect.stop(); // 默认 'drain'：停止发射，现有粒子自然消失
effect.stop('clear'); // 立即清空粒子
```

- `play()` 遵守包内的自动播放设置。关闭了自动播放的粒子系统需要宿主显式启动，见[粒子系统](/guide/particles#手动启动粒子系统)。
- `pause()` 冻结模拟，宿主行为的帧回调也不再执行。
- `restart()` 把实例恢复到包内的初始值，包括动画参数的默认值和层权重。宿主行为对象及其启用状态保留。
- 暂停和停止排空期间，所有动画保持冻结。

## 推进时间

Natsume 不会自己推进时间。每帧调用 `effect.update(seconds)`，传入以秒为单位的帧间隔：

```ts
app.ticker.add((ticker) => effect.update(ticker.deltaMS / 1000));
```

一次 `update` 的处理顺序如下：

1. 宿主行为和 Bridge 的 `beforeUpdate`。
2. 动画和粒子模拟。普通动画按 1/60 秒的固定步采样，然后推进粒子。
3. 宿主行为和 Bridge 的 `update`，只在模拟时间实际前进时执行。
4. 动画字段通知。
5. 宿主行为和 Bridge 的 `lateUpdate`。
6. 渲染同步。

约束：

- `seconds` 必须是有限的非负数，否则报错。
- 单次 `update` 最多接受 0.25 秒，超出的部分被丢弃。长时间卡顿之后不会一次性补算。
- 帧回调只在实例处于 `playing` 或 `draining` 时执行。
- `update()` 不能在回调里递归调用，递归调用会报错。
- 手动定位（`setTime`、`evaluate`）和 `update(0)` 不执行帧回调。
- 在回调里暂停、停止、重播或销毁实例，会取消当前帧剩下的阶段。

### 额外的时钟

使用 Unscaled 时间或物理步的对象需要额外的输入：

```ts
effect.update(deltaSeconds, {
  unscaledDeltaSeconds, // 未经缩放的帧间隔，单位秒
  physicsSteps: [0.02], // 本帧的物理步；本帧没有物理步时传 []
});
```

只有活动的 Animator 或粒子系统实际使用了对应模式，才要求提供对应参数，缺少时会报错。

| 需要的参数             | 使用它的对象                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `unscaledDeltaSeconds` | Unscaled 时间的粒子系统和 Animator、UnscaledGameTime 的 Timeline、没有音轨的 DSP 时钟 |
| `physicsSteps`         | AnimatePhysics 的 Animator                                                            |

### 用 FixedStepClock 生成物理步

如果宿主没有现成的物理步，可以用 `FixedStepClock` 把帧时间切成固定的步：

```ts
import { FixedStepClock } from '@untitled-story/natsume';

const physics = new FixedStepClock(0.02, 8); // 步长（秒），每帧最多步数
effect.update(deltaSeconds, { physicsSteps: physics.advance(deltaSeconds) });
```

- 不足一步的时间留到下一帧。
- 超过每帧上限的步数会被丢弃，避免长时间卡顿后连续补算。
- `reset()` 清空累积的时间，通常在重新开始播放时调用。

## 可见性与裁剪

宿主可以告诉 Natsume 某个对象当前是否可见，用于实现源数据里的裁剪模式：

```ts
effect.setParticleSystemVisible(systemId, false); // 粒子系统，默认可见，跨 restart 保留
effect.getAnimator(animatorId).setVisible(false); // Animator，默认可见
```

Animator 的 Cull Update Transforms 在不可见时继续推进状态和事件，但停止属性写回；Cull Completely 冻结状态。粒子系统的 Automatic、Pause、PauseAndCatchup、AlwaysSimulate 按源设置处理，其中 PauseAndCatchup 需要 `particleEnvironment.fixedDeltaSeconds`（Unity 工程通常为 `0.02`）。

## 销毁

```ts
effect.destroy();
```

销毁后，实例和从它取得的句柄都不可再使用。销毁时即使某个清理回调抛出错误，也会继续清理其他行为。
