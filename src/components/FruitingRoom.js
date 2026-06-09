import React from "react"
import { useGame } from "../game/GameContext"
import { estimateYield } from "../game/engine"

const STAGE_LABEL = {
  colonizing: "colonizing substrate",
  pinning: "pinning",
  fruiting: "fruiting",
  harvestable: "ready to harvest",
  resting: "resting between flushes"
}

function EnvSlider({ label, value, ideal, onChange }) {
  const off = Math.abs(value - ideal)
  const quality = off < 6 ? "good" : off < 18 ? "ok" : "bad"
  return (
    <div className="env-row">
      <div className="env-top">
        <span>{label}</span>
        <span className={"env-val " + quality}>{value}%</span>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        value={value}
        onChange={e => onChange(Number(e.target.value))}
      />
    </div>
  )
}

function TubCard({ tub }) {
  const { dispatch } = useGame()
  const harvestable = tub.stage === "harvestable"
  const showEnv = ["pinning", "fruiting", "harvestable"].includes(tub.stage) && !tub.contaminated

  const setEnv = env => dispatch({ type: "SET_ENV", tubId: tub.id, env })

  return (
    <div className={"tub-card" + (tub.contaminated ? " contam" : "")}>
      <div className="plate-head">
        <div>
          <div className="strain-name">{tub.name}</div>
          <div className="strain-sub">flush {tub.flush || "—"} · {tub.lastYield ? `last ${tub.lastYield}g` : "first flush"}</div>
        </div>
        {tub.contaminated ? (
          <span className="pill danger">contaminated</span>
        ) : harvestable ? (
          <span className="pill ready">harvest</span>
        ) : (
          <span className="pill colonizing">{tub.daysLeft}d</span>
        )}
      </div>

      <div className="tub-stage">{tub.contaminated ? "lost to contamination" : STAGE_LABEL[tub.stage]}</div>

      {showEnv && (
        <div className="env-controls">
          <EnvSlider
            label="Humidity"
            value={tub.env.humidity}
            ideal={92}
            onChange={v => setEnv({ humidity: v })}
          />
          <EnvSlider
            label="Fresh air (FAE)"
            value={tub.env.fae}
            ideal={55}
            onChange={v => setEnv({ fae: v })}
          />
          <div className="muted small">
            Dial humidity ~92% and fresh air ~55% before harvest for the fattest canopy.
          </div>
        </div>
      )}

      <div className="btn-row">
        {harvestable && (
          <button className="btn btn-primary" onClick={() => dispatch({ type: "HARVEST_TUB", tubId: tub.id })}>
            Harvest (~{estimateYield(tub)}g)
          </button>
        )}
        {!tub.contaminated && (
          <button className="btn btn-ghost btn-small" onClick={() => dispatch({ type: "CLONE_FROM_TUB", tubId: tub.id })}>
            Clone best fruit
          </button>
        )}
        <button className="btn btn-danger btn-small" onClick={() => dispatch({ type: "DISCARD_TUB", tubId: tub.id })}>
          Toss tub
        </button>
      </div>
    </div>
  )
}

export default function FruitingRoom({ goTo }) {
  const { state } = useGame()
  return (
    <div className="screen">
      <div className="screen-head">
        <h2>Fruiting Room</h2>
        <p className="muted">
          Monotubs colonize the bulk, then pin and fruit. Tune the environment, harvest each flush,
          and clone the best fruit to carry its genetics back to agar.
        </p>
      </div>

      {state.tubs.length === 0 && (
        <div className="empty">
          No tubs running. Colonize a grain jar in the{" "}
          <button className="link" onClick={() => goTo("grain")}>Grain Room</button> and spawn it here.
        </div>
      )}

      <div className="card-grid">
        {state.tubs.map(t => (
          <TubCard key={t.id} tub={t} />
        ))}
      </div>
    </div>
  )
}
