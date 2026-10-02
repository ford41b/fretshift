import { useEffect, useState } from "react";
import {
  AuthRequestError,
  cloudConfig,
  completePasswordAccount,
  getMagicLinkRetryAt,
  isStandaloneWebApp,
  requestPasswordAccountCode,
  sendSignInEmail,
  signInWithPassword,
  signOut,
  updateCurrentUserPassword,
  verifyEmailCode,
  type EmailSignInMethod,
} from "../../cloud/client";
import {
  relinkCurrentDeviceLibrary,
  syncNow,
  useCloudStore,
} from "../../cloud/store";
import { ErrorNotice } from "./Common";

type SignInMethod = EmailSignInMethod | "password";
type PasswordMode = "signin" | "signup";

export function AccountSync() {
  const { session, busy, status, error, conflicts, workspaceMismatch } = useCloudStore();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [method, setMethod] = useState<SignInMethod>("code");
  const [passwordMode, setPasswordMode] = useState<PasswordMode>("signin");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [signupCodeSent, setSignupCodeSent] = useState(false);
  const [message, setMessage] = useState("");
  const [localError, setLocalError] = useState("");
  const [retryAt, setRetryAt] = useState(() => getMagicLinkRetryAt());
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!retryAt || retryAt <= Date.now()) return;
    const timer = window.setInterval(() => {
      const nextNow = Date.now();
      setNow(nextNow);
      if (retryAt <= nextNow) {
        setRetryAt(0);
        window.clearInterval(timer);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  const retrySeconds = retryAt > now ? Math.ceil((retryAt - now) / 1000) : 0;
  const retryLabel =
    retrySeconds >= 60 ? `${Math.ceil(retrySeconds / 60)}m` : `${retrySeconds}s`;

  async function handlePasswordAuth() {
    setSending(true);
    setLocalError("");
    setMessage("");
    try {
      if (passwordMode === "signup") {
        // The server never confirms an address or stores a password; the
        // emailed code proves ownership first (see password-signup).
        await requestPasswordAccountCode(email, password);
        setRetryAt(getMagicLinkRetryAt());
        setNow(Date.now());
        setSignupCodeSent(true);
        setMessage(
          "Code sent. Enter the 8-digit code from the newest FretShift email to finish creating your account. Your password is saved only after the code is confirmed.",
        );
        return;
      } else {
        await signInWithPassword(email, password);
        setMessage("Signed in. Syncing your library…");
      }
      await syncNow();
    } catch (error) {
      const isInvalidPasswordLogin =
        passwordMode === "signin" &&
        error instanceof AuthRequestError &&
        /invalid login credentials/i.test(error.message);
      if (error instanceof AuthRequestError && error.status === 429) {
        setRetryAt(getMagicLinkRetryAt());
        setNow(Date.now());
      }
      setLocalError(
        isInvalidPasswordLogin
          ? "Email or password doesn't match. If you previously used a verification code and never set a password, sign in with the code first, then use Set or change password below."
          : error instanceof Error
            ? error.message
            : passwordMode === "signup"
              ? "That account could not be created."
              : "Email or password could not be confirmed.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="card settings-section account-section">
      <h2>Account & sync</h2>
      <ErrorNotice error={localError || error} />
      {!cloudConfig() ? (
        <>
          <p>Sign in isn't configured</p>
          <p className="muted">
            Your local songbook works without an account. Follow the Supabase
            setup in README to enable accounts, sync and sharing.
          </p>
          <span className="pill">Local mode · No account required</span>
        </>
      ) : session ? (
        <>
          <p>
            Signed in as <strong>{session.user.email ?? "your account"}</strong>
          </p>
          <p className="muted">
            Songs, setlists, preferences and practice history sync to your
            account. Recordings stay on this device.
          </p>
          <p role="status">{message || status || "Ready to sync"}</p>
          {workspaceMismatch ? (
            <div className="card" style={{ marginBottom: 16 }}>
              <h3>Use this account for this device?</h3>
              <p>
                This browser's local FretShift library was previously linked to
                another account. If you want to keep this local library and use it
                with <strong>{session.user.email ?? "this account"}</strong>,
                relink the device below.
              </p>
              <p className="small muted">
                Relinking does not delete the local library. On the next sync,
                items already stored in this account may be merged with the local
                library, and conflicts will still ask you which version to keep.
              </p>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void relinkCurrentDeviceLibrary()}
              >
                {busy ? "Working…" : "Use this account for this device"}
              </button>
            </div>
          ) : null}
          <div className="button-row">
            <button disabled={busy} onClick={() => void syncNow()}>
              {busy ? "Syncing…" : "Sync now"}
            </button>
            <button
              disabled={busy}
              onClick={async () => {
                setLocalError("");
                try {
                  await signOut();
                } catch {
                  setLocalError(
                    "Signed out on this device. The server could not be reached to revoke this session; try again when online if needed.",
                  );
                }
              }}
            >
              Sign out
            </button>
          </div>
          <details style={{ marginTop: 18 }}>
            <summary>Set or change password</summary>
            <p className="small muted" style={{ marginTop: 10 }}>
              If this account was originally created with a verification code or
              magic link, set a password here before using Email + password sign-in.
            </p>
            <label>
              New password
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label>
              Confirm new password
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={
                savingPassword ||
                newPassword.length < 8 ||
                newPassword !== confirmPassword
              }
              onClick={async () => {
                setLocalError("");
                setMessage("");
                if (newPassword !== confirmPassword) {
                  setLocalError("The two passwords do not match.");
                  return;
                }
                setSavingPassword(true);
                try {
                  await updateCurrentUserPassword(newPassword);
                  setNewPassword("");
                  setConfirmPassword("");
                  setMessage(
                    "Password saved. You can use Email + password the next time you sign in.",
                  );
                } catch (error) {
                  setLocalError(
                    error instanceof Error
                      ? error.message
                      : "Password could not be saved.",
                  );
                } finally {
                  setSavingPassword(false);
                }
              }}
            >
              {savingPassword ? "Saving password…" : "Save password"}
            </button>
          </details>
          {conflicts.map((conflict) => {
            const payload = conflict.mine.payload as Record<string, unknown>;
            return (
              <article className="card" key={conflict.key}>
                <h3>
                  {String(payload.title ?? payload.name ?? conflict.mine.kind)}{" "}
                  changed on both devices
                </h3>
                <p>
                  Local: {conflict.mine.deletedAt ? "Deleted" : "Edited"} ·
                  Server: {conflict.server.deletedAt ? "Deleted" : "Edited"}
                </p>
                <details>
                  <summary>Compare changes</summary>
                  <label>
                    Your version
                    <textarea
                      readOnly
                      value={JSON.stringify(conflict.mine.payload, null, 2)}
                    />
                  </label>
                  <label>
                    Server version
                    <textarea
                      readOnly
                      value={JSON.stringify(conflict.server.payload, null, 2)}
                    />
                  </label>
                </details>
                <div className="button-row">
                  {conflict.choices.map((choice) => (
                    <button
                      key={choice}
                      disabled={busy}
                      onClick={() => void syncNow(conflict, choice)}
                    >
                      {choice === "mine"
                        ? "Keep mine"
                        : choice === "server"
                          ? "Keep server"
                          : "Keep both as copy"}
                    </button>
                  ))}
                </div>
              </article>
            );
          })}
        </>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (method === "password") {
              await handlePasswordAuth();
              return;
            }

            setSending(true);
            setLocalError("");
            setMessage("");
            try {
              await sendSignInEmail(email, method);
              setRetryAt(getMagicLinkRetryAt());
              setNow(Date.now());
              if (method === "code") {
                setCodeSent(true);
                setMessage(
                  "Code sent. Enter the 8-digit code from the newest FretShift email below. This keeps the entire sign-in inside this app and is recommended on iPhone.",
                );
              } else {
                setMessage(
                  isStandaloneWebApp()
                    ? "Link sent. Open the newest email. If iPhone opens Safari, finish the link there and return to FretShift — this app will try to transfer the session automatically."
                    : "Link sent. Check your email and open the newest sign-in link on this device.",
                );
              }
            } catch (error) {
              setRetryAt(getMagicLinkRetryAt());
              setNow(Date.now());
              setLocalError(
                error instanceof Error
                  ? error.message
                  : "Sign-in email could not be sent.",
              );
              if (error instanceof AuthRequestError && error.status === 429)
                setMessage(
                  "No new email was sent. The button will unlock when Supabase says it is safe to retry.",
                );
            } finally {
              setSending(false);
            }
          }}
        >
          <p>
            Connect this device's library to your account. Your existing songs,
            setlists, preferences and practice history will sync after sign-in.
          </p>
          <label>
            Email address
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <div style={{ marginBottom: 16 }}>
            <span className="small muted">Choose a sign-in method</span>
            <div className="segments" style={{ marginTop: 8 }}>
              <button
                type="button"
                className={method === "code" ? "active" : ""}
                aria-pressed={method === "code"}
                onClick={() => {
                  setMethod("code");
                  setLocalError("");
                  setMessage("");
                }}
              >
                Verification code · Recommended
              </button>
              <button
                type="button"
                className={method === "magic" ? "active" : ""}
                aria-pressed={method === "magic"}
                onClick={() => {
                  setMethod("magic");
                  setLocalError("");
                  setMessage("");
                }}
              >
                Magic link
              </button>
              <button
                type="button"
                className={method === "password" ? "active" : ""}
                aria-pressed={method === "password"}
                onClick={() => {
                  setMethod("password");
                  setLocalError("");
                  setMessage("");
                }}
              >
                Email + password
              </button>
            </div>
          </div>

          {method === "password" ? (
            <>
              <div className="segments" style={{ marginBottom: 14 }}>
                <button
                  type="button"
                  className={passwordMode === "signin" ? "active" : ""}
                  aria-pressed={passwordMode === "signin"}
                  onClick={() => {
                    setPasswordMode("signin");
                    setSignupCodeSent(false);
                    setLocalError("");
                  }}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  className={passwordMode === "signup" ? "active" : ""}
                  aria-pressed={passwordMode === "signup"}
                  onClick={() => {
                    setPasswordMode("signup");
                    setLocalError("");
                  }}
                >
                  Create account
                </button>
              </div>
              <label>
                Password
                <input
                  type="password"
                  autoComplete={
                    passwordMode === "signup" ? "new-password" : "current-password"
                  }
                  minLength={8}
                  maxLength={128}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <button
                type="submit"
                disabled={
                  sending ||
                  password.length < 8 ||
                  (passwordMode === "signup" && retrySeconds > 0)
                }
              >
                {sending
                  ? passwordMode === "signup"
                    ? "Sending code…"
                    : "Signing in…"
                  : passwordMode === "signup"
                    ? retrySeconds > 0
                      ? `Try again in ${retryLabel}`
                      : signupCodeSent
                        ? "Email me a new code"
                        : "Create account · email me a code"
                    : "Sign in with password"}
              </button>
              {passwordMode === "signup" && signupCodeSent ? (
                <div style={{ marginTop: 18 }}>
                  <label>
                    8-digit verification code
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{8}"
                      maxLength={8}
                      placeholder="12345678"
                      value={code}
                      onChange={(event) =>
                        setCode(event.target.value.replace(/\D/g, "").slice(0, 8))
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="primary"
                    disabled={verifying || code.length !== 8 || password.length < 8}
                    onClick={async () => {
                      setVerifying(true);
                      setLocalError("");
                      setMessage("");
                      try {
                        await completePasswordAccount(email, code, password);
                        setMessage("Account confirmed and password saved. Syncing your library…");
                        await syncNow();
                      } catch (error) {
                        setLocalError(
                          error instanceof Error
                            ? error.message
                            : "That verification code could not be confirmed.",
                        );
                      } finally {
                        setVerifying(false);
                      }
                    }}
                  >
                    {verifying ? "Verifying…" : "Verify & create account"}
                  </button>
                </div>
              ) : null}
              <p className="small muted" style={{ marginTop: 12 }}>
                {passwordMode === "signup"
                  ? "New accounts are confirmed with an emailed 8-digit code before first sign-in. Use at least 8 characters for the password. If you open the email link instead of entering the code, set your password afterwards under Set or change password."
                  : "Use at least 8 characters."}
              </p>
            </>
          ) : (
            <>
              <button type="submit" disabled={sending || retrySeconds > 0}>
                {sending
                  ? "Sending…"
                  : retrySeconds > 0
                    ? `Try again in ${retryLabel}`
                    : method === "code"
                      ? "Email me a verification code"
                      : "Email me a sign-in link"}
              </button>

              {method === "code" && codeSent ? (
                <div style={{ marginTop: 18 }}>
                  <label>
                    8-digit verification code
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{8}"
                      maxLength={8}
                      placeholder="12345678"
                      value={code}
                      onChange={(event) =>
                        setCode(event.target.value.replace(/\D/g, "").slice(0, 8))
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="primary"
                    disabled={verifying || code.length !== 8}
                    onClick={async () => {
                      setVerifying(true);
                      setLocalError("");
                      setMessage("");
                      try {
                        await verifyEmailCode(email, code);
                        setMessage("Signed in. Syncing your library…");
                        await syncNow();
                      } catch (error) {
                        setLocalError(
                          error instanceof Error
                            ? error.message
                            : "That verification code could not be confirmed.",
                        );
                      } finally {
                        setVerifying(false);
                      }
                    }}
                  >
                    {verifying ? "Verifying…" : "Verify & sign in"}
                  </button>
                </div>
              ) : null}
              <p className="small muted" style={{ marginTop: 12 }}>
                The verification-code option is the most reliable email choice
                for an installed iPhone web app because the session is created
                and stored directly inside FretShift.
              </p>
            </>
          )}
          <p role="status">{message || status}</p>
        </form>
      )}
    </section>
  );
}
