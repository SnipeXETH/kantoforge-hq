import React, { useState } from "react"
import { useGame } from "../game/GameContext"
import StrainCard from "./StrainCard"

export default function Library({ goTo }) {
  const { state, dispatch } = useGame()
  const [crossMode, setCrossMode] = useState(false)
  const [pair, setPair] = useState([])

  const toggleCross = id => {
    setPair(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id)
      if (prev.length >= 2) return [prev[1], id]
      return [...prev, id]
    })
  }

  const doCross = () => {
    if (pair.length !== 2) return
    dispatch({ type: "CROSS_CULTURES", aId: pair[0], bId: pair[1] })
    setPair([])
    setCrossMode(false)
  }

  const canPlate = state.inventory.agarPlate > 0
  const canGrain = state.inventory.grainJar > 0

  return (
    <div className="screen">
      <div className="screen-head">
        <h2>Strain Library</h2>
        <p className="muted">
          Your living genetics. Plate a culture to select stronger sectors, or cross two
          strains to mix traits.
        </p>
      </div>

      <div className="action-row">
        <button
          className={"btn " + (crossMode ? "btn-active" : "btn-ghost")}
          onClick={() => {
            setCrossMode(m => !m)
            setPair([])
          }}
        >
          {crossMode ? "Cancel cross" : "Cross two strains"}
        </button>
        {crossMode && (
          <button
            className="btn btn-primary"
            disabled={pair.length !== 2 || !canPlate}
            onClick={doCross}
          >
            {canPlate ? `Cross selected (${pair.length}/2)` : "Need an agar plate"}
          </button>
        )}
      </div>

      {state.cultures.length === 0 && (
        <div className="empty">No cultures yet. Buy a spore syringe in the Shop.</div>
      )}

      <div className="card-grid">
        {state.cultures.map(c => (
          <StrainCard
            key={c.id}
            culture={c}
            selected={crossMode && pair.includes(c.id)}
            onClick={crossMode ? () => toggleCross(c.id) : undefined}
            badge={crossMode && pair.includes(c.id) ? `Parent ${pair.indexOf(c.id) + 1}` : null}
            footer={
              !crossMode && (
                <div className="btn-row">
                  <button
                    className="btn btn-small"
                    disabled={!canPlate}
                    onClick={() => {
                      dispatch({ type: "PLATE_CULTURE", cultureId: c.id })
                      goTo && goTo("agar")
                    }}
                  >
                    Plate{canPlate ? "" : " (need agar)"}
                  </button>
                  <button
                    className="btn btn-small"
                    disabled={!canGrain}
                    onClick={() => {
                      dispatch({ type: "INOCULATE_GRAIN", cultureId: c.id })
                      goTo && goTo("grain")
                    }}
                  >
                    To grain{canGrain ? "" : " (need jar)"}
                  </button>
                  <button
                    className="btn btn-small btn-danger"
                    onClick={() => dispatch({ type: "DISCARD_CULTURE", cultureId: c.id })}
                  >
                    Toss
                  </button>
                </div>
              )
            }
          />
        ))}
      </div>
    </div>
  )
}
