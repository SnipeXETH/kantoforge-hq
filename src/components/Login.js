import React, { useState } from "react";
import { hashPassword, verifyLogin, findUser } from "../lib/auth";
import { uid } from "../lib/format";

const logo = process.env.PUBLIC_URL + "/brand/logo-light@2x.png";

export function Login({ users, onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const user = await verifyLogin(users, email, password);
    setBusy(false);
    if (!user) {
      setErr("Wrong email or password. Ask an admin to reset your account if you're stuck.");
      return;
    }
    onLogin(user);
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="logo">
          <img src={logo} alt="KantoForge" />
        </div>
        <div className="tag">HQ — the team dashboard. Forge ahead. 🔥</div>
        {err && <div className="err">{err}</div>}
        <label className="field">
          <span className="lab">Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
        </label>
        <label className="field">
          <span className="lab">Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button className="btn primary" style={{ width: "100%", justifyContent: "center", marginTop: 6 }} disabled={busy}>
          {busy ? "Checking…" : "Log in"}
        </button>
      </form>
    </div>
  );
}

export function FirstRunSetup({ users, onCreated }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    if (password.length < 6) return setErr("Use at least 6 characters for the password.");
    if (password !== confirm) return setErr("Passwords don't match.");
    if (findUser(users, email)) return setErr("That email is already registered.");
    setBusy(true);
    const hash = await hashPassword(email, password);
    setBusy(false);
    onCreated({ id: uid(), name: name.trim(), email: email.trim().toLowerCase(), hash, role: "admin", createdAt: new Date().toISOString() });
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="logo">
          <img src={logo} alt="KantoForge" />
        </div>
        <div className="tag">Welcome! Create the owner account to set up KantoForge HQ.</div>
        {err && <div className="err">{err}</div>}
        <label className="field">
          <span className="lab">Your name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        </label>
        <label className="field">
          <span className="lab">Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <div className="form-row">
          <label className="field">
            <span className="lab">Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <label className="field">
            <span className="lab">Confirm</span>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </label>
        </div>
        <button className="btn primary" style={{ width: "100%", justifyContent: "center", marginTop: 6 }} disabled={busy}>
          {busy ? "Creating…" : "Create owner account"}
        </button>
        <p className="muted small" style={{ marginTop: 14, marginBottom: 0 }}>
          You'll be the admin. You can invite colleagues from the Team page once you're in.
        </p>
      </form>
    </div>
  );
}
