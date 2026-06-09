import React from "react"
import { useGame } from "../game/GameContext"

function GrainCard({ grain, canSpawn }) {
  const { dispatch } = useGame()
  return (
    <div className={"grain-card" + (grain.contaminated ? " contam" : "")}>
      <div className="plate-head">
        <div className="strain-name">{grain.name}</div>
        {grain.contaminated ? (
          <span className="pill danger">contaminated</span>
        ) : grain.ready ? (
          <span className="pill ready">colonized</span>
        ) : (
          <span className="pill colonizing">{grain.daysLeft}d left</span>
        )}
      </div>

      <div className="progress">
        <div
          className={"progress-fill" + (grain.contaminated ? " bad" : "")}
          style={{ width: (grain.contaminated ? 100 : grain.progress) + "%" }}
        />
      </div>
      <div className="grain-meta muted small">
        {grain.contaminated
          ? "Lost to contamination — toss it."
          : `${grain.progress}% colonized · contam risk ${Math.round(grain.risk * 100)}%`}
      </div>

      <div className="btn-row">
        {grain.ready && !grain.contaminated && (
          <button
            className="btn btn-primary"
            disabled={!canSpawn}
            onClick={() => dispatch({ type: "SPAWN_TUB", grainId: grain.id })}
          >
            {canSpawn ? "Spawn to tub" : "Need a substrate block"}
          </button>
        )}
        <button
          className="btn btn-ghost btn-small"
          onClick={() => dispatch({ type: "DISCARD_GRAIN", grainId: grain.id })}
        >
          Toss
        </button>
      </div>
    </div>
  )
}

export default function GrainRoom({ goTo }) {
  const { state } = useGame()
  const canSpawn = state.inventory.substrateBlock > 0
  return (
    <div className="screen">
      <div className="screen-head">
        <h2>Grain Room</h2>
        <p className="muted">
          Cultures colonize grain jars over several days. Strong resilience and clean gear keep
          contamination away. Fully colonized jars spawn into monotubs.
        </p>
      </div>

      {state.grains.length === 0 && (
        <div className="empty">
          No grain jars going. Inoculate a culture from your{" "}
          <button className="link" onClick={() => goTo("strains")}>Strains</button> (needs a grain jar).
        </div>
      )}

      <div className="card-grid">
        {state.grains.map(g => (
          <GrainCard key={g.id} grain={g} canSpawn={canSpawn} />
        ))}
      </div>
    </div>
  )
}
