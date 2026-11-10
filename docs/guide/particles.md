# 粒子系统

宿主通过实例上的接口读取粒子状态、手动启动系统和触发子发射器，并为力场、碰撞、Trigger 和灯光提供服务。

接口里的 `systemId` 是包内 ParticleSystem 组件的 ID，获取方式见[加载与预检](/guide/loading-packs#查找节点和组件)。

## 读取粒子状态

```ts
const particles = effect.getParticles(systemId);
for (const particle of particles) {
  console.log(particle.id, particle.position, particle.velocity);
}
```

返回当前存活粒子的独立快照，修改它不会影响模拟。

| 字段                                   | 说明                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `id`                                   | 粒子 ID。在同一个系统内保持到粒子死亡，数组压缩不会改变它，重播后重新计数。 |
| `position`、`velocity`、`size`         | Unity 世界单位。                                                            |
| `rotation`                             | 在粒子模拟空间内的欧拉角，弧度。                                            |
| `color`                                | 当前颜色，RGBA。                                                            |
| `age`、`lifetime`、`remainingLifetime` | 当前年龄、初始寿命和剩余寿命，秒。                                          |

## 手动启动粒子系统

`effect.play()` 遵守包内的自动播放设置。关闭了自动播放的系统由宿主或 Bridge 显式启动：

```ts
effect.play();
effect.playParticleSystem(systemId, { withChildren: true });
```

- `withChildren` 默认为 `true`，传 `false` 只启动指定的系统。
- 调用时实例必须处于播放中。失活的节点不会被激活，Timeline 控制的系统也不会被接管。
- 行为与 Unity 的 `Play` 一致：重置发射时间，保留已有的粒子，下一个模拟步开始发射。
- `restart()` 会恢复作者的设置，需要手动启动的系统要再次调用。

`effect.particleSystems` 的 `timelineControlled` 字段可以用来跳过 Timeline 控制的系统：

```ts
for (const system of effect.particleSystems) {
  if (!system.timelineControlled) effect.playParticleSystem(system.id, { withChildren: false });
}
```

## 子发射器

Birth 和 Death 子发射器由运行时自动触发。Collision 和 Trigger 在宿主提供物理查询后自动触发，也可以像 Manual 一样由宿主通知：

```ts
const particle = effect.getParticles(systemId)[0];
if (particle) effect.emitSubEmitter(systemId, slot, particle.id);
effect.emitSubEmitter(systemId, slot); // 对全部存活粒子触发
```

`slot` 是源包中从 0 开始的子发射器槽序号，空槽不发射。失效的粒子 ID、不存在的系统或槽会报错。

### 共享子系统的调度

多个互相独立的根共享同一个子系统时，默认使用稳定的调度。Unity 的任务交错可能改变出生年龄和寿命边界的粒子数量，运行时为此保留 `SHARED_SUB_EMITTER_ORDER` 诊断。

宿主可以显式指定每个固定步的执行顺序。以只有 A、B 两个根和一个共享子系统的实例为例：

```ts
const effect = await runtime.instantiate(pack, {
  subEmitterUpdateOrder: [childId, parentAId, childId, parentBId],
});
effect.setSubEmitterUpdateOrder([childId, childId, parentAId, parentBId]);
effect.setSubEmitterUpdateOrder(undefined); // 恢复默认调度
```

- 数组里必须包含实例内的全部系统，每个系统按它可达的独立根数出现。同一个根的重复槽和菱形路径只算一次。
- 配置从下一个固定步生效，重播后保留，不改变预热的历史。
- 未知、遗漏或多余的 ID 会报错，失败时保留原配置。
- NOAP 不包含 Unity 的全局任务队列，指定顺序不保证复现其他场景里的任务交错。

## 拖尾

拖尾的历史点放在实例共享、可复用的点池里：

```ts
const effect = await runtime.instantiate(pack, { maxTrailPoints: 65_536 });
```

`maxTrailPoints` 默认为 65,536，包括存活粒子的点和粒子死亡后残留的历史点。超出上限时会报错，宿主可以提高上限，Natsume 不会静默截断拖尾。

拖尾使用 Renderer 的第二个材质槽和独立的顶点流，该槽为空时不绘制拖尾。

## 外部力场

力场通过 `particleEnvironment.forceFields` 绑定：单个引用绑定一个 `ParticleForceField`，世界搜索槽绑定力场数组。

```ts
const field: ParticleForceField = {
  layer: 0,
  sample(query, out) {
    // query.position / velocity 是世界坐标，只在调用期间有效
    out[0] = 0;
    out[1] = 5;
    out[2] = 0;
  },
};
effect.updateParticleEnvironment({ forceFields: { 'force-field-slot': field } });
```

`sample` 接收世界位置、速度、年龄和步长，把世界空间的加速度写入 `out[0..2]`。同一个对象被多处引用时按对象身份去重。

## 碰撞

World 碰撞通过 `particleEnvironment.physicsWorlds` 绑定宿主的 `ParticlePhysicsWorld`：

```ts
const world: ParticlePhysicsWorld = {
  sweepSphere(query, outHits) {
    // 在宿主的物理场景里做球体扫掠，把结果写入 outHits
  },
};
effect.updateParticleEnvironment({ physicsWorlds: { 'world-slot': world } });
```

- 查询包含 3D 或 2D、层掩码、是否包含动态和内部碰撞、`quality`、`voxelSize` 和 `maxShapes`。
- 每个命中记录碰撞对象、沿位移的进度、表面点和法线。
- Natsume 执行粒子的碰撞响应。动态 Collider 如果实现了 `applyForce(force, point)`，会收到世界空间的力和作用点。
- 宿主拥有这些服务和物理对象。查询用的缓冲区只在调用期间有效，不要保留。
- Planes 模式使用节点的 +Y 平面，不需要宿主服务。

订阅碰撞事件：

```ts
const unsubscribe = effect.onParticleCollision((event) => {
  console.log(event.systemId, event.particleId, event.colliderId, event.planeNodeId);
});
unsubscribe();
```

只有启用了 Collision Send Messages 的系统才会派发公开事件，碰撞子发射器则独立自动触发。回调在当前粒子步之后派发，异常会记录为诊断。回调内停止、重播或销毁实例，会取消本批已失效的事件。

## Trigger

Trigger 的 Collider 通过 `particleEnvironment.colliders` 绑定，以源槽为键：

```ts
const collider: ParticleCollider = {
  id: 'zone-1',
  layer: 0,
  overlapSphere: (query) => false, // 静态重叠
  sweepSphere: (query) => false, // 整步的球体扫掠，包含起点和终点重叠
};
effect.updateParticleEnvironment({ colliders: { 'collider-slot': collider } });

effect.onParticleTrigger((event) => {
  console.log(event.kind, event.systemId, event.particleId, event.colliders);
});
```

- `kind` 取 `inside`、`outside`、`enter`、`exit`。
- `colliders` 保留源槽号和宿主的 Collider 身份。
- 只有 Callback 动作会派发公开事件，Kill 和 Callback 都会自动触发 Trigger 子发射器。
- Trigger 引用要求 Collider 实现 `sweepSphere`。

## 粒子灯光

粒子灯光通过 `particleEnvironment.lights[slot]` 绑定宿主的模板：

```ts
const template: ParticleLightTemplate = {
  color: [1, 1, 1],
  range: 5,
  intensity: 1,
  create() {
    const light = createHostLight();
    return {
      update(state) {
        /* state.position、color、range、intensity，只在调用期间有效 */
      },
      destroy() {
        light.dispose();
      },
    };
  },
};
```

模板提供 `color`、`range`、`intensity` 和 `create()`，`create()` 返回的句柄实现 `update(state)` 和 `destroy()`。位置和范围使用世界单位。

Natsume 复用句柄，并在粒子死亡、停止清空、替换模板或实例销毁时调用 `destroy()` 释放。模板本身由宿主持有。

## 停止事件

源设置的 StopAction 通过停止回调通知宿主：

```ts
const unsubscribe = effect.onParticleSystemStopped((event) => {
  console.log(event.systemId, event.nodeId);
});
```

事件在系统及其后代排空之后派发。同一个节点上的 Bridge 行为如果实现了 `onParticleSystemStopped(event)`，也会收到回调，禁用状态的 Bridge 组件也一样。

StopAction 为 Disable 时停用所属节点，为 Destroy 时销毁该节点及其子层级。`restart()` 会恢复节点，并重建已销毁的 Bridge 行为。

## 预热与限制

- 预热只用于有限循环的系统，按完整周期覆盖寿命上界。曲线用 Hermite 控制点包络估计上界。
- 每个发射器最多 36,000 步和 1000 万容量步，整个实例最多 4000 万容量步。
- 三层预热与启动延迟的组合可能让 Unity 2022.3 停滞，Natsume 继续播放并给出 `DELAYED_GRAPH_PREWARM`。
