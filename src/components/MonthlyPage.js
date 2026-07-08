import React, { useMemo, useState } from "react";
import { money, pct, monthLabel, shortDate } from "../lib/format";
import { GroupedBars } from "./charts";

// The manager's operating summary, digitised. Each month:
//   gross profit = net sales − cost-of-sales lines
//   net profit   = gross profit − operating-cost lines
//   partner fee  = net profit × split % (Settings), remainder = Kanto retains
// Cost lines are free-form label+amount rows so new costs can be added any time.

const COS = (label, amount) => ({ label, amount });

// His existing workbook, November 2025 – June 2026, verified against the
// sheet's own Gross/Net Profit figures to the penny.
const SEED = [
  {
    id: "2025-11",
    netSales: 9623.32,
    costOfSales: [COS("Other Etsy fees", 1715.69), COS("Shipping, Handling + TC Fee", 1627.8)],
    operatingCosts: [
      COS("Customer Relations Manager", 750),
      COS("Social Media Manager", 750),
      COS("Internet OpEx", 181),
      COS("Sub/Domain", 15),
      COS("Etsy Marketing", 2393.9),
      COS("Refunds/Replacements", 85),
    ],
  },
  {
    id: "2025-12",
    netSales: 6718.5,
    costOfSales: [COS("Etsy Fees", 1346.16), COS("Shipping, Handling + TC Fee", 4228.37), COS("Product Costs", 776.03)],
    operatingCosts: [COS("Internet OpEx", 181), COS("Sub/Domain", 15), COS("Etsy Marketing", 1469.74), COS("Refunds/Replacements", 138)],
  },
  {
    id: "2026-01",
    netSales: 8627.35,
    costOfSales: [COS("Etsy Fees", 934), COS("Shipping, Handling + TC Fee", 4102), COS("Product Costs", 24.99)],
    operatingCosts: [COS("Internet OpEx", 181), COS("Sub/Domain", 15), COS("Etsy Marketing", 923), COS("Refunds/Replacements", 105)],
  },
  {
    id: "2026-02",
    netSales: 4020.44,
    costOfSales: [COS("Etsy Fees", 671.64), COS("Shipping, Handling + TC Fee", 863.91)],
    operatingCosts: [COS("Internet OpEx", 181), COS("Sub/Domain", 15), COS("Etsy Marketing", 852.2), COS("Refunds/Replacements", 75)],
  },
  {
    id: "2026-03",
    netSales: 4455.71,
    costOfSales: [COS("Etsy Fees", 763.28), COS("Shipping, Handling + TC Fee", 4677.03)],
    operatingCosts: [COS("Internet OpEx", 181), COS("Sub/Domain", 15), COS("Etsy Marketing", 1109.71), COS("Refunds/Replacements", 25)],
  },
  {
    id: "2026-04",
    netSales: 4189.48,
    costOfSales: [COS("Etsy Fees", 576.69), COS("Shipping, Handling + TC Fee", 1840.98)],
    operatingCosts: [COS("Internet OpEx", 0), COS("Sub/Domain", 15), COS("Etsy Marketing", 773.1), COS("Refunds/Replacements", 25)],
  },
  {
    id: "2026-05",
    netSales: 3472.99,
    costOfSales: [COS("Etsy Fees", 557.81), COS("Shipping, Handling + TC Fee", 1191.07)],
    operatingCosts: [COS("Internet OpEx", 0), COS("Sub/Domain", 15), COS("Etsy Marketing", 788.96), COS("Refunds/Replacements", 32)],
  },
  {
    id: "2026-06",
    netSales: 2789.95,
    costOfSales: [COS("Etsy Fees", 469.96), COS("Shipping, Handling + TC Fee", 1447.17)],
    operatingCosts: [COS("Internet OpEx", 0), COS("Sub/Domain", 15), COS("Etsy Marketing", 735.36), COS("Refunds/Replacements", 75)],
  },
];

export function calcMonth(rec, partnerPct) {
  const cos = rec.costOfSales.reduce((s, l) => s + (l.amount || 0), 0);
  const op = rec.operatingCosts.reduce((s, l) => s + (l.amount || 0), 0);
  const gross = (rec.netSales || 0) - cos;
  const net = gross - op;
  const margin = rec.netSales > 0 ? (gross / rec.netSales) * 100 : null;
  const partnerFee = net * ((partnerPct || 0) / 100);
  return { cos, op, gross, net, margin, partnerFee, retains: net - partnerFee };
}

function nextMonthId(latestId) {
  const now = new Date();
  const cur = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  if (!latestId) return cur;
  let [y, m] = latestId.split("-").map(Number);
  m++;
  if (m > 12) {
    m = 1;
    y++;
  }
  const next = y + "-" + String(m).padStart(2, "0");
  return next <= cur ? next : cur;
}

function LineRows({ lines, setLines }) {
  const setAt = (i, patch) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <>
      {lines.map((l, i) => (
        <div className="form-row" key={i} style={{ marginBottom: 6 }}>
          <input
            type="text"
            style={{ flex: 2 }}
            placeholder="Cost name"
            value={l.label}
            onChange={(e) => setAt(i, { label: e.target.value })}
          />
          <input
            type="number"
            step="0.01"
            style={{ flex: 1 }}
            placeholder="0.00"
            value={l.amount}
            onChange={(e) => setAt(i, { amount: e.target.value })}
          />
          <button type="button" className="btn small danger" style={{ flex: "0 0 auto" }} onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button type="button" className="btn small" onClick={() => setLines([...lines, { label: "", amount: "" }])}>+ Add cost line</button>
    </>
  );
}

function MonthEditor({ initial, isNew, existingIds, partner, currency, onSave, onCancel }) {
  const [id, setId] = useState(initial.id);
  const [netSales, setNetSales] = useState(String(initial.netSales ?? ""));
  const [costOfSales, setCostOfSales] = useState(initial.costOfSales.map((l) => ({ label: l.label, amount: String(l.amount ?? "") })));
  const [operatingCosts, setOperatingCosts] = useState(initial.operatingCosts.map((l) => ({ label: l.label, amount: String(l.amount ?? "") })));
  const [err, setErr] = useState(null);

  const parseLines = (lines) =>
    lines
      .filter((l) => l.label.trim() !== "" || l.amount !== "")
      .map((l) => ({ label: l.label.trim() || "Unnamed cost", amount: parseFloat(l.amount) || 0 }));

  const preview = calcMonth(
    { netSales: parseFloat(netSales) || 0, costOfSales: parseLines(costOfSales), operatingCosts: parseLines(operatingCosts) },
    partner.pct
  );

  const save = (e) => {
    e.preventDefault();
    if (!/^\d{4}-\d{2}$/.test(id)) return setErr("Pick a month.");
    if (isNew && existingIds.includes(id)) return setErr(monthLabel(id) + " already exists — edit it in the list below instead.");
    onSave({ id, netSales: parseFloat(netSales) || 0, costOfSales: parseLines(costOfSales), operatingCosts: parseLines(operatingCosts) });
  };

  return (
    <form className="card mb" onSubmit={save} style={{ borderColor: "rgba(232,50,63,0.4)" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2>{isNew ? "New month" : "Edit " + monthLabel(id)}</h2>
        <input type="month" value={id} disabled={!isNew} onChange={(e) => setId(e.target.value)} style={{ width: 170 }} />
      </div>
      {err && <div className="notice bad mt mb">⚠️ {err}</div>}
      <div className="grid two mt">
        <div>
          <label className="field">
            <span className="lab">Net sales ({currency})</span>
            <input type="number" step="0.01" value={netSales} onChange={(e) => setNetSales(e.target.value)} autoFocus />
          </label>
          <h3 style={{ margin: "14px 0 8px" }}>Cost of sales <span className="muted" style={{ textTransform: "none", letterSpacing: 0 }}>(deducted before gross profit)</span></h3>
          <LineRows lines={costOfSales} setLines={setCostOfSales} />
          <h3 style={{ margin: "16px 0 8px" }}>Operating costs <span className="muted" style={{ textTransform: "none", letterSpacing: 0 }}>(deducted after gross profit)</span></h3>
          <LineRows lines={operatingCosts} setLines={setOperatingCosts} />
        </div>
        <div>
          <h3 style={{ marginBottom: 8 }}>Live calculation</h3>
          <table className="data">
            <tbody>
              <tr><td>Net sales</td><td className="num">{money(parseFloat(netSales) || 0, currency)}</td></tr>
              <tr><td>Cost of sales</td><td className="num neg">−{money(preview.cos, currency)}</td></tr>
              <tr><td><b>Gross profit</b> <span className="muted small">(margin {pct(preview.margin)})</span></td><td className={"num " + (preview.gross >= 0 ? "pos" : "neg")}><b>{money(preview.gross, currency)}</b></td></tr>
              <tr><td>Operating costs</td><td className="num neg">−{money(preview.op, currency)}</td></tr>
              <tr><td><b>Net profit</b></td><td className={"num " + (preview.net >= 0 ? "pos" : "neg")}><b>{money(preview.net, currency)}</b></td></tr>
              <tr><td>{partner.label} fee ({partner.pct}%)</td><td className="num">{money(preview.partnerFee, currency)}</td></tr>
              <tr><td><b>Kanto retains</b></td><td className={"num " + (preview.retains >= 0 ? "pos" : "neg")}><b>{money(preview.retains, currency)}</b></td></tr>
            </tbody>
          </table>
          <div className="row mt">
            <button className="btn primary">{isNew ? "Add month" : "Save changes"}</button>
            <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </div>
    </form>
  );
}

export default function MonthlyPage({ db, update, user }) {
  const currency = db.settings.currency;
  const partner = db.settings.partner || { label: "Partner", pct: 0 };
  const [editing, setEditing] = useState(null); // "new" | month id | null
  const records = db.monthlyFigures;

  const sorted = useMemo(() => [...records].sort((a, b) => b.id.localeCompare(a.id)), [records]);
  const ascending = useMemo(() => [...records].sort((a, b) => a.id.localeCompare(b.id)), [records]);

  const saveRecord = (rec) => {
    const stamped = { ...rec, updatedBy: user.name, updatedAt: new Date().toISOString() };
    update((d) => {
      const rest = d.monthlyFigures.filter((m) => m.id !== rec.id);
      return { ...d, monthlyFigures: [...rest, stamped].sort((a, b) => b.id.localeCompare(a.id)) };
    });
    setEditing(null);
  };

  const removeRecord = (id) => {
    if (!window.confirm("Delete " + monthLabel(id) + "'s figures?")) return;
    update((d) => ({ ...d, monthlyFigures: d.monthlyFigures.filter((m) => m.id !== id) }));
  };

  const importSeed = () => {
    const stamped = SEED.map((m) => ({ ...m, updatedBy: "Spreadsheet import", updatedAt: new Date().toISOString() }));
    update((d) => ({ ...d, monthlyFigures: stamped }));
  };

  if (!db.monthlyFiguresReady) {
    return (
      <div className="page">
        <div className="page-head"><div><h1>Monthly figures</h1></div></div>
        <div className="card">
          <h2>One-time database step needed</h2>
          <p className="muted">
            This page stores its data in a new table that your Supabase project doesn't have yet. Open Supabase →
            <b> SQL Editor</b> → New query, paste the snippet below, hit <b>Run</b>, then refresh this page.
            (It's also in the repo at <code>supabase/migrations/2026-07-monthly-figures.sql</code>.)
          </p>
          <pre style={{ background: "var(--panel-2)", padding: 14, borderRadius: 8, overflowX: "auto", fontSize: 12 }}>{`create table public.monthly_figures (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.monthly_figures enable row level security;
create policy "team full access" on public.monthly_figures
  for all to authenticated using (true) with check (true);
alter publication supabase_realtime add table public.monthly_figures;`}</pre>
        </div>
      </div>
    );
  }

  const template = sorted[0]
    ? { costOfSales: sorted[0].costOfSales.map((l) => COS(l.label, "")), operatingCosts: sorted[0].operatingCosts.map((l) => COS(l.label, "")) }
    : { costOfSales: [COS("Etsy Fees", ""), COS("Shipping, Handling + TC Fee", ""), COS("Product Costs", "")], operatingCosts: [COS("Etsy Marketing", ""), COS("Internet OpEx", ""), COS("Sub/Domain", ""), COS("Refunds/Replacements", "")] };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Monthly figures</h1>
          <div className="sub">The operating summary — type each month's numbers, the app does all the maths.</div>
        </div>
        {editing === null && <button className="btn primary" onClick={() => setEditing("new")}>+ Add month</button>}
      </div>

      {editing === "new" && (
        <MonthEditor
          isNew
          initial={{ id: nextMonthId(sorted[0] && sorted[0].id), netSales: "", ...template }}
          existingIds={records.map((m) => m.id)}
          partner={partner}
          currency={currency}
          onSave={saveRecord}
          onCancel={() => setEditing(null)}
        />
      )}
      {editing && editing !== "new" && (
        <MonthEditor
          isNew={false}
          initial={records.find((m) => m.id === editing)}
          existingIds={[]}
          partner={partner}
          currency={currency}
          onSave={saveRecord}
          onCancel={() => setEditing(null)}
        />
      )}

      {!records.length && editing === null && (
        <div className="card" style={{ textAlign: "center", padding: 36 }}>
          <h2>Start with the spreadsheet history</h2>
          <p className="muted" style={{ maxWidth: 520, margin: "8px auto 18px" }}>
            Load November 2025 – June 2026 from the operating summary spreadsheet in one click (checked against its own
            gross/net figures), then add new months as they close.
          </p>
          <div className="row" style={{ justifyContent: "center" }}>
            <button className="btn primary" onClick={importSeed}>⬇ Import spreadsheet history</button>
            <button className="btn" onClick={() => setEditing("new")}>Start blank instead</button>
          </div>
        </div>
      )}

      {records.length > 0 && (
        <>
          <div className="card">
            <h2>Sales &amp; profit by month</h2>
            <div className="card-sub">Gross = after Etsy fees, shipping &amp; product costs. Net = after all operating costs.</div>
            <GroupedBars
              currency={currency}
              data={ascending.map((m) => {
                const c = calcMonth(m, partner.pct);
                return { label: monthLabel(m.id), values: [m.netSales, c.gross, c.net] };
              })}
              series={[
                { label: "Net sales", color: "var(--c-revenue)" },
                { label: "Gross profit", color: "var(--c-profit)" },
                { label: "Net profit", color: "var(--c-slot3)" },
              ]}
            />
          </div>

          <div className="card mt">
            <h2>What Kanto keeps</h2>
            <div className="card-sub">Net profit after the {partner.label} fee ({partner.pct}% — change in Settings).</div>
            <GroupedBars
              height={180}
              currency={currency}
              data={ascending.map((m) => ({ label: monthLabel(m.id), values: [calcMonth(m, partner.pct).retains] }))}
              series={[{ label: "Kanto retains", color: "var(--c-slot4)" }]}
            />
          </div>

          <div className="card mt">
            <h2>All months</h2>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="num">Net sales</th>
                    <th className="num">Gross profit</th>
                    <th className="num">Margin</th>
                    <th className="num">Net profit</th>
                    <th className="num">{partner.label} fee</th>
                    <th className="num">Kanto retains</th>
                    <th>Updated</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((m) => {
                    const c = calcMonth(m, partner.pct);
                    return (
                      <tr key={m.id}>
                        <td><b>{monthLabel(m.id)}</b></td>
                        <td className="num">{money(m.netSales, currency)}</td>
                        <td className={"num " + (c.gross >= 0 ? "pos" : "neg")}>{money(c.gross, currency)}</td>
                        <td className="num">{pct(c.margin)}</td>
                        <td className={"num " + (c.net >= 0 ? "pos" : "neg")}>{money(c.net, currency)}</td>
                        <td className="num">{money(c.partnerFee, currency)}</td>
                        <td className={"num " + (c.retains >= 0 ? "pos" : "neg")}>{money(c.retains, currency)}</td>
                        <td className="muted small">{m.updatedBy ? m.updatedBy + " · " + shortDate(m.updatedAt) : "—"}</td>
                        <td className="num">
                          <span className="row" style={{ justifyContent: "flex-end" }}>
                            <button className="btn small" onClick={() => setEditing(m.id)}>Edit</button>
                            <button className="btn small danger" onClick={() => removeRecord(m.id)}>✕</button>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
