import {
  ArrowRight,
  BarChart3,
  Box,
  CircleAlert,
  Eye,
  EyeOff,
  FileText,
  Globe,
  LoaderCircle,
  Lock,
  Mail,
  UserPlus,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { erpLinks } from "./lib/config";
import { readRememberedEmail, rememberEmail } from "./lib/session";

type LoginResponse = {
  accessToken?: string;
  refreshToken?: string;
  token?: string;
  user?: { name?: string; requirePasswordChange?: boolean };
  message?: string;
  error?: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SW = 1.5;

export function SignIn({
  onSignedIn,
  notice,
}: {
  onSignedIn: (token: string, remember: boolean, refreshToken?: string) => void;
  notice?: string;
}) {
  const [email, setEmail] = useState(readRememberedEmail);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const emailError = touched && !EMAIL_PATTERN.test(email.trim()) ? "Enter a valid email address." : "";
  const passwordError = touched && !password ? "Enter your password." : "";

  function useErpSession() {
    window.location.href = erpLinks.handoff(window.location.origin);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!EMAIL_PATTERN.test(email.trim()) || !password) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(erpLinks.login, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const body = (await res.json().catch(() => ({}))) as LoginResponse;
      if (!res.ok) {
        setError(res.status >= 500 ? "Excel Edge couldn't sign you in right now. Please try again shortly." : body.message || body.error || "The email or password is incorrect.");
        return;
      }
      if (body.user?.requirePasswordChange) {
        setError("Change your password in Excel Edge before opening Accounting.");
        return;
      }
      const token = body.accessToken || body.token;
      if (!token) {
        setError("Excel Edge did not return a session. Please try again.");
        return;
      }
      rememberEmail(remember ? email.trim() : null);
      onSignedIn(token, remember, body.refreshToken);
    } catch {
      setError("Can't reach Excel Edge right now. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ee-signin">
      <aside className="ee-signin-hero" aria-hidden="false">
        <div className="ee-signin-hero-brand">
          <img src="/logo.jpeg" alt="" className="ee-signin-hero-logo" />
          <div>
            <div className="ee-signin-hero-name">Excel Edge ERP</div>
            <div className="ee-signin-hero-tag">One platform. Your whole business.</div>
          </div>
        </div>

        <div className="ee-signin-hero-copy">
          <h1>
            Clarity for your numbers.
            <br />
            <span>Control</span> for your business.
          </h1>
          <p>Accounting, sales, inventory and your team—connected in one workspace.</p>
        </div>

        <div className="ee-signin-hero-visual" aria-hidden="true">
          <div className="ee-signin-dash">
            <div className="ee-signin-dash-bars">
              <span style={{ height: "42%" }} />
              <span style={{ height: "68%" }} />
              <span style={{ height: "55%" }} />
              <span style={{ height: "82%" }} />
              <span style={{ height: "60%" }} />
            </div>
          </div>
          <div className="ee-signin-float ee-signin-float-1">
            <BarChart3 size={14} strokeWidth={SW} />
            Accounting
          </div>
          <div className="ee-signin-float ee-signin-float-2">
            <Box size={14} strokeWidth={SW} />
            Inventory
          </div>
          <div className="ee-signin-float ee-signin-float-3">
            <FileText size={14} strokeWidth={SW} />
            Invoices
          </div>
        </div>

        <div className="ee-signin-hero-modules">
          <span>Accounting</span>
          <span className="ee-signin-hero-sep" />
          <span>Operations</span>
          <span className="ee-signin-hero-sep" />
          <span>Hospitality</span>
        </div>

        <p className="ee-signin-hero-copy-foot">© 2026 Excel Edge CPA</p>
      </aside>

      <main className="ee-signin-panel">
        <div className="ee-signin-lang" aria-hidden="true">
          <Globe size={14} strokeWidth={SW} />
          English
        </div>

        <div className="ee-signin-form-wrap">
          <div className="ee-signin-eyebrow">Your workspace awaits</div>
          <h2>Welcome back</h2>
          <p className="ee-signin-lead">Sign in to your Excel Edge account.</p>

          {notice && <div className="notice info signin-notice">{notice}</div>}

          <form onSubmit={submit} noValidate className="ee-signin-form">
            <div className="field">
              <label className="field-label" htmlFor="signin-email">
                Email address
              </label>
              <span className={`ee-signin-affix ${emailError ? "invalid" : ""}`}>
                <Mail size={16} strokeWidth={SW} aria-hidden="true" />
                <input
                  id="signin-email"
                  className="input input-lg"
                  type="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  autoComplete="username"
                  autoFocus
                  aria-invalid={Boolean(emailError)}
                  aria-describedby={emailError ? "email-error" : undefined}
                />
              </span>
              {emailError && (
                <span className="field-error" id="email-error">
                  {emailError}
                </span>
              )}
            </div>

            <div className="ee-signin-remember-row">
              <label className="check" htmlFor="signin-remember">
                <input
                  id="signin-remember"
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                Remember me
              </label>
            </div>

            <div className="field">
              <span className="field-row">
                <label className="field-label" htmlFor="signin-password">
                  Password
                </label>
                <a href={erpLinks.forgotPassword} className="ee-signin-forgot">
                  Forgot password?
                </a>
              </span>
              <span className={`ee-signin-affix ${passwordError ? "invalid" : ""}`}>
                <Lock size={16} strokeWidth={SW} aria-hidden="true" />
                <input
                  id="signin-password"
                  className="input input-lg"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  aria-invalid={Boolean(passwordError)}
                  aria-describedby={passwordError ? "password-error" : undefined}
                />
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                </button>
              </span>
              {passwordError && (
                <span className="field-error" id="password-error">
                  {passwordError}
                </span>
              )}
            </div>

            {error && (
              <div className="signin-error" role="alert">
                <CircleAlert size={16} aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <button type="submit" className="btn btn-primary btn-lg ee-signin-submit" disabled={busy}>
              {busy && <LoaderCircle size={16} className="spin" aria-hidden="true" />}
              {busy ? "Signing in…" : "Sign in"}
              {!busy && <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />}
            </button>
          </form>

          <div className="divider">or</div>
          <button type="button" className="btn btn-lg signin-sso" onClick={useErpSession}>
            Continue with my Excel Edge session
          </button>

          <div className="ee-signin-new">
            <p>New to Excel Edge?</p>
            <a className="ee-signin-create" href={erpLinks.home}>
              <UserPlus size={16} strokeWidth={SW} />
              Create account
            </a>
          </div>
        </div>

        <p className="ee-signin-panel-foot">
          <a href={erpLinks.home}>Help centre</a>
          <span aria-hidden="true">|</span>
          <a href={erpLinks.home}>Privacy</a>
          <span aria-hidden="true">|</span>
          <a href={erpLinks.home}>Terms</a>
        </p>
      </main>
    </div>
  );
}
