#!/usr/bin/env node
/**
 * 生成「自定义更新源」清单（latest.json）—— 免手写 sha256 / size 出错。
 *
 * 用法：
 *   node scripts/gen-update-manifest.mjs --version 0.0.37 \
 *     --win  dist/PPcode-Setup-0.0.37.exe \
 *     --mac  dist/PPcode-0.0.37-mac-arm64.zip \
 *     --base-url https://your-host/ppcode \
 *     --out  latest.json
 *
 * 说明：
 *   · `--base-url` 给了就按 `<base>/<文件名>` 生成下载地址（配合把产物放到同一目录）；
 *     不给则要求每个文件用 `--url-<平台>` 显式指定地址。
 *   · mac 分架构用 `--mac`（arm64）与 `--mac-x64`；不区分就只给一个。
 *   · ⛔ 生成的地址必须是 https —— 这个地址的产物会被 `shell.openPath()` 当安装包执行，
 *     明文 http 在客户端的 `updates.ts` 里会被硬拒（含每一跳重定向）。
 *   · 清单格式与失败码含义见 docs/UPDATE-SOURCE.md。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^\/\*\*?/, ""));
  process.exit(0);
}

function arg(name, fallback = "") {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const version = arg("version").replace(/^v/i, "");
const baseUrl = arg("base-url").replace(/\/+$/, "");
const out = arg("out", "");
if (!version) {
  console.error("✗ 缺少 --version");
  process.exit(2);
}

/** 计算 sha256（流式，大安装包不整份进内存）。 */
async function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("data", (c) => hash.update(c));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

const plan = [
  { key: "win32", file: arg("win"), url: arg("url-win") },
  { key: "darwin-arm64", file: arg("mac"), url: arg("url-mac") },
  { key: "darwin-x64", file: arg("mac-x64"), url: arg("url-mac-x64") },
].filter((p) => p.file || p.url);

if (!plan.length) {
  console.error("✗ 至少要给一个产物：--win / --mac / --mac-x64");
  process.exit(2);
}

const assets = {};
for (const item of plan) {
  const name = item.file ? path.basename(item.file) : path.basename(item.url);
  const url = item.url || (baseUrl ? `${baseUrl}/${encodeURIComponent(name)}` : "");
  if (!url) {
    console.error(`✗ ${item.key}：既没给 --base-url 也没给 --url-*，拼不出下载地址`);
    process.exit(2);
  }
  if (!/^https:\/\//i.test(url)) {
    console.error(`✗ ${item.key}：下载地址必须是 https（当前 ${url}）`);
    process.exit(2);
  }
  let size;
  let hash;
  if (item.file) {
    if (!fs.existsSync(item.file)) {
      console.error(`✗ 找不到产物：${item.file}`);
      process.exit(2);
    }
    size = fs.statSync(item.file).size;
    hash = await sha256(item.file);
  } else {
    console.warn(`· ${item.key} 只有地址没有本地产物 ⇒ 清单里不带 size/sha256（客户端会跳过哈希校验）`);
  }
  assets[item.key] = {
    url,
    filename: name,
    ...(size !== undefined ? { size } : {}),
    ...(hash ? { sha256: hash } : {}),
  };
}

const manifest = {
  version,
  changelog: arg("changelog"),
  prerelease: args.includes("--prerelease"),
  assets,
};
const text = JSON.stringify(manifest, null, 2) + "\n";
if (out) {
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, text, "utf8");
  console.log(`✓ 已写出 ${out}（${Object.keys(assets).join(", ")}）`);
} else {
  process.stdout.write(text);
}
