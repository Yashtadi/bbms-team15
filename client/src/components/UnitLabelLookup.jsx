import { useState } from 'react';
import { flushSync } from 'react-dom';
import { apiFetch } from '../api';
import UnitLabel from './UnitLabel';
import ComponentSeparation from './ComponentSeparation';

// BBMS-F-012: scan or type a unit ID to open the unit's record and print its label.
// A USB barcode scanner acts like a keyboard: it types the code and presses Enter,
// which submits this form. Without a scanner, staff type the code (simulated scan).
// BBMS-F-031: the record also shows where the unit came from (parent, components, siblings),
// and a whole-blood unit can be separated into components here.

function UnitList({ units }) {
  return (
    <ul>
      {units.map((u) => (
        <li key={u.unitId}>
          {u.unitId} · {u.component} · {u.status}
        </li>
      ))}
    </ul>
  );
}

export default function UnitLabelLookup() {
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [generalError, setGeneralError] = useState('');
  const [unit, setUnit] = useState(null);
  const [lineage, setLineage] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [printTarget, setPrintTarget] = useState('unit');

  const handleChange = (e) => {
    setCode(e.target.value);
    if (fieldError) setFieldError('');
  };

  // Lineage is extra information: if it cannot be loaded, the record and label still show
  const loadLineage = async (unitId) => {
    try {
      const response = await apiFetch(`/api/inventory/units/${encodeURIComponent(unitId)}/lineage`);
      if (response.status !== 200) return;
      const data = await response.json();
      if (Array.isArray(data?.children) && Array.isArray(data?.siblings)) setLineage(data);
    } catch {
      // ignore
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFieldError('');
    setGeneralError('');
    setUnit(null);
    setLineage(null);

    const trimmed = code.trim();
    if (!trimmed) {
      setFieldError('Unit ID is required');
      return;
    }

    setIsLoading(true);
    try {
      const response = await apiFetch(`/api/donations/units/${encodeURIComponent(trimmed)}`);
      const data = await response.json().catch(() => ({}));

      if (response.status === 200) {
        setUnit(data);
        loadLineage(data.unitId);
      } else if (response.status === 400) {
        setFieldError(data.errors?.unitId || data.message || 'Invalid unit ID');
      } else if (response.status === 404) {
        setGeneralError(`No blood unit found for ${trimmed.toUpperCase()}`);
      } else {
        setGeneralError(data.message || 'An unexpected error occurred. Please try again.');
      }
    } catch {
      setGeneralError('Network error: unable to connect to the server.');
    } finally {
      setIsLoading(false);
    }
  };

  // The print CSS uses the container class to choose which labels go on paper
  const printLabels = (target) => {
    flushSync(() => setPrintTarget(target));
    window.print();
  };

  const handleSeparated = (result) => {
    setUnit((current) => ({ ...current, status: 'SEPARATED' }));
    setLineage((current) => (current ? { ...current, children: result.children } : current));
  };

  return (
    <div className={`registration-form-container unit-lookup-container print-${printTarget}`}>
      <h2>Blood Unit Label</h2>
      <p className="subtitle">Scan or enter a unit ID to open its record and print its barcode label</p>

      {generalError && (
        <div className="alert-box alert-error" role="alert" data-testid="general-error">
          {generalError}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div className="form-group">
          <label htmlFor="unitCode">Scan or enter unit ID *</label>
          <input
            id="unitCode"
            name="unitCode"
            type="text"
            placeholder="e.g. U-2026-000007"
            autoComplete="off"
            value={code}
            onChange={handleChange}
            className={fieldError ? 'input-error' : ''}
          />
          {fieldError && (
            <span className="field-error" data-testid="error-unitCode">{fieldError}</span>
          )}
        </div>

        <button type="submit" className="btn-primary" disabled={isLoading}>
          {isLoading ? 'Looking up...' : 'Find Unit'}
        </button>
      </form>

      {unit && (
        <dl className="unit-record" data-testid="unit-record">
          <div>
            <dt>Status</dt>
            <dd data-testid="record-status">{unit.status}</dd>
          </div>
          <div>
            <dt>Volume</dt>
            <dd>{unit.volumeMl} mL</dd>
          </div>
          <div>
            <dt>Donation</dt>
            <dd>#{unit.donationId}</dd>
          </div>
          {unit.parentUnitCode && (
            <div>
              <dt>Parent unit</dt>
              <dd data-testid="record-parent">{unit.parentUnitCode}</dd>
            </div>
          )}
        </dl>
      )}

      {lineage && (lineage.children.length > 0 || lineage.siblings.length > 0) && (
        <dl className="unit-lineage" data-testid="unit-lineage">
          {lineage.children.length > 0 && (
            <>
              <dt>Components made from this unit</dt>
              <dd><UnitList units={lineage.children} /></dd>
            </>
          )}
          {lineage.siblings.length > 0 && (
            <>
              <dt>Other components from {lineage.parent?.unitId}</dt>
              <dd><UnitList units={lineage.siblings} /></dd>
            </>
          )}
        </dl>
      )}

      {/* Printing shows only the label (see UnitLabel.css) */}
      {unit && <UnitLabel unit={unit} />}

      {unit && (
        <button type="button" className="btn-primary" onClick={() => printLabels('unit')}>
          Print Label
        </button>
      )}

      {unit && (
        <ComponentSeparation
          key={unit.unitId}
          unit={unit}
          onSeparated={handleSeparated}
          onPrint={() => printLabels('components')}
        />
      )}
    </div>
  );
}
