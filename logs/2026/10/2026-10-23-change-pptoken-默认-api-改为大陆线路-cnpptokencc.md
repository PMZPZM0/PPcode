---
id: 2026-10-23-change-pptoken-默认-api-改为大陆线路-cnpptokencc
date: 2026-10-23
kind: change
area: model
title: PPtoken 默认 API 改为大陆线路 cn.pptoken.cc
tags: [pptoken, endpoint, cn, provider]
commits: []
files: [src/lib/pptoken-endpoints.ts, src/features/settings-model/ModelSettingsSection.tsx, scripts/guards/04-misc-and-tools.mjs]
importance: normal
---

# PPtoken 默认 API 改为大陆线路 cn.pptoken.cc

# PPtoken 默认 API 改为大陆线路

## 起因
用户：「ppCode 里面的供应商 pptoken 供应商的默认 api 地址错了，要用国内 cn 那个」。

## 结论
- 端点表默认项改为 `https://cn.pptoken.cc/v1`（大陆优化线路）；
  国际线 `https://api.pptoken.cc/v1` 保留为第二项，US / Claude 不变。
- 供应商推荐卡与编辑表单统一读 `PPTokenEndpoints[0].url`，不再写死 api 地址。
- 登录页的 sub2api 网关地址保持 `api.pptoken.cc`（只改供应商 API 默认，不动账号登录链路）。
- 守卫【15】核对默认 cn 且禁止供应商卡写死 api。

## 验证
- 守卫 04 通过；PPcode 预检余一条与本改动无关的 12k 自动更新并发红。
