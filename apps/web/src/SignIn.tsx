import { CircleAlert, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { type FormEvent, useState } from "react";
import { erpLinks } from "./lib/config";

type LoginResponse = {
  accessToken?: string;
  token?: string;
  user?: { name?: string; requirePasswordChange?: boolean };
  message?: string;
  error?: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignIn({ onSignedIn, notice }: { onSignedIn: (token: string) => void; notice?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
      onSignedIn(token);
    } catch {
      setError("Can't reach Excel Edge right now. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="signin-screen">
      <main className="signin">
        <div className="signin-brand">
          <img src="/logo.jpeg" alt="Excel Edge" />
          <div>
            <div className="name">Excel Edge</div>
            <div className="product">Accounting</div>
          </div>
        </div>

        <div className="signin-card">
          <h1>Welcome back</h1>
          <p className="signin-lead">Sign in to continue to your accounting workspace.</p>

          {notice && <div className="notice info signin-notice">{notice}</div>}

          <form onSubmit={submit} noValidate>
            <div className="field">
              <label className="field-label" htmlFor="signin-email">
                Email
              </label>
              <input
                id="signin-email"
                className={`input input-lg ${emailError ? "invalid" : ""}`}
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                autoFocus
                aria-invalid={Boolean(emailError)}
                aria-describedby={emailError ? "email-error" : undefined}
              />
              {emailError && (
                <span className="field-error" id="email-error">
                  {emailError}
                </span>
              )}
            </div>

            <div className="field">
              <span className="field-row">
                <label className="field-label" htmlFor="signin-password">
                  Password
                </label>
                <a href={erpLinks.forgotPassword} className="small">
                  Forgot password?
                </a>
              </span>
              <span className="input-affix">
                <input
                  id="signin-password"
                  className={`input input-lg ${passwordError ? "invalid" : ""}`}
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

            <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
              {busy && <LoaderCircle size={16} className="spin" aria-hidden="true" />}
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="divider">or</div>
          <button type="button" className="btn btn-lg signin-sso" onClick={useErpSession}>
            Continue with my Excel Edge session
          </button>
        </div>

        <p className="signin-foot">Use the same account you sign in to Excel Edge with.</p>
      </main>
    </div>
  );
}
