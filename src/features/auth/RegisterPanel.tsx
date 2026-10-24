/**
 * 注册面板（10-24 品牌特供款：**默认走 pptoken 云管理的注册**）。
 *
 * 用户令（10-24）：「注册界面默认走 pptoken 云管理的注册功能，也加上用户名输入框」。
 *   · **默认视图** = 云管理注册：云端账号服务没有应用内注册接口（cloud-auth 域只有
 *     login/logout/switch/status/points），注册在云端网页用户中心完成 —— 主按钮打开
 *     `cloudCenterUrl`（由账号服务基址派生，⛔ 不写死域名，见 cloud-links.mjs）。
 *     注册完回「登录」用同一账号登录，登录即自动配好模型 / 知识库 / 记忆。
 *   · **折叠备用** = 中转站邮箱注册表单（sub2api 站点：邮箱 + 验证码），整块收进
 *     「高级」折叠里 —— 它注册的是**中转站网关**账号，与云管理不是同一套账号体系。
 *     用户名字段在本表单里（performRelayRegister 的 username = 界面昵称）。
 *
 * ⛔ 中转站注册的站点能力（验证码开关 / 邀请码 / 图形验证码）仍以公开设置为准（`relay:public-settings`），
 *   写死任何一条，站点一改配置注册就整条失效。
 * ⛔ 邀请归因**不进界面**（10-09 用户令）：码只随请求体 / 网页注册 URL 静默带上。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Cloud, ExternalLink, Loader2, Mail, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { captureAffiliateFromUrl, resolveAffiliateCode } from "../../lib/relay-affiliate";
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
  /** 界面昵称回写（与登录页共用同一份 state，登录/注册两处输入互相同步）。 */
  onUsernameChange?: (value: string) => void;
  /** pptoken 云管理用户中心（由账号服务基址派生；空串 = 还没拿到，主按钮降级提示）。 */
  cloudCenterUrl?: string;
  onLogin: (info: { provider: string; name: string; baseUrl: string; apiKey: string; model: string; username?: string }) => Promise<boolean>;
  onBack: () => void;
};

export function RegisterPanel({ baseUrl, username, onUsernameChange, cloudCenterUrl, onLogin, onBack }: Props) {
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

  /** 本次注册**静默**携带的邀请码：URL → 本地存储 → 内置默认码（默认码只在最后兜底）。
   *  ⛔ 10-09 用户令：「邀请归因不要透出来，默认用我的邀请码注册就行」⇒ 只进请求体，
   *     界面上一个字都不显示（连掩码也不显示）。 */
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
    // 走网页注册这条兜底路时，归因只能靠 URL 参数（站点的注册页就是这么读的）——
    // 这是**功能必需**，不是"透出来"：页面本身不显示任何码。
    void window.codex.openExternal(`${baseUrl.replace(/\/$/, "")}/register?aff=${encodeURIComponent(affiliate.code)}`).catch(() => undefined);
  };

  const openCloudRegister = () => {
    if (!cloudCenterUrl) { setError("还不知道云管理服务地址 —— 先回「登录」试一次，或检查网络后重试"); return; }
    void window.codex.openExternal(cloudCenterUrl).catch((e: any) => setError("打开失败：" + (e?.message ?? e)));
  };

  const loadingSettings = busy === "settings";

  return (
    <div className="authx-panel">
      <button type="button" className="authx-back" onClick={onBack}><ArrowLeft size={13} />返回登录</button>

      {/* ── 默认：pptoken 云管理注册（网页端完成，注册完回「登录」即用） ── */}
      <div className="authx-cloud-register">
        <div className="authx-cloud-register-icon"><Cloud size={22} /></div>
        <strong>注册 pptoken 云管理账号</strong>
        <p>一个账号管全部：模型额度、知识库、记忆。注册在网页端完成，注册后回「登录」用同一账号登录，
          应用会自动配好模型供应商（登录即用，不用手动填 Key）。</p>
        <button type="button" className="authx-primary" onClick={openCloudRegister}>
          <ExternalLink size={15} />去云管理注册（浏览器打开）
        </button>
        <p className="authx-note">已经有云管理账号了？切回上方「登录」，选「云管理账号」直接登录。</p>
      </div>

      {/* ── 备用：中转站邮箱注册（sub2api 网关账号；整块折叠进高级） ── */}
      <details className="authx-adv">
        <summary>用中转站邮箱注册（高级）</summary>

        {loadingSettings ? (
          <div className="authx-loading"><Loader2 size={15} className="authx-spin" />正在读取站点设置…</div>
        ) : settings && !settings.registrationEnabled ? (
          <div className="authx-loading">该站点已关闭注册，请改用登录或前往网页端了解开放时间。</div>
        ) : null}

        <label className="authx-field">
          <span>用户名（选填）</span>
          <div className="authx-input">
            <UserRound size={14} />
            <input value={username ?? ""} onChange={(e) => onUsernameChange?.(e.target.value)} placeholder="注册后显示在左上角" />
          </div>
        </label>

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
            <ExternalLink size={13} />该站点需要图形验证码，去网页注册
          </button>
        )}
        <p className="authx-note">
          注册成功后会自动登录并接入模型供应商。
          {settings?.siteName ? ` 当前站点：${settings.siteName}。` : ""}
        </p>
      </details>
    </div>
  );
}
