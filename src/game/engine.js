// Game engine: state shape, the reducer with every player action, and the
// day-tick simulation that advances colonization, fruiting and contamination.

import {
  randomGenome,
  randomName,
  hybridName,
  express,
  rating,
  cross,
  mutate,
  plateSectors,
  isolateFromSector,
  clamp,
  rand,
  uid
} from "./genetics"

const SAVE_KEY = "mycelia.save.v1"

// ---- equipment / upgrades ---------------------------------------------------

export const UPGRADES = {
  stillAirBox: {
    name: "Still Air Box",
    desc: "A simple sealed box. Cuts contamination a little.",
    cost: 120,
    contam: 0.06,
    purity: 0.15
  },
  flowHood: {
    name: "Laminar Flow Hood",
    desc: "Sterile air curtain. Big drop in contamination and cleaner isolations.",
    cost: 850,
    contam: 0.18,
    purity: 0.4
  },
  incubator: {
    name: "Heated Incubator",
    desc: "Holds the ideal temperature. Colonization runs faster.",
    cost: 400,
    speed: 0.25
  },
  microscope: {
    name: "Lab Microscope",
    desc: "Read sector genetics more precisely, sharpening every isolation.",
    cost: 600,
    skill: 0.35
  }
}

// ---- prices -----------------------------------------------------------------

export const PRICES = {
  sporeSyringe: 45, // wild genetics
  premiumSpore: 160, // better wild genetics
  agarPlate: 8,
  grainJar: 14,
  substrateBlock: 20
}

// ---- initial state ----------------------------------------------------------

export function newGame() {
  const starter = randomGenome(0.32)
  return {
    day: 1,
    money: 200,
    log: [{ day: 1, text: "Welcome to the lab. Buy a spore syringe to begin." }],
    inventory: { agarPlate: 1, grainJar: 0, substrateBlock: 0 },
    upgrades: { stillAirBox: false, flowHood: false, incubator: false, microscope: false },
    cultures: [
      {
        id: uid(),
        name: randomName(),
        genome: starter,
        generation: 1,
        source: "starter culture"
      }
    ],
    plates: [],
    grains: [],
    tubs: [],
    stats: { harvested: 0, generations: 1, contamLost: 0, earned: 0 }
  }
}

// ---- derived helpers --------------------------------------------------------

export function purityBonus(state) {
  let p = 0.25
  if (state.upgrades.stillAirBox) p += UPGRADES.stillAirBox.purity
  if (state.upgrades.flowHood) p += UPGRADES.flowHood.purity
  return Math.min(0.9, p)
}

export function skillBonus(state) {
  return state.upgrades.microscope ? 0.85 : 0.5
}

export function contamReduction(state) {
  let r = 0
  if (state.upgrades.stillAirBox) r += UPGRADES.stillAirBox.contam
  if (state.upgrades.flowHood) r += UPGRADES.flowHood.contam
  return r
}

function speedFactor(state) {
  return state.upgrades.incubator ? 1 + UPGRADES.incubator.speed : 1
}

// Base contamination chance for a step, reduced by resilience and gear.
function contamChance(state, genome, base) {
  const e = express(genome)
  const resilience = e.resilience / 100
  const chance = base - resilience * base * 0.8 - contamReduction(state)
  return clamp(chance, 0.01, 0.6)
}

function logLine(state, text) {
  const log = [{ day: state.day, text }, ...state.log].slice(0, 60)
  return log
}

// ---- reducer ----------------------------------------------------------------

export function reducer(state, action) {
  switch (action.type) {
    case "LOAD":
      return action.state

    case "RESET":
      return newGame()

    // ---- shop ----
    case "BUY_ITEM": {
      const { item } = action
      const cost = PRICES[item]
      if (state.money < cost) return state
      const inv = { ...state.inventory }
      if (item === "agarPlate") inv.agarPlate += 1
      else if (item === "grainJar") inv.grainJar += 1
      else if (item === "substrateBlock") inv.substrateBlock += 1
      return { ...state, money: state.money - cost, inventory: inv }
    }

    case "BUY_SPORE": {
      const premium = action.premium
      const cost = premium ? PRICES.premiumSpore : PRICES.sporeSyringe
      if (state.money < cost) return state
      const genome = randomGenome(premium ? 0.55 : 0.32)
      const culture = {
        id: uid(),
        name: randomName(),
        genome,
        generation: 1,
        source: premium ? "premium spore syringe" : "spore syringe"
      }
      return {
        ...state,
        money: state.money - cost,
        cultures: [...state.cultures, culture],
        log: logLine(state, `Acquired a new wild strain: ${culture.name}.`)
      }
    }

    case "BUY_UPGRADE": {
      const { key } = action
      const up = UPGRADES[key]
      if (!up || state.upgrades[key] || state.money < up.cost) return state
      return {
        ...state,
        money: state.money - up.cost,
        upgrades: { ...state.upgrades, [key]: true },
        log: logLine(state, `Installed the ${up.name}.`)
      }
    }

    // ---- agar lab ----
    case "PLATE_CULTURE": {
      const { cultureId } = action
      const culture = state.cultures.find(c => c.id === cultureId)
      if (!culture || state.inventory.agarPlate < 1) return state
      const days = Math.round(
        clamp(7 - express(culture.genome).vigor / 25, 3, 7) / speedFactor(state)
      )
      const plate = {
        id: uid(),
        name: culture.name,
        genome: culture.genome,
        cultureName: culture.name,
        daysLeft: days,
        ready: false,
        sectors: [],
        contaminated: false
      }
      return {
        ...state,
        inventory: { ...state.inventory, agarPlate: state.inventory.agarPlate - 1 },
        plates: [...state.plates, plate],
        log: logLine(state, `Plated ${culture.name} onto agar. Colonizing...`)
      }
    }

    case "ISOLATE_SECTOR": {
      const { plateId, sectorId } = action
      const plate = state.plates.find(p => p.id === plateId)
      if (!plate || !plate.ready) return state
      const sector = plate.sectors.find(s => s.id === sectorId)
      if (!sector) return state
      const newGenome = isolateFromSector(plate.genome, sector, skillBonus(state))
      const culture = {
        id: uid(),
        name: plate.name,
        genome: newGenome,
        generation: 99, // recomputed below relative to source
        source: "agar isolation"
      }
      // generation = source generation + 1 when we can find it
      const parent = state.cultures.find(c => c.name === plate.name)
      culture.generation = (parent ? parent.generation : 1) + 1
      const gainNote = describeGain(express(plate.genome), express(newGenome))
      return {
        ...state,
        plates: state.plates.filter(p => p.id !== plateId),
        cultures: [...state.cultures, culture],
        stats: { ...state.stats, generations: state.stats.generations + 1 },
        log: logLine(
          state,
          `Isolated an elite sector of ${plate.name} (gen ${culture.generation}). ${gainNote}`
        )
      }
    }

    case "DISCARD_PLATE":
      return { ...state, plates: state.plates.filter(p => p.id !== action.plateId) }

    case "CROSS_CULTURES": {
      const { aId, bId } = action
      const a = state.cultures.find(c => c.id === aId)
      const b = state.cultures.find(c => c.id === bId)
      if (!a || !b || a.id === b.id || state.inventory.agarPlate < 1) return state
      const genome = cross(a.genome, b.genome)
      const culture = {
        id: uid(),
        name: hybridName(a.name, b.name),
        genome,
        generation: Math.max(a.generation, b.generation) + 1,
        source: `cross of ${a.name} × ${b.name}`
      }
      return {
        ...state,
        inventory: { ...state.inventory, agarPlate: state.inventory.agarPlate - 1 },
        cultures: [...state.cultures, culture],
        log: logLine(state, `Crossed ${a.name} × ${b.name} → ${culture.name}.`)
      }
    }

    case "DISCARD_CULTURE":
      return { ...state, cultures: state.cultures.filter(c => c.id !== action.cultureId) }

    // ---- grain ----
    case "INOCULATE_GRAIN": {
      const { cultureId } = action
      const culture = state.cultures.find(c => c.id === cultureId)
      if (!culture || state.inventory.grainJar < 1) return state
      const e = express(culture.genome)
      const days = Math.round(clamp(14 - e.vigor / 9, 6, 14) / speedFactor(state))
      const grain = {
        id: uid(),
        name: culture.name,
        genome: culture.genome,
        daysLeft: days,
        totalDays: days,
        progress: 0,
        ready: false,
        contaminated: false,
        risk: contamChance(state, culture.genome, 0.22)
      }
      return {
        ...state,
        inventory: { ...state.inventory, grainJar: state.inventory.grainJar - 1 },
        grains: [...state.grains, grain],
        log: logLine(state, `Inoculated a grain jar with ${culture.name}.`)
      }
    }

    case "DISCARD_GRAIN":
      return { ...state, grains: state.grains.filter(g => g.id !== action.grainId) }

    // ---- fruiting / monotub ----
    case "SPAWN_TUB": {
      const { grainId } = action
      const grain = state.grains.find(g => g.id === grainId)
      if (!grain || !grain.ready || grain.contaminated) return state
      if (state.inventory.substrateBlock < 1) return state
      const e = express(grain.genome)
      const days = Math.round(clamp(12 - e.vigor / 11, 5, 12) / speedFactor(state))
      const tub = {
        id: uid(),
        name: grain.name,
        genome: grain.genome,
        stage: "colonizing",
        daysLeft: days,
        flush: 0,
        env: { humidity: 90, fae: 50 }, // player-tuned
        contaminated: false,
        risk: contamChance(state, grain.genome, 0.16),
        lastYield: 0
      }
      return {
        ...state,
        inventory: { ...state.inventory, substrateBlock: state.inventory.substrateBlock - 1 },
        grains: state.grains.filter(g => g.id !== grainId),
        tubs: [...state.tubs, tub],
        log: logLine(state, `Spawned ${grain.name} to a monotub.`)
      }
    }

    case "SET_ENV": {
      const { tubId, env } = action
      return {
        ...state,
        tubs: state.tubs.map(t => (t.id === tubId ? { ...t, env: { ...t.env, ...env } } : t))
      }
    }

    case "HARVEST_TUB": {
      const { tubId } = action
      const tub = state.tubs.find(t => t.id === tubId)
      if (!tub || tub.stage !== "harvestable") return state
      const e = express(tub.genome)
      const grams = tubYield(tub)
      const value = Math.round(grams * (0.5 + e.potency / 100))
      const flush = tub.flush
      // diminishing flushes: after 3 flushes the tub is spent
      const spent = flush >= 3
      const nextDays = Math.round(clamp(8 - e.vigor / 14, 4, 8) / speedFactor(state))
      const updated = spent
        ? null
        : { ...tub, stage: "resting", daysLeft: nextDays, lastYield: grams }
      const tubs = spent
        ? state.tubs.filter(t => t.id !== tubId)
        : state.tubs.map(t => (t.id === tubId ? updated : t))
      return {
        ...state,
        tubs,
        money: state.money + value,
        stats: {
          ...state.stats,
          harvested: state.stats.harvested + grams,
          earned: state.stats.earned + value
        },
        log: logLine(
          state,
          `Harvested flush ${flush} of ${tub.name}: ${grams}g for $${value}.${
            spent ? " The tub is spent." : ""
          }`
        )
      }
    }

    case "CLONE_FROM_TUB": {
      const { tubId } = action
      const tub = state.tubs.find(t => t.id === tubId)
      if (!tub) return state
      // cloning the best fruit: small heritable boost + a little mutation
      const boosted = mutate(tub.genome, 1.2)
      const culture = {
        id: uid(),
        name: tub.name,
        genome: boosted,
        generation: 2,
        source: "tissue clone"
      }
      const parent = state.cultures.find(c => c.name === tub.name)
      culture.generation = (parent ? parent.generation : 1) + 1
      return {
        ...state,
        cultures: [...state.cultures, culture],
        log: logLine(state, `Took a tissue clone from the best fruit of ${tub.name}.`)
      }
    }

    case "DISCARD_TUB":
      return { ...state, tubs: state.tubs.filter(t => t.id !== action.tubId) }

    // ---- time ----
    case "NEXT_DAY":
      return advanceDay(state)

    default:
      return state
  }
}

// Estimate wet-yield grams for the current flush of a tub.
function tubYield(tub) {
  const e = express(tub.genome)
  // environment quality: humidity ideally 90-95, fae ideally ~55
  const humScore = 1 - Math.abs(tub.env.humidity - 92) / 60
  const faeScore = 1 - Math.abs(tub.env.fae - 55) / 70
  const envQuality = clamp((humScore + faeScore) / 2, 0.3, 1)
  const flushFactor = [1, 0.7, 0.45, 0.3][tub.flush] || 0.25
  const base = (e.yield * 4 + e.canopy * 2) * envQuality * flushFactor
  return Math.max(1, Math.round(base + rand(-base * 0.08, base * 0.08)))
}

export function estimateYield(tub) {
  return tubYield(tub)
}

function describeGain(before, after) {
  const parts = []
  for (const key of ["vigor", "yield", "resilience", "potency", "canopy"]) {
    const d = after[key] - before[key]
    if (d >= 2) parts.push(`+${d} ${key}`)
  }
  return parts.length ? `Gains: ${parts.join(", ")}.` : "Traits held steady."
}

// ---- the day tick -----------------------------------------------------------

function advanceDay(state) {
  let log = state.log
  const day = state.day + 1

  // plates
  const plates = []
  for (const p of state.plates) {
    if (p.ready) {
      plates.push(p)
      continue
    }
    const daysLeft = p.daysLeft - 1
    if (daysLeft <= 0) {
      const count = 4 + (state.upgrades.microscope ? 1 : 0)
      const sectors = plateSectors(p.genome, count, purityBonus(state))
      plates.push({ ...p, daysLeft: 0, ready: true, sectors })
      log = [{ day, text: `${p.name} has fully colonized the agar. Pick a sector to isolate.` }, ...log]
    } else {
      plates.push({ ...p, daysLeft })
    }
  }

  // grains
  let grains = []
  let contamLost = state.stats.contamLost
  for (const g of state.grains) {
    if (g.contaminated || g.ready) {
      grains.push(g)
      continue
    }
    // daily contamination roll (risk spread across colonization window)
    if (Math.random() < g.risk / Math.max(1, g.totalDays)) {
      contamLost += 1
      grains.push({ ...g, contaminated: true })
      log = [{ day, text: `A grain jar of ${g.name} got contaminated and was tossed.` }, ...log]
      continue
    }
    const daysLeft = g.daysLeft - 1
    const progress = Math.round(clamp(((g.totalDays - daysLeft) / g.totalDays) * 100))
    if (daysLeft <= 0) {
      grains.push({ ...g, daysLeft: 0, progress: 100, ready: true })
      log = [{ day, text: `Grain jar of ${g.name} is fully colonized. Spawn it to a tub.` }, ...log]
    } else {
      grains.push({ ...g, daysLeft, progress })
    }
  }

  // tubs
  const tubs = []
  for (const t of state.tubs) {
    if (t.contaminated) {
      tubs.push(t)
      continue
    }
    if (t.stage === "colonizing") {
      if (Math.random() < t.risk / 8) {
        contamLost += 1
        tubs.push({ ...t, contaminated: true })
        log = [{ day, text: `${t.name}'s tub contaminated during colonization.` }, ...log]
        continue
      }
      const daysLeft = t.daysLeft - 1
      if (daysLeft <= 0) {
        const e = express(t.genome)
        const pinDays = Math.round(clamp(6 - e.vigor / 22, 3, 6))
        tubs.push({ ...t, stage: "pinning", daysLeft: pinDays, flush: t.flush + 1 })
        log = [{ day, text: `${t.name} has colonized and is pinning (flush ${t.flush + 1}).` }, ...log]
      } else {
        tubs.push({ ...t, daysLeft })
      }
    } else if (t.stage === "pinning") {
      const daysLeft = t.daysLeft - 1
      if (daysLeft <= 0) {
        tubs.push({ ...t, stage: "fruiting", daysLeft: 3 })
        log = [{ day, text: `${t.name} pins are bulking up into a canopy.` }, ...log]
      } else {
        tubs.push({ ...t, daysLeft })
      }
    } else if (t.stage === "fruiting") {
      const daysLeft = t.daysLeft - 1
      if (daysLeft <= 0) {
        tubs.push({ ...t, stage: "harvestable", daysLeft: 0 })
        log = [{ day, text: `${t.name} is ready to harvest!` }, ...log]
      } else {
        tubs.push({ ...t, daysLeft })
      }
    } else if (t.stage === "resting") {
      const daysLeft = t.daysLeft - 1
      if (daysLeft <= 0) {
        tubs.push({ ...t, stage: "pinning", daysLeft: 3, flush: t.flush + 1 })
        log = [{ day, text: `${t.name} is pinning again for flush ${t.flush + 1}.` }, ...log]
      } else {
        tubs.push({ ...t, daysLeft })
      }
    } else {
      tubs.push(t)
    }
  }

  log = log.slice(0, 60)
  return {
    ...state,
    day,
    plates,
    grains,
    tubs,
    stats: { ...state.stats, contamLost }
  }
}

// ---- persistence ------------------------------------------------------------

export function save(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state))
  } catch (e) {
    /* storage unavailable */
  }
}

export function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch (e) {
    return null
  }
}

export function wipe() {
  try {
    localStorage.removeItem(SAVE_KEY)
  } catch (e) {
    /* ignore */
  }
}

export { express, rating }
