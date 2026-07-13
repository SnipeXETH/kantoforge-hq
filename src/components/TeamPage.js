import React, { useState } from "react";
import { supabase } from "../lib/supabase";
import { shortDate } from "../lib/format";
import { RoleBadges, BADGE_OPTIONS, BADGE_COLORS } from "./badges";
import {
  PAGE_LABELS, PAGE_SECTIONS, ADMIN_ONLY_PAGES, ASSIGNABLE_PAGES, ACCESS_PRESETS,
  allowedPages, isLimited,
} from "../lib/access";

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

// Full-screen per-user access editor, grouped like the sidebar.
function AccessModal({ u, update, onClose }) {
  const custom = isLimited(u);
  const chosen = custom && u.access ? (u.access.pages || []) : [];
  const first = (u.name || "they").split(" ")[0];

  const setAccess = (access) =>
    update((d) => ({ ...d, users: d.users.map((x) => (x.id === u.id ? { ...x, access } : x)) }));

  const setFull = () => setAccess(null);
  const setCustom = (pages) => setAccess({ mode: "limited", pages: Array.from(new Set(pages)) });
  const toCustom = () => setCustom(ASSIGNABLE_PAGES); // switching to custom starts with everything on
  const togglePage = (p) => setCustom(chosen.includes(p) ? chosen.filter((x) => x !== p) : [...chosen, p]);
  const setGroup = (pages, on) =>
    setCustom(on ? [...chosen, ...pages] : chosen.filter((p) => !pages.includes(p)));

  const activePreset = ACCESS_PRESETS.find((pr) => custom && sameSet(pr.pages, chosen));
  const willSee = custom ? allowedPages(u) : null;

  return (
    <div className="lightbox" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620, width: "100%", maxHeight: "88vh", overflowY: "auto", textAlign: "left", margin: 0 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Access · {u.name}</h2>
          <button className="btn small" onClick={onClose}>Done</button>
        </div>
        <div className="card-sub mt">Choose exactly which parts of the portal {first} can open. Changes save instantly.</div>

        <div className="pills mt mb">
          <button className={!custom ? "active" : ""} onClick={setFull}>Full access</button>
          <button className={custom ? "active" : ""} onClick={() => (custom ? null : toCustom())}>Custom</button>
        </div>

        {custom && (
          <>
            <div className="card-sub">Quick presets</div>
            <div className="pills mb" style={{ flexWrap: "wrap" }}>
              {ACCESS_PRESETS.map((pr) => (
                <button key={pr.key} className={activePreset && activePreset.key === pr.key ? "active" : ""} onClick={() => setCustom(pr.pages)}>{pr.label}</button>
              ))}
              <button onClick={() => setCustom(ASSIGNABLE_PAGES)}>Everything</button>
            </div>

            {PAGE_SECTIONS.map((sec) => {
              const onCount = sec.pages.filter((p) => chosen.includes(p)).length;
              const allOn = onCount === sec.pages.length;
              return (
                <div key={sec.title} className="access-group" style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 10 }}>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <b style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--text-3)" }}>{sec.title}</b>
                    <button className="btn small" onClick={() => setGroup(sec.pages, !allOn)}>{allOn ? "Clear" : "All"}</button>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    {sec.pages.map((p) => {
                      const on = chosen.includes(p);
                      return (
                        <label key={p} className="access-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 2px", cursor: "pointer" }}>
                          <input type="checkbox" checked={on} onChange={() => togglePage(p)} />
                          <span style={{ color: on ? "var(--text)" : "var(--text-3)" }}>{PAGE_LABELS[p]}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <div className="notice mt small">
              {first} will see: <b>{willSee.map((p) => PAGE_LABELS[p]).join(", ")}</b>.
              Data for hidden sections isn't loaded into their browser.
            </div>
          </>
        )}

        <div className="notice mt small" style={{ opacity: 0.85 }}>
          🔒 <b>{ADMIN_ONLY_PAGES.map((p) => PAGE_LABELS[p]).join(" & ")}</b> stay admin-only — make someone an admin to grant those.
          {!custom && " A full-access member sees every section."}
        </div>
      </div>
    </div>
  );
}

export default function TeamPage({ db, update, user }) {
  const isAdmin = user.role === "admin";
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [editingAccess, setEditingAccess] = useState(null);
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
                          <button className="btn small" onClick={() => setEditingAccess(u.id)}>
                            {isLimited(u) ? `Access: ${allowedPages(u).length} section${allowedPages(u).length === 1 ? "" : "s"}` : "Access: full"}
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
        return <AccessModal u={u} update={update} onClose={() => setEditingAccess(null)} />;
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
