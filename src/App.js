import React, { useCallback, useEffect, useRef, useState } from "react";
import { supabase, isConfigured } from "./lib/supabase";
import { fetchDb, syncDb } from "./lib/store";
import { Login, SetNewPassword, AuthCard } from "./components/Login";
import Dashboard from "./components/Dashboard";
import OrdersPage from "./components/OrdersPage";
import CostsPage from "./components/CostsPage";
import AnalyticsPage from "./components/AnalyticsPage";
import PricingPage from "./components/PricingPage";
import TasksPage from "./components/TasksPage";
import TeamPage from "./components/TeamPage";
import SettingsPage from "./components/SettingsPage";

const logo = process.env.PUBLIC_URL + "/brand/logo-light@2x.png";

const icons = {
  dashboard: <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />,
  orders: <path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-8 14H7v-2h4v2zm6-4H7v-2h10v2zm0-4H7V7h10v2z" />,
  costs: <path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z" />,
  analytics: <path d="M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z" />,
  pricing: <path d="M12.79 21 3 11.21v2c0 .53.21 1.04.59 1.41l7.79 7.79c.78.78 2.05.78 2.83 0l6.21-6.21c.78-.78.78-2.05 0-2.83L12.79 21zM11.38 17.41c.39.39.9.59 1.41.59.51 0 1.02-.2 1.41-.59l6.21-6.21c.78-.78.78-2.05 0-2.83L12.62.58C12.25.21 11.74 0 11.21 0H5c-1.1 0-2 .9-2 2v6.21c0 .53.21 1.04.59 1.41l7.79 7.79zM7.25 3a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5z" />,
  tasks: <path d="M22 5.18 10.59 16.6l-4.24-4.24 1.41-1.41 2.83 2.83 10-10L22 5.18zM19.79 10.22c.13.57.21 1.17.21 1.78 0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8c1.58 0 3.04.46 4.28 1.25l1.44-1.44A9.9 9.9 0 0 0 12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10c0-1.19-.22-2.33-.6-3.39l-1.61 1.61z" />,
  team: <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />,
  settings: <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.61 3.61 0 0 1 8.4 12c0-1.98 1.62-3.6 3.6-3.6s3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />,
};

function Icon({ name }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="currentColor">
      {icons[name]}
    </svg>
  );
}

const NAV = [
  { section: "Overview" },
  { key: "dashboard", label: "Dashboard", icon: "dashboard" },
  { key: "analytics", label: "Analytics", icon: "analytics" },
  { section: "Operations" },
  { key: "orders", label: "Orders & imports", icon: "orders" },
  { key: "costs", label: "Costs", icon: "costs" },
  { key: "pricing", label: "Pricing calculator", icon: "pricing" },
  { section: "Team" },
  { key: "tasks", label: "Tasks", icon: "tasks" },
  { key: "team", label: "Team", icon: "team" },
  { section: "Admin" },
  { key: "settings", label: "Settings", icon: "settings" },
];

function CenterScreen({ children }) {
  return (
    <div className="login-wrap">
      <div style={{ textAlign: "center" }}>
        <img src={logo} alt="KantoForge" style={{ height: 24, marginBottom: 18, opacity: 0.9 }} />
        <div className="muted">{children}</div>
      </div>
    </div>
  );
}

function NotConfigured() {
  return (
    <AuthCard tag="Almost there — connect Supabase to finish setup.">
      <div className="notice" style={{ textAlign: "left" }}>
        <p style={{ marginTop: 0 }}>This deployment is missing its database configuration. Add these environment variables and redeploy:</p>
        <p style={{ fontFamily: "monospace", fontSize: 12 }}>
          REACT_APP_SUPABASE_URL<br />
          REACT_APP_SUPABASE_ANON_KEY
        </p>
        <p style={{ marginBottom: 0 }}>
          Both values are in your Supabase project under <b>Settings → API</b>. Full instructions are in the repo's README.
        </p>
      </div>
    </AuthCard>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [recovery, setRecovery] = useState(false);
  const [db, setDbState] = useState(null);
  const dbRef = useRef(null);
  const [loadErr, setLoadErr] = useState(null);
  const [syncErr, setSyncErr] = useState(null);
  const [pageKey, setPageKey] = useState("dashboard");

  useEffect(() => {
    if (!isConfigured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      setSession(s || null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const refetch = useCallback(async () => {
    try {
      const fresh = await fetchDb();
      dbRef.current = fresh;
      setDbState(fresh);
      setLoadErr(null);
    } catch (e) {
      setLoadErr(e.message || String(e));
    }
  }, []);

  useEffect(() => {
    if (session) {
      refetch();
    } else {
      dbRef.current = null;
      setDbState(null);
    }
  }, [session, refetch]);

  // Live sync: when a teammate changes anything, refetch (debounced).
  useEffect(() => {
    if (!session) return;
    let timer;
    const channel = supabase
      .channel("kf-live")
      .on("postgres_changes", { event: "*", schema: "public" }, () => {
        clearTimeout(timer);
        timer = setTimeout(refetch, 800);
      })
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [session, refetch]);

  // Optimistic update: apply locally right away, push the diff to Supabase.
  const update = useCallback((fn) => {
    const prev = dbRef.current;
    if (!prev) return;
    const next = fn(prev);
    dbRef.current = next;
    setDbState(next);
    syncDb(prev, next).catch((e) => setSyncErr(e.message || String(e)));
  }, []);

  if (!isConfigured) return <NotConfigured />;
  if (recovery && session) return <SetNewPassword onDone={() => setRecovery(false)} />;
  if (session === undefined) return <CenterScreen>Loading…</CenterScreen>;
  if (!session) return <Login />;
  if (loadErr) {
    return (
      <AuthCard tag="Couldn't load your data.">
        <div className="err">{loadErr}</div>
        <p className="muted small">
          If this is a brand-new Supabase project, make sure you've run <b>supabase/schema.sql</b> in the SQL editor.
        </p>
        <button className="btn primary" style={{ width: "100%", justifyContent: "center" }} onClick={refetch}>Retry</button>
      </AuthCard>
    );
  }
  if (!db) return <CenterScreen>Loading your workspace…</CenterScreen>;

  const user = db.users.find((u) => u.id === session.user.id);
  if (!user) {
    return (
      <AuthCard tag="Setting up your profile…">
        <p className="muted small">Your account exists but its profile row hasn't appeared yet. This resolves itself in a second.</p>
        <button className="btn primary" style={{ width: "100%", justifyContent: "center" }} onClick={refetch}>Retry</button>
      </AuthCard>
    );
  }

  const logout = () => supabase.auth.signOut();

  const pages = {
    dashboard: <Dashboard db={db} user={user} go={setPageKey} />,
    analytics: <AnalyticsPage db={db} />,
    orders: <OrdersPage db={db} update={update} refetch={refetch} />,
    costs: <CostsPage db={db} update={update} />,
    pricing: <PricingPage db={db} />,
    tasks: <TasksPage db={db} update={update} user={user} />,
    team: <TeamPage db={db} update={update} user={user} />,
    settings: <SettingsPage db={db} update={update} user={user} refetch={refetch} />,
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src={logo} alt="KantoForge HQ" />
        </div>
        {NAV.map((item, i) =>
          item.section ? (
            <div className="nav-section" key={"s" + i}>{item.section}</div>
          ) : (
            <button
              key={item.key}
              className={"nav-item" + (pageKey === item.key ? " active" : "")}
              onClick={() => setPageKey(item.key)}
            >
              <Icon name={item.icon} />
              {item.label}
            </button>
          )
        )}
        <div className="me">
          <div className="avatar">{(user.name || "?").split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()}</div>
          <div className="who">
            <div className="name">{user.name}</div>
            <div className="role">{user.role}</div>
          </div>
          <span className="spacer" />
          <button className="btn small" onClick={logout} title="Log out">⎋</button>
        </div>
      </aside>
      <main className="main">
        {syncErr && (
          <div className="notice bad mb" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span>⚠️ A change failed to save: {syncErr}</span>
            <span className="row">
              <button className="btn small" onClick={() => { setSyncErr(null); refetch(); }}>Reload data</button>
              <button className="btn small" onClick={() => setSyncErr(null)}>Dismiss</button>
            </span>
          </div>
        )}
        {pages[pageKey]}
      </main>
    </div>
  );
}
