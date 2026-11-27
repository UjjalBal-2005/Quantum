import React, { useRef, useState } from 'react';
import { ForecastEngineMode, ForecastHorizon } from '../types/domain';

interface TopControlBarProps {
  horizon: ForecastHorizon;
  onHorizonChange: (h: ForecastHorizon) => void;
  globalLeadTime: number;
  onGlobalLeadTimeChange: (days: number) => void;
  showSafetyBuffer: boolean;
  onToggleSafetyBuffer: () => void;
  engineMode: ForecastEngineMode;
  onEngineModeChange: (mode: ForecastEngineMode) => void;
  mlOnline: boolean;
  mlTrainingMs: number | null;
  mlLoading: boolean;
  onRefreshMlHealth: () => void;
  sourceLabel: string;
  onUploadCsvs: (salesText: string, invText: string, calText: string, label: string) => void;
  onResetDemo: () => void;
  activeTab: 'advisor' | 'holdout';
  onTabChange: (tab: 'advisor' | 'holdout') => void;
}

export const TopControlBar: React.FC<TopControlBarProps> = ({
  horizon,
  onHorizonChange,
  globalLeadTime,
  onGlobalLeadTimeChange,
  showSafetyBuffer,
  onToggleSafetyBuffer,
  engineMode,
  onEngineModeChange,
  mlOnline,
  mlTrainingMs,
  mlLoading,
  onRefreshMlHealth,
  sourceLabel,
  onUploadCsvs,
  onResetDemo,
  activeTab,
  onTabChange,
}) => {
  const [showUploadDrawer, setShowUploadDrawer] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const salesRef = useRef<HTMLInputElement>(null);
  const invRef = useRef<HTMLInputElement>(null);
  const calRef = useRef<HTMLInputElement>(null);

  const handleApplyUpload = async () => {
    const salesFile = salesRef.current?.files?.[0];
    const invFile = invRef.current?.files?.[0];
    const calFile = calRef.current?.files?.[0];

    if (!salesFile || !invFile) {
      setUploadError('Please select at least Sales CSV and Inventory CSV (Calendar CSV is optional).');
      return;
    }

    try {
      const [salesText, invText, calText] = await Promise.all([
        salesFile.text(),
        invFile.text(),
        calFile ? calFile.text() : Promise.resolve('date\n'),
      ]);
      setUploadError(null);
      onUploadCsvs(
        salesText,
        invText,
        calText,
        `Uploaded CSVs (${salesFile.name}, ${invFile.name})`
      );
      setShowUploadDrawer(false);
    } catch {
      setUploadError('Failed to read one or more CSV files.');
    }
  };

  return (
    <header className="top-bar">
      <div className="top-bar-row">
        <div className="brand-block">
          <div className="brand-title-wrap">
            <h1>Retail Smart Stock &amp; Replenishment Advisor</h1>
            <span className="pill-heuristic">Transparent Heuristic • Browser-Only</span>
          </div>
          <p className="source-subtitle">
            Active Dataset: <strong>{sourceLabel}</strong> • Historical sales used as demand proxy
          </p>
        </div>

        <div className="tab-switcher" role="tablist" aria-label="Workspace View">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'advisor'}
            className={`tab-btn ${activeTab === 'advisor' ? 'active' : ''}`}
            onClick={() => onTabChange('advisor')}
          >
            Replenishment Advisor
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'holdout'}
            className={`tab-btn ${activeTab === 'holdout' ? 'active' : ''}`}
            onClick={() => onTabChange('holdout')}
          >
            28-Day Holdout &amp; Replay
          </button>
        </div>
      </div>

      <div className="controls-row">
        <div className="control-group">
          <span className="control-label">Forecast Horizon:</span>
          <div className="segmented-control">
            {([7, 14, 30] as ForecastHorizon[]).map((h) => (
              <button
                key={h}
                type="button"
                className={`seg-btn ${horizon === h ? 'active' : ''}`}
                onClick={() => onHorizonChange(h)}
              >
                {h}d
              </button>
            ))}
          </div>
        </div>

        <div className="control-group">
          <label htmlFor="lead-time-input" className="control-label">
            Default Lead Time (days):
          </label>
          <input
            id="lead-time-input"
            type="number"
            min={1}
            max={30}
            value={globalLeadTime}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= 1 && v <= 30) onGlobalLeadTimeChange(Math.round(v));
            }}
            className="lead-input"
          />
        </div>

        <label className="checkbox-control">
          <input
            type="checkbox"
            checked={showSafetyBuffer}
            onChange={onToggleSafetyBuffer}
          />
          <span>Show Safety Buffer in Table</span>
        </label>

        <div className="control-group">
          <span className="control-label">Engine:</span>
          <div className="segmented-control">
            <button
              type="button"
              className={`seg-btn ${engineMode === 'statistical' ? 'active' : ''}`}
              onClick={() => onEngineModeChange('statistical')}
            >
              Browser Statistical
            </button>
            <button
              type="button"
              className={`seg-btn ${engineMode === 'python_ml' ? 'active' : ''}`}
              onClick={() => onEngineModeChange('python_ml')}
            >
              Python ML (scikit-learn)
            </button>
          </div>
          <button
            type="button"
            className={`ml-status-pill ${mlOnline ? 'online' : 'offline'}`}
            onClick={onRefreshMlHealth}
            title="Click to re-check Python ML service (http://localhost:8000)"
          >
            <i className="status-dot" />
            {mlLoading
              ? 'Training ML...'
              : mlOnline
                ? `Python ML Connected${mlTrainingMs !== null ? ` (${Math.round(mlTrainingMs)}ms)` : ''}`
                : 'Offline — Using Browser Fallback'}
          </button>
        </div>

        <div className="data-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowUploadDrawer((v) => !v)}
          >
            {showUploadDrawer ? 'Close CSV Upload' : 'Upload CSVs'}
          </button>
          <button type="button" className="btn-outline" onClick={onResetDemo}>
            Reset to Synthetic Demo
          </button>
        </div>
      </div>

      {showUploadDrawer && (
        <div className="upload-drawer">
          <div className="upload-grid">
            <div className="upload-field">
              <label htmlFor="sales-csv-file">Sales CSV (Required)</label>
              <input id="sales-csv-file" ref={salesRef} type="file" accept=".csv,text/csv" />
            </div>
            <div className="upload-field">
              <label htmlFor="inv-csv-file">Inventory CSV (Required)</label>
              <input id="inv-csv-file" ref={invRef} type="file" accept=".csv,text/csv" />
            </div>
            <div className="upload-field">
              <label htmlFor="cal-csv-file">Calendar CSV (Optional)</label>
              <input id="cal-csv-file" ref={calRef} type="file" accept=".csv,text/csv" />
            </div>
          </div>
          {uploadError && <div className="inline-error">{uploadError}</div>}
          <div className="upload-footer">
            <span className="upload-hint">
              Processed 100% locally in your browser. Supports canonical headers &amp; common aliases (sku, qty, on_hand, etc.).
            </span>
            <button type="button" className="btn-primary" onClick={handleApplyUpload}>
              Load Uploaded CSVs
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
