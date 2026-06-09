// Genetics engine for the mushroom cultivation game.
//
// Each strain carries a "genome": for every trait we store a pair of alleles
// (numbers 0-100). The expressed value the player sees is the mean of the two
// alleles. Crossing two strains inherits one allele from each parent per trait
// (plus a little mutation drift). Isolating a strong sector on agar nudges the
// alleles toward the selected phenotype with diminishing returns near the cap,
// which is what makes genetics "strengthen" generation over generation.

export const TRAITS = [
  {
    key: "vigor",
    label: "Vigor",
    color: "#6ee7b7",
    short: "VIG",
    desc: "Colonization speed. High vigor races across grain and substrate, out-pacing contaminants."
  },
  {
    key: "yield",
    label: "Yield",
    color: "#fbbf24",
    short: "YLD",
    desc: "Biomass conversion. Drives the total wet weight of every flush."
  },
  {
    key: "resilience",
    label: "Resilience",
    color: "#60a5fa",
    short: "RES",
    desc: "Contamination resistance. Fends off trich, cobweb and bacterial blooms."
  },
  {
    key: "potency",
    label: "Potency",
    color: "#c084fc",
    short: "POT",
    desc: "Quality of the fruit. Multiplies the market value of your harvest."
  },
  {
    key: "canopy",
    label: "Canopy",
    color: "#f472b6",
    short: "CAN",
    desc: "Pin density. More pins per flush means a fuller canopy and more fruits."
  }
]

export const TRAIT_KEYS = TRAITS.map(t => t.key)

// ---- small helpers ----------------------------------------------------------

export function clamp(n, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n))
}

export function rand(min, max) {
  return min + Math.random() * (max - min)
}

export function randInt(min, max) {
  return Math.floor(rand(min, max + 1))
}

export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function uid() {
  return Math.random().toString(36).slice(2, 9)
}

// ---- genome -----------------------------------------------------------------

// A wild genome. `quality` (0-1) biases how good a freshly bought spore print is.
export function randomGenome(quality = 0.3) {
  const genome = {}
  for (const key of TRAIT_KEYS) {
    const center = 18 + quality * 45
    const a = clamp(center + rand(-14, 14))
    const b = clamp(center + rand(-14, 14))
    genome[key] = [Math.round(a), Math.round(b)]
  }
  return genome
}

// Expressed (visible) trait values: the mean of each allele pair.
export function express(genome) {
  const out = {}
  for (const key of TRAIT_KEYS) {
    const [a, b] = genome[key]
    out[key] = Math.round((a + b) / 2)
  }
  return out
}

// Overall power rating, 0-100, weighted toward the "grow" traits.
export function rating(genome) {
  const e = express(genome)
  const weights = { vigor: 1, yield: 1.4, resilience: 1.1, potency: 1.2, canopy: 1 }
  let sum = 0
  let wsum = 0
  for (const key of TRAIT_KEYS) {
    sum += e[key] * weights[key]
    wsum += weights[key]
  }
  return Math.round(sum / wsum)
}

// Cross two genomes: each child allele pair takes one allele from each parent,
// with a little mutation jitter. Mutation can occasionally produce a standout.
export function cross(a, b, mutationStrength = 1) {
  const child = {}
  for (const key of TRAIT_KEYS) {
    const fromA = pick(a[key])
    const fromB = pick(b[key])
    const jitterA = rand(-4, 4) * mutationStrength
    const jitterB = rand(-4, 4) * mutationStrength
    // rare beneficial (or harmful) macro-mutation
    const macroA = Math.random() < 0.04 ? rand(-12, 16) : 0
    const macroB = Math.random() < 0.04 ? rand(-12, 16) : 0
    child[key] = [
      Math.round(clamp(fromA + jitterA + macroA)),
      Math.round(clamp(fromB + jitterB + macroB))
    ]
  }
  return child
}

// Slightly mutate a single genome (used when cloning fresh tissue).
export function mutate(genome, strength = 1) {
  const out = {}
  for (const key of TRAIT_KEYS) {
    out[key] = genome[key].map(v => Math.round(clamp(v + rand(-3, 5) * strength)))
  }
  return out
}

// ---- agar sectors -----------------------------------------------------------

// Growing a culture on agar throws several phenotypic "sectors". Each sector
// expresses the genome with random variance; `purity` (from your gear/skill)
// tightens that variance so elite sectors are easier to spot and select.
export function plateSectors(genome, count, purity = 0.4) {
  const base = express(genome)
  const spread = 22 * (1 - purity * 0.7)
  const sectors = []
  for (let i = 0; i < count; i++) {
    const expr = {}
    for (const key of TRAIT_KEYS) {
      expr[key] = Math.round(clamp(base[key] + rand(-spread, spread)))
    }
    sectors.push({
      id: uid(),
      expr,
      rating: ratingFromExpr(expr),
      // is this a rhizomorphic (good) or tomentose (fluffy/weak) sector, cosmetic
      morph: ratingFromExpr(expr) >= base.vigor ? "rhizomorphic" : "tomentose"
    })
  }
  return sectors
}

function ratingFromExpr(expr) {
  const weights = { vigor: 1, yield: 1.4, resilience: 1.1, potency: 1.2, canopy: 1 }
  let sum = 0
  let wsum = 0
  for (const key of TRAIT_KEYS) {
    sum += expr[key] * weights[key]
    wsum += weights[key]
  }
  return Math.round(sum / wsum)
}

// Isolate a sector into a new genome. The alleles are pulled toward the
// selected phenotype (selection pressure) plus a small heritable gain that
// shrinks as the trait approaches the 100 cap (diminishing returns).
export function isolateFromSector(genome, sector, skill = 0.5) {
  const out = {}
  for (const key of TRAIT_KEYS) {
    const target = sector.expr[key]
    const newAlleles = genome[key].map(allele => {
      const pull = (target - allele) * (0.45 + skill * 0.25)
      const headroom = (100 - allele) / 100
      const gain = Math.max(0, target - allele) * 0.12 * headroom
      return Math.round(clamp(allele + pull + gain))
    })
    out[key] = newAlleles
  }
  return out
}

// ---- naming -----------------------------------------------------------------

const ADJ = [
  "Golden", "Crimson", "Velvet", "Midnight", "Albino", "Emerald", "Mystic",
  "Frosted", "Royal", "Thunder", "Amber", "Ghost", "Cobalt", "Solar", "Wild",
  "Ancient", "Ironcap", "Sugar", "Storm", "Lunar"
]
const NOUN = [
  "Teacher", "Cap", "Veil", "Crown", "Comet", "Halo", "Spore", "Cluster",
  "Flush", "Mycelia", "Oracle", "Cyclone", "Pearl", "Monarch", "Drift",
  "Phantom", "Ember", "Cascade", "Titan", "Bloom"
]

export function randomName() {
  return `${pick(ADJ)} ${pick(NOUN)}`
}

// Build a hybrid name from two parents, e.g. "Golden x Storm".
export function hybridName(a, b) {
  const left = (a || "").split(" ")[0] || pick(ADJ)
  const right = (b || "").split(" ").slice(-1)[0] || pick(NOUN)
  return `${left} ${right}`
}
