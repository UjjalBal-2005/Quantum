from typing import Dict, List, Tuple
import numpy as np
import pandas as pd

REGRESSION_FEATURE_COLS = [
    "dow_0", "dow_1", "dow_2", "dow_3", "dow_4", "dow_5", "dow_6",
    "is_weekend",
    "is_promotion",
    "is_holiday_or_festival",
    "lag_1d_sales",
    "lag_7d_mean",
    "lag_14d_mean",
    "lag_28d_mean",
    "lag_14d_std",
]

CLASSIFICATION_FEATURE_COLS = [
    "cover_to_lead_ratio",
    "cover_to_horizon_ratio",
    "stock_to_reorder_ratio",
    "stock_to_14d_demand_ratio",
    "demand_cv",
    "perishable_pressure",
]


def prepare_calendar_lookup(calendar_records: List[dict]) -> Dict[str, dict]:
    lookup: Dict[str, dict] = {}
    for c in calendar_records:
        is_hol_fest = bool(c.get("holiday")) or bool(c.get("festival"))
        is_promo = bool(c.get("promotion_event"))
        dt = pd.to_datetime(c["date"], errors="coerce")
        is_wknd = bool(c.get("is_weekend")) if c.get("is_weekend") is not None else (
            bool(dt.dayofweek >= 5) if pd.notna(dt) else False
        )
        lookup[c["date"]] = {
            "is_weekend": 1.0 if is_wknd else 0.0,
            "is_promotion": 1.0 if is_promo else 0.0,
            "is_holiday_or_festival": 1.0 if is_hol_fest else 0.0,
        }
    return lookup


def build_regression_features(
    product_sales: pd.DataFrame,
    calendar_lookup: Dict[str, dict],
) -> Tuple[pd.DataFrame, pd.Series, List[float]]:
    """
    Build strictly leak-free regression features using .shift(1) rolling lags.
    Excludes known stockout rows from the training target y.
    Returns (X, y, recent_qty_history).
    """
    if product_sales.empty:
        return pd.DataFrame(columns=REGRESSION_FEATURE_COLS), pd.Series(dtype=float), []

    df = product_sales.copy()
    df["dt"] = pd.to_datetime(df["date"])
    df = df.sort_values("dt").reset_index(drop=True)

    # Exclude known stockout rows
    if "stock_availability" in df.columns:
        avail_lower = df["stock_availability"].fillna("").astype(str).str.lower().str.strip()
        df = df[~avail_lower.isin(["out_of_stock", "stockout"])].reset_index(drop=True)

    if df.empty:
        return pd.DataFrame(columns=REGRESSION_FEATURE_COLS), pd.Series(dtype=float), []

    # Aggregate if duplicate dates exist
    df = (
        df.groupby("date", as_index=False)
        .agg({"quantity_sold": "sum", "is_promotion": "max", "dt": "first"})
        .sort_values("dt")
        .reset_index(drop=True)
    )

    # Strictly shifted lag features (no data leakage)
    s = df["quantity_sold"].astype(float)
    df["lag_1d_sales"] = s.shift(1)
    df["lag_7d_mean"] = s.shift(1).rolling(7, min_periods=7).mean()
    df["lag_14d_mean"] = s.shift(1).rolling(14, min_periods=1).mean()
    df["lag_28d_mean"] = s.shift(1).rolling(28, min_periods=1).mean()
    df["lag_14d_std"] = s.shift(1).rolling(14, min_periods=2).std().fillna(0.0)

    # Calendar & weekday features
    dow = df["dt"].dt.dayofweek
    for d_idx in range(7):
        df[f"dow_{d_idx}"] = (dow == d_idx).astype(float)

    df["is_weekend"] = [
        calendar_lookup.get(dt_str, {}).get("is_weekend", 1.0 if d_val >= 5 else 0.0)
        for dt_str, d_val in zip(df["date"], dow)
    ]
    df["is_promotion"] = [
        1.0 if (bool(p) or calendar_lookup.get(dt_str, {}).get("is_promotion", 0.0) > 0.5) else 0.0
        for dt_str, p in zip(df["date"], df["is_promotion"].fillna(False))
    ]
    df["is_holiday_or_festival"] = [
        calendar_lookup.get(dt_str, {}).get("is_holiday_or_festival", 0.0)
        for dt_str in df["date"]
    ]

    recent_history = s.tolist()

    # Drop warm-up rows where lag_7d_mean is NaN
    valid = df.dropna(subset=["lag_7d_mean", "lag_1d_sales"]).reset_index(drop=True)
    if valid.empty:
        return pd.DataFrame(columns=REGRESSION_FEATURE_COLS), pd.Series(dtype=float), recent_history

    X = valid[REGRESSION_FEATURE_COLS].astype(float)
    y = valid["quantity_sold"].astype(float)
    return X, y, recent_history


def compute_risk_feature_vector(
    current_stock: float,
    reorder_level: float,
    lead_time_days: float,
    horizon_days: float,
    demand_14d: float,
    daily_mean: float,
    daily_std: float,
    shelf_life_days: float | None,
) -> List[float]:
    safe_daily = max(0.25, daily_mean)
    cover = current_stock / safe_daily
    cover_to_lead = cover / max(1.0, lead_time_days)
    cover_to_horizon = cover / max(1.0, horizon_days)
    stock_to_reorder = current_stock / max(1.0, reorder_level)
    stock_to_14d = current_stock / max(1.0, demand_14d)
    demand_cv = daily_std / max(1.0, daily_mean)
    perishable_pressure = (cover / shelf_life_days) if (shelf_life_days and shelf_life_days > 0) else 0.0

    return [
        float(cover_to_lead),
        float(cover_to_horizon),
        float(stock_to_reorder),
        float(stock_to_14d),
        float(demand_cv),
        float(perishable_pressure),
    ]


def build_classification_dataset(
    sales_df: pd.DataFrame,
    inventory_df: pd.DataFrame,
    horizon_days: int,
    default_lead_time: int,
) -> Tuple[pd.DataFrame, pd.Series]:
    """
    Constructs historical rolling-window inventory risk training examples
    labeled with Urgent / Watch / Healthy / Excess outcomes.
    """
    rows: List[List[float]] = []
    labels: List[str] = []

    if sales_df.empty or inventory_df.empty:
        return pd.DataFrame(columns=CLASSIFICATION_FEATURE_COLS), pd.Series(dtype=str)

    inv_map = inventory_df.set_index("product_id").to_dict("index")

    for pid, grp in sales_df.groupby("product_id"):
        inv = inv_map.get(pid)
        if not inv:
            continue

        grp_sorted = grp.sort_values("date").reset_index(drop=True)
        qtys = grp_sorted["quantity_sold"].astype(float).tolist()
        if len(qtys) < 21:
            continue

        lead_time = float(inv.get("lead_time_days") or default_lead_time)
        reorder = float(inv.get("reorder_level") or 10.0)
        shelf_life = inv.get("shelf_life_days")
        shelf_life = float(shelf_life) if pd.notna(shelf_life) and shelf_life else None

        # Sample rolling windows every 7 days
        for end_idx in range(14, len(qtys) - 7, 7):
            window = qtys[max(0, end_idx - 14):end_idx]
            mu = float(np.mean(window))
            sigma = float(np.std(window))
            d14 = mu * 14.0

            # Simulate varying stock levels across windows so all 4 classes are represented
            for stock_mult in [0.5, 1.2, 3.0, 8.0]:
                sim_stock = max(0.0, mu * lead_time * stock_mult)
                vec = compute_risk_feature_vector(
                    current_stock=sim_stock,
                    reorder_level=reorder,
                    lead_time_days=lead_time,
                    horizon_days=float(horizon_days),
                    demand_14d=d14,
                    daily_mean=mu,
                    daily_std=sigma,
                    shelf_life_days=shelf_life,
                )
                cover = sim_stock / max(0.25, mu)
                if sim_stock <= reorder or cover <= lead_time:
                    lbl = "Urgent"
                elif cover < horizon_days:
                    lbl = "Watch"
                elif sim_stock > 2.0 * d14:
                    lbl = "Excess"
                else:
                    lbl = "Healthy"
                rows.append(vec)
                labels.append(lbl)

    if not rows:
        return pd.DataFrame(columns=CLASSIFICATION_FEATURE_COLS), pd.Series(dtype=str)

    return pd.DataFrame(rows, columns=CLASSIFICATION_FEATURE_COLS), pd.Series(labels, dtype=str)
