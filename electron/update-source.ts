/**
 * PPcode 更新源配置（10-09）—— 私有仓时代的鉴权与自定义源，**唯一真相源**。
 *
 * 背景：PPcode 的发布仓是**私有仓库**（`PMZPZM0/PPcode`）。GitHub 对私有仓的
 *   `GET /repos/{o}/{r}/releases/latest` 在**匿名**请求下一律返回 404（等同「仓库不存在」），
 *   于是原本零配置的「检查更新」必然失败。这里给出两条出路：
 *   ① **GitHub 私有仓 + 只读令牌**（`token`）：本应用对发布仓只有读需求 ⇒
 *      fine-grained token 勾 `Contents: Read-only` 就够，**永远不要给写权限**；
 *   ② **自定义清单地址**（`manifestUrl`）：任意 https 主机上的一个小 JSON。
 *      用来「在仓库前挂一层代理」（令牌留在服务端，客户端零秘密、可对外分发），
 *      或直接自建分发。清单格式见 updates.ts 的 `checkFromManifest`。
 *
 * 解析优先级：`userData/update-source.json`（用户在应用内配置的）
 *           → 环境变量（开发 / 调试用：`PPCODE_UPDATE_TOKEN` 等）
 *           → 内置默认（本仓库、无令牌、无自定义源）。
 *
 * ⛔ 惰性求值（【91】）：userData 路径只在**调用时**取。本模块被 import 的时机早于
 *    `app.setPath("userData", …)`，在模块体里取路径会静默拿到默认目录。
 * ⛔ 令牌绝不进日志、也绝不整串回给渲染层（渲染层只拿得到掩码 `tokenHint`）。
 * ⛔ 令牌只用于**读**：本模块不做任何上传 / 写入 GitHub 的动作。
 */
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

/** 内置默认发布仓（私有）。改这里等于换更新源。 */
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
  return {
    repo: normalizeRepo(stored.repo) || normalizeRepo(envValue("PPCODE_UPDATE_REPO")) || DEFAULT_UPDATE_REPO,
    token: normalizeToken(stored.token) || normalizeToken(envValue("PPCODE_UPDATE_TOKEN")),
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
