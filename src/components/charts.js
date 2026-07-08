import React, { useRef, useState } from "react";
import { moneyCompact, money } from "../lib/format";

// Hand-rolled SVG charts: grouped bars, donut, horizontal bars.
// All follow the same rules: thin marks with rounded data-ends, 2px surface
// gaps between fills, recessive gridlines, hover tooltip layer, legend for
// >= 2 series, text in ink tokens (never series colors).

function useTooltip() {
  const boxRef = useRef(null);
  const [tip, setTip] = useState(null);
  const show = (evt, content) => {
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    setTip({ x: evt.clientX - rect.left, y: evt.clientY - rect.top, content });
  };
  const hide = () => setTip(null);
  const el = tip ? (
    <div
      className="chart-tip"
      style={{
        left: Math.min(tip.x + 14, (boxRef.current ? boxRef.current.clientWidth : 300) - 150),
        top: Math.max(tip.y - 10, 0),
      }}
    >
      {tip.content}
    </div>
  ) : null;
  return { boxRef, show, hide, el };
}

function niceMax(v) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (v <= m * mag) return m * mag;
  }
  return 10 * mag;
}

export function Legend({ items }) {
  if (!items || items.length < 2) return null;
  return (
    <div className="legend">
      {items.map((it) => (
        <span className="li" key={it.label}>
          <span className="dot" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

// data: [{label, values: [n, ...]}], series: [{label, color}]
// Negative values supported (bars drop below the zero baseline).
export function GroupedBars({ data, series, height = 240, currency = "GBP" }) {
  const { boxRef, show, hide, el } = useTooltip();
  const W = 900;
  const H = height;
  const padL = 46;
  const padR = 8;
  const padT = 12;
  const padB = 24;

  const allVals = data.flatMap((d) => d.values);
  const maxV = niceMax(Math.max(0, ...allVals));
  const minRaw = Math.min(0, ...allVals);
  const minV = minRaw < 0 ? -niceMax(-minRaw) : 0;
  const span = maxV - minV || 1;
  const plotH = H - padT - padB;
  const yOf = (v) => padT + plotH * (1 - (v - minV) / span);
  const zeroY = yOf(0);

  const n = Math.max(1, data.length);
  const groupW = (W - padL - padR) / n;
  const barGap = 2;
  const barW = Math.min(56, Math.max(2, (groupW - Math.min(28, groupW * 0.44) - barGap * (series.length - 1)) / series.length));
  const contentW = barW * series.length + barGap * (series.length - 1);

  const ticks = 4;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => minV + (span * i) / ticks);

  const labelEvery = Math.ceil(n / 12);

  return (
    <div className="chart-box" ref={boxRef}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }} onMouseLeave={hide}>
        {tickVals.map((tv, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={yOf(tv)} y2={yOf(tv)} stroke={tv === 0 ? "#3a3a42" : "var(--grid)"} strokeWidth={1} />
            <text x={padL - 8} y={yOf(tv) + 4} fill="var(--text-3)" fontSize={11} textAnchor="end">
              {moneyCompact(tv, currency)}
            </text>
          </g>
        ))}
        {data.map((d, gi) => {
          const gx = padL + gi * groupW + (groupW - contentW) / 2;
          return (
            <g key={gi}>
              {d.values.map((v, si) => {
                const x = gx + si * (barW + barGap);
                const y = v >= 0 ? yOf(v) : zeroY;
                const h = Math.abs(yOf(v) - zeroY);
                const r = Math.min(4, barW / 2, h);
                // rounded corner at the data end only, square at the baseline
                const path =
                  v >= 0
                    ? `M ${x} ${zeroY} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} L ${x + barW - r} ${y} Q ${x + barW} ${y} ${x + barW} ${y + r} L ${x + barW} ${zeroY} Z`
                    : `M ${x} ${zeroY} L ${x} ${y + h - r} Q ${x} ${y + h} ${x + r} ${y + h} L ${x + barW - r} ${y + h} Q ${x + barW} ${y + h} ${x + barW} ${y + h - r} L ${x + barW} ${zeroY} Z`;
                return (
                  <path
                    key={si}
                    d={h < 0.5 ? undefined : path}
                    fill={series[si].color}
                    onMouseMove={(e) =>
                      show(
                        e,
                        <>
                          <div className="tt-title">{d.label}</div>
                          {series.map((s, i2) => (
                            <div className="tt-row" key={i2}>
                              <span>
                                <span className="dot" style={{ background: s.color, marginRight: 5 }} />
                                {s.label}
                              </span>
                              <b>{money(d.values[i2], currency)}</b>
                            </div>
                          ))}
                        </>
                      )
                    }
                    onMouseLeave={hide}
                  />
                );
              })}
              {/* invisible hover target covering the whole group */}
              <rect
                x={padL + gi * groupW}
                y={padT}
                width={groupW}
                height={plotH}
                fill="transparent"
                onMouseMove={(e) =>
                  show(
                    e,
                    <>
                      <div className="tt-title">{d.label}</div>
                      {series.map((s, i2) => (
                        <div className="tt-row" key={i2}>
                          <span>
                            <span className="dot" style={{ background: s.color, marginRight: 5 }} />
                            {s.label}
                          </span>
                          <b>{money(d.values[i2], currency)}</b>
                        </div>
                      ))}
                    </>
                  )
                }
              />
              {gi % labelEvery === 0 && (
                <text x={padL + gi * groupW + groupW / 2} y={H - 7} fill="var(--text-3)" fontSize={11} textAnchor="middle">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {el}
      <Legend items={series} />
    </div>
  );
}

// segments: [{label, value, color}]
export function Donut({ segments, size = 190, currency = "GBP", centerLabel }) {
  const { boxRef, show, hide, el } = useTooltip();
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const R = 80;
  const r = 54;
  const C = 100;
  let angle = -Math.PI / 2;

  const paths = segments
    .filter((s) => s.value > 0)
    .map((seg) => {
      const frac = seg.value / total;
      const a0 = angle;
      const a1 = angle + frac * Math.PI * 2;
      angle = a1;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a, rad) => [C + rad * Math.cos(a), C + rad * Math.sin(a)];
      const [x0, y0] = p(a0, R);
      const [x1, y1] = p(a1, R);
      const [x2, y2] = p(a1, r);
      const [x3, y3] = p(a0, r);
      return {
        seg,
        frac,
        d: `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${r} ${r} 0 ${large} 0 ${x3} ${y3} Z`,
      };
    });

  if (total <= 0) {
    return <div className="muted small">No data yet.</div>;
  }

  return (
    <div className="chart-box" ref={boxRef} style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
      <svg viewBox="0 0 200 200" width={size} height={size} onMouseLeave={hide}>
        {paths.map(({ seg, d, frac }, i) => (
          <path
            key={i}
            d={d}
            fill={seg.color}
            stroke="var(--panel)"
            strokeWidth={2}
            onMouseMove={(e) =>
              show(
                e,
                <>
                  <div className="tt-title">{seg.label}</div>
                  <div className="tt-row">
                    <span>Value</span>
                    <b>{money(seg.value, currency)}</b>
                  </div>
                  <div className="tt-row">
                    <span>Share</span>
                    <b>{(frac * 100).toFixed(1)}%</b>
                  </div>
                </>
              )
            }
            onMouseLeave={hide}
          />
        ))}
        {centerLabel && (
          <>
            <text x={C} y={C - 4} textAnchor="middle" fill="var(--text)" fontSize={17} fontWeight={700}>
              {centerLabel[0]}
            </text>
            <text x={C} y={C + 14} textAnchor="middle" fill="var(--text-3)" fontSize={10.5}>
              {centerLabel[1]}
            </text>
          </>
        )}
      </svg>
      <div style={{ flex: 1, minWidth: 150 }}>
        {segments.map((seg) => (
          <div key={seg.label} className="tt-row" style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 12.5, color: "var(--text-2)" }}>
            <span>
              <span className="dot" style={{ background: seg.color, marginRight: 7 }} />
              {seg.label}
            </span>
            <b style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
              {money(seg.value, currency)}
              <span className="muted" style={{ marginLeft: 8 }}>{total > 0 ? ((Math.max(0, seg.value) / total) * 100).toFixed(0) + "%" : ""}</span>
            </b>
          </div>
        ))}
      </div>
      {el}
    </div>
  );
}

// rows: [{label, value, sub}] — single-series horizontal bars, direct labels.
export function HBars({ rows, color = "var(--c-revenue)", currency = "GBP", max = 8 }) {
  const shown = rows.slice(0, max);
  const top = Math.max(...shown.map((r) => Math.abs(r.value)), 1);
  return (
    <div>
      {shown.map((r, i) => (
        <div key={i} style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%", color: "var(--text-2)" }} title={r.label}>
              {r.label}
            </span>
            <b style={{ fontVariantNumeric: "tabular-nums", color: r.value < 0 ? "var(--accent-hi)" : "var(--text)" }}>{money(r.value, currency)}</b>
          </div>
          <div style={{ background: "var(--panel-2)", borderRadius: 4, height: 8 }}>
            <div
              style={{
                width: Math.max(1.5, (Math.abs(r.value) / top) * 100) + "%",
                height: 8,
                borderRadius: 4,
                background: r.value < 0 ? "var(--accent)" : color,
              }}
            />
          </div>
          {r.sub && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{r.sub}</div>}
        </div>
      ))}
      {!shown.length && <div className="muted small">No data yet.</div>}
    </div>
  );
}
