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

async function loadInventory(filters, thresholdDays = 3, lowStockThreshold = 3) {
  // URLSearchParams encodes "A+" as "A%2B"; a raw "+" in a URL would be read as a space.
  const params = new URLSearchParams();
  if (filters.bloodGroup) params.set('bloodGroup', filters.bloodGroup);
  if (filters.component) params.set('component', filters.component);
  const query = params.toString();

  const [summary, list, alertsData, lowStockData] = await Promise.all([
    getJson('/api/inventory/summary'),
    getJson(`/api/inventory${query ? `?${query}` : ''}`),
    getJson(`/api/inventory/alerts/expiry?thresholdDays=${thresholdDays}`).catch(() => ({ alertCount: 0, alerts: [] })),
    getJson(`/api/inventory/alerts/low-stock?threshold=${lowStockThreshold}`).catch(() => ({ alertCount: 0, alerts: [], stockByGroup: [] })),
  ]);

  const alerts = Array.isArray(alertsData?.alerts) ? alertsData.alerts : [];
  const alertCount = typeof alertsData?.alertCount === 'number' ? alertsData.alertCount : alerts.length;

  const lowStockAlerts = Array.isArray(lowStockData?.alerts) ? lowStockData.alerts : [];
  const lowStockCount = typeof lowStockData?.alertCount === 'number' ? lowStockData.alertCount : lowStockAlerts.length;

  return {
    summary,
    units: list.units || [],
    expiryAlerts: {
      thresholdDays: alertsData?.thresholdDays || thresholdDays,
      alertCount,
      alerts,
    },
    lowStockAlerts: {
      threshold: lowStockData?.threshold || lowStockThreshold,
      alertCount: lowStockCount,
      alerts: lowStockAlerts,
      stockByGroup: Array.isArray(lowStockData?.stockByGroup) ? lowStockData.stockByGroup : [],
    },
  };
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
  const [thresholdDays, setThresholdDays] = useState(3);
  const [lowStockThreshold, setLowStockThreshold] = useState(3);
  const [inventory, setInventory] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState('');

  // BBMS-F-033: FEFO allocation state
  const [fefoPatientGroup, setFefoPatientGroup] = useState('A+');
  const [fefoComponent, setFefoComponent] = useState('PRBC');
  const [fefoResults, setFefoResults] = useState(null);
  const [loadingFefo, setLoadingFefo] = useState(false);

  const handleCheckFefo = async () => {
    setLoadingFefo(true);
    try {
      const data = await getJson(
        `/api/inventory/fefo?patientBloodGroup=${encodeURIComponent(fefoPatientGroup)}&component=${encodeURIComponent(fefoComponent)}&unitsRequested=5`
      );
      setFefoResults(data);
    } catch {
      setFefoResults({ suggestedUnits: [] });
    } finally {
      setLoadingFefo(false);
    }
  };

  // Polling loop. setTimeout (not setInterval) waits for each request to finish before
  // scheduling the next, so slow responses never pile up. Changing a filter or threshold
  // restarts the loop, which also fetches straight away. The cleanup stops polling when the tab closes.
  useEffect(() => {
    let active = true;
    let timerId;

    async function poll() {
      try {
        const next = await loadInventory(filters, thresholdDays, lowStockThreshold);
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
  }, [filters, thresholdDays, lowStockThreshold, pollIntervalMs]);

  const updateFilter = (name) => (e) => {
    const { value } = e.target;
    setFilters((current) => ({ ...current, [name]: value }));
  };

  const handleThresholdChange = (e) => {
    setThresholdDays(Number(e.target.value));
  };

  const handleLowStockThresholdChange = (e) => {
    setLowStockThreshold(Number(e.target.value));
  };

  const counts = {};
  inventory?.summary.stock.forEach((entry) => {
    counts[`${entry.bloodGroup}|${entry.component}`] = entry.units;
  });
  const totals = inventory?.summary.totals;
  const expiryAlerts = inventory?.expiryAlerts || { thresholdDays, alertCount: 0, alerts: [] };
  const lowStockAlerts = inventory?.lowStockAlerts || { threshold: lowStockThreshold, alertCount: 0, alerts: [], stockByGroup: [] };

  return (
    <section className="inventory-dashboard registration-form-container">
      <div className="inventory-heading">
        <div>
          <h2>Inventory Dashboard</h2>
          <p className="subtitle">
            Released blood units by blood group, component and expiry
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
            <div className="inventory-stat">
              <span className="inventory-stat-label">Nearing expiry</span>
              <strong
                data-testid="stat-expiring-units"
                style={{ color: expiryAlerts.alertCount > 0 ? '#ef4444' : 'inherit' }}
              >
                {expiryAlerts.alertCount}
              </strong>
            </div>
            <div className="inventory-stat">
              <span className="inventory-stat-label">Low-stock groups</span>
              <strong
                data-testid="stat-low-stock-groups"
                style={{ color: lowStockAlerts.alertCount > 0 ? '#ef4444' : 'inherit' }}
              >
                {lowStockAlerts.alertCount}
              </strong>
            </div>
          </div>

          {/* BBMS-F-032 / TC-Inv-03: Expiry alerts visible on manager dashboard */}
          <div className="inventory-card expiry-alerts-card" data-testid="expiry-alerts-card">
            <div className="expiry-alerts-header">
              <div>
                <h3 id="expiry-alerts-heading">Units Nearing Expiry · Alerts</h3>
                <p className="subtitle">
                  Configurable threshold alerts for perishable blood inventory
                </p>
              </div>
              <div className="expiry-threshold-control">
                <label htmlFor="expiry-threshold-select">Alert threshold</label>
                <select
                  id="expiry-threshold-select"
                  data-testid="expiry-threshold-select"
                  value={thresholdDays}
                  onChange={handleThresholdChange}
                >
                  <option value={1}>Within 1 day (24 hours)</option>
                  <option value={3}>Within 3 days (Default)</option>
                  <option value={7}>Within 7 days</option>
                  <option value={14}>Within 14 days</option>
                  <option value={30}>Within 30 days</option>
                </select>
              </div>
            </div>

            {expiryAlerts.alertCount === 0 ? (
              <p className="inventory-muted" data-testid="no-expiry-alerts">
                No units nearing expiry within {thresholdDays} day{thresholdDays > 1 ? 's' : ''}. Safe shelf life.
              </p>
            ) : (
              <div className="inventory-table-wrap">
                <table className="inventory-table" aria-labelledby="expiry-alerts-heading" data-testid="expiry-alerts-table">
                  <thead>
                    <tr>
                      <th scope="col">Unit ID</th>
                      <th scope="col">Blood group</th>
                      <th scope="col">Component</th>
                      <th scope="col">Volume</th>
                      <th scope="col">Status</th>
                      <th scope="col">Expires</th>
                      <th scope="col">Time remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expiryAlerts.alerts.map((alert) => (
                      <tr key={alert.id} data-testid={`alert-row-${alert.unitCode}`}>
                        <td className="inventory-code">{alert.unitCode}</td>
                        <td><strong>{alert.bloodGroup || 'PENDING'}</strong></td>
                        <td>{COMPONENT_LABELS[alert.component] || alert.component}</td>
                        <td>{alert.volumeMl} ml</td>
                        <td>
                          <span className={`status-pill status-${(alert.status || '').toLowerCase()}`}>
                            {alert.status}
                          </span>
                        </td>
                        <td>{formatDate(alert.expiresAt)}</td>
                        <td>
                          <span className={`urgency-pill urgency-${(alert.urgency || '').toLowerCase()}`}>
                            {alert.hoursRemaining <= 24
                              ? `${alert.hoursRemaining}h left (${alert.urgency})`
                              : `${alert.daysRemaining} days left (${alert.urgency})`}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* BBMS-F-034 / TC-Inv-05: Low-stock alerts visible on manager dashboard */}
          <div className="inventory-card low-stock-alerts-card" data-testid="low-stock-alerts-card">
            <div className="expiry-alerts-header">
              <div>
                <h3 id="low-stock-alerts-heading">Low-Stock Blood Group Alerts</h3>
                <p className="subtitle">
                  Alert blood bank manager when blood group stock falls below safety threshold
                </p>
              </div>
              <div className="expiry-threshold-control">
                <label htmlFor="low-stock-threshold-select">Safety threshold</label>
                <select
                  id="low-stock-threshold-select"
                  data-testid="low-stock-threshold-select"
                  value={lowStockThreshold}
                  onChange={handleLowStockThresholdChange}
                >
                  <option value={1}>Below 1 unit</option>
                  <option value={2}>Below 2 units</option>
                  <option value={3}>Below 3 units (Default)</option>
                  <option value={5}>Below 5 units</option>
                  <option value={10}>Below 10 units</option>
                </select>
              </div>
            </div>

            {lowStockAlerts.alertCount === 0 ? (
              <p className="inventory-muted" data-testid="no-low-stock-alerts">
                All blood groups meet or exceed the safety threshold of {lowStockThreshold} unit{lowStockThreshold > 1 ? 's' : ''}. Safe inventory levels.
              </p>
            ) : (
              <div className="inventory-table-wrap">
                <table className="inventory-table" aria-labelledby="low-stock-alerts-heading" data-testid="low-stock-alerts-table">
                  <thead>
                    <tr>
                      <th scope="col">Blood group</th>
                      <th scope="col">Available units</th>
                      <th scope="col">Total volume</th>
                      <th scope="col">Safety threshold</th>
                      <th scope="col">Deficit</th>
                      <th scope="col">Urgency</th>
                      <th scope="col">Status message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lowStockAlerts.alerts.map((alert) => (
                      <tr key={alert.bloodGroup} data-testid={`low-stock-row-${alert.bloodGroup}`}>
                        <td><strong>{alert.bloodGroup}</strong></td>
                        <td>{alert.availableUnits} unit{alert.availableUnits === 1 ? '' : 's'}</td>
                        <td>{alert.volumeMl ? `${alert.volumeMl} ml` : '0 ml'}</td>
                        <td>{alert.threshold} units</td>
                        <td>
                          <span className="deficit-badge">
                            +{alert.deficit} needed
                          </span>
                        </td>
                        <td>
                          <span className={`urgency-pill ${alert.urgency === 'OUT_OF_STOCK' ? 'urgency-critical' : 'urgency-warning'}`}>
                            {alert.urgency === 'OUT_OF_STOCK' ? 'Out of stock' : 'Low stock'}
                          </span>
                        </td>
                        <td className="inventory-muted">{alert.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* BBMS-F-033 / TC-Inv-04: FEFO Unit Allocation Finder */}
          <div className="inventory-card fefo-finder-card" data-testid="fefo-finder-card">
            <h3 id="fefo-heading">FEFO Unit Allocation (First-Expiry-First-Out)</h3>
            <p className="subtitle">
              Suggests soonest-to-expire clinically compatible units for patient issuance
            </p>

            <div className="form-row align-end">
              <div className="form-group">
                <label htmlFor="fefo-patient-group">Patient blood group</label>
                <select
                  id="fefo-patient-group"
                  data-testid="fefo-patient-group-select"
                  value={fefoPatientGroup}
                  onChange={(e) => setFefoPatientGroup(e.target.value)}
                >
                  {BLOOD_GROUPS.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="fefo-component">Required component</label>
                <select
                  id="fefo-component"
                  data-testid="fefo-component-select"
                  value={fefoComponent}
                  onChange={(e) => setFefoComponent(e.target.value)}
                >
                  {COMPONENTS.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <button
                  type="button"
                  className="btn-fefo-find"
                  data-testid="btn-find-fefo"
                  onClick={handleCheckFefo}
                  disabled={loadingFefo}
                >
                  {loadingFefo ? 'Allocating...' : 'Suggest FEFO Units'}
                </button>
              </div>
            </div>

            {fefoResults && (
              <div className="fefo-results-container" data-testid="fefo-results-container">
                {fefoResults.suggestedUnits.length === 0 ? (
                  <p className="inventory-muted" data-testid="no-fefo-units-msg">
                    No compatible available units in stock for {fefoPatientGroup} ({fefoComponent}).
                  </p>
                ) : (
                  <div className="inventory-table-wrap">
                    <table className="inventory-table" aria-labelledby="fefo-heading" data-testid="fefo-allocation-table">
                      <thead>
                        <tr>
                          <th scope="col">Rank</th>
                          <th scope="col">Unit ID</th>
                          <th scope="col">Unit group</th>
                          <th scope="col">Component</th>
                          <th scope="col">Volume</th>
                          <th scope="col">Expires</th>
                          <th scope="col">FEFO Priority</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fefoResults.suggestedUnits.map((unit) => (
                          <tr key={unit.unitCode} data-testid={`fefo-row-${unit.unitCode}`}>
                            <td>
                              <span className={`rank-badge ${unit.rank === 1 ? 'rank-top' : ''}`}>
                                #{unit.rank} {unit.rank === 1 ? '(Soonest Expiry)' : ''}
                              </span>
                            </td>
                            <td className="inventory-code">{unit.unitCode}</td>
                            <td><strong>{unit.bloodGroup}</strong></td>
                            <td>{COMPONENT_LABELS[unit.component] || unit.component}</td>
                            <td>{unit.volumeMl} ml</td>
                            <td>{formatDate(unit.expiresAt)}</td>
                            <td>
                              <span className="urgency-pill urgency-warning">
                                {unit.daysRemaining <= 1 ? `${unit.hoursRemaining || 24}h left` : `${unit.daysRemaining} days left`}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
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
