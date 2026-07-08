import React, { useState } from "react";
import { supabase } from "../lib/supabase";

const logo = process.env.PUBLIC_URL + "/brand/logo-light@2x.png";

export function AuthCard({ tag, children }) {
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="logo">
          <img src={logo} alt="KantoForge" />
        </div>
        <div className="tag">{tag}</div>
        {children}
      </div>
    </div>
  );
}

export function Login() {
  const [mode, setMode] = useState("signin"); // signin | signup | forgot
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn) => {
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const signIn = (e) => {
    e.preventDefault();
    run(async () => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // session change is picked up by App's auth listener
    });
  };

  const signUp = (e) => {
    e.preventDefault();
    run(async () => {
      if (password.length < 6) throw new Error("Use at least 6 characters for the password.");
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name: name.trim() } },
      });
      if (error) throw error;
      if (!data.session) {
        setMode("signin");
        setMsg("Account created — check your email for a confirmation link, then sign in.");
      }
    });
  };

  const forgot = (e) => {
    e.preventDefault();
    run(async () => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
      if (error) throw error;
      setMode("signin");
      setMsg("Reset link sent — check your inbox, the link brings you back here to set a new password.");
    });
  };

  const tag =
    mode === "signup"
      ? "Join the KantoForge HQ team."
      : mode === "forgot"
      ? "We'll email you a reset link."
      : "HQ — the team dashboard. Forge ahead. 🔥";

  return (
    <AuthCard tag={tag}>
      {err && <div className="err">{err}</div>}
      {msg && <div className="notice good mb">{msg}</div>}

      {mode === "signup" && (
        <form onSubmit={signUp}>
          <label className="field">
            <span className="lab">Your name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          </label>
          <label className="field">
            <span className="lab">Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="field">
            <span className="lab">Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <button className="btn primary" style={{ width: "100%", justifyContent: "center", marginTop: 6 }} disabled={busy}>
            {busy ? "Creating…" : "Create account"}
          </button>
          <p className="muted small" style={{ marginTop: 14, marginBottom: 0 }}>
            The first account on a new workspace becomes the admin. Already registered?{" "}
            <a href="#signin" onClick={(e) => { e.preventDefault(); setMode("signin"); setErr(null); }}>Sign in</a>
          </p>
        </form>
      )}

      {mode === "forgot" && (
        <form onSubmit={forgot}>
          <label className="field">
            <span className="lab">Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
          </label>
          <button className="btn primary" style={{ width: "100%", justifyContent: "center", marginTop: 6 }} disabled={busy}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
          <p className="muted small" style={{ marginTop: 14, marginBottom: 0 }}>
            <a href="#signin" onClick={(e) => { e.preventDefault(); setMode("signin"); setErr(null); }}>← Back to sign in</a>
          </p>
        </form>
      )}

      {mode === "signin" && (
        <form onSubmit={signIn}>
          <label className="field">
            <span className="lab">Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
          </label>
          <label className="field">
            <span className="lab">Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <button className="btn primary" style={{ width: "100%", justifyContent: "center", marginTop: 6 }} disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <p className="muted small" style={{ marginTop: 14, marginBottom: 0, display: "flex", justifyContent: "space-between" }}>
            <a href="#forgot" onClick={(e) => { e.preventDefault(); setMode("forgot"); setErr(null); }}>Forgot password?</a>
            <a href="#signup" onClick={(e) => { e.preventDefault(); setMode("signup"); setErr(null); }}>Create account</a>
          </p>
        </form>
      )}
    </AuthCard>
  );
}

export function SetNewPassword({ onDone }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    if (password.length < 6) return setErr("Use at least 6 characters.");
    if (password !== confirm) return setErr("Passwords don't match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setErr(error.message);
    onDone();
  };

  return (
    <AuthCard tag="Choose a new password.">
      {err && <div className="err">{err}</div>}
      <form onSubmit={submit}>
        <label className="field">
          <span className="lab">New password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required />
        </label>
        <label className="field">
          <span className="lab">Confirm</span>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </label>
        <button className="btn primary" style={{ width: "100%", justifyContent: "center", marginTop: 6 }} disabled={busy}>
          {busy ? "Saving…" : "Save password"}
        </button>
      </form>
    </AuthCard>
  );
}
