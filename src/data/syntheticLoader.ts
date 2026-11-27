import salesCsvRaw from '../../data/synthetic-sales.csv?raw';
import inventoryCsvRaw from '../../data/synthetic-inventory.csv?raw';
import calendarCsvRaw from '../../data/synthetic-calendar.csv?raw';
import { DatasetLoadResult } from '../types/domain';
import { parseCsvDatasets } from '../utils/csvParser';

export function loadSyntheticDataset(): DatasetLoadResult {
  return parseCsvDatasets(
    salesCsvRaw,
    inventoryCsvRaw,
    calendarCsvRaw,
    'Synthetic Demo Dataset (120d history + 30d calendar)'
  );
}
