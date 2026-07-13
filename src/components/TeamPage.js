import React, { useState } from "react";
import { supabase } from "../lib/supabase";
import { shortDate } from "../lib/format";
import { RoleBadges, BADGE_OPTIONS, BADGE_COLORS } from "./badges";
import { ALL_PAGES, PAGE_LABELS, allowedPages, isLimited } from "../lib/access";

export default function TeamPage({ db, update, user }) {
  const isAdmin = user.role === "admin";
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [editingAccess, setEditingAccess] = useState(null);
  const appUrl = window.location.origin;

  const setAccess = (target, access) =>
    update((d) => ({ ...d, users: d.users.map((u) => (u.id === target.id ? { ...u, access } : u)) }));

  const setFull = (target) => setAccess(target, null);
  const setLimited = (target, pages) => setAccess(target, { mode: "limited", pages });
  const togglePage = (target, page) => {
    const cur = target.access && target.access.mode === "limited" ? target.access.pages || [] : [];
    const next = cur.includes(page) ? cur.filter((p) => p !== page) : [...cur, page];
    setLimited(target, next);
  };

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

  const toggleBadge = (target, badge) => {
    update((d) => ({
      ...d,
      users: d.users.map((u) => {
        if (u.id !== target.id) return u;
        const has = (u.badges || []).includes(badge);
        return { ...u, badges: has ? u.badges.filter((b) => b !== badge) : [...(u.badges || []), badge] };
      }),
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
              <tr><th>Name</th><th>Email</th><th>Role</th><th>Badges</th><th>Joined</th>{isAdmin && <th></th>}</tr>
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
                  <td>
                    {isAdmin ? (
                      <span className="row" style={{ gap: 5 }}>
                        {BADGE_OPTIONS.map((b) => {
                          const on = (u.badges || []).includes(b);
                          const c = BADGE_COLORS[b];
                          return (
                            <button
                              key={b}
                              type="button"
                              className="role-badge"
                              onClick={() => toggleBadge(u, b)}
                              title={on ? "Remove " + b : "Add " + b}
                              style={{
                                cursor: "pointer",
                                color: on ? c : "var(--text-3)",
                                borderColor: on ? c + "66" : "var(--border-strong)",
                                background: on ? c + "1f" : "transparent",
                                fontSize: 10.5,
                                opacity: on ? 1 : 0.55,
                              }}
                            >
                              {b}
                            </button>
                          );
                        })}
                      </span>
                    ) : (
                      <RoleBadges badges={u.badges} size={10.5} />
                    )}
                  </td>
                  <td className="muted">{shortDate(u.createdAt)}</td>
                  {isAdmin && (
                    <td className="num">
                      <span className="row" style={{ justifyContent: "flex-end" }}>
                        {u.role !== "admin" && (
                          <button className="btn small" onClick={() => setEditingAccess(editingAccess === u.id ? null : u.id)}>
                            {isLimited(u) ? `Access: limited (${allowedPages(u).length})` : "Access: full"}
                          </button>
                        )}
                        <button className="btn small" onClick={() => sendReset(u)}>Reset password</button>
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

      {isAdmin && editingAccess && (() => {
        const u = db.users.find((x) => x.id === editingAccess);
        if (!u || u.role === "admin") return null;
        const limited = isLimited(u);
        const pages = allowedPages(u);
        return (
          <div className="card mt">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>Access for {u.name}</h2>
              <button className="btn small" onClick={() => setEditingAccess(null)}>Done</button>
            </div>
            <div className="card-sub mt">Choose which sections {u.name.split(" ")[0]} can see when they log in.</div>
            <div className="pills mb">
              <button className={!limited ? "active" : ""} onClick={() => setFull(u)}>Full access</button>
              <button className={limited ? "active" : ""} onClick={() => setLimited(u, limited ? u.access.pages : ["commissions", "tasks"])}>Limited</button>
              <button onClick={() => setLimited(u, ["commissions"])}>Preset: Commissions only</button>
            </div>
            {limited && (
              <div className="row" style={{ gap: 8 }}>
                {ALL_PAGES.filter((p) => p !== "settings" && p !== "team").map((p) => {
                  const on = pages.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      className="role-badge"
                      onClick={() => togglePage(u, p)}
                      style={{ cursor: "pointer", color: on ? "#ffb3b9" : "var(--text-3)", borderColor: on ? "rgba(232,50,63,0.4)" : "var(--border-strong)", background: on ? "rgba(232,50,63,0.12)" : "transparent", fontSize: 12, padding: "4px 10px", opacity: on ? 1 : 0.6 }}
                    >
                      {PAGE_LABELS[p]}
                    </button>
                  );
                })}
              </div>
            )}
            {limited && (
              <div className="notice mt small">
                {u.name.split(" ")[0]} will only see: <b>{pages.map((p) => PAGE_LABELS[p]).join(", ")}</b>. Restricted data isn't loaded into their browser.
                Admin, Team and Settings stay admin-only. For a hard database-level lock, ask about the RLS follow-up.
              </div>
            )}
          </div>
        );
      })()}

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
