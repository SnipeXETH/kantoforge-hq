import React, { useState } from "react";
import { hashPassword, findUser } from "../lib/auth";
import { uid, shortDate } from "../lib/format";

export default function TeamPage({ db, update, user }) {
  const isAdmin = user.role === "admin";
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "member" });
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  const addUser = async (e) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    if (!form.name.trim() || !form.email.trim()) return setErr("Name and email are required.");
    if (form.password.length < 6) return setErr("Password needs at least 6 characters.");
    if (findUser(db.users, form.email)) return setErr("That email is already registered.");
    const hash = await hashPassword(form.email, form.password);
    update((d) => ({
      ...d,
      users: [...d.users, { id: uid(), name: form.name.trim(), email: form.email.trim().toLowerCase(), hash, role: form.role, createdAt: new Date().toISOString() }],
    }));
    setMsg(`${form.name.trim()} can now log in with the password you set — share it with them securely.`);
    setForm({ name: "", email: "", password: "", role: "member" });
  };

  const removeUser = (id) => {
    if (id === user.id) return;
    update((d) => ({ ...d, users: d.users.filter((u) => u.id !== id) }));
  };

  const resetPassword = async (target) => {
    const pw = window.prompt(`New password for ${target.name}:`);
    if (!pw || pw.length < 6) return;
    const hash = await hashPassword(target.email, pw);
    update((d) => ({ ...d, users: d.users.map((u) => (u.id === target.id ? { ...u, hash } : u)) }));
    setMsg(`Password updated for ${target.name}.`);
  };

  const toggleRole = (target) => {
    update((d) => ({ ...d, users: d.users.map((u) => (u.id === target.id ? { ...u, role: u.role === "admin" ? "member" : "admin" } : u)) }));
  };

  const admins = db.users.filter((u) => u.role === "admin").length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Team</h1>
          <div className="sub">Who can log into KantoForge HQ on this device.</div>
        </div>
      </div>

      {msg && <div className="notice good mb">✅ {msg}</div>}
      {err && <div className="notice bad mb">⚠️ {err}</div>}

      {isAdmin && (
        <form className="card mb" onSubmit={addUser}>
          <h2>Invite a colleague</h2>
          <div className="card-sub">Set them a starter password — they can't change it themselves yet, but you can reset it any time.</div>
          <div className="form-row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
            <label className="field" style={{ minWidth: 150 }}>
              <span className="lab">Name</span>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="field" style={{ minWidth: 180 }}>
              <span className="lab">Email</span>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
            <label className="field" style={{ minWidth: 140 }}>
              <span className="lab">Password</span>
              <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </label>
            <label className="field" style={{ minWidth: 110 }}>
              <span className="lab">Role</span>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <button className="btn primary" style={{ marginBottom: 12 }}>Add teammate</button>
          </div>
        </form>
      )}

      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th>{isAdmin && <th></th>}</tr>
            </thead>
            <tbody>
              {db.users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <span className="row" style={{ gap: 8 }}>
                      <span className="avatar" style={{ width: 24, height: 24, fontSize: 10 }}>
                        {u.name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()}
                      </span>
                      <b>{u.name}</b>
                      {u.id === user.id && <span className="badge gray">you</span>}
                    </span>
                  </td>
                  <td className="muted">{u.email}</td>
                  <td><span className={"badge " + (u.role === "admin" ? "red" : "gray")}>{u.role}</span></td>
                  <td className="muted">{shortDate(u.createdAt)}</td>
                  {isAdmin && (
                    <td className="num">
                      <span className="row" style={{ justifyContent: "flex-end" }}>
                        <button className="btn small" onClick={() => resetPassword(u)}>Reset password</button>
                        <button
                          className="btn small"
                          disabled={u.id === user.id || (u.role === "admin" && admins <= 1)}
                          onClick={() => toggleRole(u)}
                        >
                          {u.role === "admin" ? "Make member" : "Make admin"}
                        </button>
                        <button className="btn small danger" disabled={u.id === user.id} onClick={() => removeUser(u.id)}>Remove</button>
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="notice mt">
        ℹ️ Accounts and data live in this browser. To share live data with the team, use Settings → Data to export a backup
        they can import — or ask your developer about connecting a shared database (see the README for the upgrade path).
      </div>
    </div>
  );
}
