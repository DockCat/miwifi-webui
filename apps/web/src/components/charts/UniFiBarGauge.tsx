import { formatSpeed } from './UniFiAreaChart.js';

export interface UniFiUtilizationGaugeProps {
  label: string;
  speed: number;
  maxSpeed?: number;
  variant?: 'down' | 'up';
}

export function UniFiUtilizationGauge({
  label,
  speed,
  maxSpeed = 100 * 1024 * 1024, // 100 MB/s default max scale
  variant = 'down'
}: UniFiUtilizationGaugeProps) {
  const percent = Math.min(100, Math.max(0, (speed / maxSpeed) * 100));

  return (
    <div className="unifi-gauge">
      <div className="gauge-header">
        <span className="gauge-label">{label}</span>
        <span className="gauge-val">{formatSpeed(speed)}</span>
      </div>
      <div className="gauge-track">
        <div
          className={`gauge-fill ${variant}`}
          style={{ width: `${Math.max(percent, speed > 0 ? 4 : 0)}%` }}
        />
        {/* Pointer indicator marker */}
        {speed > 0 && (
          <div
            className="gauge-pointer"
            style={{ left: `${percent}%` }}
            title={`${percent.toFixed(1)}%`}
          />
        )}
      </div>
    </div>
  );
}

export interface WiFiBandBarsProps {
  wifi2gCount: number;
  wifi5gCount: number;
  wiredCount: number;
  guestCount?: number;
}

export function WiFiBandBars({
  wifi2gCount,
  wifi5gCount,
  wiredCount,
  guestCount = 0
}: WiFiBandBarsProps) {
  const total = wifi2gCount + wifi5gCount + wiredCount + guestCount;

  return (
    <div className="wifi-bands-container">
      <div className="band-col">
        <div className="band-header">
          <span className="band-title">2.4 GHz</span>
          <span className="band-count">{wifi2gCount}</span>
        </div>
        <div className="band-bar-track">
          <div
            className="band-bar-fill band-2g"
            style={{
              height: `${total > 0 ? Math.max(8, (wifi2gCount / total) * 100) : 0}%`
            }}
          />
        </div>
        <span className="band-sub">Wi-Fi 2.4G</span>
      </div>

      <div className="band-col">
        <div className="band-header">
          <span className="band-title">5 GHz</span>
          <span className="band-count">{wifi5gCount}</span>
        </div>
        <div className="band-bar-track">
          <div
            className="band-bar-fill band-5g"
            style={{
              height: `${total > 0 ? Math.max(8, (wifi5gCount / total) * 100) : 0}%`
            }}
          />
        </div>
        <span className="band-sub">Wi-Fi 5G/6</span>
      </div>

      <div className="band-col">
        <div className="band-header">
          <span className="band-title">LAN</span>
          <span className="band-count">{wiredCount}</span>
        </div>
        <div className="band-bar-track">
          <div
            className="band-bar-fill band-wired"
            style={{
              height: `${total > 0 ? Math.max(8, (wiredCount / total) * 100) : 0}%`
            }}
          />
        </div>
        <span className="band-sub">Wired</span>
      </div>
    </div>
  );
}
