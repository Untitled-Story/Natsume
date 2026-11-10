# 包格式

Natsume 读取由 [Noa](https://github.com/Untitled-Story/Noa) 编译的 NOAP（Noa Package）资源包。本页概述包的结构和 Natsume 接受的版本。包的完整定义由 Noa 维护，Natsume 仓库的 `packages/natsume/schemas/` 保存了所使用的模式文件，并在 `provenance.json` 中记录了它们的来源和哈希。

## 接受的版本

| 项目 | 版本 |
| --- | --- |
| NOAP 清单 | `format: "noa-package"`，`version: 1` |
| NOIR（场景文档） | 1.0，契约标识 `noa.effects/1.0` |
| NOMS（网格） | 1.0，契约标识 `noa.mesh/1.0` |

不在此列的版本会以 `VERSION` 错误被拒绝。旧格式的包需要用新版 Noa 重新编译。

## 包的结构

NOAP 是一个 ZIP 压缩包，包含：

```text
manifest.json
scene.noir
assets/<id>.png | <id>.exr | <id>.noms | <id>.shader.json | <id>.bin
```

- `manifest.json` 列出包内的每个文件。
- `scene.noir` 是场景文档，使用 FlatBuffers 编码，包含节点层级、组件、动画、材质、Timeline 和入口。
- `assets/` 下的文件以资产 ID 命名，由场景文档按 ID 引用。

### 清单

```json
{
  "format": "noa-package",
  "version": 1,
  "noir_version": [1, 0],
  "document": "scene.noir",
  "files": [
    { "path": "scene.noir", "kind": "noir", "byte_length": 1234, "sha256": "…" },
    { "path": "assets/3.png", "kind": "image", "asset_id": 3, "byte_length": 5678, "sha256": "…" }
  ]
}
```

| 文件类型 `kind` | 路径 | 说明 |
| --- | --- | --- |
| `noir` | `scene.noir` | 场景文档，不带 `asset_id`。 |
| `image` | `assets/<id>.png` 或 `assets/<id>.exr` | 图像。EXR 用于 HDR。 |
| `mesh` | `assets/<id>.noms` | 网格，保留源的顶点属性、UV0 到 UV7 和三角形顺序。 |
| `shader_data` | `assets/<id>.shader.json` | 源 Shader 的描述数据。 |
| `source_data` | `assets/<id>.bin` | 源数据。 |

资产 ID 是 1 到 4294967295 的整数，同一个包内不能重复。清单的字段是封闭的，出现未知字段会被拒绝。

## 加载时的校验

`loadPack` 检查以下内容：

1. ZIP 结构和文件数量、大小限制。
2. 清单的格式和版本。
3. 压缩包内的文件集合与清单完全一致，每个文件的长度和 SHA-256 与清单相符。
4. `scene.noir` 的 FlatBuffers 二进制布局和契约版本。
5. 场景文档的语义，例如引用的对象必须存在。

校验使用 Web Crypto 的 SHA-256，因此需要在支持 `crypto.subtle` 的环境里运行，浏览器里通常意味着安全上下文（HTTPS 或 localhost）。

## 能力声明

场景文档里的 `features` 列出包需要的能力，每一项带有版本，并标明是否必需。

- 遇到 Natsume 完全不认识的必需能力，`loadPack` 直接报错。
- 已知但尚未实现的必需能力，由[兼容性预检](/guide/loading-packs#兼容性预检)和实例化阻止。

`pack.describe().features` 可以查看包声明的全部能力。
