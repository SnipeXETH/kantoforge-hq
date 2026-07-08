import React, { useRef, useState } from "react";
import { exportBackup, parseBackup } from "../lib/store";

function RateField({ label, hint, value, onChange, suffix }) {
  return (
    <label className="field">
      <span className="lab">{label}{suffix ? ` (${suffix})` : ""}</span>
      <input type="number" step="0.01" defaultValue={value} onBlur={(e) => onChange(parseFloat(e.target.value) || 0)} />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export default function SettingsPage({ db, update, user }) {
  const fileRef = useRef(null);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const isAdmin = user.role === "admin";
  const currency = db.settings.currency;

  const setEtsy = (key) => (v) => update((d) => ({ ...d, settings: { ...d.settings, etsy: { ...d.settings.etsy, [key]: v } } }));
  const setShopify = (key) => (v) => update((d) => ({ ...d, settings: { ...d.settings, shopify: { ...d.settings.shopify, [key]: v } } }));

  const doExport = () => {
    const blob = new Blob([exportBackup(db)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "kantoforge-hq-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const doImport = async (file) => {
    setErr(null);
    setMsg(null);
    try {
      const text = await file.text();
      const data = parseBackup(text);
      if (!window.confirm(`Replace everything with this backup? It has ${data.orders.length} orders, ${data.users.length} users and ${data.tasks.length} tasks.`)) return;
      update(() => data);
      setMsg("Backup restored.");
    } catch (e) {
      setErr(e.message || String(e));
    }
  };

  const wipe = () => {
    if (!window.confirm("Delete ALL data — orders, costs, tasks and accounts? This can't be undone.")) return;
    if (!window.confirm("Really sure? Consider exporting a backup first.")) return;
    localStorage.clear();
    window.location.reload();
  };

  const e = db.settings.etsy;
  const s = db.settings.shopify;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <div className="sub">Fee rates, currency and data. Rates change over time — keep these matching your platform statements.</div>
        </div>
      </div>

      {msg && <div className="notice good mb">✅ {msg}</div>}
      {err && <div className="notice bad mb">⚠️ {err}</div>}

      <div className="grid two">
        <div className="card" style={{ margin: 0 }}>
          <h2><span className="badge etsy">Etsy</span> fee rates</h2>
          <div className="card-sub">Defaults are the UK rates. Where the CSV includes actual card fees, those are used instead of the estimate.</div>
          <div className="form-row">
            <RateField label="Transaction fee" suffix="%" value={e.transactionPct} onChange={setEtsy("transactionPct")} hint="% of item + postage, after discounts" />
            <RateField label="Regulatory operating fee" suffix="%" value={e.regulatoryPct} onChange={setEtsy("regulatoryPct")} />
          </div>
          <div className="form-row">
            <RateField label="Payment processing" suffix="%" value={e.paymentPct} onChange={setEtsy("paymentPct")} />
            <RateField label="Payment fixed fee" suffix={currency} value={e.paymentFixed} onChange={setEtsy("paymentFixed")} />
          </div>
          <div className="form-row">
            <RateField label="Listing/renewal fee per item" suffix={currency} value={e.listingFee} onChange={setEtsy("listingFee")} hint="$0.20 — enter your currency equivalent" />
          </div>
          <div className="form-row">
            <RateField label="Offsite ads fee" suffix="%" value={e.offsiteAdsPct} onChange={setEtsy("offsiteAdsPct")} hint="12% if you did over $10k/yr, else 15%" />
            <RateField label="Share of orders via offsite ads" suffix="%" value={e.offsiteAdsShare} onChange={setEtsy("offsiteAdsShare")} hint="Rough average — 0 to ignore" />
          </div>
        </div>

        <div className="card" style={{ margin: 0 }}>
          <h2><span className="badge shopify">Shopify</span> fee rates</h2>
          <div className="card-sub">Shopify Payments UK online rate by default. Add your plan price as a fixed monthly cost on the Costs page.</div>
          <div className="form-row">
            <RateField label="Payment processing" suffix="%" value={s.paymentPct} onChange={setShopify("paymentPct")} />
            <RateField label="Payment fixed fee" suffix={currency} value={s.paymentFixed} onChange={setShopify("paymentFixed")} />
          </div>
          <label className="field">
            <span className="lab">Currency</span>
            <select
              value={currency}
              onChange={(ev) => update((d) => ({ ...d, settings: { ...d.settings, currency: ev.target.value } }))}
            >
              <option value="GBP">GBP (£)</option>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
            </select>
            <span className="hint">Display only — imports are assumed to already be in this currency.</span>
          </label>
        </div>
      </div>

      <div className="card mt">
        <h2>Data</h2>
        <div className="card-sub">
          Everything is stored in this browser. Export regularly — it's your backup, and it's also how you share data with
          teammates on other devices for now.
        </div>
        <div className="row">
          <button className="btn primary" onClick={doExport}>⬇ Export backup (.json)</button>
          <button className="btn" onClick={() => fileRef.current && fileRef.current.click()}>⬆ Restore from backup</button>
          {isAdmin && <button className="btn danger" onClick={wipe}>Delete all data</button>}
          <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={(ev) => { if (ev.target.files[0]) doImport(ev.target.files[0]); ev.target.value = ""; }} />
        </div>
      </div>
    </div>
  );
}
