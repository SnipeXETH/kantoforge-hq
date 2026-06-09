# 🍄 Mycelia — Mushroom Cultivation Lab

A genetics-driven mushroom cultivation game, built as a mobile-friendly React PWA.
Start with wild spores, isolate the strongest genetics on agar, colonize grain,
spawn monotubs, and push your line toward elite flushes — one generation at a time.

> This is a **game/simulation**. It models cultivation as a fun genetics loop; it is
> not a real-world grow guide.

## The core loop

1. **Shop** — buy a spore syringe to get a wild strain (cheap, unproven genetics).
2. **Agar Lab** — plate a culture. It throws a field of genetic *sectors*; isolate the
   strongest to lock its traits into the next generation. Or **cross** two strains to
   mix their traits and chase rare standouts.
3. **Grain Room** — inoculate grain jars. They colonize over days; weak resilience or
   dirty gear invites contamination.
4. **Fruiting Room** — spawn colonized grain into monotubs. Tune humidity and fresh-air
   exchange, then harvest each flush.
5. **Harvest & clone** — sell fruit for cash, and clone the best fruit to carry its
   genetics back to agar. Repeat to strengthen the line every cycle.

### Genetics model

Each strain has a genome of five traits — **Vigor, Yield, Resilience, Potency, Canopy** —
stored as allele pairs:

- **Crossing** inherits one allele per trait from each parent, plus mutation drift.
- **Isolating** a strong agar sector pulls the alleles toward that phenotype with a small
  heritable gain that shrinks near the cap (diminishing returns) — so traits climb but
  never trivially max out.
- Better gear (flow hood, microscope) tightens sector variance and sharpens selection.

The engine and its genetics live in [`src/game`](src/game); the UI screens are in
[`src/components`](src/components). Progress autosaves to `localStorage`.

## Run it

```bash
yarn install
yarn start            # dev server at http://localhost:3000
```

> This project uses an older `react-scripts@3`. On modern Node you may need:
> `NODE_OPTIONS=--openssl-legacy-provider yarn start`

### Build & test

```bash
NODE_OPTIONS=--openssl-legacy-provider yarn build:app    # production build
CI=true NODE_OPTIONS=--openssl-legacy-provider yarn test # run tests once
```

## Turning it into a mobile app

It's already a PWA (installable from the browser "Add to Home Screen"). To ship it as a
native iOS/Android app, wrap the build with [Capacitor](https://capacitorjs.com):

```bash
yarn build:app
npm i @capacitor/core @capacitor/cli
npx cap init Mycelia com.example.mycelia --web-dir=build
npx cap add ios && npx cap add android
npx cap open ios   # or android
```

## Roadmap ideas

- Persisted lab "renown" / progression and unlockable strains
- Market price swings, contracts and orders
- Pest/contamination events with cleanup mini-decisions
- A proper genome inspector and lineage tree
- Real artwork for dishes, jars and canopies
