import React, { useState } from "react"
import { useGame } from "../game/GameContext"
import { TRAITS } from "../game/genetics"

function bestSectorId(sectors) {
  const best = sectors.reduce((b, s) => (s.rating > (b ? b.rating : -1) ? s : b), null)
  return best ? best.id : null
}

function Sector({ sector, isBest, selected, onSelect }) {
  return (
    <div
      className={"sector" + (selected ? " selected" : "") + (isBest ? " best" : "")}
      onClick={onSelect}
    >
      <div className="sector-head">
        <span className={"morph " + sector.morph}>{sector.morph}</span>
        <span className="sector-rating">{sector.rating}</span>
      </div>
      <div className="sector-traits">
        {TRAITS.map(t => (
          <span key={t.key} className="sector-trait" title={t.label}>
            <span className="dot" style={{ background: t.color }} />
            {sector.expr[t.key]}
          </span>
        ))}
      </div>
      {isBest && <div className="best-tag">strongest</div>}
    </div>
  )
}

function PlateCard({ plate }) {
  const { dispatch } = useGame()
  const [picked, setPicked] = useState(null)
  const best = plate.ready ? bestSectorId(plate.sectors) : null

  return (
    <div className="plate-card">
      <div className="plate-head">
        <div className="strain-name">{plate.name}</div>
        {!plate.ready ? (
          <span className="pill colonizing">colonizing · {plate.daysLeft}d</span>
        ) : (
          <span className="pill ready">ready</span>
        )}
      </div>

      {!plate.ready ? (
        <div className="agar-dish growing">
          <div className="myc" style={{ animationDuration: "3s" }} />
          <span className="dish-note">mycelium spreading…</span>
        </div>
      ) : (
        <>
          <p className="muted small">
            Pick a sector. Isolating the strongest pushes its traits into the next generation.
          </p>
          <div className="sector-grid">
            {plate.sectors.map(s => (
              <Sector
                key={s.id}
                sector={s}
                isBest={s.id === best}
                selected={picked === s.id}
                onSelect={() => setPicked(s.id)}
              />
            ))}
          </div>
          <div className="btn-row">
            <button
              className="btn btn-primary"
              disabled={!picked}
              onClick={() => dispatch({ type: "ISOLATE_SECTOR", plateId: plate.id, sectorId: picked })}
            >
              Isolate sector
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => dispatch({ type: "DISCARD_PLATE", plateId: plate.id })}
            >
              Discard plate
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default function AgarLab({ goTo }) {
  const { state } = useGame()
  return (
    <div className="screen">
      <div className="screen-head">
        <h2>Agar Lab</h2>
        <p className="muted">
          Cultures grow into a field of genetic sectors. Select and isolate the best to
          strengthen the line — repeat to climb toward elite genetics.
        </p>
      </div>

      {state.plates.length === 0 && (
        <div className="empty">
          No plates growing. Go to your <button className="link" onClick={() => goTo("strains")}>Strains</button>{" "}
          and plate a culture (needs an agar plate from the Shop).
        </div>
      )}

      <div className="card-grid">
        {state.plates.map(p => (
          <PlateCard key={p.id} plate={p} />
        ))}
      </div>
    </div>
  )
}
