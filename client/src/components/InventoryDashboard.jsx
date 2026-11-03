import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import './InventoryDashboard.css';

// BBMS-F-030: real-time inventory dashboard.
// AC-BBMS-F-030 asks for stock changes to show within 5 seconds of any transaction.
// We poll (re-ask the server) every 3 s: worst case is 3 s + request time, safely under 5 s.
export const POLL_INTERVAL_MS = 3000;

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const COMPONENTS = [
  { value: 'WHOLE_BLOOD', label: 'Whole blood' },
  { value: 'PRBC', label: 'PRBC' },
  { value: 'FFP', label: 'FFP' },
  { value: 'PLATELETS', label: 'Platelets' },
  { value: 'CRYO', label: 'Cryo' },
];
const COMPONENT_LABELS = Object.fromEntries(COMPONENTS.map((c) => [c.value, c.label]));
const DAY_MS = 24 * 60 * 60 * 1000;

async function getJson(path) {
  let response;
  try {
    response = await apiFetch(path);
  } catch {
    throw new Error('Network error: unable to connect to the server.');
  }
  const data = await response.json().catch(() => ({}));
  if (response.status !== 200) {
    throw new Error(data.message || 'Unable to load inventory.');
  }
  return data;
}

async function loadInventory(filters) {
  // URLSearchParams encodes "A+" as "A%2B"; a raw "+" in a URL would be read as a space.
  const params = new URLSearchParams();
  if (filters.bloodGroup) params.set('bloodGroup', filters.bloodGroup);
  if (filters.component) params.set('component', filters.component);
  const query = params.toString();

  const [summary, list] = await Promise.all([
    getJson('/api/inventory/summary'),
    getJson(`/api/inventory${query ? `?${query}` : ''}`),
  ]);
  return { summary, units: list.units || [] };
}

function formatDate(value) {
  return new Date(value).toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function daysLeft(value) {
  const days = Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / DAY_MS));
  return days === 1 ? '1 day left' : `${days} days left`;
}

export default function InventoryDashboard({ pollIntervalMs = POLL_INTERVAL_MS }) {
  const [filters, setFilters] = useState({ bloodGroup: '', component: '' });
  const [inventory, setInventory] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState('');

  // Polling loop. setTimeout (not setInterval) waits for each request to finish before
  // scheduling the next, so slow responses never pile up. Changing a filter restarts the
  // loop, which also fetches straight away. The cleanup stops polling when the tab closes.
  useEffect(() => {
    let active = true;
    let timerId;

    async function poll() {
      try {
        const next = await loadInventory(filters);
        if (!active) return;
        setInventory(next);
        setLastUpdated(new Date());
        setError('');
      } catch (loadError) {
        if (!active) return;
        setError(loadError.message);
      }
      if (active) timerId = setTimeout(poll, pollIntervalMs);
    }

    poll();
    return () => {
      active = false;
      clearTimeout(timerId);
    };
  }, [filters, pollIntervalMs]);

  const updateFilter = (name) => (e) => {
    const { value } = e.target;
    setFilters((current) => ({ ...current, [name]: value }));
  };

  const counts = {};
  inventory?.summary.stock.forEach((entry) => {
    counts[`${entry.bloodGroup}|${entry.component}`] = entry.units;
  });
  const totals = inventory?.summary.totals;

  return (
    <section className="inventory-dashboard registration-form-container">
      <div className="inventory-heading">
        <div>
          <h2>Inventory Dashboard</h2>
          <p className="subtitle">
            BBMS-F-030 · Released blood units by blood group, component and expiry
          </p>
        </div>
        <p className="inventory-live">
          <span className="inventory-live-dot" aria-hidden="true" />
          Live · refreshes every {pollIntervalMs / 1000} s
          {lastUpdated && (
            <>
              {' · '}Updated <time dateTime={lastUpdated.toISOString()}>{lastUpdated.toLocaleTimeString()}</time>
            </>
          )}
        </p>
      </div>

      {error && !inventory && (
        <div className="alert-box alert-error" role="alert">{error}</div>
      )}
      {error && inventory && (
        <div className="alert-box alert-warning" role="alert">
          Could not refresh: {error} Showing the last loaded data. Retrying automatically.
        </div>
      )}
      {!inventory && !error && <p className="inventory-muted">Loading inventory...</p>}

      {inventory && (
        <>
          <div className="inventory-stats">
            <div className="inventory-stat">
              <span className="inventory-stat-label">Units available</span>
              <strong data-testid="total-units">{totals.units}</strong>
            </div>
            <div className="inventory-stat">
              <span className="inventory-stat-label">Total volume</span>
              <strong>{totals.volumeMl.toLocaleString()} ml</strong>
            </div>
            <div className="inventory-stat">
              <span className="inventory-stat-label">Soonest expiry</span>
              <strong>{totals.nextExpiry ? formatDate(totals.nextExpiry) : '—'}</strong>
            </div>
          </div>

          <div className="inventory-card">
            <h3 id="stock-grid-heading">Stock by blood group and component</h3>
            <div className="inventory-table-wrap">
              <table className="inventory-table inventory-grid" aria-labelledby="stock-grid-heading">
                <thead>
                  <tr>
                    <th scope="col">Blood group</th>
                    {COMPONENTS.map((c) => <th scope="col" key={c.value}>{c.label}</th>)}
                    <th scope="col">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {BLOOD_GROUPS.map((group) => {
                    const rowCounts = COMPONENTS.map((c) => counts[`${group}|${c.value}`] || 0);
                    const rowTotal = rowCounts.reduce((sum, n) => sum + n, 0);
                    return (
                      <tr key={group}>
                        <th scope="row">{group}</th>
                        {rowCounts.map((count, i) => (
                          <td key={COMPONENTS[i].value} className={count === 0 ? 'is-empty' : undefined}>
                            {count}
                          </td>
                        ))}
                        <td className={`inventory-row-total${rowTotal === 0 ? ' is-empty' : ''}`}>{rowTotal}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="inventory-card">
            <h3 id="unit-list-heading">Available units · soonest expiry first</h3>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="inventory-blood-group">Blood group</label>
                <select id="inventory-blood-group" value={filters.bloodGroup} onChange={updateFilter('bloodGroup')}>
                  <option value="">All blood groups</option>
                  {BLOOD_GROUPS.map((group) => <option key={group} value={group}>{group}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="inventory-component">Component</label>
                <select id="inventory-component" value={filters.component} onChange={updateFilter('component')}>
                  <option value="">All components</option>
                  {COMPONENTS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>

            {inventory.units.length === 0 ? (
              <p className="inventory-muted">No available units match these filters.</p>
            ) : (
              <div className="inventory-table-wrap">
                <table className="inventory-table" aria-labelledby="unit-list-heading">
                  <thead>
                    <tr>
                      <th scope="col">Unit ID</th>
                      <th scope="col">Blood group</th>
                      <th scope="col">Component</th>
                      <th scope="col">Volume</th>
                      <th scope="col">Expires</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.units.map((unit) => (
                      <tr key={unit.id}>
                        <td className="inventory-code">{unit.unit_code}</td>
                        <td>{unit.blood_group}</td>
                        <td>{COMPONENT_LABELS[unit.component] || unit.component}</td>
                        <td>{unit.volume_ml} ml</td>
                        <td>
                          {formatDate(unit.expires_at)}{' '}
                          <span className="inventory-muted">({daysLeft(unit.expires_at)})</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
