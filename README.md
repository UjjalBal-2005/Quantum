# Retail Smart Stock & Replenishment Advisor

A dependency-light, browser-only React + TypeScript application that helps store staff decide **which products to replenish**, **how much to order**, **which SKUs face stockout or excess/spoilage risk**, and **why each recommendation makes sense** — backed by a zero-leakage 28-day historical holdout and simulated policy replay.

## Local Startup

1. Ensure Node.js (v18+) and npm are installed.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the local dev server:
   ```bash
   npm run dev
   ```
4. Open the local URL shown in the terminal (typically `http://localhost:5173`).
5. For a production build:
   ```bash
   npm run build
   npm run preview
   ```

## Architecture & Track Summary

- **Data & Synthetic Generator (`data/synthetic-*.csv`, `src/utils/csvParser.ts`, `src/data/syntheticLoader.ts`):**
  - 12 deterministic SKUs (perishable & longer-life) with 120 days of sales history and 30 days of future calendar events.
  - Alias-aware client-side CSV parser (`sku`, `qty`, `on_hand`, `incoming_qty`, etc.) with inline validation and excluded-product reporting.
- **Forecasting Engine (`src/engine/forecaster.ts`):**
  - Comparable-weekday baseline over the latest 8 weeks (56 days), excluding known stockout days and dampening `> 3σ` non-event outliers.
  - Sparse history fallback hierarchy: comparable weekday → product daily average → category daily average → store-wide median.
  - Clamped promotion/holiday/festival lift (`[0.8, 2.5]`) and bounded 14d-vs-42d recent trend (`[0.85, 1.15]`).
- **Replenishment, Risk & Explainer (`src/engine/replenishment.ts`):**
  - Safety buffer `ceil(1.28 × σ × √L)` (or `ceil(20% × forecast)` sparse fallback) and suggested order `max(0, ceil(D̂ + S - (current + incoming)))`.
  - Risk classification (`Urgent`, `Watch`, `Healthy`), orthogonal `Excess` flag (`current_stock > 2 × 14d forecast`), and **Perishable Spoilage Risk** when projected cover exceeds `shelf_life_days`.
- **28-Day Holdout & Replay (`src/engine/replaySimulator.ts`):**
  - Strict zero-leakage 28-day holdout comparing Smart Advisor MAE/WMAPE against a trailing 14-day average baseline, plus a **Simulated** day-by-day inventory policy replay against a static reorder-level baseline.

## Methodology & Honest Estimates

- All forecasts and risk flags are **transparent heuristics**, not calibrated stockout probabilities.
- Historical `quantity_sold` is used as a proxy for demand when stockout history is unavailable.
- Historical inventory policy replay results are **Simulated** under documented starting-stock and lead-time receipt assumptions and are not presented as proven financial savings.
