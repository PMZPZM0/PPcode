/**
 * 更新源自检（PPcode 私有仓）—— **真跑**，不是读代码。
 *
 * 默认离线：桩化 `https.request`，覆盖清单解析、按平台挑资产、下载的令牌转发规则、
 *           sha256 匹配/不匹配、明文 http 拒绝、版本比较回归。
 * `--online` 追加真实 GitHub API 用例：匿名读私有仓、坏令牌、状态码区分。
 *
 * 用法：
 *   node scripts/verify-update-source.mjs
 *   node scripts/verify-update-source.mjs --online
 *   PPCODE_UPDATE_TOKEN=ghp_xxx node scripts/verify-update-source.mjs --online   # 额外验真令牌
 *
 * ⛔ 需要先 `npm run build:electron`（读的是 dist-electron 产物，不是 TS 源码）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "dist-electron");
const online = process.argv.includes("--online");

if (!fs.existsSync(path.join(OUT, "updates.js"))) {
  console.error("✗ 找不到 dist-electron/updates.js —— 先跑 npm run build:electron");
  process.exit(2);
}

/* ── 宿主替身：updates/update-source 都要 electron，且 userData 必须指向临时目录 ── */
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), "ppcode-verify-"));
const electronStub = {
  app: { getPath: () => tmpUserData, getVersion: () => "0.0.35", isPackaged: false },
  shell: { openPath: async () => "" },
};
const Module = require("node:module");
const origLoad = Module._load;
Module._load = function (request) {
  if (request === "electron") return electronStub;
  return origLoad.apply(this, arguments);
};

const U = require(path.join(OUT, "updates.js"));
const S = require(path.join(OUT, "update-source.js"));

/* 环境变量是「开发 / 调试」的兜底口径（`readUpdateSource` 会吃它）——本脚本自己的用例
   要先把它们摘掉，否则 ① 的「默认无令牌」断言会被 `PPCODE_UPDATE_TOKEN` 污染。 */
const envToken = String(process.env.PPCODE_UPDATE_TOKEN || "");
delete process.env.PPCODE_UPDATE_TOKEN;
delete process.env.PPCODE_UPDATE_REPO;
delete process.env.PPCODE_UPDATE_MANIFEST_URL;

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log("  ✓ " + msg); } else { fail++; console.log("  ✗ " + msg); } };
const section = (t) => console.log("\n" + t);

/** 取源一次：正常返回错误码字符串；**网络类**错误抛出去交给 withRetry（本机到 GitHub 偶发 TLS 抖动）。 */
async function reasonOf(promise) {
  try { await promise; return "NO_THROW"; }
  catch (e) {
    const m = e?.message || String(e);
    if (/TLS|socket|ECONN|EAI_AGAIN|EPIPE|ETIMEDOUT|timeout/i.test(m)) throw new Error("NET:" + m);
    return m;
  }
}

/** 真实网络用例的轻量重试（最多 3 次，只在网络类错误上重试）。 */
async function withRetry(fn, times = 3) {
  let out = "ERR:unknown";
  for (let i = 0; i < times; i += 1) {
    try { return await fn(); }
    catch (e) { out = "ERR:" + (e?.message || String(e)); }
    await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  return out;
}

/* ── ① 配置层 ─────────────────────────────────────────────────────────────── */
section("① 更新源配置层");
ok(path.basename(S.updateSourceFile()) === "update-source.json", "配置文件 = userData/update-source.json");
let cfg = S.readUpdateSource();
ok(cfg.repo === "PMZPZM0/PPcode", "默认仓库 = PMZPZM0/PPcode（读到 " + cfg.repo + "）");
ok(cfg.token === "" && cfg.manifestUrl === "", "默认无令牌、无自定义源");
ok(S.normalizeRepo("https://github.com/PMZPZM0/PPcode.git") === "PMZPZM0/PPcode", "repo 规范化吃掉整条 URL 与 .git");
ok(S.normalizeManifestUrl("http://x/y.json") === "", "自定义源只收 https（http 归零）");
const masked = S.maskToken("github_pat_11ABCDEFG0abcdefghij");
ok(!masked.includes("ABCDEFG") && masked.includes("…"), "令牌掩码 = " + masked);

S.saveUpdateSource({ token: "github_pat_VERIFY_ONLY" });
cfg = S.readUpdateSource();
ok(cfg.token === "github_pat_VERIFY_ONLY", "令牌落盘并回读");
const view = S.viewOfUpdateSource(cfg);
ok(view.hasToken === true && !JSON.stringify(view).includes("VERIFY_ONLY"), "渲染层视图不含令牌原文（只有 " + view.tokenHint + "）");
let threw = "";
try { S.saveUpdateSource({ repo: "not a repo" }); } catch (e) { threw = e.message; }
ok(/owner\/name/.test(threw), "非法仓库被拒：" + threw);
threw = "";
try { S.saveUpdateSource({ manifestUrl: "http://insecure/x.json" }); } catch (e) { threw = e.message; }
ok(/https/.test(threw), "http 清单地址被拒：" + threw);
S.saveUpdateSource({ token: "" });
ok(!fs.existsSync(S.updateSourceFile()), "清空后配置文件被删（回到内置默认）");

section("② 下载目录");
ok(U.defaultDownloadDir("C:/Users/x/Downloads").replace(/\\/g, "/").endsWith("/PPcode"),
  "下载目录 = …/Downloads/PPcode（不再叫 codex-harness）");

/* ── ③ 桩化 https：清单 / 资产挑选 / 下载 ────────────────────────────────── */
section("③ 清单模式与下载（桩化 https）");
const realReq = https.request;
const seen = [];
const routes = new Map();
https.request = function (opts, cb) {
  const key = opts.hostname + (opts.path || "");
  seen.push({ host: opts.hostname, path: opts.path, auth: Boolean(opts.headers?.Authorization), accept: opts.headers?.Accept });
  const route = routes.get(key) || routes.get(opts.hostname);
  const req = { on() { return req; }, end() { setImmediate(() => route(opts, cb)); }, destroy() {} };
  return req;
};
const reply = (cb, { status = 200, body = "", headers = {} }) => {
  const stream = Readable.from([Buffer.from(body, "utf8")]);
  stream.statusCode = status; stream.headers = headers;
  cb(stream);
};

const manifest = {
  version: "9.9.9",
  changelog: "验证用",
  assets: {
    win32: { url: "https://github.com/PMZPZM0/PPcode/releases/download/v9.9.9/PPcode-Setup-9.9.9.exe", size: 4242, sha256: "a".repeat(64) },
    "darwin-arm64": { url: "https://example.com/PPcode-mac.zip", size: 1 },
  },
};
routes.set("manifest.test/latest.json", (opts, cb) => reply(cb, { body: JSON.stringify(manifest) }));
const m1 = await U.checkLatestUpdate("0.0.35", "win32", "x64", { repo: "", token: "", manifestUrl: "https://manifest.test/latest.json" });
ok(m1.hasUpdate === true && m1.version === "9.9.9", "清单模式：选到 win32 资产 ⇒ hasUpdate=true，version=" + m1.version);
ok(m1.filename === "PPcode-Setup-9.9.9.exe" && m1.size === 4242 && m1.sha256 === "a".repeat(64), "文件名/大小/sha256 全部解析到位：" + m1.filename);
const m2 = await U.checkLatestUpdate("0.0.35", "darwin", "arm64", { repo: "", token: "", manifestUrl: "https://manifest.test/latest.json" });
ok(m2.filename === "PPcode-mac.zip", "darwin-arm64 走平台键挑选（实测 " + m2.filename + "）");

seen.length = 0;
routes.set("api.github.com/repos/PMZPZM0/PPcode/releases/assets/7", (opts, cb) =>
  reply(cb, { status: 302, headers: { location: "https://release-assets.githubusercontent.com/github-production/x?sig=abc" } }));
routes.set("release-assets.githubusercontent.com/github-production/x?sig=abc", (opts, cb) =>
  reply(cb, { body: "INSTALLER-BYTES", headers: { "content-length": "15" } }));
const asset = "https://api.github.com/repos/PMZPZM0/PPcode/releases/assets/7";
const dest = path.join(tmpUserData, "PPcode-Setup.exe");
const dl = await U.downloadUpdate(asset, dest, null, undefined, { token: "ghp_SECRET" });
ok(dl.bytes === 15 && fs.readFileSync(dest, "utf8") === "INSTALLER-BYTES", "302 跟随 + 流式落盘成功（" + dl.bytes + " 字节）");
ok(seen[0].auth === true && seen[0].accept === "application/octet-stream", "第一跳（api.github.com）带令牌 + octet-stream");
ok(seen[1].auth === false, "第二跳（签名 CDN）**不带**令牌 —— 实测 auth=" + seen[1].auth);

const dest2 = path.join(tmpUserData, "PPcode-Setup-2.exe");
const mismatch = await U.downloadUpdate(asset, dest2, null, "b".repeat(64), { token: "ghp_SECRET" })
  .then(() => "NO_THROW").catch((e) => e.message);
ok(/校验失败/.test(mismatch) && !fs.existsSync(dest2), "sha256 不匹配 ⇒ 报错并删除下载文件");

const good = crypto.createHash("sha256").update("INSTALLER-BYTES").digest("hex");
const dest3 = path.join(tmpUserData, "PPcode-Setup-3.exe");
const okdl = await U.downloadUpdate(asset, dest3, null, good, { token: "ghp_SECRET" }).then(() => "OK").catch((e) => "ERR:" + e.message);
ok(okdl === "OK" && fs.existsSync(dest3), "sha256 匹配 ⇒ 保留文件");

const httpReject = await U.downloadUpdate("http://evil.test/x.exe", path.join(tmpUserData, "evil.exe"), null, undefined, {})
  .then(() => "NO_THROW").catch((e) => e.message);
ok(/https/.test(httpReject), "明文 http 更新包地址被拒：" + httpReject);
https.request = realReq;

/* ── ④ 版本比较回归 ──────────────────────────────────────────────────────── */
section("④ 版本比较（回归）");
ok(U.compareVersions("0.0.36", "0.0.35") === 1 && U.compareVersions("0.0.35", "0.0.35") === 0 && U.compareVersions("0.0.34", "0.0.35") === -1,
  "semver 比较保持正确");
ok(U.compareVersions("1.0.0", "1.0.0-beta") === 1, "正式版 > 预发布版");

/* ── ⑤ 真实网络（--online）──────────────────────────────────────────────── */
if (online) {
  section("⑤ 真实网络：私有仓状态区分");
  const anon = await withRetry(() => reasonOf(
    U.checkLatestUpdate("0.0.35", "win32", "x64", { repo: "PMZPZM0/PPcode", token: "", manifestUrl: "" })));
  ok(anon === "private_repo_needs_token", "匿名读私有仓 → private_repo_needs_token（实测：" + anon + "）");

  const bad = await withRetry(() => reasonOf(
    U.checkLatestUpdate("0.0.35", "win32", "x64", { repo: "PMZPZM0/PPcode", token: "ghp_definitely_not_valid_000000000000000000", manifestUrl: "" })));
  ok(bad === "token_invalid", "坏令牌 → token_invalid（证明 Authorization 真发出去了；实测：" + bad + "）");

  if (envToken) {
    const r = await withRetry(async () => {
      try {
        const v = await U.checkLatestUpdate("0.0.35", "win32", "x64", { repo: "PMZPZM0/PPcode", token: envToken, manifestUrl: "" });
        return "OK:" + JSON.stringify({ hasUpdate: v.hasUpdate, reason: v.reason });
      } catch (e) {
        const m = e?.message || String(e);
        if (/TLS|socket|ECONN|EAI_AGAIN|EPIPE|ETIMEDOUT|timeout/i.test(m)) throw new Error("NET:" + m);
        return "ERR:" + m;
      }
    });
    ok(/OK:.*"reason":"no_release"|ERR:token_invalid/.test(r),
      "真令牌 → 读到仓库（no_release）或已撤销（token_invalid）：" + r);
  } else {
    console.log("  · 跳过真令牌用例（未设置 PPCODE_UPDATE_TOKEN）");
  }
} else {
  console.log("\n· 跳过真实网络用例（加 --online 打开）");
}

console.log("\n【更新源自检】" + pass + "/" + (pass + fail) + " 通过" + (fail ? "，✗ " + fail : ""));
try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* 忽略 */ }
process.exit(fail ? 1 : 0);
