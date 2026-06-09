import { reducer, newGame } from "./engine"
import { express, rating } from "./genetics"

// Drive the reducer through N NEXT_DAY ticks.
function advance(state, days) {
  let s = state
  for (let i = 0; i < days; i++) s = reducer(s, { type: "NEXT_DAY" })
  return s
}

// A genome with maxed resilience so contamination never derails the test.
function safeCulture(state) {
  const c = state.cultures[0]
  return {
    ...state,
    cultures: [
      {
        ...c,
        genome: {
          vigor: [80, 80],
          yield: [40, 40],
          resilience: [100, 100],
          potency: [50, 50],
          canopy: [40, 40]
        }
      }
    ]
  }
}

test("buying spend money and adds a culture", () => {
  let s = newGame()
  const before = s.money
  s = reducer(s, { type: "BUY_SPORE", premium: false })
  expect(s.money).toBeLessThan(before)
  expect(s.cultures.length).toBe(2)
})

test("plating then isolating the best sector raises traits and bumps generation", () => {
  let s = safeCulture(newGame())
  const startRating = rating(s.cultures[0].genome)
  s = reducer(s, { type: "PLATE_CULTURE", cultureId: s.cultures[0].id })
  s = advance(s, 8) // colonize the plate
  const plate = s.plates[0]
  expect(plate.ready).toBe(true)
  expect(plate.sectors.length).toBeGreaterThan(0)
  // isolate the strongest sector
  const best = plate.sectors.reduce((a, b) => (b.rating > a.rating ? b : a))
  s = reducer(s, { type: "ISOLATE_SECTOR", plateId: plate.id, sectorId: best.id })
  const iso = s.cultures[s.cultures.length - 1]
  expect(iso.generation).toBe(2)
  // selecting a strong sector should not lower the line's rating
  expect(rating(iso.genome)).toBeGreaterThanOrEqual(startRating - 2)
})

test("full loop: grain -> tub -> harvest pays out", () => {
  let s = safeCulture(newGame())
  s = { ...s, money: 1000, inventory: { agarPlate: 5, grainJar: 5, substrateBlock: 5 } }
  s = reducer(s, { type: "INOCULATE_GRAIN", cultureId: s.cultures[0].id })
  s = advance(s, 14)
  const grain = s.grains[0]
  expect(grain.ready).toBe(true)
  s = reducer(s, { type: "SPAWN_TUB", grainId: grain.id })
  expect(s.tubs.length).toBe(1)
  // colonize -> pin -> fruit -> harvestable
  s = advance(s, 20)
  const tub = s.tubs.find(t => t.stage === "harvestable")
  expect(tub).toBeTruthy()
  const money = s.money
  s = reducer(s, { type: "HARVEST_TUB", tubId: tub.id })
  expect(s.money).toBeGreaterThan(money)
  expect(s.stats.harvested).toBeGreaterThan(0)
})

test("repeated isolation climbs yield over many generations", () => {
  let s = safeCulture(newGame())
  s = { ...s, inventory: { ...s.inventory, agarPlate: 50 } }
  let cultureId = s.cultures[0].id
  const startYield = express(s.cultures[0].genome).yield
  for (let gen = 0; gen < 8; gen++) {
    s = reducer(s, { type: "PLATE_CULTURE", cultureId })
    s = advance(s, 8)
    const plate = s.plates[0]
    const best = plate.sectors.reduce((a, b) => (b.rating > a.rating ? b : a))
    s = reducer(s, { type: "ISOLATE_SECTOR", plateId: plate.id, sectorId: best.id })
    cultureId = s.cultures[s.cultures.length - 1].id
  }
  const endYield = express(s.cultures.find(c => c.id === cultureId).genome).yield
  expect(endYield).toBeGreaterThan(startYield)
})
