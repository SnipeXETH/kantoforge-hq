import React from "react"
import { useGame } from "../game/GameContext"
import { PRICES, UPGRADES } from "../game/engine"

function ShopItem({ title, desc, cost, disabled, owned, onBuy }) {
  return (
    <div className="shop-item">
      <div className="shop-info">
        <div className="shop-title">{title}</div>
        <div className="muted small">{desc}</div>
      </div>
      <button
        className={"btn " + (owned ? "btn-ghost" : "btn-primary")}
        disabled={disabled || owned}
        onClick={onBuy}
      >
        {owned ? "Owned" : `$${cost}`}
      </button>
    </div>
  )
}

export default function Shop() {
  const { state, dispatch } = useGame()
  const money = state.money

  return (
    <div className="screen">
      <div className="screen-head">
        <h2>Shop</h2>
        <p className="muted">Stock up on lab supplies and invest in gear that strengthens your whole operation.</p>
      </div>

      <h3 className="section-title">Genetics</h3>
      <ShopItem
        title="Spore Syringe"
        desc="A wild, unproven strain. Cheap genetics to start a line."
        cost={PRICES.sporeSyringe}
        disabled={money < PRICES.sporeSyringe}
        onBuy={() => dispatch({ type: "BUY_SPORE", premium: false })}
      />
      <ShopItem
        title="Premium Spore Print"
        desc="Hand-selected genetics with a much stronger baseline."
        cost={PRICES.premiumSpore}
        disabled={money < PRICES.premiumSpore}
        onBuy={() => dispatch({ type: "BUY_SPORE", premium: true })}
      />

      <h3 className="section-title">Supplies</h3>
      <ShopItem
        title="Agar Plate"
        desc={`For plating & crossing. You have ${state.inventory.agarPlate}.`}
        cost={PRICES.agarPlate}
        disabled={money < PRICES.agarPlate}
        onBuy={() => dispatch({ type: "BUY_ITEM", item: "agarPlate" })}
      />
      <ShopItem
        title="Grain Jar"
        desc={`Sterilized grain to colonize. You have ${state.inventory.grainJar}.`}
        cost={PRICES.grainJar}
        disabled={money < PRICES.grainJar}
        onBuy={() => dispatch({ type: "BUY_ITEM", item: "grainJar" })}
      />
      <ShopItem
        title="Substrate Block"
        desc={`Bulk substrate for a monotub. You have ${state.inventory.substrateBlock}.`}
        cost={PRICES.substrateBlock}
        disabled={money < PRICES.substrateBlock}
        onBuy={() => dispatch({ type: "BUY_ITEM", item: "substrateBlock" })}
      />

      <h3 className="section-title">Lab Upgrades</h3>
      {Object.entries(UPGRADES).map(([key, up]) => (
        <ShopItem
          key={key}
          title={up.name}
          desc={up.desc}
          cost={up.cost}
          owned={state.upgrades[key]}
          disabled={money < up.cost}
          onBuy={() => dispatch({ type: "BUY_UPGRADE", key })}
        />
      ))}
    </div>
  )
}
