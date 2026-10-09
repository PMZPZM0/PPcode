/**
 * 中转站**邀请归因**（relay affiliate）——单一真相源。
 *
 * 参考 sub2api 上游实现（`frontend/src/utils/oauthAffiliate.ts`）：
 *   · 注册页从 URL 读 `?aff=` / `?aff_code=`，命中就**落本地**（TTL 30 天），
 *     提交注册时作为 `aff_code` 字段发给 `POST /api/v1/auth/register`；
 *   · 落本地的意义：用户先点邀请链接、中途刷新/跳转/被引导去登录，归因**不会丢**。
 *
 * 本应用的差异（用户 10-09 要求「默认使用我的专属邀请链接」）：
 *   · 没有任何 URL 参数时，回落到**内置默认码** `DEFAULT_AFF_CODE`；
 *   · 于是「下载即带归因」——用户不用点链接、不用填邀请码，注册即绑定。
 *
 * ⛔ 为什么单独一个基座文件：原先这个码硬编码在 `RelayCenterPage/use-relay-center-page-state.tsx`
 *   里（`const AFF_CODE = "X82JSNVC3W3S"`），只有在「中转站面板」注册才带；首屏登录页、引导弹窗
 *   各写一份必然漂移。现在**所有注册入口都从这里取**（守卫钉住：不许再出现第二处字面量）。
 */

/** 专属邀请码（用户提供）。⛔ 改这里 = 改全应用归因，别在别处再写死一份。 */
export const DEFAULT_AFF_CODE = "X82JSNVC3W3S";

/** 归因本地存储键 / 有效期（与上游同为 30 天）。 */
const AFF_STORAGE_KEY = "relay_aff_code";
const AFF_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type StoredAff = { code: string; expiresAt: number };

/** 归因码清洗：去空白、只留安全字符、截断（防 URL 里塞超长串污染请求体）。 */
export function normalizeAffCode(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
}

/** 落库（仅在有码时写；写失败静默 —— 存储不可用不该阻断注册）。 */
export function storeAffiliateCode(value: unknown, now = Date.now()): string {
  const code = normalizeAffCode(value);
  if (!code) return "";
  try {
    const payload: StoredAff = { code, expiresAt: now + AFF_TTL_MS };
    window.localStorage.setItem(AFF_STORAGE_KEY, JSON.stringify(payload));
  } catch { /* 忽略存储异常 */ }
  return code;
}

/** 读取未过期的归因码；过期即清。 */
export function loadAffiliateCode(now = Date.now()): string {
  try {
    const raw = window.localStorage.getItem(AFF_STORAGE_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as Partial<StoredAff>;
    const code = normalizeAffCode(parsed?.code);
    const expiresAt = Number(parsed?.expiresAt) || 0;
    if (!code || expiresAt <= now) { clearAffiliateCode(); return ""; }
    return code;
  } catch {
    clearAffiliateCode();
    return "";
  }
}

export function clearAffiliateCode(): void {
  try { window.localStorage.removeItem(AFF_STORAGE_KEY); } catch { /* 忽略 */ }
}

/**
 * 从 URL query 捕获归因码（`?aff=` 优先，兼容 `?aff_code=`）。
 * 命中的码会落库 30 天；未命中返回空串（**不**回落默认码 —— 调用方自己决定）。
 */
export function captureAffiliateFromUrl(search: string, now = Date.now()): string {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(String(search ?? ""));
  } catch {
    return "";
  }
  const code = normalizeAffCode(params.get("aff")) || normalizeAffCode(params.get("aff_code"));
  return code ? storeAffiliateCode(code, now) : "";
}

/**
 * 归一化后的「本次注册该带哪个码」：**实参（URL/表单） → 本地存储 → 内置默认码**。
 * ⛔ 默认码只是**兜底**，不落库：这样用户日后点别人的邀请链接，仍能覆盖掉默认归因。
 */
export function resolveAffiliateCode(...values: unknown[]): { code: string; source: "input" | "stored" | "default" } {
  for (const value of values) {
    const code = normalizeAffCode(value);
    if (code) return { code: storeAffiliateCode(code), source: "input" };
  }
  const stored = loadAffiliateCode();
  if (stored) return { code: stored, source: "stored" };
  return { code: DEFAULT_AFF_CODE, source: "default" };
}

/** 展示用：把码遮成 `X82J…C3W3S`（首屏不必把完整邀请码摊给所有人看）。 */
export function maskAffCode(code: string): string {
  const value = normalizeAffCode(code);
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
