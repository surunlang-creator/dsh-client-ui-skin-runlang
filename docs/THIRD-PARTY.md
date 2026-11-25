# 第三方组件与许可

Runlang皮肤本体是 MIT（见根目录 `LICENSE`）。本文件列出随仓库分发（或作为实现依据）的第三方组件、
版本、许可与归属；分发包会带上 `lib/we-wallpaper/`、`vendor/we-wallpaper/`、
`vendor/webwallgl/` 及各自的许可文件。

## 1. dsh-we-wallpaper 宿主半（MIT）

v0.6.0 的 Wallpaper Engine 库集成把上游 **dsh-we-wallpaper** 的宿主半（MIT）**以源码形式内嵌**，
使皮肤能在**不填写任何目录**的前提下浏览本机 Wallpaper Engine 库。

| 项 | 值 |
|---|---|
| 上游 | <https://github.com/pbadgpmeb22791-sketch/dsh-we-wallpaper> |
| 版本 / 提交 | `v0.4.0` @ `61ccaa2`（把 v0.4.0 提升到仓库根的 restructure commit） |
| 归属 | Copyright (c) 2026 **dsh-we-wallpaper contributors** |
| 内嵌文件 | `lib/we-wallpaper/host.mjs`（单 ESM，仅 Node 内置模块；上游 `lib/index.js`，由上游 TS 源码构建） |
| 许可全文 | [`lib/we-wallpaper/LICENSE`](../lib/we-wallpaper/LICENSE) |
| 修改说明 | [`lib/we-wallpaper/README.md`](../lib/we-wallpaper/README.md)（grep `QINGLAN` 可定位全部改动） |

保留：无框架扫描器、无依赖 `.pkg`/TEX 解码器、HTTP 路由族。
未内嵌：上游 cordis/settings 插件接线与上游客户端半（由本皮肤自己的客户端渲染列表并播放壁纸）。

对本仓库的修改（摘要，详细见上表 README）：去掉插件接线改为纯函数导出；同源校验放宽到 DSH Desktop
webview 与 `127.0.0.1/localhost`（跨站仍 403）；运行状态/缓存从 `~/.dsh` 移到插件 gitignored `state/`
（`QINGLAN_WE_HOME` 可覆盖）；wcap 路径指向 `vendor/we-wallpaper/wcap/`；本地 project 的 `.pkg` 也支持解出；
场景动态缓存 503 语义明确；扫描器结果映射为本皮肤的 `_wallpapers`/`_engines` 形状。

```text
MIT License

Copyright (c) 2026 dsh-we-wallpaper contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 2. wcap（Unlicense / 公有领域）

可选的「场景动态缓存」（Windows-only）使用上游 dsh-we-wallpaper 随附的窗口捕获工具 `wcap`：

| 文件 | 来源 | 许可 |
|---|---|---|
| `vendor/we-wallpaper/wcap/wcap-x64.exe` | 上游 `tools/wcap/wcap-x64.exe` | Unlicense（public domain） |
| `vendor/we-wallpaper/wcap/scene-capture-desktop.ps1` | 上游 `tools/wcap/` | Unlicense |
| `vendor/we-wallpaper/wcap/send-window-capture-hotkey.ps1` | 上游 `tools/wcap/` | Unlicense |
| 许可全文 | 上游 `tools/wcap/LICENSE`，逐字内嵌 | [`vendor/we-wallpaper/wcap/LICENSE`](../vendor/we-wallpaper/wcap/LICENSE) |

```text
This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or distribute
this software, either in source code form or as a compiled binary, for any
purpose, commercial or non-commercial, and by any means.

In jurisdictions that recognize copyright laws, the author or authors of
this software dedicate any and all copyright interest in the software to the
public domain. We make this dedication for the benefit of the public at large
and to the detriment of our heirs and successors. We intend this dedication
to be an overt act of relinquishment in perpetuity of all present and future
rights to this software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <https://unlicense.org>.
```

> `wcap` 只在用户显式请求「生成动态」时被 `POST /api/ql-we-wallpaper/scene-video/generate/<id>` 调用；
> 仓库测试套件用 `QINGLAN_WE_DISABLE_SCENE_VIDEO=1` 跳过它（不会在维护者桌面弹窗）。

## 3. RePKG（MIT，DXT 解码的实现依据）

`lib/we-wallpaper/host.mjs` 的 `pkg-tex` 解包/解码器在格式实现上参考并移植了 **RePKG** 的 DXT 解码
（LibSquish 派生的 C# 实现）；上游 dsh-we-wallpaper 同样以此为实现依据。

| 项 | 值 |
|---|---|
| 项目 | <https://github.com/notscuffed/repkg> |
| 归属 | Copyright (c) **Xalcon @ mmowned.com**（见上游文件头） |
| 许可 | MIT |
| 使用方式 | 格式/算法参考与 DXT 解码移植；未整份复制其 C# 实现 |

RePKG 的 MIT 许可全文（v2.0.4 起逐字附在这里，随 npm 包分发）：

```
MIT License

Copyright (c) Xalcon @ mmowned.com

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 4. WebWallGL（MIT）

Wallpaper Engine 场景通道使用仓库内 `vendor/webwallgl/` 的 WebWallGL 3.0（可选依赖，不内联进
`lib/client.js`）：

| 项 | 值 |
|---|---|
| 位置 | `vendor/webwallgl/webwallgl.global.min.js`（+ `README.upstream.md`） |
| 归属 | Copyright (c) 2026 **oneincase** `<462534624@qq.com>` |
| 许可 | MIT；全文见 [`vendor/webwallgl/LICENSE`](../vendor/webwallgl/LICENSE) |

## 4.1 二进制与压缩代码（v2.0.4 起公布校验值）

下面两个文件不是从本仓库源码构建的，包内无法审计其源码，只能按来源与校验值核对。`wcap-x64.exe` 未做代码签名，且只在用户显式点击「生成动态」时才会运行。

| 文件 | SHA-256 | 来源 |
|---|---|---|
| `vendor/we-wallpaper/wcap/wcap-x64.exe` | `4bd124febf537f0f569bd5cb7486ddbb9e664b509f39e421e6949767829b6be6` | 上游 dsh-we-wallpaper `tools/wcap/wcap-x64.exe`，原样复制 |
| `vendor/webwallgl/webwallgl.global.min.js` | `2f86ab955f3377e2fa2cfd5ffa72f5813fe8f6e4a272295fed36f4c1e626b1e5` | WebWallGL 3.0 发布的压缩构建，原样复制（见 `vendor/webwallgl/README.upstream.md`） |

`tools/test.mjs` 会断言这两个校验值，文件被替换时测试会变红。

## 5. 默认演示素材

Runlang基于 [天光 2.3.0](https://github.com/MilkySnowWay123/dsh-client-ui-skin-tianlight)，保留原作者版权和 MIT 许可声明。
`assets/runlang-loop.mp4` 源于用户提供的「浮生梦影 AI」短片，仅用于本地壁纸；`assets/cat.png` 是随天光安装的桌宠图。
这两项素材**不在 MIT 代码许可范围内**，版权归各自权利方，不要将此本地包公开发布。

---

*本文件随 v0.6.0 新增；若后续再内嵌第三方代码，请在同一 PR 里补行并附许可全文。*

## dsh-claude-slider (v2.20.1) — MIT

The canvas slider effects (`QL_SLIDER_FX`) and the composer pet theater (`QL_PET`: pixel
sprites, audio clips, entity state machines and the stage renderer) are vendored from
[yicun0316/dsh-claude-slider](https://github.com/yicun0316/dsh-claude-slider) 2.20.1,
licensed under the MIT License, © yicun0316. Only the drawing/data/simulation layers are
copied; the tier list, fill geometry, config store and settings UI remain this skin's own.

Per its README, dsh-claude-slider itself credits the following upstream projects:
RMvdesi/obsidian-prism (GPL-3.0-only), 0DNANCY/agy-claude-style (MIT),
Nwflower/dsh-claude-style, Microqian2th/dsh-codex-effort-slider,
mobius/dsh-performance-slider, LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider
(MIT), claudenoshujin/claude-web, ATtacK030130/antigrative-dashboard (MIT),
yiheng8023/antigravity-chinese (MIT).

## 白璃桌宠图集

`assets/baili-pet.webp` 来自 Codex 桌宠资源包 `pets/baili`（宠物 id `baili`，spriteVersionNumber 2），
作者随公开版提供，按该项目的 ASSET-NOTICE.md：图集**不是** MIT 许可素材，随本仓库分发前请确认授权范围。
本皮肤只做播放：不做二次修改，也不把它重新声明为 MIT。
