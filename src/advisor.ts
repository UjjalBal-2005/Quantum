import type { ForecastHorizon, ProductRecommendation } from './types/domain';
import { MOCK_RECS } from './mock/mockRecommendations';

// THE ONE SEAM: today this returns fake demo data so the UI runs.
// In the wiring step we replace the body with real calls to the engines.
export function getRecommendations(
  _horizon: ForecastHorizon,
  _leadTime: number
): ProductRecommendation[] {
  return MOCK_RECS;
}
