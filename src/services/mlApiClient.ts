import {
  CalendarRecord,
  ForecastHorizon,
  InventoryRecord,
  MlHoldoutEvalResponse,
  SalesRecord,
  TrainForecastResponse,
} from '../types/domain';

const ML_BASE_URL = 'http://localhost:8000';

export interface MlRequestPayload {
  sales: SalesRecord[];
  inventory: InventoryRecord[];
  calendar: CalendarRecord[];
  horizonDays: ForecastHorizon;
  defaultLeadTimeDays: number;
}

export async function checkMlHealth(): Promise<boolean> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(`${ML_BASE_URL}/health`, { signal: controller.signal });
    if (!res.ok) return false;
    const data = (await res.json()) as { status?: string };
    return data.status === 'ok';
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function requestMlForecast(payload: MlRequestPayload): Promise<TrainForecastResponse> {
  const res = await fetch(`${ML_BASE_URL}/api/ml/train-and-forecast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Python ML forecast failed (${res.status})`);
  }
  return (await res.json()) as TrainForecastResponse;
}

export async function requestMlHoldout(payload: MlRequestPayload): Promise<MlHoldoutEvalResponse> {
  const res = await fetch(`${ML_BASE_URL}/api/ml/holdout-eval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Python ML holdout failed (${res.status})`);
  }
  return (await res.json()) as MlHoldoutEvalResponse;
}
