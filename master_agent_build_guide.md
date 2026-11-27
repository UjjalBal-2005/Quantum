# Master Agent Build Guide: Retail Smart Stock & Replenishment Advisor

This document is the unified implementation handoff for building the **Retail Smart Stock & Replenishment Advisor** in a **90-minute, 5-agent (or 5-person) sprint**. It synthesizes the architectural workflow, exact mathematical specifications, canonical CSV schemas, deterministic synthetic data requirements, and rigorous evaluation rules into a single source of truth.

---

## 1. Objective & Core Constraints

Build a **dependency-light, browser-only React + TypeScript application** that helps retail store staff decide:
1. **Which products to replenish** (prioritized queue with stockout alerts).
2. **How much to order** (demand forecast + safety buffer minus net available stock).
3. **Which products face stockout or excess-inventory risk** (including shelf-life context for perishables).
4. **Why each recommendation makes sense** (plain-language rationales + historical backtest comparison).

### Non-Negotiable Constraints
* **Zero Backend:** Run entirely client-side in a modern browser. No backend server, user login, database, or paid API keys. Do not upload imported CSVs to any external service.
* **Local Ready:** Must be easy to serve/open locally with clear startup steps in a short `README.md`.
* **Honest Estimates:** Clearly label all forecasts and risk flags as **transparent heuristics/estimates**, never as calibrated stockout probabilities. Explicitly disclose that historical sales quantities are a proxy for demand when stockout history is unavailable.
* **Default Controls:** Default forecast horizon of `7` days (with `14`-day and `30`-day choices). Default supplier lead time of `3` days when absent from data, adjustable by store staff.

---

## 2. 5-Track Parallel Agent Allocation & 90-Minute Timeline

| Track / Role | Primary Ownership | Key Deliverables |
| :--- | :--- | :--- |
| **Agent 1: Data, Schema & Synthetic Generator** | Canonical CSV schemas, alias-aware parser, validation, deterministic synthetic CSV files | `data/synthetic-*.csv`, `src/types/domain.ts`, `src/utils/csvParser.ts`, `src/data/syntheticLoader.ts` |
| **Agent 2: Forecasting Engine** | Comparable-weekday model, promo/holiday lift, bounded trend, sparse fallbacks | `src/engine/forecaster.ts` |
| **Agent 3: Replenishment, Risk & Explainer** | Safety stock, order math, Urgent/Watch/Healthy/Excess rules, shelf-life context, plain-language rationale | `src/engine/replenishment.ts` |
| **Agent 4: 28-Day Holdout & Replay Engine** | Zero-leakage 28-day backtest, Forecast vs. Average MAE, Smart vs. Static Reorder policy replay | `src/engine/replaySimulator.ts` |
| **Agent 5: Store Staff UI, Alerts & Integration** | Dashboard layout, CSV importer + demo reset, searchable table, stockout banner, inspector, replay view, `README.md` | `src/App.tsx`, `src/components/*`, `README.md` |

### Phased Sprint Schedule
* **00:00 – 00:15 (Contracts & Data):** Lock TypeScript interfaces in `src/types/domain.ts`. Agent 1 generates the 3 deterministic synthetic CSVs and alias-resilient parser. Agent 5 scaffolds the responsive UI shell and CSV dropzones.
* **00:15 – 00:50 (Core Engines):** Agents 2, 3, and 4 build the Forecasting, Replenishment/Explainer, and 28-Day Replay engines in parallel against the locked interfaces. Agent 5 builds the KPI strip, stockout alert banner, searchable prioritized table, and parameter controls.
* **00:50 – 01:15 (Integration & Explainability):** Wire live recalculation across horizon (`7`/`14`/`30` days), lead time, and CSV uploads. Build the Selected Product Inspector (chart, formula breakdown, shelf-life warning, rationale) and Historical Evaluation tab.
* **01:15 – 01:30 (QA, Edge Cases & Polish):** Run the completion checklist against both synthetic and malformed CSV inputs. Verify excluded-product reporting, one-click restore-demo, and `README.md` local run steps.

---

## 3. Data Inputs, Canonical Schema & Synthetic Dataset (`Agent 1`)

### 3.1 Deterministic Synthetic CSV Files
Generate and bundle three deterministic CSV files using dates relative to the generation date so the demo is reproducible:
* `data/synthetic-sales.csv`
* `data/synthetic-inventory.csv`
* `data/synthetic-calendar.csv`

**Dataset Requirements:**
* **Products:** At least `10`–`12` products spanning both **fresh/perishable** (with `shelf_life_days`, e.g., dairy, bakery, produce) and **longer-life** categories (e.g., pantry, beverages, household).
* **Time Span:** Approximately `120` days of daily sales history, plus calendar rows covering the `120`-day history and the **next `30` days**.
* **Guaranteed Edge Cases:** Every inventory product must have matching sales history, and the dataset must visibly trigger:
  1. Ordinary weekday vs. weekend demand surges.
  2. Active/historical promotions and holidays/festivals.
  3. Unusual single-day sales spikes (to test outlier dampening).
  4. Sparse sales history (to test fallback averages).
  5. **Urgent** stockout-risk SKUs (cover shorter than lead time or below reorder level).
  6. **Watch** risk SKUs (cover shorter than forecast horizon).
  7. **Excess** stock SKUs (stock exceeding twice the 14-day forecast, including a perishable SKU near shelf-life risk).

### 3.2 Canonical Columns & Alias Mapping
CSV import must validate required columns, normalize headers (case-insensitive, trimmed), and accept common aliases:

| File | Required Columns | Useful Optional Columns | Accepted Aliases |
| :--- | :--- | :--- | :--- |
| **Sales** | `date`, `product_id`, `product`, `category`, `quantity_sold` | `selling_price`, `promotion_name`, `is_promotion` | `sku` $\rightarrow$ `product_id`; `quantity`, `units_sold`, `qty` $\rightarrow$ `quantity_sold`; `promo_flag` $\rightarrow$ `is_promotion` |
| **Inventory** | `product_id`, `product`, `category`, `current_stock`, `reorder_level`, `quantity_received`, `stock_availability` | `incoming_stock`, `lead_time_days`, `shelf_life_days` | `on_hand`, `on_hand_qty` $\rightarrow$ `current_stock`; `incoming_qty` $\rightarrow$ `incoming_stock` |
| **Calendar** | `date` | `day_of_week`, `is_weekend`, `holiday`, `festival`, `promotion_event`, `event_name` | `event_type` $\rightarrow$ `holiday`/`festival`/`promotion_event` |

### 3.3 Data Hygiene & Error Reporting
* Validate dates, numeric fields, and `product_id` matching across files. Display actionable validation errors in the UI rather than failing silently.
* If any products are missing required inventory or sales linkage, either surface them in an explicit **"Excluded / Incomplete Products"** drawer with reasons, or default missing inventory safely with a `MISSING_INVENTORY_RECORD` warning badge.
* Treat `quantity_sold` as unconstrained demand unless `stock_availability` explicitly indicates a stockout (exclude known stockout days from downward baseline averages).

---

## 4. Forecasting Engine (`Agent 2`)

For each product $p$ and future target date $t$ over horizon $H \in \{7, 14, 30\}$:

1. **Comparable-Weekday Baseline ($B_{p,t}$):**
   * Use recent sales over the latest `8` weeks (`56` days), prioritizing observations matching the same day-of-week as $t$.
   * Exclude known stockout days and dampen extreme single-day outliers ($> 3\sigma$ unless tied to a known promo/holiday/festival) so one spike does not distort the baseline.
   * **Sparse History Fallbacks:**
     * If $< 2$ comparable weekdays exist $\rightarrow$ fall back to the product's recent daily average.
     * If $< 3$ total sales days exist for the product $\rightarrow$ fall back to the category daily average.
     * If category data is unavailable $\rightarrow$ fall back to the store-wide median daily velocity.

2. **Promotion, Holiday & Festival Lift ($L_{p,t}$):**
   * When sufficient historical matching examples exist, compute observed lift on past `is_promotion`, `holiday`, `festival`, or `promotion_event` days relative to non-event baseline.
   * Clamp multipliers to a safe range (e.g., $[0.8, 2.5]$) to prevent overfitting small sample sizes.
   * **Missing Future Calendar Rows:** If a future date $t$ has no calendar row, apply normal weekday/weekend behavior ($L_{p,t} = 1.0$) without inventing an event.

3. **Bounded Recent-Trend Adjustment ($T_p$):**
   * Compare the latest 14-day average velocity against the prior 42-day average velocity, bounded tightly (e.g., $[0.85, 1.15]$) so recent momentum is reflected without letting a single unusual day dominate.

4. **Daily & Horizon Forecast:**
   $$\hat{D}_{p,t} = B_{p,t} \times L_{p,t} \times T_p$$
   $$\hat{D}_{p, H} = \sum_{t=1}^{H} \hat{D}_{p,t}$$
   *(Always also compute $\hat{D}_{p, 14}$ in the background for excess-stock evaluation.)*

---

## 5. Replenishment, Risk & Plain-Language Explainer (`Agent 3`)

Let:
* $I_{\text{avail}} = \text{current\_stock}$
* $I_{\text{in}} = \text{incoming\_stock}$ (default `0` if absent)
* $I_{\text{net}} = I_{\text{avail}} + I_{\text{in}}$
* $R = \text{reorder\_level}$
* $L = \text{lead\_time\_days}$ (product-specific if provided, otherwise staff-configured global default of `3` days)
* $\sigma_p = \text{recent daily demand standard deviation}$

### 5.1 Safety Stock & Order Quantity
1. **Safety Buffer ($S_p$):**
   $$S_p = \lceil z \cdot \sigma_p \cdot \sqrt{L} \rceil$$
   *(Default $z = 1.28$ for ~90% service heuristic; if $\sigma_p$ cannot be estimated due to sparse history, use a documented fallback of $\lceil 0.20 \cdot \hat{D}_{p, H} \rceil$ and display the exact buffer rule in the UI.)*
2. **Suggested Order Quantity ($Q_p$):**
   $$Q_p = \max\left(0, \lceil \hat{D}_{p, H} + S_p - I_{\text{net}} \rceil\right)$$
3. **Projected Days of Cover ($C_p$):**
   * Compute by stepping $I_{\text{avail}}$ forward day-by-day against $\hat{D}_{p,t}$ until stock reaches $\le 0$ (also display net cover including $I_{\text{in}}$ in the detail panel).

### 5.2 Risk Classification & Queue Priority
1. **Replenishment Status:**
   * **Urgent (Red):** $I_{\text{avail}} \le R$ **OR** $C_p \le L$ (likely to stock out before a new order can arrive).
   * **Watch (Amber):** Not Urgent, but $C_p < H$ (stock will fall short within the selected forecast horizon).
   * **Healthy (Green):** Cover meets or exceeds horizon and stock is above reorder level.
2. **Excess Stock Flag (Blue/Purple):**
   * Flag **Excess** when $I_{\text{avail}} > 2 \times \hat{D}_{p, 14}$.
   * **Perishable Context:** When `shelf_life_days` is present and $C_p > \text{shelf\_life\_days}$, display an explicit **Perishable Spoilage Risk** callout.
   * **Consistency Rule:** Excess items must not receive a positive order quantity unless $\hat{D}_{p, H} + S_p > I_{\text{net}}$ genuinely holds.
3. **Queue Sorting Order:**
   * Sort by: **1. Urgent** $\rightarrow$ **2. Watch** $\rightarrow$ **3. Remaining items**.
   * Break ties by **largest suggested order quantity ($Q_p$)**, then shortest days of cover ($C_p$).

### 5.3 Plain-Language Rationale
Every product must generate a concise 2–3 sentence explanation citing its exact inputs and assumptions, e.g.:
> *"Urgent: 12 units on hand (0 incoming) provide 1.8 days of cover, which is shorter than the 3-day supplier lead time and at/below the reorder level of 15. Upcoming weekend and festival lift (+25%) drives 7-day forecast demand to 48 units. Recommend ordering 44 units (includes an 8-unit safety buffer)."*

---

## 6. 28-Day Historical Holdout & Policy Replay (`Agent 4`)

Evaluate both **forecast accuracy** and **inventory policy outcomes** using a strict time-based holdout of the **latest `28` days**.

* **Zero Data Leakage Rule:** When predicting any holdout date $t$, the forecasting engine may only access sales and calendar data strictly prior to $t$ (no future rows used to predict past dates).
* **Part A — Forecast Accuracy Comparison:**
  * Compare the **Smart Advisor Forecast** against a **Simple Recent-Average Baseline** (e.g., trailing 14-day average).
  * Report portfolio and per-product **MAE** (Mean Absolute Error) and **WMAPE** (Weighted Mean Absolute Percentage Error).
* **Part B — Inventory Policy Replay (Simulated):**
  * Replay two policies day-by-day over the 28-day holdout demand:
    1. **Smart Advisor Policy:** Orders according to the forecast + safety buffer rule, arriving after $L$ days.
    2. **Static Reorder-Level Baseline:** Orders a fixed replenishment quantity whenever simulated stock $\le R$, arriving after $L$ days.
  * Report **Simulated Stockout Days** and **Ending Leftover Inventory** for both policies.
* **Mandatory Simulation Disclosure:** Where historical daily inventory snapshots or receipts are unavailable, clearly badge all inventory replay outcomes as **Simulated**, explicitly state the starting-stock assumption (e.g., initialized to $\hat{D}_{p, 7} + S_p$ at day $t_0$) and lead-time receipt assumption, and **never present simulated results as proven financial savings**.

---

## 7. Store Staff UI / UX Specification (`Agent 5`)

1. **Top Control Bar:**
   * **Data Source Controls:** `[Upload CSVs (Sales / Inventory / Calendar)]` with inline validation feedback + one-click **`[Reset to Synthetic Demo]`** button.
   * **Global Planning Controls:** Horizon selector (`7d` / `14d` / `30d`), Global Default Lead Time input (`3` days), and optional Safety Buffer visibility.
2. **Urgent Stockout Alert Banner:**
   * High-visibility alert summarizing products likely to run out before supplier replenishment can arrive ($C_p \le L$), with quick-filter action.
3. **KPI Summary Strip:**
   * Upcoming Total Demand Units, Urgent Replenishment Count, Total Products Needing Action (Urgent + Watch), and Excess Stock Count.
4. **Main Workspace (Responsive Split View):**
   * **Searchable, Prioritized Product Table:** Search by product name/ID/category, filter by risk badge (`All`, `Urgent`, `Watch`, `Excess`, `Healthy`). Displays: `Product & Category`, `Stock / Incoming`, `Days Cover`, `Forecast`, `Risk Badges`, and `Suggested Order`.
   * **Selected Product Inspector:**
     * **Plain-Language Explanation Box** + **Methodology Disclaimer** (estimates, sales-as-demand-proxy).
     * **Transparent Math Card:** Shows Forecast Demand, Safety Buffer, Current Stock, Incoming Stock, Reorder Level, Lead Time, and Shelf Life (if perishable).
     * **Visual Chart:** Recent historical sales (marking promos/holidays/spikes) seamlessly connected to the upcoming $H$-day forecast.
   * **Excluded / Data Warnings Panel:** Explains any skipped rows or mismatched IDs.
5. **Historical Evaluation View (Tab or Section):**
   * Side-by-side comparison of Forecast Accuracy (Smart vs. Simple Average MAE) and Simulated Policy Replay (Smart vs. Static Reorder Stockout Days & Leftover Units), complete with a prominent **Simulated Assumptions** banner.

---

## 8. Completion & Verification Checklist

* [ ] **Synthetic Data:** `data/synthetic-sales.csv`, `data/synthetic-inventory.csv`, and `data/synthetic-calendar.csv` exist, are deterministic (~120 days history + 30 days future calendar, $\ge 10$ perishable & non-perishable SKUs), and load automatically.
* [ ] **Full Product Coverage:** All relevant products appear in the prioritized table, or any excluded products are explicitly listed with reasons.
* [ ] **Live Recalculation:** Selecting any product and changing Forecast Horizon (`7`/`14`/`30` days) or Lead Time immediately updates forecasts, cover, risk labels, order quantities, and explanations.
* [ ] **Visible Risk & Edge Cases:** Urgent stockout, Watch, Excess (with perishable shelf-life context), weekend surge, holiday/festival, promotion, sparse-history fallback, and outlier dampening are all visibly demonstrated and explainable.
* [ ] **Transparent Inputs:** Every recommendation exposes its underlying inputs, safety buffer rule, and sales-as-demand-proxy caveat.
* [ ] **28-Day Holdout & Replay:** Zero-leakage forecast accuracy (vs. recent-average baseline) and inventory policy replay (vs. static reorder level) run cleanly and clearly label simulated inventory assumptions.
* [ ] **CSV Import & Resilience:** Uploading valid CSVs (including aliased headers) works client-side; malformed CSVs show actionable errors; one-click restore to synthetic demo works reliably.
* [ ] **Documentation:** A concise `README.md` documents local startup instructions and methodology assumptions.

---

## Appendix: Comparison of Original Plans & Merged Enhancements

| Area | Original `AGENTS.md` | Uploaded `AGENT_BUILD_GUIDE.md` | Unified in `MASTER_AGENT_BUILD_GUIDE.md` |
| :--- | :--- | :--- | :--- |
| **Team Coordination** | 5-track parallel agent split + 90-min phased timeline | High-level single-document handoff | Kept the 5-agent parallel tracks & 90-min timeline |
| **Synthetic Data** | In-memory 8–12 SKU demo dataset | 3 deterministic CSV files (`data/synthetic-*.csv`), 120d history + 30d calendar, perishable + long-life SKUs | Adopted the 3 deterministic CSV files + perishable/long-life mix & 120d/30d span |
| **Schema & Aliases** | General column names + fuzzy mapping | Explicit canonical table (`quantity_sold`, `current_stock`, `shelf_life_days`, `festival`, etc.) | Adopted canonical schema + fuzzy alias mapping |
| **Forecasting Math** | Exact LaTeX formulas, outlier dampening, clamped lift, censored stockout handling | Bounded recent trend, safe handling of missing future calendar rows, `7`/`14`/`30`d horizons | Combined exact math + bounded trend + missing-date fallback + `7`/`14`/`30`d horizons |
| **Risk & Sorting** | `URGENT`, `AT_RISK`, `EXCESS`, `HEALTHY` | `Urgent`, `Watch`, `Healthy` + `Excess` with shelf-life context & strict tie-breaking sort | Adopted `Urgent`/`Watch`/`Healthy` + orthogonal `Excess` + perishable spoilage warning + tie-breakers |
| **Historical Eval** | 14-day holdout policy replay | 28-day zero-leakage holdout; Forecast vs. Simple Avg MAE + Policy Replay; no "proven savings" claim | Adopted 28-day zero-leakage holdout with both Forecast MAE and Simulated Policy Replay |