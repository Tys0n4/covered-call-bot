// src/pages/Settings.jsx
import { useEffect, useState } from 'react'
import { getSettings } from '../api/client'
import { ScanLine, Scale, Info } from 'lucide-react'

function SettingRow({ label, value, description }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      padding: '16px 0', borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 3 }}>{label}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{description}</div>
      </div>
      <div style={{
        fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, fontSize: 16,
        color: 'var(--accent-light)', background: 'var(--accent-dim)',
        border: '1px solid var(--border)', borderRadius: 8,
        padding: '6px 14px', minWidth: 80, textAlign: 'center',
      }}>{value}</div>
    </div>
  )
}

export default function Settings() {
  const [settings, setSettings] = useState(null)
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    getSettings()
      .then(r => setSettings(r.data))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="fade-up">
      <h1 className="page-title" style={{ marginBottom: 6 }}>Settings</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 32 }}>
        Current scanner configuration. To change values, edit <code style={{ background: 'var(--accent-dim)', padding: '2px 6px', borderRadius: 4, fontSize: 12 }}>app/config.py</code>.
      </p>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <div className="spinner" style={{ width: 36, height: 36, margin: '0 auto' }} />
        </div>
      ) : settings ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {/* Scanner settings */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 15, color: 'var(--accent-light)', marginBottom: 4 }}><ScanLine size={15} strokeWidth={1.75} /> Scanner</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>Options filtering parameters</div>
            <SettingRow label="Min DTE"              value={settings.min_dte}            description="Minimum days to expiry" />
            <SettingRow label="Max DTE"              value={settings.max_dte}            description="Maximum days to expiry" />
            <SettingRow label="Min Strike OTM"       value={`${(settings.min_strike_pct * 100).toFixed(0)}%`} description="Minimum % above current price" />
            <SettingRow label="Min Premium"          value={`$${settings.min_premium}`}  description="Minimum option premium per share" />
            <SettingRow label="Min Volume"           value={settings.min_volume}         description="Minimum daily volume" />
            <SettingRow label="Min Open Interest"    value={settings.min_open_interest}  description="Minimum open interest for liquidity" />
          </div>

          {/* Strategy settings */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 15, color: 'var(--accent-light)', marginBottom: 4 }}><Scale size={15} strokeWidth={1.75} /> Strategy</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>Scoring and allocation rules</div>
            <SettingRow label="Target Delta"         value={settings.target_delta}       description="Balanced pick target delta" />
            <SettingRow label="Income Weight"        value={`${(settings.income_weight * 100).toFixed(0)}%`} description="Contract allocation to income picks" />
            <SettingRow label="Buyback Budget"       value={`${(settings.buyback_budget_pct * 100).toFixed(0)}%`} description="Premium reserved for buyback" />
            <SettingRow label="Profit Capture Target" value={`${settings.profit_capture_target_pct}%`} description="% profit captured before buying back" />
          </div>
        </div>
      ) : (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--red)' }}>
          Could not load settings. Is the API running?
        </div>
      )}

      {/* Info box */}
      <div style={{
        marginTop: 24, background: 'var(--accent-dim)', border: '1px solid var(--border)',
        borderRadius: 12, padding: '16px 20px', fontSize: 13, color: 'var(--text-dim)',
        display: 'flex', alignItems: 'flex-start', gap: 12,
      }}>
        <Info size={18} strokeWidth={1.75} style={{ flexShrink: 0, color: 'var(--accent-light)' }} />
        <div>
          <strong style={{ color: 'var(--text)' }}>To change settings:</strong> Open{' '}
          <code style={{ background: 'rgba(106,228,255,0.16)', padding: '1px 6px', borderRadius: 4 }}>app/config.py</code>{' '}
          and update the <code style={{ background: 'rgba(106,228,255,0.16)', padding: '1px 6px', borderRadius: 4 }}>ScannerConfig</code> dataclass values.
          Restart the API server after saving changes.
        </div>
      </div>
    </div>
  )
}
