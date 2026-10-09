/**
 * 应用图标构建脚本（10-09）
 *
 * 母版 = `build/icon-a-spark.svg`（**唯一真相源**）。本脚本产出：
 *   · `build/icon-a-spark-{16,24,32,48,64,128,256,512,1024}.png`  尺寸梯
 *   · `build/icon.png` / `public/icon.png`                        512 应用图标
 *     （非 Windows 的窗口图标；渲染层 UI 也用它）
 *   · `build/icon.ico`                                            多尺寸 Windows 图标
 *     （桌面快捷方式 / 任务栏 / 窗口 / electron-builder 的 win.icon）
 * 系统托盘那三份（`tray.png` / `trayTemplate.png` / `trayTemplate@2x.png`）由
 * `scripts/build-tray-icon.cjs` 从**同一母版**渲染 —— 守卫【123】钉死「托盘与应用图标同源」，
 * 用户 09-24 的原话是「桌面快捷图标是啥样，任务栏跟系统托盘就啥样」。
 *
 * 运行（resvg-js 装在隔离 workspace，不污染项目 node_modules）：
 *   NODE_PATH=<workspace>/node_modules <node> scripts/build-app-icons.cjs
 *
 * ⛔ `.ico` 里小尺寸用 **DIB(BMP)** 条目、256 用 PNG 条目 —— 这是 Windows 的传统约定
 *    （老组件只认 DIB；256 用 PNG 省体积）。resvg 的 `render().pixels` 直接给 RGBA，
 *    所以 DIB 编码自己做，不引第三方 ico 库。
 */
const fs = require("node:fs");
const path = require("node:path");

let Resvg;
try {
  ({ Resvg } = require("@resvg/resvg-js"));
} catch (error) {
  console.error("[build-app-icons] 读不到 @resvg/resvg-js：", error.message);
  console.error("  装法：cd ~/.workbuddy/binaries/node/workspace && npm install @resvg/resvg-js");
  process.exit(1);
}

const ROOT = path.resolve(__dirname, "..");
const BUILD = path.join(ROOT, "build");
const MASTER = path.join(BUILD, "icon-a-spark.svg");
const MASTER_SVG = fs.readFileSync(MASTER, "utf8");

const LADDER = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/** 渲染一次并缓存（同一尺寸只渲一遍：梯子 / icon.png / .ico 共用）。 */
const cache = new Map();
function render(size) {
  if (!cache.has(size)) cache.set(size, new Resvg(MASTER_SVG, { fitTo: { mode: "width", value: size } }).render());
  return cache.get(size);
}

/** 32bpp DIB 条目：BITMAPINFOHEADER + BGRA（自下而上）+ AND 掩码（全 0，32bpp 认 alpha 通道）。 */
function dibEntry(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);          // biSize
  header.writeInt32LE(size, 4);         // biWidth
  header.writeInt32LE(size * 2, 8);     // biHeight = 2×（XOR 位图 + AND 掩码）
  header.writeUInt16LE(1, 12);          // biPlanes
  header.writeUInt16LE(32, 14);         // biBitCount
  const rowBytes = size * 4;
  header.writeUInt32LE(rowBytes * size, 20);   // biSizeImage

  const xor = Buffer.alloc(rowBytes * size);
  for (let y = 0; y < size; y += 1) {
    const src = (size - 1 - y) * rowBytes;       // DIB 自下而上
    for (let x = 0; x < rowBytes; x += 4) {
      xor[y * rowBytes + x] = rgba[src + x + 2];       // B
      xor[y * rowBytes + x + 1] = rgba[src + x + 1];   // G
      xor[y * rowBytes + x + 2] = rgba[src + x];       // R
      xor[y * rowBytes + x + 3] = rgba[src + x + 3];   // A
    }
  }
  const maskRow = Math.ceil(size / 32) * 4;    // 1bpp，行按 4 字节对齐
  return Buffer.concat([header, xor, Buffer.alloc(maskRow * size)]);
}

/** 组装 .ico 容器：ICONDIR + ICONDIRENTRY[] + 各条目数据。 */
function buildIco() {
  const entries = ICO_SIZES.map((size) => {
    const img = render(size);
    return { size, payload: size >= 256 ? img.asPng() : dibEntry(size, img.pixels) };
  });
  const dir = Buffer.alloc(6 + entries.length * 16);
  dir.writeUInt16LE(0, 0);                     // reserved
  dir.writeUInt16LE(1, 2);                     // type = icon
  dir.writeUInt16LE(entries.length, 4);
  let offset = dir.length;
  entries.forEach((entry, i) => {
    const at = 6 + i * 16;
    const dim = entry.size >= 256 ? 0 : entry.size;   // 0 表示 256
    dir.writeUInt8(dim, at);
    dir.writeUInt8(dim, at + 1);
    dir.writeUInt8(0, at + 2);                 // 调色板数
    dir.writeUInt8(0, at + 3);                 // reserved
    dir.writeUInt16LE(1, at + 4);              // planes
    dir.writeUInt16LE(32, at + 6);             // bitCount
    dir.writeUInt32LE(entry.payload.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += entry.payload.length;
  });
  return Buffer.concat([dir, ...entries.map((e) => e.payload)]);
}

/** 写 PNG 并回读校验（签名 + 尺寸 + 体积），防止"渲染出 0 字节却静默成功"。 */
function writePng(file, buffer, size, label) {
  const target = path.join(BUILD, file);
  fs.writeFileSync(target, buffer);
  const back = fs.readFileSync(target);
  const ok = back.slice(0, 8).toString("hex") === "89504e470d0a1a0a"
    && back.readUInt32BE(16) === size && back.readUInt32BE(20) === size && back.length > 100;
  console.log(`  ${ok ? "✓" : "✗"} ${file}  ${size}x${size}  ${back.length}B  ${label}`);
  if (!ok) process.exitCode = 1;
}

function writeCopy(file, buffer, label) {
  fs.writeFileSync(path.join(ROOT, file), buffer);
  console.log(`  ✓ ${file}  ${buffer.length}B  ${label}`);
}

console.log("[build-app-icons] 从母版渲染：", path.relative(ROOT, MASTER));
for (const size of LADDER) {
  writePng(`icon-a-spark-${size}.png`, render(size).asPng(), size, size === 512 ? "512 应用图标源" : "尺寸梯");
}
writePng("icon.png", render(512).asPng(), 512, "窗口图标（非 Windows）");
writeCopy("public/icon.png", render(512).asPng(), "渲染层 UI 图标");

const ico = buildIco();
fs.writeFileSync(path.join(BUILD, "icon.ico"), ico);
const backIco = fs.readFileSync(path.join(BUILD, "icon.ico"));
const icoCount = backIco.readUInt16LE(4);
const icoOk = backIco.readUInt16LE(0) === 0 && backIco.readUInt16LE(2) === 1
  && icoCount === ICO_SIZES.length && backIco.length > 20000;
console.log(`  ${icoOk ? "✓" : "✗"} icon.ico  ${icoCount} 个尺寸 [${ICO_SIZES.join(",")}]  ${backIco.length}B  桌面快捷方式 / 任务栏 / 窗口 / 安装包`);
if (!icoOk) process.exitCode = 1;

console.log(process.exitCode ? "[build-app-icons] ✗ 有不符预期的产物" : "[build-app-icons] ✓ 全部就绪");
