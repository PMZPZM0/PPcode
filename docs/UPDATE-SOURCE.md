# 更新源（私有仓）—— PPcode

> 起因：PPcode 的发布仓 `PMZPZM0/PPcode` 是**私有仓库**。GitHub 对私有仓的
> `GET /repos/{owner}/{repo}/releases/latest` 在**匿名**请求下一律返回 **404**
> （形态与「仓库不存在」完全一样），所以原本零配置的「检查更新」必然失败。
> 本文件说明两条出路、清单格式与排查口径。

---

## 一、两条出路

| 方案 | 谁持有密钥 | 适合 |
|---|---|---|
| **A. GitHub 只读令牌** | 每台机器（填在应用内，落 `userData/update-source.json`） | 自用 / 少量机器；零服务端 |
| **B. 自定义清单 `manifestUrl`** | 服务端（令牌不下发） | **对外分发**；可在私有仓前挂一层代理 |

⛔ **不要把令牌打进安装包**：安装包会被分发出去，`asar` 里的字符串取出来不难 ——
那就等于把私有仓（含源码）公开了，「不开源」这条就白设了。对外分发只有方案 B 成立。

---

## 二、方案 A：只读令牌

1. GitHub → Settings → Developer settings → **Personal access tokens → Fine-grained tokens** → Generate new token
2. **Repository access** → `Only select repositories` → 勾 **`PMZPZM0/PPcode`**
3. **Permissions → Repository permissions** → 只勾 **`Contents: Read-only`**
   - ⛔ 不要给 `Administration`、不要给写权限 —— 本应用对发布仓**只有读**需求
4. 生成后复制（只显示一次），在应用里：**账号菜单 → 检查更新 → 粘贴 → 保存并重试**
   - 打开「检查更新」时若报 `private_repo_needs_token`，界面会直接给出这个输入框与申请链接

令牌存哪：`%APPDATA%\PPcode\update-source.json`（macOS：`~/Library/Application Support/PPcode/`），
文件按 `0600` 写。**渲染层永远只拿得到掩码**（如 `github_pa…ijkl`），全量原文不出主进程。

> 令牌被撤销/过期时表现为 `token_invalid` → 界面提示「令牌无效或已过期」，换一个即可。

---

## 三、方案 B：自定义清单

在应用里把「更新源设置 → 自定义清单地址」填成一个 https 的 JSON 地址即可（留空则回到 GitHub 源）。

### 清单格式（除 `version` 外全部可选）

```json
{
  "version": "0.0.37",
  "changelog": "- 修复…\n- 新增…",
  "prerelease": false,
  "assets": {
    "win32": {
      "url": "https://…/PPcode-Setup-0.0.37.exe",
      "filename": "PPcode-Setup-0.0.37.exe",
      "size": 98765432,
      "sha256": "0123…（64 位十六进制）"
    },
    "darwin-arm64": { "url": "https://…/PPcode-0.0.37-mac-arm64.zip", "size": 12345678 }
  }
}
```

- **平台键**查找顺序：`darwin-<arch>` / `darwin` / `mac` / `macos`，Windows 侧 `win32` / `windows` / `win`，
  最后回退 `all` / `default`。
- 也接受**不分子平台**的平铺写法：`{ "version": "…", "url": "…", "filename": "…", "size": 0, "sha256": "…" }`。
- ⛔ 清单里的 `url` **必须是 https**：这个地址的产物会被 `shell.openPath()` 当安装包执行，
  明文 http 等于给中间的代理/DNS/公共 Wi-Fi 留了「把安装包换掉」的窗口（代码里硬拒）。
- 本仓带了一个生成器，免得手写哈希出错：

```bash
node scripts/gen-update-manifest.mjs \
  --version 0.0.37 \
  --win  dist/PPcode-Setup-0.0.37.exe \
  --mac  dist/PPcode-0.0.37-mac-arm64.zip \
  --base-url https://your-host/ppcode \
  --out  latest.json
```

### 在私有仓前挂代理（推荐的分发形态）

服务端（nginx / 任意小服务）持有一个**只读令牌**，对外只暴露一个 `latest.json`：

```
GET https://your-host/ppcode/latest.json
   └─ 服务端用令牌打 GitHub API（releases/latest）→ 归一化成上面的清单 → 逐个字段透出
GET https://your-host/ppcode/<asset>
   └─ 服务端用令牌取资产（Accept: application/octet-stream）并转发
```

客户端因此零秘密；要撤权只需在服务端换令牌，**不用重新打包发版**。

---

## 四、失败码与含义（主进程原样透传，界面据此决定给什么提示）

| 错误码 | 含义 | 怎么办 |
|---|---|---|
| `private_repo_needs_token` | 匿名读私有仓（GitHub 一律 404，代码用 `/repos/{repo}` 再探一次才分得清） | 填只读令牌，或改用自定义清单 |
| `token_invalid` | 401：令牌无效 / 已过期 / 已撤销 | 换一个令牌 |
| `repo_not_found_or_no_access` | 有令牌但读不到该仓库（仓库名错 / 令牌没勾这个仓） | 核对 `owner/name` 与令牌的仓库访问范围 |
| `github_forbidden` | 403：被拒（多为权限不足或限流） | 检查令牌权限；稍后再试 |
| `no_release` | 仓库读得到，但**一次都没发布过** | 先发一个 Release（推 `v*` tag 触发 workflow） |
| `no_asset_for_platform` | 有 Release，但没有当前平台的资产（win 找 `*.exe`，mac 按架构找 `*-mac-<arch>.zip`） | 补该平台构建产物，或修资产命名 |
| `up_to_date` / `prerelease_not_on_stable_channel` | 正常结果 | 无需处理 |

> 下载侧另有两层硬校验：地址必须是 https（含每一跳重定向）、有期望 `sha256` 就必须匹配
> （不匹配**删文件并报错**）。GitHub Release 的资产 `digest` 字段会自动作为期望哈希。

---

## 五、自检

```bash
node scripts/verify-update-source.mjs --online                      # 完整（含真实 API）
PPCODE_UPDATE_TOKEN=ghp_xxx node scripts/verify-update-source.mjs --online   # 再加验真令牌
```

覆盖：配置层读写与掩码、令牌不进渲染层、下载目录、清单解析与按平台挑资产、
下载的令牌转发规则（只发 GitHub 自家主机、302 之后不带）、sha256 匹配与不匹配、
明文 http 拒绝、版本比较回归；`--online` 追加真实 API 用例（匿名读私有仓 ⇒
`private_repo_needs_token`、坏令牌 ⇒ `token_invalid`）。

⛔ 跑之前先 `npm run build:electron`（脚本读的是 `dist-electron` 产物，不是 TS 源码）。
