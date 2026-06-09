import React, { useState } from "react"
import "./App.css"
import { GameProvider, useGame } from "./game/GameContext"
import { wipe } from "./game/engine"
import Library from "./components/Library"
import AgarLab from "./components/AgarLab"
import GrainRoom from "./components/GrainRoom"
import FruitingRoom from "./components/FruitingRoom"
import Shop from "./components/Shop"

const TABS = [
  { key: "strains", label: "Strains", icon: "🧬" },
  { key: "agar", label: "Agar", icon: "🧫" },
  { key: "grain", label: "Grain", icon: "🫙" },
  { key: "tubs", label: "Tubs", icon: "📦" },
  { key: "shop", label: "Shop", icon: "🛒" }
]

function TopBar() {
  const { state, dispatch } = useGame()
  const [showLog, setShowLog] = useState(false)
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" role="img" aria-label="mushroom">🍄</span>
        <span className="brand-name">Mycelia</span>
      </div>
      <div className="stats">
        <button className="stat stat-btn" onClick={() => setShowLog(s => !s)} title="Activity log">
          Day {state.day}
        </button>
        <span className="stat money">${state.money}</span>
        <button className="btn btn-primary btn-day" onClick={() => dispatch({ type: "NEXT_DAY" })}>
          Next day ▸
        </button>
      </div>
      {showLog && (
        <div className="log-pop" onClick={() => setShowLog(false)}>
          <div className="log-inner" onClick={e => e.stopPropagation()}>
            <div className="log-head">
              <strong>Activity log</strong>
              <button className="link" onClick={() => setShowLog(false)}>close</button>
            </div>
            {state.log.map((l, i) => (
              <div className="log-line" key={i}>
                <span className="log-day">D{l.day}</span> {l.text}
              </div>
            ))}
            <div className="log-head" style={{ marginTop: 12 }}>
              <span className="muted small">
                Harvested {state.stats.harvested}g · earned ${state.stats.earned} · lost{" "}
                {state.stats.contamLost} to contam
              </span>
            </div>
            <button
              className="btn btn-danger btn-small"
              style={{ marginTop: 10 }}
              onClick={() => {
                if (window.confirm("Wipe your save and start a new lab?")) {
                  wipe()
                  dispatch({ type: "RESET" })
                }
              }}
            >
              New game
            </button>
          </div>
        </div>
      )}
    </header>
  )
}

function TabBar({ tab, setTab }) {
  const { state } = useGame()
  const counts = {
    agar: state.plates.filter(p => p.ready).length,
    grain: state.grains.filter(g => g.ready && !g.contaminated).length,
    tubs: state.tubs.filter(t => t.stage === "harvestable").length
  }
  return (
    <nav className="tabbar">
      {TABS.map(t => (
        <button
          key={t.key}
          className={"tab" + (tab === t.key ? " active" : "")}
          onClick={() => setTab(t.key)}
        >
          <span className="tab-icon" role="img" aria-label={t.label}>{t.icon}</span>
          <span className="tab-label">{t.label}</span>
          {counts[t.key] > 0 && <span className="tab-dot">{counts[t.key]}</span>}
        </button>
      ))}
    </nav>
  )
}

function Game() {
  const [tab, setTab] = useState("strains")
  const goTo = setTab
  return (
    <div className="app">
      <TopBar />
      <main className="content">
        {tab === "strains" && <Library goTo={goTo} />}
        {tab === "agar" && <AgarLab goTo={goTo} />}
        {tab === "grain" && <GrainRoom goTo={goTo} />}
        {tab === "tubs" && <FruitingRoom goTo={goTo} />}
        {tab === "shop" && <Shop goTo={goTo} />}
      </main>
      <TabBar tab={tab} setTab={setTab} />
    </div>
  )
}

export default function App() {
  return (
    <GameProvider>
      <Game />
    </GameProvider>
  )
}
