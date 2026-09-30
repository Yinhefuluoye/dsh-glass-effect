# 玻璃效果（dsh-glass-effect）

给 DSH 界面加一层玻璃材质：**输入框、弹窗、菜单、卡片、代码块**共用同一种半透明质感，
深浅两套配色各自调过。

![设置里的开关](assets/settings-row.png)

## 它做什么

- 输入框、弹窗、菜单、代码块、任务面板、右侧栏面板统一成同一族**半透明材质**；
- 顶部细高光 + 边缘反光 + 背景模糊，深浅两套配色各自取值；
- 设置里一行**总开关**，关掉即**完全恢复原生外观**（一个属性都不留）。

## 安装

把插件装进你正在用的那个 profile（桌面端通常是 `%USERPROFILE%\.dsh\profiles\desktop`，
网页端是 `%USERPROFILE%\.dsh\profiles\web`）：

```powershell
$profile = "$env:USERPROFILE\.dsh\profiles\desktop"
& node <DSH 自带的 pnpm.mjs> -C $profile add "file:<这个仓库的路径>"
```

再把 `"dsh-glass-effect"` 追加进该 profile 的 `package.json`：

```jsonc
{ "dsh": { "profile": { "bundles": [ /* … */, "dsh-glass-effect" ] } } }
```

然后**重启 DSH**（客户端插件在启动时装入）。改过插件源码后，要 `remove` + `add`
重新安装才会刷新 profile 里的副本。

> 桌面端没有刷新快捷键（`Ctrl+R` 无效）——**重启应用**即可。

## 使用

打开 **设置 → 通用 → 外观**，三个配色格子（浅色 / 深色 / 跟随系统）的**正下方**就是这一行：

| | |
| --- | --- |
| **开** | 应用玻璃外观 |
| **关** | 与下载的原版**完全一致**（深浅两套都是） |

没有快捷键，也没有第二处开关——这一行就是全部。

## 卸载

从 profile 的 `dsh.profile.bundles` 里删掉 `"dsh-glass-effect"`，再 `pnpm remove dsh-glass-effect`，
重启即可。只想暂时变回原样的话，用上面那个开关就行。

## 兼容性

- **桌面端（Electron）与网页端（`dsh web`）都能用**——两者跑的是同一套 Web 客户端；
- 开关状态按站点（origin）各存各的，桌面端和网页端互不影响；
- 依赖 DSH **0.2.x**（用到 `settings.general.item` 槽与 `ui-primitives` 的 `Switch`）。

## 它不做什么

- **不联网**：没有 fetch / XHR / WebSocket，没有任何外部请求；
- **不采集**：不读 cookie、会话数据或任何凭据；
- **不改别人的东西**：只往页面插一张样式表、在 `body` 上挂几个属性、经主题服务覆盖一层 token、
  以及在设置里注册那一行；卸载时全部还原；
- 只写自己的几个 localStorage 键（开关和几个微调值）；
- **不注册任何全局快捷键**。

想核对的话：`lib/client.js` 是手写的单文件、**无构建步骤**，可以直接读；
`tools/verify.mjs` 是离线自检，其中一条断言专门守着"不得联网、不得碰会话数据"。

## 许可

MIT。玻璃手法参考 [394804078-pixel/dsh-liquid-glass](https://github.com/394804078-pixel/dsh-liquid-glass)（同样 MIT），
署名保留在 [LICENSE](LICENSE)。
