---
id: 2026-11-01-change-ppcode-安卓包迁到自有仓库apk-更新源同步迁移
date: 2026-11-01
kind: change
area: remote
title: PPcode 安卓包迁到自有仓库，APK 更新源同步迁移
tags: [apk, github, release, remote]
commits: []
files: [electron/remote.ts, scripts/relay-gateway.mjs, scripts/guards/04-misc-and-tools.mjs, docs/REMOTE-RELAY.md]
importance: normal
---

# PPcode 安卓包迁到自有仓库，APK 更新源同步迁移

## 背景
用户令：PPcode 的安卓 APK 放到自己的 GitHub 仓库（`PMZPZM0/PPcode`），手动更新源一并迁过去。此前两个品牌的 APK 都发在主仓 `PMZPZM0/codex-harness-desktop` 的 `mobile-remote-v0.1.16`。

## 结论
- 在 `PMZPZM0/PPcode` 新建 Release `mobile-remote-v0.1.16`（id 430413310），上传 `PPcodeRemote-0.1.16.apk`（sha256 `10803fa7…`，2,888,123 字节）；主仓同 tag 里的 PPcode 资产已删除（只留 CodexRemote）。
- PP 仓代码：
  - `electron/remote.ts`：APK 下载基址改为 `https://github.com/PMZPZM0/PPcode/releases/download/…`；`REMOTE_APK_SHA256` 只登记自己的 `PPcodeRemote`。
  - `scripts/relay-gateway.mjs`：默认 `APK_URL` 指向本仓 Release。
  - 守卫 04：新增「网关 /apk 指向本仓」「下载基址指向本仓」两条断言（并入原断言，计数不变）。
- PP 服务器：systemd `RELAY_APK_URL` 切到本仓 URL，重启后 `/apk` 实测 200、2,888,123 字节、sha 一致（命中 `/var/lib/relay/apk` 缓存）。
- 未动桌面版 / 云助手：它们的 APK 仍是 CodexRemote，继续走主仓 Release。

## 依据
- GitHub API 实测：PP 仓 Release 资产 `uploaded`；主仓同 tag 仅剩 `CodexRemote-0.1.16.apk`。
- PP 服务器 `curl http://127.0.0.1:18700/apk` → `http=200 bytes=2888123`，sha256 = `10803fa7…`。
- PP 预检：两条新断言 ✓，整轮预检通过（仅 5 条告警）。

## 影响面
- PPcode 手机端「安装包」下载、网关 `/apk`、应用内 APK 更新链路改为从 PP 仓取包；桌面版/云助手不受影响。
- 历史版本 APK 仍留在主仓旧 Release（未删历史资产），旧二维码/旧包可继续用。

## 回滚
把 `remote.ts` 的下载基址与网关 `RELAY_APK_URL` 指回主仓即可（主仓历史 Release 仍在）。
