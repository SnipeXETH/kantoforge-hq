import React from "react"
import { TRAITS, express } from "../game/genetics"

// Compact set of trait bars for a genome. Pass `compact` to hide labels.
export default function TraitBars({ genome, compact }) {
  const e = express(genome)
  return (
    <div className={"trait-bars" + (compact ? " compact" : "")}>
      {TRAITS.map(t => (
        <div className="trait-row" key={t.key} title={t.desc}>
          {!compact && <span className="trait-label">{t.label}</span>}
          {compact && <span className="trait-label short">{t.short}</span>}
          <span className="trait-track">
            <span
              className="trait-fill"
              style={{ width: e[t.key] + "%", background: t.color }}
            />
          </span>
          <span className="trait-val">{e[t.key]}</span>
        </div>
      ))}
    </div>
  )
}
