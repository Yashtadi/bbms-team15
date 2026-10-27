import { useState } from 'react';
import { apiFetch } from '../api';
import './DonationVitalsForm.css';

// BBMS-F-011: pre/post-donation vitals. The server owns the range rules; this form only
// checks that every field is filled in, then shows the server's errors and warnings.

const VITAL_FIELDS = [
  { name: 'bpSystolic', title: 'Systolic BP', unit: 'mmHg', placeholder: 'e.g. 120' },
  { name: 'bpDiastolic', title: 'Diastolic BP', unit: 'mmHg', placeholder: 'e.g. 80' },
  { name: 'pulseBpm', title: 'Pulse', unit: 'bpm', placeholder: 'e.g. 72' },
  { name: 'hemoglobinGDl', title: 'Haemoglobin', unit: 'g/dL', placeholder: 'e.g. 13.5', step: '0.1' },
];

const PHASE_LABELS = { PRE: 'Pre-donation', POST: 'Post-donation' };

const EMPTY_FORM = {
  donationId: '',
  phase: 'PRE',
  bpSystolic: '',
  bpDiastolic: '',
  pulseBpm: '',
  hemoglobinGDl: '',
};

export default function DonationVitalsForm() {
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [generalError, setGeneralError] = useState('');
  const [result, setResult] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (fieldErrors[name]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setGeneralError('');
    setFieldErrors({});
    setResult(null);

    const errors = {};
    if (!formData.donationId.trim()) errors.donationId = 'Donation ID is required';
    VITAL_FIELDS.forEach(({ name, title }) => {
      if (!formData[name].trim()) errors[name] = `${title} is required`;
    });
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    const phasePath = formData.phase === 'POST' ? 'post' : 'pre';
    const body = Object.fromEntries(VITAL_FIELDS.map(({ name }) => [name, formData[name].trim()]));

    setIsSubmitting(true);
    try {
      const response = await apiFetch(
        `/api/donations/${encodeURIComponent(formData.donationId.trim())}/vitals/${phasePath}`,
        { method: 'PUT', body: JSON.stringify(body) },
      );
      const data = await response.json().catch(() => ({}));

      if (response.status === 200) {
        setResult(data);
      } else if (response.status === 400) {
        setFieldErrors(data.errors || {});
        setGeneralError(data.message || 'Please correct the invalid fields.');
      } else if (response.status === 404) {
        setGeneralError(data.message || 'Donation not found');
      } else {
        setGeneralError(data.message || 'An unexpected error occurred. Please try again.');
      }
    } catch {
      setGeneralError('Network error: unable to connect to the server.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderInput = (name, label, props = {}) => (
    <div className="form-group" key={name}>
      <label htmlFor={name}>{label} *</label>
      <input
        id={name}
        name={name}
        type="number"
        value={formData[name]}
        onChange={handleChange}
        className={fieldErrors[name] ? 'input-error' : ''}
        {...props}
      />
      {fieldErrors[name] && (
        <span className="field-error" data-testid={`error-${name}`}>{fieldErrors[name]}</span>
      )}
    </div>
  );

  const renderVitalInput = ({ name, title, unit, placeholder, step }) =>
    renderInput(name, `${title} (${unit})`, { placeholder, step });

  return (
    <div className="registration-form-container vitals-form-container">
      <h2>Donation Vitals</h2>
      <p className="subtitle">BBMS-F-011 · Record BP, pulse and haemoglobin before and after donating</p>

      {generalError && (
        <div className="alert-box alert-error" role="alert" data-testid="general-error">
          {generalError}
        </div>
      )}

      {result && (
        <div data-testid="vitals-result">
          <div className="alert-box alert-success" role="status">
            {PHASE_LABELS[result.phase]} vitals saved for donation #{result.donationId}.
            {result.warnings.length === 0 && ' All readings are within the safe range.'}
          </div>

          {result.warnings.length > 0 && (
            <div className="alert-box alert-warning" role="alert" data-testid="vitals-warnings">
              <strong>⚠ Out of safe range: check the donor</strong>
              <ul>
                {result.warnings.map((warning) => (
                  <li key={warning.field}>{warning.message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div className="form-row">
          {renderInput('donationId', 'Donation ID', { placeholder: 'e.g. 21', min: 1 })}

          <div className="form-group">
            <label htmlFor="phase">Reading *</label>
            <select id="phase" name="phase" value={formData.phase} onChange={handleChange}>
              <option value="PRE">{PHASE_LABELS.PRE}</option>
              <option value="POST">{PHASE_LABELS.POST}</option>
            </select>
          </div>
        </div>

        <div className="form-row">
          {VITAL_FIELDS.slice(0, 2).map(renderVitalInput)}
        </div>
        <div className="form-row">
          {VITAL_FIELDS.slice(2).map(renderVitalInput)}
        </div>

        <button type="submit" className="btn-primary" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : 'Save Vitals'}
        </button>
      </form>
    </div>
  );
}
