import { useState } from 'react';
import { apiFetch } from '../api';
import UnitLabel from './UnitLabel';
import './ComponentSeparation.css';

// BBMS-F-031: separate a whole-blood unit into components and print a label for each one.
// Each component keeps the parent's donation, blood group and quarantine state, and its
// label shows the parent unit it came from.

const COMPONENT_OPTIONS = [
  { value: 'PRBC', label: 'PRBC (red cells)', defaultChecked: true },
  { value: 'FFP', label: 'FFP (plasma)', defaultChecked: true },
  { value: 'PLATELETS', label: 'Platelets', defaultChecked: true },
  { value: 'CRYO', label: 'Cryo', defaultChecked: false },
];

const SEPARABLE_STATUSES = ['QUARANTINE', 'AVAILABLE'];

function canSeparate(unit) {
  return Boolean(unit) && unit.component === 'WHOLE_BLOOD' && SEPARABLE_STATUSES.includes(unit.status);
}

export default function ComponentSeparation({ unit, onSeparated, onPrint }) {
  const [selected, setSelected] = useState(() =>
    COMPONENT_OPTIONS.filter((o) => o.defaultChecked).map((o) => o.value)
  );
  const [children, setChildren] = useState([]);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const toggle = (value) => {
    setSelected((current) =>
      current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (selected.length === 0) {
      setError('Choose at least one component.');
      return;
    }

    // Keep the order of the options, whatever order they were ticked in
    const components = COMPONENT_OPTIONS.map((o) => o.value).filter((v) => selected.includes(v));

    setIsSaving(true);
    try {
      const response = await apiFetch(`/api/inventory/units/${encodeURIComponent(unit.unitId)}/separate`, {
        method: 'POST',
        body: JSON.stringify({ components }),
      });
      const data = await response.json().catch(() => ({}));

      if (response.status === 201) {
        setChildren(data.children || []);
        onSeparated?.(data);
      } else if (response.status === 400 && data.errors) {
        setError(Object.values(data.errors).join(' '));
      } else {
        setError(data.message || 'The unit could not be separated. Please try again.');
      }
    } catch {
      setError('Network error: unable to connect to the server.');
    } finally {
      setIsSaving(false);
    }
  };

  if (children.length > 0) {
    return (
      <section className="component-separation" aria-label="Component labels">
        <h3>Components created from {unit.unitId}</h3>
        <p className="subtitle">Stick each label on its component bag.</p>
        <div className="component-labels" data-testid="component-labels">
          {children.map((child) => (
            <div className="component-label-item" key={child.unitId}>
              <UnitLabel unit={child} />
            </div>
          ))}
        </div>
        <button type="button" className="btn-primary" onClick={onPrint}>
          Print component labels
        </button>
      </section>
    );
  }

  if (!canSeparate(unit)) return null;

  return (
    <section className="component-separation" aria-label="Separate components">
      <h3>Separate components</h3>
      <p className="subtitle">
        Each component gets its own unit ID and label, and stays linked to {unit.unitId}. Expiry is
        counted from when the blood was collected.
      </p>

      {error && (
        <div className="alert-box alert-error" role="alert">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="component-separation-form">
        <fieldset>
          <legend>Components</legend>
          {COMPONENT_OPTIONS.map((option) => (
            <label key={option.value} className="component-option">
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={() => toggle(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </fieldset>
        <button type="submit" className="btn-primary" disabled={isSaving}>
          {isSaving ? 'Separating...' : 'Separate components'}
        </button>
      </form>
    </section>
  );
}
