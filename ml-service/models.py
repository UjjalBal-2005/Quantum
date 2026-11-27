from datetime import timedelta
import math
from typing import Dict, List, Tuple
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor

from features import (
    CLASSIFICATION_FEATURE_COLS,
    REGRESSION_FEATURE_COLS,
    build_classification_dataset,
    build_regression_features,
    compute_risk_feature_vector,
    prepare_calendar_lookup,
)
from schemas import (
    DailyPredictedPoint,
    HoldoutEvalResponse,
    HoldoutProductMetric,
    MlFeatureDriver,
    MlProductResult,
    TrainForecastRequest,
)


def _aggregate_drivers(importances: np.ndarray) -> List[MlFeatureDriver]:
    col_imp = dict(zip(REGRESSION_FEATURE_COLS, importances.tolist()))
    grouped = [
        ("weekday", "Weekday Pattern", sum(col_imp.get(f"dow_{i}", 0.0) for i in range(7)) + col_imp.get("is_weekend", 0.0)),
        ("recent_7d", "Recent 7d Trend", col_imp.get("lag_7d_mean", 0.0) + col_imp.get("lag_1d_sales", 0.0)),
        ("recent_level", "14d / 28d Baseline", col_imp.get("lag_14d_mean", 0.0) + col_imp.get("lag_28d_mean", 0.0) + col_imp.get("lag_14d_std", 0.0)),
        ("promotion", "Promotion", col_imp.get("is_promotion", 0.0)),
        ("holiday", "Holiday / Festival", col_imp.get("is_holiday_or_festival", 0.0)),
    ]
    total = sum(v for _, _, v in grouped) or 1.0
    drivers = [
        MlFeatureDriver(feature=feat, label=lbl, importance=round(val / total, 4))
        for feat, lbl, val in grouped
        if val > 0.001
    ]
    drivers.sort(key=lambda d: d.importance, reverse=True)
    return drivers[:4]


def _recursive_forecast(
    model: RandomForestRegressor,
    history_qtys: List[float],
    start_date: pd.Timestamp,
    days: int,
    calendar_lookup: Dict[str, dict],
) -> List[DailyPredictedPoint]:
    buf = list(history_qtys)
    points: List[DailyPredictedPoint] = []

    for step in range(days):
        dt = start_date + timedelta(days=step)
        date_str = dt.strftime("%Y-%m-%d")
        dow = dt.dayofweek

        cal = calendar_lookup.get(date_str, {})
        lag_1d = buf[-1] if len(buf) >= 1 else 0.0
        lag_7d = float(np.mean(buf[-7:])) if len(buf) >= 1 else 0.0
        lag_14d = float(np.mean(buf[-14:])) if len(buf) >= 1 else 0.0
        lag_28d = float(np.mean(buf[-28:])) if len(buf) >= 1 else 0.0
        lag_14d_std = float(np.std(buf[-14:])) if len(buf) >= 2 else 0.0

        row = {f"dow_{i}": 1.0 if dow == i else 0.0 for i in range(7)}
        row["is_weekend"] = cal.get("is_weekend", 1.0 if dow >= 5 else 0.0)
        row["is_promotion"] = cal.get("is_promotion", 0.0)
        row["is_holiday_or_festival"] = cal.get("is_holiday_or_festival", 0.0)
        row["lag_1d_sales"] = lag_1d
        row["lag_7d_mean"] = lag_7d
        row["lag_14d_mean"] = lag_14d
        row["lag_28d_mean"] = lag_28d
        row["lag_14d_std"] = lag_14d_std

        X_step = pd.DataFrame([row], columns=REGRESSION_FEATURE_COLS)
        pred = float(max(0.0, model.predict(X_step)[0]))
        buf.append(pred)
        points.append(DailyPredictedPoint(date=date_str, predictedUnits=round(pred, 2)))

    return points


def _heuristic_risk_fallback(
    current_stock: float,
    reorder_level: float,
    lead_time_days: float,
    horizon_days: float,
    demand_14d: float,
    daily_mean: float,
) -> Tuple[str, float]:
    cover = current_stock / max(0.25, daily_mean)
    if current_stock <= reorder_level or cover <= lead_time_days:
        return "Urgent", 0.75
    if cover < horizon_days:
        return "Watch", 0.70
    if current_stock > 2.0 * demand_14d:
        return "Excess", 0.75
    return "Healthy", 0.75


def train_and_forecast_all(req: TrainForecastRequest) -> List[MlProductResult]:
    sales_df = pd.DataFrame([s.model_dump() for s in req.sales])
    inv_df = pd.DataFrame([i.model_dump() for i in req.inventory])
    cal_lookup = prepare_calendar_lookup([c.model_dump() for c in req.calendar])

    if inv_df.empty:
        return []

    max_date_str = sales_df["date"].max() if not sales_df.empty else "2026-11-26"
    start_forecast_dt = pd.to_datetime(max_date_str) + timedelta(days=1)
    eval_days = max(req.horizonDays, 14)

    # Train portfolio Risk Classifier
    X_clf, y_clf = build_classification_dataset(
        sales_df=sales_df,
        inventory_df=inv_df,
        horizon_days=req.horizonDays,
        default_lead_time=req.defaultLeadTimeDays,
    )
    clf_model: RandomForestClassifier | None = None
    if len(X_clf) >= 12 and y_clf.nunique() >= 2:
        clf_model = RandomForestClassifier(
            n_estimators=100,
            max_depth=6,
            class_weight="balanced",
            random_state=42,
        )
        clf_model.fit(X_clf, y_clf)

    results: List[MlProductResult] = []
    sales_by_pid = {pid: grp for pid, grp in sales_df.groupby("product_id")} if not sales_df.empty else {}

    for inv in req.inventory:
        pid = inv.product_id
        prod_sales = sales_by_pid.get(pid, pd.DataFrame())
        X_reg, y_reg, recent_hist = build_regression_features(prod_sales, cal_lookup)
        lead_time = float(inv.lead_time_days or req.defaultLeadTimeDays)

        if len(X_reg) < 21:
            # Sparse SKU guard: delegate forecasting to TypeScript statistical fallback
            daily_mean = float(np.mean(recent_hist)) if recent_hist else 1.0
            daily_std = float(np.std(recent_hist)) if len(recent_hist) >= 2 else 0.0
            d14_est = daily_mean * 14.0
            risk_cls, risk_conf = _heuristic_risk_fallback(
                inv.current_stock,
                inv.reorder_level,
                lead_time,
                float(req.horizonDays),
                d14_est,
                daily_mean,
            )
            results.append(
                MlProductResult(
                    productId=pid,
                    engineUsed="statistical_fallback",
                    dailyForecast=[],
                    horizonDemand=0.0,
                    demand14d=0.0,
                    mlRiskClass=risk_cls,  # type: ignore[arg-type]
                    mlRiskConfidence=round(risk_conf, 3),
                    trainingSamples=len(X_reg),
                    topDrivers=[],
                )
            )
            continue

        reg_model = RandomForestRegressor(
            n_estimators=100,
            max_depth=8,
            random_state=42,
        )
        reg_model.fit(X_reg, y_reg)

        all_points = _recursive_forecast(
            model=reg_model,
            history_qtys=recent_hist,
            start_date=start_forecast_dt,
            days=eval_days,
            calendar_lookup=cal_lookup,
        )
        horizon_points = all_points[: req.horizonDays]
        horizon_demand = float(sum(p.predictedUnits for p in horizon_points))
        demand_14d = float(sum(p.predictedUnits for p in all_points[:14]))

        recent_14 = recent_hist[-14:] if len(recent_hist) >= 14 else recent_hist
        daily_mean = float(np.mean(recent_14)) if recent_14 else 1.0
        daily_std = float(np.std(recent_14)) if len(recent_14) >= 2 else 0.0

        if clf_model is not None:
            feat_vec = compute_risk_feature_vector(
                current_stock=float(inv.current_stock),
                reorder_level=float(inv.reorder_level),
                lead_time_days=lead_time,
                horizon_days=float(req.horizonDays),
                demand_14d=demand_14d,
                daily_mean=daily_mean,
                daily_std=daily_std,
                shelf_life_days=float(inv.shelf_life_days) if inv.shelf_life_days else None,
            )
            X_cur = pd.DataFrame([feat_vec], columns=CLASSIFICATION_FEATURE_COLS)
            probs = clf_model.predict_proba(X_cur)[0]
            best_idx = int(np.argmax(probs))
            risk_cls = str(clf_model.classes_[best_idx])
            risk_conf = float(probs[best_idx])
        else:
            risk_cls, risk_conf = _heuristic_risk_fallback(
                inv.current_stock,
                inv.reorder_level,
                lead_time,
                float(req.horizonDays),
                demand_14d,
                daily_mean,
            )

        results.append(
            MlProductResult(
                productId=pid,
                engineUsed="python_sklearn",
                dailyForecast=horizon_points,
                horizonDemand=round(horizon_demand, 2),
                demand14d=round(demand_14d, 2),
                mlRiskClass=risk_cls,  # type: ignore[arg-type]
                mlRiskConfidence=round(risk_conf, 3),
                trainingSamples=len(X_reg),
                topDrivers=_aggregate_drivers(reg_model.feature_importances_),
            )
        )

    return results


def run_python_holdout_evaluation(req: TrainForecastRequest) -> HoldoutEvalResponse:
    holdout_days = 28
    sales_df = pd.DataFrame([s.model_dump() for s in req.sales])
    cal_lookup = prepare_calendar_lookup([c.model_dump() for c in req.calendar])

    if sales_df.empty or not req.inventory:
        return HoldoutEvalResponse(
            holdoutDays=holdout_days,
            startDate="",
            endDate="",
            portfolioMlMae=0.0,
            portfolioMlWmape=0.0,
            totalMlStockoutDays=0,
            totalMlEndingStock=0.0,
            productsEvaluated=0,
            perProduct=[],
            assumptions=[],
        )

    end_dt = pd.to_datetime(sales_df["date"].max())
    start_dt = end_dt - timedelta(days=holdout_days - 1)
    split_dt = start_dt - timedelta(days=1)

    start_str = start_dt.strftime("%Y-%m-%d")
    end_str = end_dt.strftime("%Y-%m-%d")
    split_str = split_dt.strftime("%Y-%m-%d")

    train_df = sales_df[sales_df["date"] <= split_str].copy()
    test_df = sales_df[(sales_df["date"] >= start_str) & (sales_df["date"] <= end_str)].copy()

    per_product: List[HoldoutProductMetric] = []
    sum_abs_err = 0.0
    sum_actual = 0.0
    total_obs = 0
    total_stockout_days = 0
    total_ending_stock = 0.0

    for inv in req.inventory:
        pid = inv.product_id
        p_test = test_df[test_df["product_id"] == pid]
        if p_test.empty:
            continue

        p_train = train_df[train_df["product_id"] == pid]
        X_train, y_train, hist_qtys = build_regression_features(p_train, cal_lookup)
        if len(X_train) < 21:
            continue

        reg_model = RandomForestRegressor(n_estimators=100, max_depth=8, random_state=42)
        reg_model.fit(X_train, y_train)

        preds = _recursive_forecast(
            model=reg_model,
            history_qtys=hist_qtys,
            start_date=start_dt,
            days=holdout_days,
            calendar_lookup=cal_lookup,
        )
        pred_map = {p.date: p.predictedUnits for p in preds}
        actual_map = p_test.groupby("date")["quantity_sold"].sum().to_dict()

        lead_time = int(inv.lead_time_days or req.defaultLeadTimeDays)
        recent_std = float(np.std(hist_qtys[-14:])) if len(hist_qtys) >= 5 else 0.0
        init_7d = sum(p.predictedUnits for p in preds[:7])
        init_buffer = math.ceil(1.28 * recent_std * math.sqrt(lead_time)) if recent_std > 0 else math.ceil(0.2 * init_7d)
        stock = float(max(inv.reorder_level, math.ceil(init_7d + init_buffer)))

        arrivals: Dict[int, float] = {}
        stockout_days = 0
        p_abs_err = 0.0
        p_actual_total = 0.0

        for k in range(holdout_days):
            d_str = (start_dt + timedelta(days=k)).strftime("%Y-%m-%d")
            actual = float(actual_map.get(d_str, 0.0))
            pred = float(pred_map.get(d_str, 0.0))

            p_abs_err += abs(actual - pred)
            p_actual_total += actual

            stock += arrivals.get(k, 0.0)
            if stock < actual:
                stockout_days += 1
                stock = 0.0
            else:
                stock -= actual

            pending = sum(qty for arr_k, qty in arrivals.items() if arr_k > k)
            rem_7d = sum(preds[j].predictedUnits for j in range(k, min(holdout_days, k + 7)))
            target = math.ceil(rem_7d + init_buffer)
            if stock + pending < target and (stock <= inv.reorder_level or stock + pending < rem_7d):
                order_qty = max(0.0, target - (stock + pending))
                if order_qty > 0:
                    arrivals[k + lead_time] = arrivals.get(k + lead_time, 0.0) + order_qty

        mae = p_abs_err / holdout_days
        wmape = (p_abs_err / p_actual_total) * 100.0 if p_actual_total > 0 else 0.0

        sum_abs_err += p_abs_err
        sum_actual += p_actual_total
        total_obs += holdout_days
        total_stockout_days += stockout_days
        total_ending_stock += stock

        per_product.append(
            HoldoutProductMetric(
                productId=pid,
                product=inv.product,
                category=inv.category,
                actualTotal=round(p_actual_total),
                mlMae=round(mae, 2),
                mlWmape=round(wmape, 1),
                mlStockoutDays=stockout_days,
                mlEndingStock=round(stock),
            )
        )

    return HoldoutEvalResponse(
        holdoutDays=holdout_days,
        startDate=start_str,
        endDate=end_str,
        portfolioMlMae=round(sum_abs_err / total_obs, 2) if total_obs > 0 else 0.0,
        portfolioMlWmape=round((sum_abs_err / sum_actual) * 100.0, 1) if sum_actual > 0 else 0.0,
        totalMlStockoutDays=total_stockout_days,
        totalMlEndingStock=round(total_ending_stock),
        productsEvaluated=len(per_product),
        perProduct=per_product,
        assumptions=[
            f"Zero Data Leakage (Python ML): RandomForestRegressor trained strictly on rows <= {split_str} and evaluated on {start_str} to {end_str}.",
            "Sparse SKUs with < 21 training rows are excluded from ML holdout and handled by the browser statistical fallback.",
            "Simulated Inventory Replay: Starting stock initialized to 7d ML forecast + safety buffer; orders arrive after lead time L.",
        ],
    )
