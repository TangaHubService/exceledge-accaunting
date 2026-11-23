import { capabilitiesForRole } from "@exceledge/accounting-domain-web";
import { ArrowRight, Building2, Check, CircleAlert, Clock, Eye, EyeOff, LoaderCircle, Lock, Mail, MailX, User, UserCheck } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { erpLinks } from "./lib/config";
import { roleAccess, roleLabel } from "./lib/users";

/**
 * Accept an invitation, QuickBooks style:
 *   1. Review   — who invited you, to which company, as what, and what that role can do.
 *   2. Account  — new people create their Excel Edge account (name + password, email fixed);
 *                 people who already have one sign in with their current password.
 *   3. Done     — signed straight into the company that invited them.
 * Public page: reached from the invitation email at /accept-invite?token=…
 */

type Invitation = {
  email: string;
  role: string;
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "CANCELLED" | "EXPIRED" | string;
  expiresAt: string;
  organizationId: number;
  organization: { name: string };
  branch: { name: string; code?: string | null } | null;
  inviterName: string | null;
  hasAccount: boolean;
};

type Step = "review" | "account" | "done";
type LoginBody = { accessToken?: string; token?: string; refreshToken?: string; user?: { requirePasswordChange?: boolean }; error?: string; message?: string };

const SW = 1.5;
const PASSWORD_HINT = "At least 8 characters, with a letter and a number.";

function strongEnough(p: string) {
  return p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
}

function decodeClaims(token: string): { activeOrganizationId?: number } | null {
  try {
    return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

async function readJson<T>(res: Response) {
  return ((await res.json().catch(() => ({}))) ?? {}) as T & { error?: string; message?: string };
}

export function AcceptInvite({ onSignedIn }: { onSignedIn: (token: string, remember: boolean, refreshToken?: string) => void }) {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [invite, setInvite] = useState<Invitation | null>(null);
  const [loadError, setLoadError] = useState<"" | "missing" | "unreachable">(token ? "" : "missing");
  const [step, setStep] = useState<Step>("review");
  const [declined, setDeclined] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [agree, setAgree] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [session, setSession] = useState<{ token: string; refreshToken?: string } | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(erpLinks.invitation(token))
      .then(async (res) => {
        if (res.status === 404) return setLoadError("missing");
        if (!res.ok) return setLoadError("unreachable");
        setInvite(await readJson<Invitation>(res));
      })
      .catch(() => setLoadError("unreachable"));
  }, [token]);

  const isNew = invite ? !invite.hasAccount : false;
  const nameError = touched && isNew && name.trim().length < 2 ? "Enter your full name" : "";
  const passwordError = touched && (isNew ? !strongEnough(password) && PASSWORD_HINT : !password && "Enter your password") || "";
  const confirmError = touched && isNew && confirm !== password ? "Passwords don't match" : "";
  const agreeError = touched && isNew && !agree ? "Agree to the terms to continue" : "";

  async function decline() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(erpLinks.declineInvitation(token), { method: "PUT" });
      if (!res.ok) throw new Error((await readJson(res)).error || "Couldn't decline the invitation.");
      setDeclined(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function accept(e: FormEvent) {
    e.preventDefault();
    if (!invite) return;
    setTouched(true);
    if (isNew ? name.trim().length < 2 || !strongEnough(password) || confirm !== password || !agree : !password) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(erpLinks.acceptInvitation(token), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isNew ? { name: name.trim(), password } : { password }),
      });
      const body = await readJson(res);
      if (!res.ok) throw new Error(body.error || "Couldn't accept the invitation. Please try again.");

      // Sign in, then make sure the session opens the company that invited them.
      const login = await fetch(erpLinks.login, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: invite.email, password }),
      });
      const lb = await readJson<LoginBody>(login);
      let access = lb.accessToken || lb.token;
      let refresh = lb.refreshToken;
      if (!login.ok || !access) throw new Error("You've joined the company. Sign in to continue.");
      if (lb.user?.requirePasswordChange) throw new Error("You've joined the company. Change your password in Excel Edge, then sign in to Accounting.");
      if (decodeClaims(access)?.activeOrganizationId !== invite.organizationId) {
        const sw = await fetch(erpLinks.switchOrganization, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${access}` },
          body: JSON.stringify({ organizationId: invite.organizationId }),
        });
        const sb = await readJson<LoginBody>(sw);
        if (sw.ok && (sb.accessToken || sb.token)) {
          access = sb.accessToken || sb.token;
          refresh = sb.refreshToken ?? refresh;
        }
      }
      setSession({ token: access!, refreshToken: refresh });
      setStep("done");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function openCompany() {
    if (!session) return;
    window.history.replaceState(null, "", "/");
    onSignedIn(session.token, true, session.refreshToken);
  }

  const status = invite?.status;
  const closed = invite && status !== "PENDING";
  const hasAccounting = invite ? capabilitiesForRole(invite.role).length > 0 : true;

  return (
    <div className="ee-signin ee-invite-accept">
      <aside className="ee-signin-hero">
        <div className="ee-signin-hero-brand">
          <img src="/logo.jpeg" alt="" className="ee-signin-hero-logo" />
          <div>
            <div className="ee-signin-hero-name">Excel Edge Accounting</div>
            <div className="ee-signin-hero-tag">One platform. Your whole business.</div>
          </div>
        </div>
        <div className="ee-signin-hero-copy">
          <h1>
            Your team is <span>waiting</span> for you.
          </h1>
          <p>Accept your invitation to start working in the books together.</p>
        </div>
        <p className="ee-signin-hero-copy-foot">© 2026 Excel Edge CPA</p>
      </aside>

      <main className="ee-signin-panel">
        <div className="ee-signin-form-wrap ee-accept-wrap">
          {!loadError && !invite && (
            <div className="ee-accept-state" role="status">
              <LoaderCircle size={22} className="spin" aria-hidden="true" />
              <p>Opening your invitation…</p>
            </div>
          )}

          {loadError === "missing" && (
            <StateCard
              icon={<MailX size={26} strokeWidth={SW} />}
              title="This invitation link isn't valid"
              body="The link may be incomplete or the invitation was removed. Ask the person who invited you to send a new one."
            />
          )}
          {loadError === "unreachable" && (
            <StateCard
              icon={<CircleAlert size={26} strokeWidth={SW} />}
              title="We can't reach Excel Edge right now"
              body="Check your connection and reload this page."
            />
          )}

          {invite && declined && (
            <StateCard
              icon={<Check size={26} strokeWidth={SW} />}
              title="Invitation declined"
              body={`We've let ${invite.organization.name} know. If you change your mind, ask them to invite you again.`}
            />
          )}

          {invite && !declined && closed && (
            <ClosedState invite={invite} />
          )}

          {invite && !declined && !closed && (
            <>
              <Stepper step={step} />

              {step === "review" && (
                <section aria-labelledby="accept-title">
                  <div className="ee-signin-eyebrow">You're invited</div>
                  <h2 id="accept-title">Join {invite.organization.name}</h2>
                  <p className="ee-signin-lead">
                    {invite.inviterName ?? "Your team"} invited you to work in {invite.organization.name} on Excel Edge Accounting.
                  </p>

                  <dl className="ee-accept-facts">
                    <div>
                      <dt>
                        <Building2 size={15} strokeWidth={SW} aria-hidden="true" /> Company
                      </dt>
                      <dd>{invite.organization.name}</dd>
                    </div>
                    <div>
                      <dt>
                        <UserCheck size={15} strokeWidth={SW} aria-hidden="true" /> Your role
                      </dt>
                      <dd>{roleLabel(invite.role)}</dd>
                    </div>
                    {invite.branch && (
                      <div>
                        <dt>
                          <Building2 size={15} strokeWidth={SW} aria-hidden="true" /> Branch
                        </dt>
                        <dd>{invite.branch.name}</dd>
                      </div>
                    )}
                    <div>
                      <dt>
                        <Mail size={15} strokeWidth={SW} aria-hidden="true" /> Invited email
                      </dt>
                      <dd>{invite.email}</dd>
                    </div>
                    <div>
                      <dt>
                        <Clock size={15} strokeWidth={SW} aria-hidden="true" /> Expires
                      </dt>
                      <dd>{new Date(invite.expiresAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</dd>
                    </div>
                  </dl>

                  {hasAccounting ? (
                    <details className="ee-accept-access">
                      <summary>What you'll be able to do</summary>
                      <ul className="ee-manage-access">
                        {roleAccess(invite.role).map((a) => (
                          <li key={a.label}>
                            <span>{a.label}</span>
                            <span className={`ee-manage-access-level ${a.access === "Full" ? "full" : a.access === "None" ? "none" : "view"}`}>
                              {a.access}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : (
                    <p className="notice info">This role uses Excel Edge point of sale. It doesn't include Accounting.</p>
                  )}

                  {error && <ErrorLine text={error} />}

                  <div className="ee-accept-actions">
                    <button type="button" className="btn btn-primary btn-lg ee-signin-submit" onClick={() => setStep("account")} disabled={busy}>
                      Accept invitation <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
                    </button>
                    <button type="button" className="btn btn-lg" onClick={() => void decline()} disabled={busy}>
                      Decline
                    </button>
                  </div>
                </section>
              )}

              {step === "account" && (
                <form onSubmit={(e) => void accept(e)} noValidate aria-labelledby="account-title" className="ee-signin-form">
                  <div className="ee-signin-eyebrow">Step 2 of 3</div>
                  <h2 id="account-title">{isNew ? "Create your account" : "Sign in to accept"}</h2>
                  <p className="ee-signin-lead">
                    {isNew
                      ? "You'll use this email and password to sign in to Excel Edge."
                      : `You already have an Excel Edge account. Sign in to add ${invite.organization.name} to it.`}
                  </p>

                  <div className="field">
                    <label className="field-label" htmlFor="accept-email">
                      Email address
                    </label>
                    <span className="ee-signin-affix">
                      <Mail size={16} strokeWidth={SW} aria-hidden="true" />
                      <input id="accept-email" className="input input-lg" value={invite.email} readOnly aria-readonly="true" autoComplete="username" />
                    </span>
                  </div>

                  {isNew && (
                    <div className={`field ${nameError ? "has-error" : ""}`}>
                      <label className="field-label" htmlFor="accept-name">
                        Full name
                      </label>
                      <span className={`ee-signin-affix ${nameError ? "invalid" : ""}`}>
                        <User size={16} strokeWidth={SW} aria-hidden="true" />
                        <input
                          id="accept-name"
                          className="input input-lg"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          autoComplete="name"
                          autoFocus
                          aria-invalid={Boolean(nameError)}
                        />
                      </span>
                      {nameError && <span className="field-error">{nameError}</span>}
                    </div>
                  )}

                  <div className={`field ${passwordError ? "has-error" : ""}`}>
                    <span className="field-row">
                      <label className="field-label" htmlFor="accept-password">
                        {isNew ? "Create a password" : "Password"}
                      </label>
                      {!isNew && (
                        <a href={erpLinks.forgotPassword} className="ee-signin-forgot">
                          Forgot password?
                        </a>
                      )}
                    </span>
                    <span className={`ee-signin-affix ${passwordError ? "invalid" : ""}`}>
                      <Lock size={16} strokeWidth={SW} aria-hidden="true" />
                      <input
                        id="accept-password"
                        className="input input-lg"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete={isNew ? "new-password" : "current-password"}
                        autoFocus={!isNew}
                        aria-invalid={Boolean(passwordError)}
                        aria-describedby="accept-password-hint"
                      />
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => setShowPassword((s) => !s)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        aria-pressed={showPassword}
                      >
                        {showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                      </button>
                    </span>
                    {passwordError ? (
                      <span className="field-error" id="accept-password-hint">
                        {passwordError}
                      </span>
                    ) : (
                      isNew && (
                        <span className="field-hint" id="accept-password-hint">
                          {PASSWORD_HINT}
                        </span>
                      )
                    )}
                  </div>

                  {isNew && (
                    <div className={`field ${confirmError ? "has-error" : ""}`}>
                      <label className="field-label" htmlFor="accept-confirm">
                        Confirm password
                      </label>
                      <span className={`ee-signin-affix ${confirmError ? "invalid" : ""}`}>
                        <Lock size={16} strokeWidth={SW} aria-hidden="true" />
                        <input
                          id="accept-confirm"
                          className="input input-lg"
                          type={showPassword ? "text" : "password"}
                          value={confirm}
                          onChange={(e) => setConfirm(e.target.value)}
                          autoComplete="new-password"
                          aria-invalid={Boolean(confirmError)}
                        />
                      </span>
                      {confirmError && <span className="field-error">{confirmError}</span>}
                    </div>
                  )}

                  {isNew && (
                    <div className={`field ${agreeError ? "has-error" : ""}`}>
                      <label className="check" htmlFor="accept-agree">
                        <input id="accept-agree" type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                        <span>
                          I agree to the Excel Edge{" "}
                          <a href={erpLinks.home} target="_blank" rel="noreferrer">
                            Terms
                          </a>{" "}
                          and{" "}
                          <a href={erpLinks.home} target="_blank" rel="noreferrer">
                            Privacy statement
                          </a>
                          .
                        </span>
                      </label>
                      {agreeError && <span className="field-error">{agreeError}</span>}
                    </div>
                  )}

                  {error && <ErrorLine text={error} />}

                  <button type="submit" className="btn btn-primary btn-lg ee-signin-submit" disabled={busy}>
                    {busy && <LoaderCircle size={16} className="spin" aria-hidden="true" />}
                    {busy ? "Joining…" : isNew ? "Create account and join" : "Sign in and join"}
                  </button>
                  <button type="button" className="ee-link-btn ee-accept-back" onClick={() => (setStep("review"), setError(""))} disabled={busy}>
                    ← Back
                  </button>
                </form>
              )}

              {step === "done" && (
                <section className="ee-accept-done" aria-live="polite">
                  <div className="ee-accept-done-icon" aria-hidden="true">
                    <Check size={28} strokeWidth={2.25} />
                  </div>
                  <h2>You're in!</h2>
                  <p className="ee-signin-lead">
                    You've joined {invite.organization.name} as {roleLabel(invite.role)}.
                  </p>
                  {hasAccounting ? (
                    <button type="button" className="btn btn-primary btn-lg ee-signin-submit" onClick={openCompany}>
                      Go to {invite.organization.name} <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
                    </button>
                  ) : (
                    <a className="btn btn-primary btn-lg ee-signin-submit" href={erpLinks.home}>
                      Open Excel Edge <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
                    </a>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const steps: Array<{ key: Step; label: string }> = [
    { key: "review", label: "Review invite" },
    { key: "account", label: "Your account" },
    { key: "done", label: "Done" },
  ];
  const at = steps.findIndex((s) => s.key === step);
  return (
    <ol className="ee-accept-steps" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s.key} className={i < at ? "done" : i === at ? "current" : undefined} aria-current={i === at ? "step" : undefined}>
          <span className="ee-accept-step-dot">{i < at ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : i + 1}</span>
          {s.label}
        </li>
      ))}
    </ol>
  );
}

function ClosedState({ invite }: { invite: Invitation }) {
  if (invite.status === "ACCEPTED")
    return (
      <StateCard
        icon={<UserCheck size={26} strokeWidth={SW} />}
        title="You've already accepted this invitation"
        body={`Sign in with ${invite.email} to open ${invite.organization.name}.`}
        action={
          <a className="btn btn-primary btn-lg ee-signin-submit" href="/">
            Sign in
          </a>
        }
      />
    );
  if (invite.status === "EXPIRED")
    return (
      <StateCard
        icon={<Clock size={26} strokeWidth={SW} />}
        title="This invitation has expired"
        body={`Invitations last 7 days. Ask ${invite.inviterName ?? "the person who invited you"} at ${invite.organization.name} to resend it.`}
      />
    );
  return (
    <StateCard
      icon={<MailX size={26} strokeWidth={SW} />}
      title={invite.status === "DECLINED" ? "This invitation was declined" : "This invitation was cancelled"}
      body={`Ask ${invite.inviterName ?? "the company admin"} at ${invite.organization.name} to send you a new one.`}
    />
  );
}

function StateCard({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <section className="ee-accept-state">
      <div className="ee-accept-state-icon" aria-hidden="true">
        {icon}
      </div>
      <h2>{title}</h2>
      <p className="ee-signin-lead">{body}</p>
      {action}
    </section>
  );
}

function ErrorLine({ text }: { text: string }) {
  return (
    <div className="signin-error" role="alert">
      <CircleAlert size={16} aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}
