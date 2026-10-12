/**
 * PPcode 自更新（client side）
 *
 * 设计原则：**发布仓私有**（`PMZPZM0/PPcode`）⇒ 匿名读不到 Releases，鉴权与自定义源
 *   统一由 `update-source.ts` 管（用户在「检查更新」里可配只读令牌或自定义清单地址）。
 *   - ⛔ 09-15 用户定稿：更新源只剩 GitHub Releases，自建发布站不再分发安装包
 *     （发布站只负责应用介绍与问题反馈），web 更新源代码整段删除
 *   - ⛔ 10-09：仓库改私有后补两条取源 —— ① GitHub + 只读令牌（Contents: Read-only）
 *     ② 自定义清单 `manifestUrl`（可在私有仓前挂代理，令牌留服务端）
 *   - channel 固定 stable，不暴露 beta/canary 选项
 *   - 桌面端只有一个动作：检查更新 → 有新版本 → 下载并打开安装程序
 *
 * 流程：checkLatestUpdate() 拉 Releases API（或自定义清单）→ downloadUpdate() 流式落盘
 *      （https + sha256）→ installUpdate() 运行安装包
 */
import fs from "node:fs/promises";
import { existsSync, createWriteStream, createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import https from "node:https";
import { shell } from "electron";
import { URL } from "node:url";
import { DEFAULT_UPDATE_REPO, readUpdateSource, type UpdateSourceConfig } from "./update-source";
import { mirrorCandidates } from "./gh-mirror";

/** GitHub 仓库（**内置默认**更新源，走 Releases API）——PPcode 的**公开**仓库
 *  （10-12：源码已合并进本仓，一个仓既是源码也是发布页；此前是私有仓 + 跨仓发布）。
 *  ⛔ 运行期真正生效的是 update-source.ts 里那份（用户在应用内可改）；这里只是
 *     「从没配置过」时的兜底，同时也是 whats-new 弹窗里 release 链接的唯一来源。 */
export const GITHUB_REPO = DEFAULT_UPDATE_REPO;
export const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

/** 订阅通道（固定 stable） */
export const UPDATE_CHANNEL = "stable";

export type ParsedVersion = { major: number; minor: number; patch: number; pre: string };

/** 解析 `v1.2.3` / `1.2.3` / `0.0.26-b` / `0.0.26-beta.1`；不是 semver 时返回 null。 */
export function parseVersion(input: string): ParsedVersion | null {
  const raw = String(input ?? "").trim().replace(/^v/i, "");
  const m = raw.match(/^(\d+)\.(\d+)\.(\d+)(?:[-.]([0-9A-Za-z.-]+))?$/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ?? "" };
}

/**
 * 语义化版本比较：a > b 返回 1，相等 0，a < b 返回 -1。
 * ⛔ 09-24 修：原先是「字符串不等 ⇒ hasUpdate」⇒ **任何不同的 tag（包括更旧的）都报有更新**，
 *    且 `0.0.26-b` 这类带后缀的版本与 `0.0.26` 的大小关系完全反直觉。
 * 规则（与 semver 一致）：先比 major/minor/patch 数值；打平后**有预发布后缀的小于正式版**，
 *    两边都有后缀时按字典序（`-b` < `-beta`，与 npm 的标识符比较同向）。
 * 非 semver 输入（解析失败）回退字符串比较 —— 但**不再是"不等即更新"**。
 */
export function compareVersions(a: string, b: string): number {
  const A = parseVersion(a);
  const B = parseVersion(b);
  if (!A || !B) return String(a) === String(b) ? 0 : (String(a) > String(b) ? 1 : -1);
  for (const key of ["major", "minor", "patch"] as const) {
    if (A[key] !== B[key]) return A[key] > B[key] ? 1 : -1;
  }
  if (A.pre === B.pre) return 0;
  if (!A.pre) return 1;   // 1.2.3 > 1.2.3-beta
  if (!B.pre) return -1;  // 1.2.3-beta < 1.2.3
  return A.pre > B.pre ? 1 : -1;
}

export type LatestInfo = {
  hasUpdate: boolean;
  reason: string;
  channel: string;
  version?: string;
  filename?: string;
  size?: number;
  sha256?: string;
  changelog?: string;
  mandatory?: boolean;
  uploadedAt?: number;
  downloadUrl?: string;
};

// ============== HTTP 工具（不走 axios / fetch，保持零依赖） ==============
// 调用方恒为 https（GitHub Releases API / 自定义清单），不再需要 http 分支

/** ⛔ 只给 GitHub 自家主机带我们的令牌：资产会 302 到签名 CDN
 *  （`release-assets.githubusercontent.com`），那里凭的是签名 URL，
 *  把 Authorization 一起转过去既不必要、也把令牌多暴露一跳。 */
function isGithubHost(hostname: string): boolean {
  return hostname === "github.com" || hostname === "api.github.com";
}

/** GitHub API 请求头（带令牌即可读私有仓；**只读用途，绝不需要写权限**）。 */
function githubHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function requestJson(
  url: string,
  timeoutMs = 8000,
  extraHeaders: Record<string, string> = {}
): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error("invalid_url"));
      return;
    }
    const req = https.request(
      {
        method: "GET",
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        timeout: timeoutMs,
        headers: { "User-Agent": "CodexHarness/0.1", ...extraHeaders },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: res.headers,
          })
        );
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.end();
  });
}

/** 归一化后的「候选版本」——两个取源（GitHub Releases / 自定义清单）都产出这个形状。 */
type ReleaseCandidate = {
  version: string;        // 已剥掉 v 前缀
  prerelease: boolean;
  changelog: string;
  downloadUrl: string;    // "" = 该平台没有可下载的资产
  filename?: string;
  size?: number;
  sha256?: string;
};

/** GitHub 资产的 `digest` 形如 `sha256:abcd…`；清单里的 `sha256` 两种写法都收。取不出则 undefined（跳过校验）。 */
function sha256Of(value: unknown): string | undefined {
  const m = String(value ?? "").trim().match(/(?:sha256:)?([0-9a-f]{64})/i);
  return m ? m[1].toLowerCase() : undefined;
}

/**
 * 检查更新。取源两条：
 *   · 默认 —— GitHub Releases API（**私有仓必须带只读令牌**，见 update-source.ts）
 *   · 配置了 `manifestUrl` —— 自定义清单（任意 https 主机；令牌可以留在服务端，客户端零秘密）
 * @param currentVersion 当前应用版本（形如 0.4.1，可带 v 前缀）
 * @param platform 按平台挑资产：win32→exe，darwin→mac zip
 * @param arch mac 下区分 x64/arm64
 * @param source 更新源；不传则现读（用户在应用内配置的那份）
 */
export async function checkLatestUpdate(
  currentVersion: string,
  platform: NodeJS.Platform = process.platform,
  arch = process.arch,
  source: UpdateSourceConfig = readUpdateSource(),
): Promise<LatestInfo> {
  const release = source.manifestUrl
    ? await fetchManifestRelease(source.manifestUrl, platform, arch)
    : await fetchGithubRelease(source, platform, arch);
  if (!release || !release.version) {
    return { hasUpdate: false, reason: "no_release", channel: UPDATE_CHANNEL };
  }
  const version = release.version;
  // ⛔ 09-24 修：改为 semver 比较 —— 旧写法「字符串不等即更新」会把**更旧的 tag** 也报成有更新。
  //    同时尊重 prerelease 标志：stable 通道下不推预发布版
  //    （**例外**：本地本身就是预发布版，如 0.0.26-b，否则 beta 用户永远收不到更新）。
  const localPre = Boolean(parseVersion(currentVersion)?.pre);
  const remotePre = release.prerelease || Boolean(parseVersion(version)?.pre);
  if (remotePre && UPDATE_CHANNEL === "stable" && !localPre) {
    return { hasUpdate: false, reason: "prerelease_not_on_stable_channel", channel: UPDATE_CHANNEL, version };
  }
  if (compareVersions(version, currentVersion) <= 0) {
    return { hasUpdate: false, reason: "up_to_date", channel: UPDATE_CHANNEL, version };
  }
  if (!release.downloadUrl) {
    return { hasUpdate: false, reason: "no_asset_for_platform", channel: UPDATE_CHANNEL, version };
  }
  return {
    hasUpdate: true,
    reason: "available",
    channel: UPDATE_CHANNEL,
    version,
    filename: release.filename,
    size: release.size,
    sha256: release.sha256,
    changelog: release.changelog,
    downloadUrl: release.downloadUrl,
  };
}

/**
 * GitHub Releases 取源（默认）。
 * ⛔ 私有仓的坑都集中在这里，三条都别改回去：
 *   ① 匿名读私有仓的 `releases/latest` 与「一次都没发布过」**同为 404** ⇒ 必须再探一次
 *      仓库元信息才分得清「没权限」和「还没发布」；
 *   ② 私有仓的资产**不能**用 `browser_download_url`（那是给匿名读公开仓的）
 *      ⇒ 有令牌时改走资产 API + `Accept: application/octet-stream`；
 *   ③ 令牌只发给 api.github.com / github.com，302 到 CDN 的那一跳不带。
 */
async function fetchGithubRelease(
  source: UpdateSourceConfig,
  platform: NodeJS.Platform,
  arch: string,
): Promise<ReleaseCandidate | null> {
  const repo = source.repo || GITHUB_REPO;
  const token = source.token;
  const directUrl = repo === GITHUB_REPO ? GITHUB_RELEASES_API : `https://api.github.com/repos/${repo}/releases/latest`;
  // ⛔ 镜像只给匿名请求用（10-11 起，镜像表在 ./gh-mirror）：令牌发到第三方反代 = 凭据泄露，
  //    私有仓镜像也读不到 ⇒ 带令牌恒直连。镜像档的 401/403/404 不代表 GitHub 的判断（ghfast 对
  //    API 已 403 "Invalid input"），一律换下一档；**只有直连档**的语义状态码才走下面的分支。
  const apiCandidates = token ? [directUrl] : mirrorCandidates(directUrl);
  let lastError: unknown = new Error("no_candidate");
  for (let ci = 0; ci < apiCandidates.length; ci++) {
    const isLast = ci === apiCandidates.length - 1;
    let res;
    try {
      res = await requestJson(apiCandidates[ci], 12000, githubHeaders(token));
    } catch (error) {
      lastError = error;
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      lastError = new Error(`HTTP ${res.status}`);
      if (!isLast) continue;
      if (res.status === 401) throw new Error("token_invalid");
      if (res.status === 403) throw new Error("github_forbidden");
      if (res.status === 404) {
        // 404 语义只在直连档判定：匿名读私有仓的 releases/latest 与「一次都没发布过」同为 404
        // ⇒ 必须再探一次仓库元信息才分得清「没权限」和「还没发布」。
        const probe = await requestJson(`https://api.github.com/repos/${repo}`, 8000, githubHeaders(token));
        if (probe.status === 401) throw new Error("token_invalid");
        if (probe.status === 404) {
          throw new Error(token ? "repo_not_found_or_no_access" : "private_repo_needs_token");
        }
        return null;   // 仓库读得到 ⇒ 真的还没发布过任何版本
      }
      throw lastError;
    }
    let release: any;
    try {
      release = JSON.parse(res.body) as any;
    } catch {
      lastError = new Error("invalid_json");
      continue;
    }
    if (!release?.tag_name) return null;
    // 按平台选资产：Windows → *.exe；mac → 按架构 *-mac-arm64.zip / *-mac-x64.zip（含 mac 即可）
    const assets: { id?: number; name: string; browser_download_url: string; size?: number; digest?: string }[] =
      Array.isArray(release.assets) ? release.assets : [];
    const match = platform === "darwin"
      ? assets.find((a) => a.name.includes("mac") && a.name.endsWith(".zip") && a.name.includes(arch))
      : assets.find((a) => a.name.endsWith(".exe"));
    return {
      version: String(release.tag_name).replace(/^v/i, ""),
      prerelease: Boolean(release.prerelease),
      changelog: String(release.body ?? "").slice(0, 2000),
      downloadUrl: match
        ? (token && match.id
          ? `https://api.github.com/repos/${repo}/releases/assets/${match.id}`
          : match.browser_download_url)
        : "",
      filename: match?.name,
      size: match?.size,
      sha256: sha256Of(match?.digest),
    };
  }
  throw lastError;
}

/**
 * 自定义清单取源（`manifestUrl`）——用来「在私有仓前挂一层代理」或直接自建分发。
 * 期望形状（除 `version` 外全部可选）：
 * ```json
 * {
 *   "version": "0.0.37", "changelog": "…", "prerelease": false,
 *   "assets": {
 *     "win32":        { "url": "https://…/PPcode-Setup.exe", "size": 1234, "sha256": "…" },
 *     "darwin-arm64": { "url": "https://…/PPcode-mac-arm64.zip" }
 *   }
 * }
 * ```
 * 也接受「不分子平台」的平铺写法：`{ version, url, filename, size, sha256 }`。
 */
async function fetchManifestRelease(
  manifestUrl: string,
  platform: NodeJS.Platform,
  arch: string,
): Promise<ReleaseCandidate | null> {
  const res = await requestJson(manifestUrl, 12000);
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
  let manifest: any;
  try {
    manifest = JSON.parse(res.body) as any;
  } catch {
    throw new Error("invalid_json");
  }
  const version = String(manifest?.version ?? "").trim().replace(/^v/i, "");
  if (!version) return null;
  const entry: any = pickManifestAsset(manifest?.assets, platform, arch) ?? manifest;
  const url = String(entry?.url ?? "").trim();
  if (url && !/^https:\/\//i.test(url)) throw new Error("清单里的更新包地址必须是 https");
  let filename = entry?.filename ? String(entry.filename) : "";
  if (!filename && url) {
    try { filename = path.basename(new URL(url).pathname); } catch { filename = ""; }
  }
  return {
    version,
    prerelease: Boolean(manifest?.prerelease) || Boolean(parseVersion(version)?.pre),
    changelog: String(manifest?.changelog ?? "").slice(0, 2000),
    downloadUrl: url,
    filename: filename || undefined,
    size: Number.isFinite(Number(entry?.size)) && Number(entry?.size) > 0 ? Number(entry.size) : undefined,
    sha256: sha256Of(entry?.sha256),
  };
}

/** 清单里按平台挑资产：先试「平台-架构」，再试平台别名，最后 `all`/`default`。 */
function pickManifestAsset(assets: unknown, platform: NodeJS.Platform, arch: string): any | undefined {
  if (!assets || typeof assets !== "object") return undefined;
  const table = assets as Record<string, unknown>;
  const keys = platform === "darwin"
    ? [`darwin-${arch}`, "darwin", "mac", "macos", "all", "default"]
    : ["win32", "windows", "win", "all", "default"];
  for (const key of keys) {
    const hit = table[key];
    if (hit && typeof hit === "object") return hit;
  }
  return undefined;
}

export type DownloadProgress = (info: {
  receivedBytes: number;
  totalBytes: number;
  percent: number;
}) => void;

export async function downloadUpdate(
  releaseUrl: string,
  destPath: string,
  onProgress?: DownloadProgress,
  expectedSha256?: string,
  opts: { token?: string } = {},
): Promise<{ path: string; bytes: number }> {
  // 私有仓的资产必须带只读令牌；令牌只发给 GitHub 自家主机（见 isGithubHost）。
  const token = String(opts.token ?? "");
  // ⛔ 09-16 实测：GitHub 的 `browser_download_url` **不是**资源本身，而是 302 到
  //    `release-assets.githubusercontent.com`（带签名的临时地址）。这里过去是裸 https.request +
  //    `status >= 300 就 reject`，**不跟随重定向** ⇒ 用户点「下载并安装」直接报 `HTTP 302`。
  //    这个坑直到 v0.0.18 才暴露：09-15 才把更新源切成 GitHub 单源，而当时仓库 0 个 release，
  //    检查更新拿不到东西，从来没走到过下载这一步。现在跟随最多 5 跳。
  const MAX_REDIRECTS = 5;
  const hop = async (url: string, depth: number): Promise<{ path: string; bytes: number }> => {
    const parsed = new URL(url);
    // ⛔ 只允许 https（09-13 审计 P0）：这条链的产物会被 `shell.openPath` 当安装包执行，
    // 明文 http 给中间的代理/DNS/公共 Wi-Fi 留了一个"把安装包换掉"的窗口。
    // 重定向的每一跳都要重新校验，防止从 https 掉到 http。
    if (parsed.protocol !== "https:") throw new Error(`更新包地址必须是 https（收到 ${parsed.protocol}）`);
    return await new Promise<{ path: string; bytes: number }>((resolve, reject) => {
      // 每一跳按**主机**决定带什么：api.github.com 要令牌 + octet-stream（读私有资产），
      // github.com 要令牌；302 之后的 CDN 凭签名 URL，什么都不带。
      const headers: Record<string, string> = { "User-Agent": "CodexHarness/0.1" };
      if (token && isGithubHost(parsed.hostname)) headers.Authorization = `Bearer ${token}`;
      if (parsed.hostname === "api.github.com") headers.Accept = "application/octet-stream";
      const req = https.request(
        {
          method: "GET",
          hostname: parsed.hostname,
          port: parsed.port || 443,
          path: parsed.pathname + parsed.search,
          headers,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          // 重定向：跟随（GitHub → release-assets.githubusercontent.com）
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume();
            if (depth >= MAX_REDIRECTS) {
              reject(new Error(`更新包地址重定向次数过多（>${MAX_REDIRECTS}）`));
              return;
            }
            let next: string;
            try {
              next = new URL(res.headers.location, url).toString();
            } catch {
              reject(new Error(`更新包地址重定向目标非法：${String(res.headers.location).slice(0, 120)}`));
              return;
            }
            hop(next, depth + 1).then(resolve, reject);
            return;
          }
          if (status < 200 || status >= 300) {
            res.resume();
            reject(new Error(`HTTP ${status}`));
            return;
          }
          const total = parseInt(String(res.headers["content-length"] ?? "0"), 10) || 0;
          const out = createWriteStream(destPath);
          let received = 0;
          res.on("data", (chunk: Buffer) => {
            received += chunk.length;
            if (onProgress) {
              onProgress({
                receivedBytes: received,
                totalBytes: total,
                percent: total ? received / total : 0,
              });
            }
          });
          res.pipe(out);
          out.on("finish", () => {
            out.close(() => resolve({ path: destPath, bytes: received }));
          });
          out.on("error", reject);
        }
      );
      req.on("error", reject);
      req.end();
    });
  };
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  // ⛔ 镜像只给匿名下载用（10-11）：带令牌的下载走资产 API（api.github.com），恒直连 ——
  //    只读令牌绝不能发给第三方反代。匿名（公开仓 browser_download_url）按 gh-proxy → ghfast →
  //    直连逐条试：网络错 / HTTP 错 / sha256 校验不过都**删掉半截文件换下一档**（校验不过最可能是
  //    镜像动了包体，直连 GitHub 是基准真相，候选最后一条恒为直连）。
  const candidates = token ? [releaseUrl] : mirrorCandidates(releaseUrl);
  let lastError: unknown = new Error("no_candidate");
  for (const candidate of candidates) {
    await fs.rm(destPath, { force: true }).catch(() => undefined);
    try {
      const result = await hop(candidate, 0);
      if (expectedSha256) {
        const actual = await sha256OfFile(result.path);
        if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
          await fs.rm(result.path, { force: true }).catch(() => undefined);
          lastError = new Error(`更新包校验失败（期望 ${expectedSha256.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…），已删除下载文件`);
          continue;
        }
      }
      return result;
    } catch (error) {
      lastError = error;
    }
  }
  if (candidates.length > 1) {
    const detail = lastError instanceof Error ? lastError.message : String(lastError);
    await fs.rm(destPath, { force: true }).catch(() => undefined);
    throw new Error(`全部下载通道（gh-proxy / ghfast / 直连）都失败了；最后一次：${detail}`);
  }
  throw lastError;
}

/** 流式计算文件 sha256（大安装包不整份读进内存）。 */
async function sha256OfFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/** 默认下载目录 = 系统「下载」目录下的 PPcode 子目录（改名残留收口：原为 codex-harness）。 */
export function defaultDownloadDir(appDownloads: string): string {
  return path.join(appDownloads, "PPcode");
}

/**
 * 运行下载好的安装包（交给系统默认程序，Windows 下即启动安装向导）
 * @returns 是否成功唤起
 */
export async function installUpdate(filePath: string): Promise<boolean> {
  if (!existsSync(filePath)) return false;
  const err = await shell.openPath(filePath);
  // shell.openPath 成功返回空字符串，失败返回错误描述
  return !err;
}

/** 文件是否存在（同步） */
export function fileExists(p: string): boolean {
  return existsSync(p);
}
