import React, { useState } from "react";
import { supabase } from "../lib/supabase";
import { shortDate } from "../lib/format";

export default function TeamPage({ db, update, user }) {
  const isAdmin = user.role === "admin";
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const appUrl = window.location.origin;

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(appUrl);
      setMsg("Link copied — send it to your colleague. They pick “Create account”, then you set their role below.");
    } catch (e) {
      setMsg(`Send your colleague this link: ${appUrl} — they pick “Create account”, then you set their role below.`);
    }
  };

  const sendReset = async (target) => {
    setErr(null);
    setMsg(null);
    const { error } = await supabase.auth.resetPasswordForEmail(target.email, { redirectTo: appUrl });
    if (error) setErr(error.message);
    else setMsg(`Password reset email sent to ${target.email}.`);
  };

  const toggleRole = (target) => {
    update((d) => ({
      ...d,
      users: d.users.map((u) => (u.id === target.id ? { ...u, role: u.role === "admin" ? "member" : "admin" } : u)),
    }));
  };

  const admins = db.users.filter((u) => u.role === "admin").length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Team</h1>
          <div className="sub">Everyone here shares the same live workspace — orders, analytics and tasks.</div>
        </div>
        {isAdmin && <button className="btn primary" onClick={copyInvite}>🔗 Copy invite link</button>}
      </div>

      {msg && <div className="notice good mb">✅ {msg}</div>}
      {err && <div className="notice bad mb">⚠️ {err}</div>}

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
                        {(u.name || "?").split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()}
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
                        <button className="btn small" onClick={() => sendReset(u)}>Send password reset</button>
                        <button
                          className="btn small"
                          disabled={u.id === user.id || (u.role === "admin" && admins <= 1)}
                          onClick={() => toggleRole(u)}
                        >
                          {u.role === "admin" ? "Make member" : "Make admin"}
                        </button>
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isAdmin && (
        <div className="notice mt">
          ℹ️ <b>Inviting someone:</b> send them the invite link — they create their own account and password, and show up
          here as a member. <b>Removing someone:</b> delete their user in the Supabase dashboard
          (Authentication → Users); their profile disappears here automatically. To stop strangers signing up, turn off
          “Allow new users to sign up” in Supabase (Authentication → Sign In / Providers) once your team is in.
        </div>
      )}
    </div>
  );
}
