/**
 * PPcode 更新源配置（10-09 立；10-12 随「发布仓转公开」改判据）—— **唯一真相源**。
 *
 * ⚠️ **10-12 背景变更**：内置发布仓 `PMZPZM0/PPcode` **已转公开**。
 *   私有仓时代（10-09 ~ 10-12）的整套「鉴权」前提因此**不再成立**：
 *     · GitHub 对**私有仓**的 `GET /releases/latest` 在匿名请求下一律 404，
 *       所以那时必须给用户两条出路：① 只读令牌；② 自定义清单地址。
 *     · 且私有仓的 Actions 分钟**计费** —— 额度用尽时作业秒失败且拿不到 runner，
 *       这正是 PPcode v0.1.3「推了 tag 却什么都没发生」的根因。
 *   现在发布仓公开 ⇒ **默认零配置即可匿名检查更新**，且匿名才能走国内镜像（见下）。
 *
 * 因此本模块现在的职责收窄为「**用户想换源时才需要动**」：
 *   · 内置默认 = 公开仓 + **无令牌** ⇒ `updates.ts` 走 `gh-proxy → ghfast → 直连` 三档镜像；
 *   · 令牌与自定义清单**保留**给「自建私有分发 / 在仓库前挂一层代理」这类真需要它们的场景。
 *
 * ⛔⛔ **令牌绝不允许走镜像**（`updates.ts` 的令牌门：带令牌 ⇒ 恒直连）——
 *    第三方反代会拿到凭据。代价是「带着令牌就失去镜像」，所以内置公开仓一律丢弃令牌
 *    （见 `readUpdateSource` 里的 `isDefaultPublicRepo`），让
 *    **「默认 = 公开 = 匿名 = 走镜像」成为不变量**，而不是取决于用户有没有清过旧配置。
 *
 * 解析优先级：`userData/update-source.json`（用户在应用内配置的）
 *           → 环境变量（开发 / 调试用：`PPCODE_UPDATE_TOKEN` 等）
 *           → 内置默认（公开仓、无令牌、无自定义源）。
 *
 * ⛔ 惰性求值（【91】）：userData 路径只在**调用时**取。本模块被 import 的时机早于
 *    `app.setPath("userData", …)`，在模块体里取路径会静默拿到默认目录。
 * ⛔ 令牌绝不进日志、也绝不整串回给渲染层（渲染层只拿得到掩码 `tokenHint`）。
 * ⛔ 令牌只用于**读**：本模块不做任何上传 / 写入 GitHub 的动作。
 */
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

/**
 * 内置默认发布仓。改这里等于换更新源。
 * ⛔ 10-12：**该仓已转公开** —— 默认路径因此是「匿名可读」，镜像链
 *    （`gh-proxy → ghfast → 直连`）在默认配置下**必然可用**。
 */
export const DEFAULT_UPDATE_REPO = "PMZPZM0/PPcode";

/** 用户在应用内配置的三项；空串表示「没有」。 */
export type UpdateSourceConfig = {
  repo: string;
  token: string;
  manifestUrl: string;
};

/** 回给渲染层的形状：**永远不含令牌原文**。 */
export type UpdateSourceView = {
  repo: string;
  manifestUrl: string;
  hasToken: boolean;
  tokenHint: string;
  filePath: string;
};

/** 应用内配置文件（userData 下，不随仓库走）。 */
export function updateSourceFile(): string {
  return path.join(app.getPath("userData"), "update-source.json");
}

/** 环境变量兜底（开发/调试；打包版通常为空）。 */
function envValue(name: string): string {
  return String(process.env[name] ?? "").trim();
}

/** `owner/name` 规范化：容忍整条 URL、`.git` 后缀与空白。非法返回空串。 */
export function normalizeRepo(input: unknown): string {
  let raw = String(input ?? "").trim();
  if (!raw) return "";
  raw = raw.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(raw) ? raw : "";
}

/** 清单地址规范化：只接受 https（下载链会把产物当安装包执行，明文 http 不可接受）。 */
export function normalizeManifestUrl(input: unknown): string {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

/** 令牌规范化：GitHub 令牌不含空白；顺手容忍用户粘贴时带上的换行/引号。 */
export function normalizeToken(input: unknown): string {
  return String(input ?? "").trim().replace(/^["']|["']$/g, "");
}

/** 掩码：够人眼确认「填的是哪一条」，又不足以复用。 */
export function maskToken(token: string): string {
  if (!token) return "";
  if (token.length <= 12) return `${token.slice(0, 4)}…`;
  return `${token.slice(0, 8)}…${token.slice(-4)}`;
}

/** 读当前生效的更新源（永不抛；文件坏 / 不存在都退到下一级）。 */
export function readUpdateSource(): UpdateSourceConfig {
  let stored: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(updateSourceFile(), "utf8"));
    if (parsed && typeof parsed === "object") stored = parsed as Record<string, unknown>;
  } catch {
    /* 没配置过 / 文件坏了 ⇒ 走环境变量与默认值 */
  }
  const repo = normalizeRepo(stored.repo) || normalizeRepo(envValue("PPCODE_UPDATE_REPO")) || DEFAULT_UPDATE_REPO;
  /* ⛔⛔ 10-12 **内置发布仓已转公开** ⇒ 匿名可读 ⇒ 令牌既无必要、又**有害**：
   *   `updates.ts` 的令牌门是「带令牌 ⇒ 恒直连、不走镜像」（令牌发到第三方反代 = 凭据泄露，
   *   这条纪律本身是对的）。于是私有仓时代存下的那枚令牌，会让用户**静默失去国内镜像**，
   *   恰好与「必须走国内镜像更新」相反 —— 且没有任何报错，只有下载变慢。
   *   ⇒ **内置公开仓一律丢弃令牌**；用户配的**自定义私有仓**仍照旧尊重令牌（那里才真需要）。
   *   这样「默认路径 = 公开仓 = 匿名 = 镜像可用」成为不变量，不依赖用户是否清过配置。 */
  const isDefaultPublicRepo = repo === DEFAULT_UPDATE_REPO;
  return {
    repo,
    token: isDefaultPublicRepo ? "" : normalizeToken(stored.token) || normalizeToken(envValue("PPCODE_UPDATE_TOKEN")),
    manifestUrl: normalizeManifestUrl(stored.manifestUrl) || normalizeManifestUrl(envValue("PPCODE_UPDATE_MANIFEST_URL")),
  };
}

/** 渲染层回读用视图（不含令牌原文）。 */
export function viewOfUpdateSource(config: UpdateSourceConfig): UpdateSourceView {
  return {
    repo: config.repo,
    manifestUrl: config.manifestUrl,
    hasToken: Boolean(config.token),
    tokenHint: maskToken(config.token),
    filePath: updateSourceFile(),
  };
}

/**
 * 写入更新源配置（**部分更新**：只覆盖显式传进来的键；传空串 = 清除该项）。
 * @throws 规范化后非法（如 repo 不是 `owner/name`、manifest 不是 https）⇒ 报中文原因，前端原样展示。
 * @returns 写入后的完整配置
 */
export function saveUpdateSource(patch: {
  repo?: string;
  token?: string;
  manifestUrl?: string;
}): UpdateSourceConfig {
  const current = readUpdateSource();
  const next: UpdateSourceConfig = { ...current };
  if (patch.repo !== undefined) {
    const repo = normalizeRepo(patch.repo);
    if (!repo) throw new Error("仓库地址要写成 owner/name（例如 PMZPZM0/PPcode）");
    next.repo = repo;
  }
  if (patch.manifestUrl !== undefined) {
    const manifestUrl = normalizeManifestUrl(patch.manifestUrl);
    if (!manifestUrl && String(patch.manifestUrl).trim()) throw new Error("自定义更新源必须是 https 地址");
    next.manifestUrl = manifestUrl;
  }
  if (patch.token !== undefined) next.token = normalizeToken(patch.token);

  const file = updateSourceFile();
  const isEmpty = !next.token && !next.manifestUrl && next.repo === DEFAULT_UPDATE_REPO;
  if (isEmpty) {
    try { fs.rmSync(file, { force: true }); } catch { /* 忽略 */ }
    return next;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  // Windows 上 mode 基本无效（ACL 才管事），但还是尽力收一次权限；失败不影响功能。
  try { fs.chmodSync(file, 0o600); } catch { /* 忽略 */ }
  return next;
}
