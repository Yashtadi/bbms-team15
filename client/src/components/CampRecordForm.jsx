import { useState } from 'react';
import { tempRef } from '../offlineQueue';
import './CampMode.css';

// BBMS-F-013: records a donation at an outreach camp. The record is saved in this browser
// first and synced to the server when there is a connection, so it works offline.
// Donor search needs the server, so the collector types the Donor ID from the donor card.

const DONOR_CODE_PATTERN = /^D-\d{6,}$/;
const CLOCK_SKEW_MS = 5 * 60 * 1000; // same allowance as the server
const MIN_HEMOGLOBIN = 12.5; // same rule as the collection desk (F-002)

// Value for <input type="datetime-local">, in the browser's local time
function localDateTimeValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function emptyDonation() {
  return {
    donorId: '',
    collectedAt: localDateTimeValue(new Date()),
    bpSystolic: '120',
    bpDiastolic: '80',
    pulseBpm: '72',
    hemoglobinGDl: '13.5',
  };
}

function validate(campLocation, form) {
  const errors = {};
  if (!campLocation.trim()) errors.campLocation = 'Camp location is required';
  if (!DONOR_CODE_PATTERN.test(form.donorId.trim().toUpperCase())) {
    errors.donorId = 'Donor ID must look like D-000001';
  }

  const collected = new Date(form.collectedAt);
  if (!form.collectedAt || Number.isNaN(collected.getTime())) {
    errors.collectedAt = 'Collection date and time is required';
  } else if (collected.getTime() > Date.now() + CLOCK_SKEW_MS) {
    errors.collectedAt = 'Collection date and time cannot be in the future';
  }

  if (!form.bpSystolic) errors.bpSystolic = 'Systolic BP is required';
  if (!form.bpDiastolic) errors.bpDiastolic = 'Diastolic BP is required';
  if (!form.pulseBpm) errors.pulseBpm = 'Pulse rate is required';
  if (!form.hemoglobinGDl) {
    errors.hemoglobinGDl = 'Haemoglobin is required';
  } else if (Number(form.hemoglobinGDl) < MIN_HEMOGLOBIN) {
    errors.hemoglobinGDl = `Haemoglobin must be at least ${MIN_HEMOGLOBIN} g/dL to collect blood`;
  }
  return errors;
}

function Field({ id, label, error, children }) {
  return (
    <div className="form-group">
      <label htmlFor={id}>{label}</label>
      {children}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

export default function CampRecordForm({ onSave }) {
  const [campLocation, setCampLocation] = useState('');
  const [donationType, setDonationType] = useState('WHOLE_BLOOD');
  const [volumeMl, setVolumeMl] = useState('450');
  const [form, setForm] = useState(emptyDonation);
  const [errors, setErrors] = useState({});
  const [saved, setSaved] = useState(null);
  const [saveError, setSaveError] = useState('');

  const setField = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  const inputClass = (field) => (errors[field] ? 'input-error' : '');

  const handleSubmit = (e) => {
    e.preventDefault();
    setSaved(null);
    setSaveError('');

    const found = validate(campLocation, form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const result = onSave({
      donorId: form.donorId.trim().toUpperCase(),
      campLocation: campLocation.trim(),
      collectedAt: new Date(form.collectedAt).toISOString(),
      donationType,
      volumeMl: Number(volumeMl),
      vitals: {
        bpSystolic: Number(form.bpSystolic),
        bpDiastolic: Number(form.bpDiastolic),
        pulseBpm: Number(form.pulseBpm),
        hemoglobinGDl: Number(form.hemoglobinGDl),
      },
    });

    if (!result?.ok) {
      setSaveError('This browser could not save the record. Write it on the paper log so it is not lost.');
      return;
    }

    setSaved({ ref: tempRef(result.record.clientRef), donorId: result.record.payload.donorId });
    // Camp location, type and volume stay the same for the next donor
    setForm(emptyDonation());
  };

  return (
    <div className="collection-wizard-container">
      <div className="wizard-panel">
        <div className="panel-header">
          <h2>Outreach Camp Recording</h2>
          <p className="subtitle">
            Works without a connection. Records are kept in this browser and synced when the connection returns.
          </p>
        </div>

        {saved && (
          <div className="alert-box alert-success" role="status" data-testid="camp-saved">
            Saved for {saved.donorId}. Write temporary reference <strong>{saved.ref}</strong> on the bag. Its
            barcode label can be printed after it syncs.
          </div>
        )}
        {saveError && (
          <div className="alert-box alert-error" role="alert">
            {saveError}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-row">
            <Field id="campLocation" label="Camp location *" error={errors.campLocation}>
              <input
                id="campLocation"
                type="text"
                maxLength={150}
                placeholder="e.g. PES University, Hall B"
                value={campLocation}
                onChange={(e) => setCampLocation(e.target.value)}
                className={inputClass('campLocation')}
              />
            </Field>
            <Field id="campDonorId" label="Donor ID *" error={errors.donorId}>
              <input
                id="campDonorId"
                type="text"
                placeholder="e.g. D-000001"
                autoComplete="off"
                value={form.donorId}
                onChange={setField('donorId')}
                className={inputClass('donorId')}
              />
            </Field>
          </div>

          <div className="form-row">
            <Field id="campCollectedAt" label="Collected at *" error={errors.collectedAt}>
              <input
                id="campCollectedAt"
                type="datetime-local"
                value={form.collectedAt}
                onChange={setField('collectedAt')}
                className={inputClass('collectedAt')}
              />
            </Field>
            <Field id="campDonationType" label="Collection type">
              <select id="campDonationType" value={donationType} onChange={(e) => setDonationType(e.target.value)}>
                <option value="WHOLE_BLOOD">Whole Blood</option>
                <option value="APHERESIS">Apheresis (Platelets)</option>
              </select>
            </Field>
            <Field id="campVolumeMl" label="Volume (mL)">
              <select id="campVolumeMl" value={volumeMl} onChange={(e) => setVolumeMl(e.target.value)}>
                <option value="450">450 mL</option>
                <option value="350">350 mL</option>
              </select>
            </Field>
          </div>

          <div className="vitals-grid">
            <Field id="campBpSystolic" label="Systolic BP (mmHg) *" error={errors.bpSystolic}>
              <input id="campBpSystolic" type="number" value={form.bpSystolic} onChange={setField('bpSystolic')} className={inputClass('bpSystolic')} />
            </Field>
            <Field id="campBpDiastolic" label="Diastolic BP (mmHg) *" error={errors.bpDiastolic}>
              <input id="campBpDiastolic" type="number" value={form.bpDiastolic} onChange={setField('bpDiastolic')} className={inputClass('bpDiastolic')} />
            </Field>
            <Field id="campPulseBpm" label="Pulse rate (bpm) *" error={errors.pulseBpm}>
              <input id="campPulseBpm" type="number" value={form.pulseBpm} onChange={setField('pulseBpm')} className={inputClass('pulseBpm')} />
            </Field>
            <Field id="campHemoglobin" label="Haemoglobin (g/dL) *" error={errors.hemoglobinGDl}>
              <input id="campHemoglobin" type="number" step="0.1" value={form.hemoglobinGDl} onChange={setField('hemoglobinGDl')} className={inputClass('hemoglobinGDl')} />
            </Field>
          </div>

          <div className="helper-notice">
            Consent and eligibility are checked again by the server when the record syncs. A record the server
            rejects stays in the list above with the reason.
          </div>

          <button type="submit" className="btn-primary mt-4">
            Save camp record
          </button>
        </form>
      </div>
    </div>
  );
}
