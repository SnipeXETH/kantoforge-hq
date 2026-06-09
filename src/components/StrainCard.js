import React from "react"
import TraitBars from "./TraitBars"
import { rating } from "../game/genetics"

function ratingClass(r) {
  if (r >= 75) return "elite"
  if (r >= 55) return "strong"
  if (r >= 35) return "decent"
  return "weak"
}

export default function StrainCard({ culture, footer, selected, onClick, badge }) {
  const r = rating(culture.genome)
  return (
    <div
      className={"strain-card" + (selected ? " selected" : "") + (onClick ? " clickable" : "")}
      onClick={onClick}
    >
      <div className="strain-head">
        <div>
          <div className="strain-name">{culture.name}</div>
          <div className="strain-sub">
            gen {culture.generation} · {culture.source}
          </div>
        </div>
        <div className={"rating-badge " + ratingClass(r)}>{r}</div>
      </div>
      <TraitBars genome={culture.genome} compact />
      {badge && <div className="card-badge">{badge}</div>}
      {footer && <div className="card-footer">{footer}</div>}
    </div>
  )
}
