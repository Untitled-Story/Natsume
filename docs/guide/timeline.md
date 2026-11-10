# Timeline

Natsume 执行 PlayableDirector 引用的 Timeline 资产，支持：

- 轨道：Group、Activation、Animation、Control。
- 片段的混合与外插。
- 嵌套的 Director。
- 对粒子系统和 Bridge 行为的时间控制。

空的资产保持为空。Audio、Signal 与 Marker、自定义轨道和 Playable、Infinite Clip、AvatarMask、prefab 实例化、自定义属性动画和非默认的 clip-end action 不在支持范围内，见[支持范围](/reference/support)。

## 控制 Director

```ts
const director = effect.getDirector(directorComponentId);

director.play();
director.pause();
director.setTime(1.5); // 只设置时间
director.evaluate(); // 立即应用，包括激活状态和受控的粒子
director.stop();
```

`getDirector` 的参数是 PlayableDirector 组件的 ID。句柄和下文的绑定覆盖在 `restart()` 之后保留，实例销毁后句柄失效。

## 绑定

可以在运行时替换轨道的绑定目标：

```ts
director.setBinding({ guid: trackGuid, fileId: trackFileId }, { componentId: animatorId });
director.setBinding({ exposedName: 'subject' }, { nodeId: targetNodeId });
director.setBinding({ exposedName: 'subject' }, null); // 清除
```

- `fileId` 使用 `bigint`。
- Activation 与 Control 轨道绑定节点，Animation 轨道绑定 Animator。
- 目标必须属于当前实例，传入 `null` 清除绑定。
- 动画的重绑定按相对的节点路径和组件序号匹配。
- 无效的目标会在修改播放图之前报错。

## 时钟

| 时钟             | 推进方式                                        |
| ---------------- | ----------------------------------------------- |
| GameTime         | 每次 `effect.update(dt)` 推进一次。             |
| UnscaledGameTime | 使用 `unscaledDeltaSeconds`。                   |
| DSP              | 目前没有音轨，同样使用 `unscaledDeltaSeconds`。 |
| Manual           | 只由 `setTime` 和 `evaluate` 采样。             |

Wrap 模式支持三种。Timeline 在 Animator 之后、普通粒子之前执行。手动 `evaluate` 不派发持续播放事件。Timeline 的 Transform 在缺失通道时使用动画流的默认值：位置为 0，缩放为 1。

## 停止与暂停

- `stop()` 回到源的 initial time，结束状态在下一次 `effect.update()` 的边界恢复。
- `pause()` 保留当前的激活状态。

## Control 轨道

Control 轨道使用实例内现有的粒子池。

- 向后定位会重新模拟，开销较大的定位受模拟预算限制。
- 轨道释放之后，受控的粒子保持暂停。宿主可以用 `restart()` 恢复普通播放。
- 嵌套控制形成闭环时会明确报错。

### ITimeControl

Control 轨道控制的 Bridge 行为可以实现 `ITimeControl` 对应的回调：

```ts
runtime.registerScript(identity, () => ({
  onControlTimeStart() {
    // 进入控制区间
  },
  onControlTime(seconds) {
    // 应用片段的局部时间
  },
  onControlTimeStop() {
    // 离开区间或停止
  },
}));
```

- 回调抛出的异常被隔离，回调里改变了播放状态会取消失效的采样。
- 禁用的脚本仍然可以接收 ITimeControl，普通的 `onEnable` 与 `update` 继续遵守组件的启用状态。
