import React, { createContext, useContext, useReducer, useEffect } from "react"
import { reducer, newGame, load, save } from "./engine"

const GameContext = createContext(null)

function init() {
  return load() || newGame()
}

export function GameProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, init)

  // autosave on every change
  useEffect(() => {
    save(state)
  }, [state])

  return <GameContext.Provider value={{ state, dispatch }}>{children}</GameContext.Provider>
}

export function useGame() {
  const ctx = useContext(GameContext)
  if (!ctx) throw new Error("useGame must be used inside <GameProvider>")
  return ctx
}
