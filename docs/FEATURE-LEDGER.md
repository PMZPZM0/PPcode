# 功能更新清单（FEATURE LEDGER）

> **定位**：功能新增/改动的**权威台账**。发布时写更新日志、GitHub Release Notes、
> `whats-new-notes.ts` 要点，一律以本文件为数据源——不重新翻 commit、不靠记忆。
>
> 与另外两份文档的分工（⛔ 不做第二份真相源）：
> - `docs/FEATURE-INVENTORY.md` = 静态基线（功能**现在在哪**，供搬迁/检索坐标）
> - `docs/CHANGELOG-ROUNDS.md` = 轮次叙事（一次改动的**完整过程**，细节长文）
> - **本文件 = 条目式流水**（一次一行，发布时直接搬）
>
> **维护规则**（写进 `AGENTS.md`，对所有 Agent 生效）：
> 1. **同轮记录**：每次新增功能 / 功能改动，同一个提交轮次内必须在本文末尾追加条目，
>    与代码改动同 commit（或在收尾提交中一并落盘）。漏记 = 工作未完成。
> 2. **列必须齐**：日期、功能名称、类型、影响范围、简要描述，缺一不可。
> 3. **类型只用这六个**：`新增` / `改动` / `修复` / `移除` / `流程`（工作方式/规则） / `基建`（仓库/CI/发布链）。
> 4. **影响范围写具体落点**（模块/板块/IPC 域），不写"全局"糊弄；跨端写明「三仓」「桌面版」等。
> 5. **只追加不改写**：写错了用新行勘误（标注"勘误"），不删旧行——台账要能追溯。
> 6. 新条目加在最上面（最新在前）。

## 条目格式

```
| 日期 | 功能名称 | 类型 | 影响范围 | 简要描述 | 提交 |
```

- **日期**：`YYYY-MM-DD`
- **类型**：新增 / 改动 / 修复 / 移除 / 流程 / 基建
- **影响范围**：模块路径或板块名，多个用顿号；跨端注明哪个仓
- **简要描述**：一两句话说清「做了什么、用户能感知什么」；含关键取舍时附一句
- **提交**：短 hash；尚未提交写 `-`

---

## 台账

| 日期 | 功能名称 | 类型 | 影响范围 | 简要描述 | 提交 |
|---|---|---|---|---|---|
| 2026-10-13 | 同步面明确包含 `logs/` 结论档案 | 流程 | `AGENTS.md` 规则块（三仓同内容）、`logs/` 结论档案（条目文件 + `index.jsonl`） | 「改动必须同轮同步全部三个仓」补一句：同步面含 `logs/` 结论档案。起因：`logs/` 此前从未进入同步批次（同步批次对 `logs/` 的 diffstat 为空）⇒ 三仓日志库漂移（PPcode 落后 19 条、云助手落后 8 条）；同日把三仓结论档案补齐到 115 条并各自 `reindex` 重建索引（⛔ sha256 与文件字节含行尾绑定，直接拷索引会哈希不符） | 6542561 |
| 2026-10-13 | 跨仓同步硬规则：改动必须同轮同步全部三仓 | 流程 | `AGENTS.md`（多仓协作段）、`docs/REPO-WORKFLOW.md`（两文件三仓同内容镜像） | 用户令「在项目规则里面写一下，改动必须要同步 ppcode 和云助手」：三仓（桌面版主线 / PPcode / 云助手）任一仓的功能改动，都要同轮同步到另外两仓并各推 `main` —— 本仓（PPcode）推 `cloud`（⛔ origin 指向桌面版仓，推错就污染主线）；只改一仓就收尾 = 该轮工作未完成。流程文档同步补入三仓拓扑与差异（生成物各仓自产、手写源逐项合并、行数棘轮按实测更新） | 20313b7 |
| 2026-10-13 | 统一组件更新体系（控制台「组件更新」） | 新增 | `electron/update-registry.ts`、`update-backends.ts`、`update-safety.ts`、`update-tar.ts`、`features/auto-update-ipc.ts`、`AutoUpdateCard.tsx` | 覆盖全部同类组件的统一更新入口（已装开发工具 / 内置工具 / 内置技能 / 市场技能 / 专家与人格包 / 插件 / ponytail / 钩子）：组件清单单一真相源 + 国内镜像序（npm→npmmirror、pip→清华、GitHub→gh-mirror）+ 更新前快照、失败回滚、内容一致即跳过；控制台一屏看版本、逐行更新、一键全更，不可单独更新的条目显式标注原因与替代路径；守卫 12l 38 条 + 实证 verify-update-safety 14/14 | ad2c179（自桌面版同步） |
| 2026-10-13 | 四类自动更新 + 开关统一到控制台 | 新增 | `app-settings.ts`、`skills-ipc.ts`、`engine-ipc.ts`、`runtime-ipc.ts`、`AutoUpdateCard.tsx` | 桌面自动化、浏览器自动化、Mac 电脑操作、Codex 引擎四类各自独立开关（默认开、持久化、成功后通知），技能内容自动更新的开关一并迁入控制台；⛔ 关闭时不发起任何检查（连版本都不比）；后台调度只留一个 owner（市场技能行不双跑） | e6fec1e、8576c55、30b6366（自桌面版同步） |
| 2026-10-13 | 技能自动更新（开关迁控制台） | 新增 | `electron/features/skills-ipc.ts`、`SkillsCenterSection.tsx`、`app-settings.ts` | 技能内容变化后台静默更新（判据与更新链路同手动一套，含安全检查）；技能页那张占位过大的「技能更新」提醒卡片整体移除（目录说明同轮改：技能页只留一句指向控制台的指路） | 5b803ff（自桌面版同步） |
| 2026-10-13 | PPcode 同步 · 统一更新体系全套 | 流程 | PPcode 仓（`PMZPZM0/PPcode`） | 自桌面版 8cafc37..f07f73f（14 提交）逐文件预检后落地：30 个文件（含新域 auto-update-ipc 与三个守卫）；副本侧自跑 gen:ipc / gen:domains，manifest 手工合并 autoUpdate 域 5 通道与 appSettings 类型串，棘轮 vite-env.d.ts 826→851（副本实测净行）；判据 = build 绿 + 12j / 12k / 12l + verify-update-safety 14/14 | b9ffddc |
| 2026-10-13 | 网页来源条挪进消息操作行 | 改动 | `MessageFooter.tsx`、`TurnWebSources.tsx`、`Status.tsx`、`04-cards-tools.css` | 用户令「跟下面这个在一行」：来源条从汇总卡内挪到回合末操作行（复制/分支/耗时/token/收藏）最右端，汇总卡回归纯文件卡；守卫 12g 19→20 条（3 处变异全抓）+ 验收 web-sources 4/4 复跑 | 2837023（自桌面版同步） |
| 2026-10-13 | 功能更新清单 = 发布数据源 | 流程 | `AGENTS.md`、`docs/FEATURE-LEDGER.md`（对所有 Agent 生效） | 每次功能新增/改动同轮在本文末尾追加六列条目（漏记 = 工作未完成）；发布日志 / Release Notes / whats-new 要点一律从本台账搬，不重翻 commit | 557f06a |
| 2026-10-12 | 汇总卡网页来源 · PPcode 同步 | 流程 | PPcode 仓（`PMZPZM0/PPcode`） | 网页来源条全套同步至 PPcode（守卫 12g / 验收项 web-sources / 副本棘轮 1911→1981 按实测），顺手解锁副本三笔存量红；原版 f6577f11（工具持久化+静默更新）留归属会话自同步 | c4d572a |
| 2026-10-12 | 本地 HTML/CSS → MP4 渲染通道 | 新增 | `electron/html-video.ts`、`html-video-ipc.ts`、`video_render_html` 工具、`scripts/render-html-video.cjs` | 零 ffmpeg：隐藏窗口 canvas + MediaRecorder（本引擎 runtime 原生支持 MP4/avc1）+ CDP 逐帧馈帧，本地 HTML 文件或 http(s) URL 渲成 MP4（默认落 `<userData>/renders/`）；模型经能力网关 `video_render_html` 可调，命令行 `scripts/render-html-video.cjs` 同引擎；守卫 21 十六条（6 处变异全抓） | 4d9f20c |
| 2026-10-12 | 壁纸星野：比例滑杆 + 拖动数字气泡 | 改动 | `WallpaperSettings.tsx`、`28-wallpaper.css`、`wallpaper.mjs` | 星野浓度用户可调（20~300%），滑杆拖动时浮出数字气泡（用户点名「别只看滑杆」）；密度实测提高约 20 倍 + 8% 亮星层次 | a5ece2c、d44ec8f |
| 2026-10-12 | 壁纸 3D 背景换「星野」（vanta 退役） | 改动 | `WallpaperLayer.tsx`、`wallpaper.mjs`、`28-wallpaper.css` | 黑夜→星空/白天→动态点、点间无连线（vanta 网状形态调不出，整体退役防复活）；自绘 canvas 零依赖，鼠标缓动视差 + 纵深系数 + 缓速自漂；旧值 `vanta` 自动迁移；守卫 14-wallpaper 37 条 | 03cd0a7 |
| 2026-10-12 | 壁纸主题色完全适配 | 修复 | `WallpaperLayer.tsx`、`28-wallpaper.css` | 3D/自定义图/粒子档未跟随主题色：vanta 深色降亮降密、自定义图与精选渐变的雾按主题分档（深 82→54% / 浅 46→18%）、粒子接上 `useThemeColor`（原切主题不换色） | c23fbf0 |
| 2026-10-12 | 550C 开机动画 | 新增 | `src/features/settings-appearance/boot550c/`、`src/lib/boot-intro.mjs`、`36-boot-550c.css`、外观设置 | 移植 DSH 插件 dsh-550c-boot（MIT）：完整 16 秒/简易 4 秒/关三档 × 琥珀/绿/青/白四配色，外观页一行可切换+预览；Shadow DOM + portal body + useLayoutEffect（防闪主帧）；`?popout=` / `?pet=1` / 减弱动效不播；守卫 20 共 34 条 + 验收 boot-intro 八条 | b072389、7a8d706 |
| 2026-10-13 | 汇总消息右下角网页来源 | 新增 | `src/features/status/Status.tsx`、`TurnWebSources.tsx`、`src/lib/turn-web-sources.mjs` | 回合完成后在状态卡右下角显示本轮引用的网页来源（favicon 条，悬停看标题/链接），从回合事件流提取域名去重 | 6b098cb |
| 2026-10-13 | 开发工具持久化 | 修复 | `electron/features/tool-persistence.ts`、`dev-runtimes.ts`、`runtime-ipc.ts` | 修复「应用更新后手动安装的非内置工具（git/ffmpeg 等）全部丢失」：安装/卸载记账到 `<userData>/installed-tools.json`（原子写、只记非内置项、退出码 0 才记） | 2f757e7 |
| 2026-10-13 | 更新后台静默下载 + 重启安装 | 新增 | `electron/features/updates-ipc.ts`、`UpdateReadyToast.tsx`、`01-sidebar-shell.tsx` | 发新版后启动 8s 自动静默检查下载（sha256 校验），下好左下角弹「更新已就绪」（取消=延后 / 重启安装=先 spawn 安装包再退自己）；手动检查更新发现已下好的包同样弹窗 | 2f757e7 |
| 2026-10-13 | 改动备份（数据管理板块） | 新增 | `electron/features/change-backup.ts`、`change-backup-ipc.ts`、`ChangeBackupSection.tsx` | 与 WorkBuddy 同构的回合级改动备份：开关（默认关）+ 可自定义目录；每回合结束落 changes-index + changes-detail；**3GB 上限**超了按会话移入系统回收站（先明细后索引，失败保留不硬删）；含 agent 工具面 4 通道（list-all / read-change / restore-file / prune） | 8cafc37 |
| 2026-10-13 | 免费网关本体随包内置 | 改动 | `scripts/prepare-{windows,mac}-tools.cjs`、`electron/features/free-gateway-ipc.ts` | 免费网关本体不再运行时下载，随安装包内置（CI 打包阶段随 extraResources 落盘） | 35b0626 |
| 2026-10-13 | 默认工作方式 = Ponytail | 流程 | `AGENTS.md`（对项目内所有 AI 助手生效） | 决策阶梯（存在吗→本仓已有→标准库→平台原生→已装依赖→一行→才写）；修 bug 修根因；4 条不许省的例外；细则全文在 AGENTS.md 同名段 | d122703 |
| 2026-10-13 | 仓库收敛：PPcode/云助手单仓公开化 | 基建 | 三仓 GitHub | `ppcode-src` 并入 `PMZPZM0/PPcode`（源码+发布一仓）后删除；`codex-harness-cloud-src` 转公开并改回自有更新源（自发布不再要跨仓 PAT）；私有仓 Actions 分钟耗尽曾致 CI 秒失败（runner 未分配、步骤数 0），公开仓免费分钟是根因修复 | - |
| 2026-10-12 | 桌面版 v0.0.41 发布 | 基建 | `codex-harness-desktop` | 内容见 `docs/releases/v0.0.41.md`：语音播报三连修（停止真停/每回合限长/状态条重做）、工具链在线更新、自动化通道修正、引擎 0.162.1、移除自动接手。0.0.40 空壳 Release 保留未动 | 8be15d9 |
| 2026-10-12 | 语音播报三连修 | 修复 | 语音板块（`11z-voice-call` 域） | 停止真停（不再播完半句）、每回合限长（超长截断）、状态条重做；同步 PPcode / 云助手 | 44fee6a |
| 2026-10-12 | 引擎升级 0.162.1 | 改动 | 引擎启动链 | npm 声明与实际二进制对齐，防重装被回退旧引擎 | 8be15d9 |
| 2026-10-12 | 移除「自动接手」 | 移除 | 回合收尾链 | 宿主侧自动续跑误判正常收尾的长报告（凭空多发一轮），按用户决定彻底删除，只留提示词层回合连续性规则 | 8be15d9 |
