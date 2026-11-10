# 开发环境

## 环境要求

- Node.js 24 或更新版本（仓库的 `.nvmrc` 指定了 24）。
- `package.json` 中 `packageManager` 字段指定版本的 pnpm。
- 浏览器回归测试需要 Playwright 的 Chromium。
- Unity 探针需要本地的 Unity Editor，普通构建和测试不需要。

## 准备

```sh
pnpm install --frozen-lockfile
```

## 仓库结构

| 路径                   | 内容                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| `packages/natsume/`    | 运行库本体：`src/` 是源码，`tests/` 是单元测试和浏览器回归测试，`schemas/` 是 NOIR、NOMS 和 NOAP 的模式文件 |
| `packages/playground/` | 预览页，用于打开本地 `.noap` 文件，也是接入代码的参考                                                       |
| `tools/unity-probe/`   | 用本地 Unity Editor 测量行为的探针，以及测量记录                                                            |
| `tools/benchmarks/`    | 性能基准脚本                                                                                                |
| `docs/`                | 本文档站                                                                                                    |

`reference/` 和 `data/` 是本地目录，不进入版本库，用来存放参考资料、样本包和测量产物。

## 常用命令

```sh
pnpm dev             # 启动预览页
pnpm build           # 构建运行库和预览页
pnpm typecheck       # 类型检查
pnpm test            # 单元测试
pnpm test:browser    # 浏览器回归测试
pnpm lint            # ESLint
pnpm format:check    # Prettier 检查
pnpm format          # Prettier 格式化

pnpm docs:dev        # 本地预览文档站
pnpm docs:build      # 构建文档站
pnpm docs:preview    # 预览构建结果
```

浏览器回归测试需要先安装 Chromium：

```sh
pnpm exec playwright install chromium
pnpm test:browser
```

## 预览页

```sh
pnpm dev
```

打开终端显示的地址，选择 `.noap` 文件即可预览，文件在浏览器本地读取。

包需要脚本动画字段时，先用"Bridge 声明"导入一个 JSON，再选择 `.noap`：

```json
[
  {
    "identity": {
      "assembly": "Assembly-CSharp",
      "namespace": "MyGame",
      "className": "MaterialSettings"
    },
    "animatedFields": { "mode": "int" }
  }
]
```

预览页只记录字段的变化，不执行原游戏的逻辑。更换声明需要刷新页面。预览使用静止的 Rigidbody、无雾和关闭软粒子的环境。

缺少项目的排序层信息时，用"排序层"导入一个 ID 到排序值的 JSON，例如 `{"-123456": 2}`。预览页不会猜测未知层的顺序。

## 生成的绑定

NOIR 和 NOMS 的 TypeScript 绑定由 FlatBuffers 编译器生成，放在 `packages/natsume/src/format/generated/`，已经提交到仓库，普通构建不需要安装 `flatc`。

只有修改模式文件时才需要重新生成：

```sh
NATSUME_FLATC=/path/to/flatc pnpm generate
```

生成脚本会先核对 `schemas/provenance.json` 里记录的模式哈希，再检查 `flatc` 的版本是否与记录一致。两者不符会直接报错。

## 提交约定

提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)，例如 `feat(runtime): ...`、`fix(particles): ...`。每个提交只包含一项逻辑上相关的改动。

## 提交前的检查

```sh
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm test:browser
```

较慢的原生对照用例在并行运行时可能超过默认的超时，可以单独运行，或用 `--timeout` 加大超时。
