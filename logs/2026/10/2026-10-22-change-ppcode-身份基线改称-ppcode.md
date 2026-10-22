---
id: 2026-10-22-change-ppcode-身份基线改称-ppcode
date: 2026-10-22
kind: change
area: branding
title: PPcode 身份基线改称 PPcode
tags: [ppcode, identity, brand, intro]
commits: []
files: [electron/personalization.ts, electron/features/window-factory.ts, electron/builtin-skills/14-skill-harness-api.ts, scripts/gen-capability-skill.mjs, scripts/guards/06-app-behavior.mjs, AGENTS.md]
importance: normal
---

# PPcode 身份基线改称 PPcode

# PPcode 身份基线改称 PPcode

## 起因
用户：「给 PPCode 里面的 Codex 自我介绍也改一下，让他知道自己是 ppCode 应用，不是 Codexharness」。
上一轮会话在写完代码/守卫后撞到每日用量上限，未做生成器修复、验证与提交。

## 结论
- `IDENTITY_GUIDELINES` 改为：你是 **PPcode**；自我介绍一句「我是跑在 PPcode 里的编码助手…」；
  明确「不要自称 Codex Harness / Codex Harness Desktop」。
- 主窗口 / 独立会话标题改为 PPcode。
- 能力清单 `harness-api` 的品牌描述从**生成器**改（`scripts/gen-capability-skill.mjs`），
  再跑 `npm run gen:ipc` 重生成；⛔ 手改生成物会在下次生成时回滚。
- 守卫 06 增加：身份基线正/负向断言 + 生成器品牌 + 成品描述双锚。
- AGENTS.md 标题/首段改为 PPcode（多仓路径与协作规则保留）。

## 影响面
- 引擎每次启动把身份基线写进 codex-home/AGENTS.md；新会话/重启后模型自我介绍为 PPcode。
- 品牌差异只属于 PPcode 仓；不回灌桌面版（Codex Harness Desktop）和云助手（Codex Assistant）。
- 验证：守卫 06 全过；`npm run build` 通过；预检仍余一条与本任务无关的 newbie-guide 并发红。

## 回滚
恢复本提交前的 `personalization.ts` / `window-factory.ts` / 生成器即可；品牌改动不涉及数据路径。
