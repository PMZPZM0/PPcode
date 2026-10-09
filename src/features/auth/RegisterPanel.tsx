/**
 * 中转站**注册**面板（sub2api 兼容站点）。
 *
 * 参考实现：sub2api 的 `RegisterView.vue` + `utils/oauthAffiliate.ts`。
 * 这里落三件在客户端**必须**做对的事：
 *   ① **站点能力以公开设置为准**（`relay:public-settings`）：要不要邮箱验证码、有没有开邀请码、
 *      图形验证码是否开启 —— 全是站点可配的。写死任何一条，站点一改配置注册就整条失效。
 *   ② **邮箱验证码是两步**（pptoken 实测 `email_verify_enabled=true`）：先 `send-code` 拿码，
 *      注册时随 `verify_code` 提交。少了这一步注册必被拒。
 *   ③ **邀请归因**：进页面先吃 URL 的 `?aff=`（落本地 30 天），提交时经 `resolveAffiliateCode`
 *      归一化 —— 顺序是「URL/表单 → 本地存储 → 内置默认码」，所以**默认就带归因**，
 *      用户点了别人的链接也能正确覆盖。
 *
 * ⛔ 图形验证码（turnstile / 腾讯 / 阿里）本仓没有内置 widget：检测到就直接给「去网页注册」出口，
 *   不假装能注册（假成功比失败更贵）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, ExternalLink, Gift, Loader2, Mail, ShieldCheck, Sparkles } from "lucide-react";
import { captureAffiliateFromUrl, maskAffCode, resolveAffiliateCode } from "../../lib/relay-affiliate";
import { performRelayRegister } from "../../lib/relay";

type SiteSettings = {
  siteName: string;
  registrationEnabled: boolean;
  emailVerifyEnabled: boolean;
  invitationCodeEnabled: boolean;
  promoCodeEnabled: boolean;
  affiliateEnabled: boolean;
  captchaRequired: boolean;
  emailSuffixWhitelist: string[];
  apiBaseUrl: string;
};

type Props = {
  baseUrl: string;
  username?: string;
  onLogin: (info: { provider: string; name: string; baseUrl: string; apiKey: string; model: string; username?: string }) => Promise<boolean>;
  onBack: () => void;
};

export function RegisterPanel({ baseUrl, username, onLogin, onBack }: Props) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState<"" | "settings" | "code" | "register">("settings");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  /** 本页面 URL 带来的归因码（挂载时吃一次；吃过就固定，避免用户中途改地址栏造成漂移） */
  const [urlCode, setUrlCode] = useState("");
  const timerRef = useRef<number | null>(null);

  /* 进页面第一件事：吃 URL 里的 ?aff= 并落本地（30 天），再读站点能力 */
  useEffect(() => {
    setUrlCode(captureAffiliateFromUrl(window.location.search));
    let alive = true;
    void window.codex.relayPublicSettings({ baseUrl })
      .then((value) => { if (alive) setSettings(value as SiteSettings); })
      .catch((e: any) => { if (alive) setError(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+':\s*/i, "")); })
      .finally(() => { if (alive) setBusy(""); });
    return () => { alive = false; };
  }, [baseUrl]);

  useEffect(() => () => { if (timerRef.current) window.clearInterval(timerRef.current); }, []);

  /** 本次注册最终会带的邀请码：URL → 本地存储 → 内置默认码（默认码只在最后兜底） */
  const affiliate = resolveAffiliateCode(urlCode || undefined);

  const sendCode = useCallback(async () => {
    setError(""); setStatus("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError("请先填一个正确的邮箱"); return; }
    setBusy("code");
    try {
      const result = await window.codex.relaySendCode({ baseUrl, email: email.trim() });
      setStatus(result.message || "验证码已发送，请查收邮箱（含垃圾箱）");
      const total = Math.max(10, Number(result.countdown) || 60);
      setCountdown(total);
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = window.setInterval(() => {
        setCountdown((value) => {
          if (value <= 1 && timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
          return value > 0 ? value - 1 : 0;
        });
      }, 1000);
    } catch (e: any) {
      const raw = String(e?.message ?? e).replace(/^Error invoking remote method '[^']+':\s*/i, "");
      // 图形验证码站点：本仓没有 widget ⇒ 直接给网页注册出口（别假装能注册）
      setError(/captcha|turnstile|验证/i.test(raw) ? `${raw}\n该站点启用了图形验证码，请在网页端完成注册；注册后回到这里用同一账号登录即可。` : raw);
    } finally { setBusy(""); }
  }, [baseUrl, email]);

  const submit = useCallback(async () => {
    setError(""); setStatus("");
    if (!settings?.registrationEnabled) { setError("该站点当前关闭了注册（registration_enabled=false）"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError("邮箱格式不正确"); return; }
    if (settings?.emailVerifyEnabled && !code.trim()) { setError("请填写邮箱收到的验证码"); return; }
    if (password.length < 6) { setError("密码至少 6 位"); return; }
    if (password !== confirm) { setError("两次输入的密码不一致"); return; }
    setBusy("register");
    const result = await performRelayRegister({
      baseUrl,
      email: email.trim(),
      password,
      verifyCode: code.trim() || undefined,
      affCode: affiliate.code,
      username,
      onLogin,
    });
    if (!result.ok) setError(result.message ?? "注册失败");
    setBusy("");
  }, [affiliate.code, baseUrl, code, confirm, email, onLogin, password, settings, username]);

  const openWebRegister = () => {
    void window.codex.openExternal(`${baseUrl.replace(/\/$/, "")}/register?aff=${encodeURIComponent(affiliate.code)}`).catch(() => undefined);
  };

  const loadingSettings = busy === "settings";
  const affSource = affiliate.source === "input" ? "来自邀请链接" : affiliate.source === "stored" ? "来自本机已记录" : "内置默认邀请码";

  return (
    <div className="authx-panel">
      <button type="button" className="authx-back" onClick={onBack}><ArrowLeft size={13} />返回登录</button>

      <div className="authx-aff" title={`邀请码 ${affiliate.code}`}>
        <Gift size={13} />
        <span>邀请归因：<b>{maskAffCode(affiliate.code)}</b></span>
        <em>{affSource}</em>
      </div>

      {loadingSettings ? (
        <div className="authx-loading"><Loader2 size={15} className="authx-spin" />正在读取站点设置…</div>
      ) : settings && !settings.registrationEnabled ? (
        <div className="authx-loading">该站点已关闭注册，请改用登录或前往网页端了解开放时间。</div>
      ) : null}

      <label className="authx-field">
        <span>邮箱{settings?.emailSuffixWhitelist?.length ? `（仅支持：${settings.emailSuffixWhitelist.slice(0, 4).join(" / ")} 等）` : ""}</span>
        <div className="authx-input">
          <Mail size={14} />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" spellCheck={false} />
        </div>
      </label>

      {settings?.emailVerifyEnabled !== false && (
        <label className="authx-field">
          <span>邮箱验证码</span>
          <div className="authx-input">
            <ShieldCheck size={14} />
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\s/g, ""))} placeholder="6 位验证码" inputMode="numeric" autoComplete="one-time-code" />
            <button type="button" className="authx-code-btn" disabled={countdown > 0 || busy !== ""} onClick={() => void sendCode()}>
              {busy === "code" ? <Loader2 size={12} className="authx-spin" /> : countdown > 0 ? `${countdown}s` : "发送验证码"}
            </button>
          </div>
        </label>
      )}

      <label className="authx-field">
        <span>设置密码（≥6 位）</span>
        <div className="authx-input">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少 6 位" autoComplete="new-password" />
        </div>
      </label>

      <label className="authx-field">
        <span>确认密码</span>
        <div className="authx-input">
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="再输一次" autoComplete="new-password"
            onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} />
        </div>
      </label>

      {error && <div className="authx-error">{error}</div>}
      {status && !error && <div className="authx-ok"><CheckCircle2 size={13} />{status}</div>}

      <button type="button" className="authx-primary" disabled={busy !== "" || !settings?.registrationEnabled} onClick={() => void submit()}>
        {busy === "register" ? <><Loader2 size={15} className="authx-spin" />正在注册…</> : <><Sparkles size={15} />注册并自动登录</>}
      </button>

      {settings?.captchaRequired && (
        <button type="button" className="authx-ghost" onClick={openWebRegister}>
          <ExternalLink size={13} />该站点需要图形验证码，去网页注册（已带邀请码）
        </button>
      )}
      <p className="authx-note">
        注册成功后会自动登录并接入模型供应商；邀请码随注册一并提交，用于归因到邀请人。
        {settings?.siteName ? ` 当前站点：${settings.siteName}。` : ""}
      </p>
    </div>
  );
}
