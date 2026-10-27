import { useState } from 'react';
import { apiFetch } from '../api';
import UnitLabel from './UnitLabel';

// BBMS-F-012: scan or type a unit ID to open the unit's record and print its label.
// A USB barcode scanner acts like a keyboard: it types the code and presses Enter,
// which submits this form. Without a scanner, staff type the code (simulated scan).

export default function UnitLabelLookup() {
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [generalError, setGeneralError] = useState('');
  const [unit, setUnit] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (e) => {
    setCode(e.target.value);
    if (fieldError) setFieldError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFieldError('');
    setGeneralError('');
    setUnit(null);

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

  return (
    <div className="registration-form-container unit-lookup-container">
      <h2>Blood Unit Label</h2>
      <p className="subtitle">BBMS-F-012 · Scan or enter a unit ID to open its record and print its barcode label</p>

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
        </dl>
      )}

      {/* Printing shows only the label (see UnitLabel.css) */}
      {unit && <UnitLabel unit={unit} />}

      {unit && (
        <button type="button" className="btn-primary" onClick={() => window.print()}>
          Print Label
        </button>
      )}
    </div>
  );
}
