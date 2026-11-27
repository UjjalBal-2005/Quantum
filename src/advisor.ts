import type { ForecastHorizon, ProductRecommendation } from './types/domain';
import { loadSyntheticDataset } from './data/syntheticLoader';
import { inferNextAsOfDate, prepareForecastContext } from './engine/forecaster';
import { evaluateProductReplenishment, sortRecommendations } from './engine/replenishment';

export function getRecommendations(
  horizon: ForecastHorizon,
  leadTime: number
): ProductRecommendation[] {
  const { dataset } = loadSyntheticDataset();
  const asOfDate = inferNextAsOfDate(dataset.sales);
  const context = prepareForecastContext(dataset.sales, dataset.calendar, asOfDate);

  const recommendations = dataset.inventory.map((inventory) =>
    evaluateProductReplenishment(inventory, horizon, leadTime, context)
  );

  return sortRecommendations(recommendations);
}
