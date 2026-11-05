import { useState } from 'react';
import { apiFetch } from '../api';
import UnitLabel from './UnitLabel';
import DonorCard from './DonorCard';
import './CollectionDeskWizard.css';
import './DonorRegistrationForm.css';

const DEFAULT_VITALS = {
  donationType: 'WHOLE_BLOOD',
  volumeMl: '450',
  bpSystolic: '120',
  bpDiastolic: '80',
  pulseBpm: '72',
  hemoglobinGDl: '13.5',
};

const DEFAULT_NEW_DONOR = {
  fullName: '',
  dateOfBirth: '',
  gender: 'MALE',
  contact: '',
  email: '',
  idProof: '',
  medicalHistory: '',
  consentGiven: true,
};

export default function CollectionDeskWizard() {
  const [step, setStep] = useState(1); // 1: Check-in, 2: Session & Vitals, 3: Barcode Label
  const [checkinMode, setCheckinMode] = useState('new'); // 'new' | 'search'

  // Step 1: Donor State
  const [newDonor, setNewDonor] = useState(DEFAULT_NEW_DONOR);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeDonor, setActiveDonor] = useState(null);
  const [searchError, setSearchError] = useState('');
  const [donorFormErrors, setDonorFormErrors] = useState({});
  const [isSearching, setIsSearching] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [showDonorCardModal, setShowDonorCardModal] = useState(false);

  // Step 2: Vitals & Collection State
  const [vitals, setVitals] = useState(DEFAULT_VITALS);
  const [vitalsErrors, setVitalsErrors] = useState({});
  const [isSavingSession, setIsSavingSession] = useState(false);
  const [sessionError, setSessionError] = useState('');
  const [vitalsWarnings, setVitalsWarnings] = useState([]);

  // Step 3: Created Unit & Session Data
  const [createdSession, setCreatedSession] = useState(null);
  const [createdUnit, setCreatedUnit] = useState(null);

  // --- Handlers for Step 1: Donor Check-in ---
  const handleSearchDonor = async (e) => {
    e?.preventDefault();
    setSearchError('');
    setActiveDonor(null);
    const query = searchQuery.trim();
    if (!query) {
      setSearchError('Please enter a Donor ID (e.g. D-000001) or phone number');
      return;
    }

    setIsSearching(true);
    try {
      const res = await apiFetch(`/api/donors/${encodeURIComponent(query)}`);
      const data = await res.json().catch(() => ({}));
      if (res.status === 200) {
        setActiveDonor(data);
      } else if (res.status === 404) {
        setSearchError(`No donor found matching "${query}". You can register them as a new donor.`);
      } else {
        setSearchError(data.message || 'Error searching for donor.');
      }
    } catch {
      setSearchError('Network error connecting to the server.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleRegisterNewDonor = async (e) => {
    e.preventDefault();
    setDonorFormErrors({});
    setSearchError('');

    const errors = {};
    if (!newDonor.fullName.trim()) errors.fullName = 'Full legal name is required';
    if (!newDonor.dateOfBirth) errors.dateOfBirth = 'Date of birth is required';
    if (!newDonor.contact.trim()) errors.contact = 'Contact phone number is required';
    if (!newDonor.idProof.trim()) errors.idProof = 'Government ID proof is required';

    if (Object.keys(errors).length > 0) {
      setDonorFormErrors(errors);
      return;
    }

    setIsRegistering(true);
    try {
      const res = await apiFetch('/api/donors', {
        method: 'POST',
        body: JSON.stringify({
          name: newDonor.fullName.trim(),
          dateOfBirth: newDonor.dateOfBirth,
          gender: newDonor.gender,
          contact: newDonor.contact.trim(),
          email: newDonor.email.trim() || undefined,
          idProof: newDonor.idProof.trim(),
          medicalHistory: newDonor.medicalHistory.trim() || undefined,
          consentGiven: Boolean(newDonor.consentGiven),
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 201) {
        const registered = {
          donorId: data.donorId,
          donorCode: data.donorId,
          fullName: newDonor.fullName.trim(),
          gender: newDonor.gender,
          dateOfBirth: newDonor.dateOfBirth,
          phone: newDonor.contact.trim(),
          email: newDonor.email.trim() || undefined,
          idProof: newDonor.idProof.trim(),
          bloodGroup: 'Pending Test',
          eligibilityStatus: data.status || 'PENDING',
          consentGiven: Boolean(newDonor.consentGiven),
        };
        setActiveDonor(registered);
        setStep(2);
      } else if (res.status === 409) {
        setSearchError('A donor with this ID proof is already registered. Try searching for their profile.');
      } else if (res.status === 400 && data.errors) {
        setDonorFormErrors(data.errors);
      } else {
        setSearchError(data.message || 'Failed to register donor.');
      }
    } catch {
      setSearchError('Network error connecting to the server.');
    } finally {
      setIsRegistering(false);
    }
  };

  // --- Handlers for Step 2: Collection & Vitals ---
  const handleStartSessionAndVitals = async (e) => {
    e.preventDefault();
    setSessionError('');
    setVitalsErrors({});
    setVitalsWarnings([]);

    // Validate vitals
    const errs = {};
    if (!vitals.bpSystolic) errs.bpSystolic = 'Systolic BP is required';
    if (!vitals.bpDiastolic) errs.bpDiastolic = 'Diastolic BP is required';
    if (!vitals.pulseBpm) errs.pulseBpm = 'Pulse rate is required';
    if (!vitals.hemoglobinGDl) errs.hemoglobinGDl = 'Haemoglobin is required';

    if (Object.keys(errs).length > 0) {
      setVitalsErrors(errs);
      return;
    }

    const hbValue = Number(vitals.hemoglobinGDl);
    if (hbValue < 12.5) {
      setSessionError(`Haemoglobin must be at least 12.5 g/dL to proceed with blood collection (measured ${vitals.hemoglobinGDl} g/dL).`);
      return;
    }

    setIsSavingSession(true);
    try {
      const donorIdentifier = activeDonor.donorId || activeDonor.donorCode;

      // Ensure donor consent is recorded in backend (F-004)
      if (!activeDonor.consentGiven) {
        await apiFetch(`/api/donors/${encodeURIComponent(donorIdentifier)}/consent`, {
          method: 'POST',
          body: JSON.stringify({ consentGiven: true }),
        });
        setActiveDonor((prev) => ({ ...prev, consentGiven: true }));
      }

      // Evaluate clinical eligibility with pre-vitals if status is not ELIGIBLE in the database (F-002 -> F-010)
      if (activeDonor.eligibilityStatus !== 'ELIGIBLE') {
        const eligRes = await apiFetch(`/api/donors/${encodeURIComponent(donorIdentifier)}/eligibility`, {
          method: 'POST',
          body: JSON.stringify({
            hemoglobin: hbValue,
          }),
        });
        const eligData = await eligRes.json().catch(() => ({}));

        if (eligRes.status !== 200) {
          const reason = eligData.reason || eligData.message || 'Donor is not eligible to donate based on clinical vitals.';
          setSessionError(reason);
          setIsSavingSession(false);
          return;
        }

        setActiveDonor((prev) => ({ ...prev, eligibilityStatus: 'ELIGIBLE' }));
      }

      // 1. Create Donation Session (F-010)
      const sessionRes = await apiFetch('/api/donations', {
        method: 'POST',
        body: JSON.stringify({
          donorId: donorIdentifier,
          donationType: vitals.donationType,
          volumeMl: Number(vitals.volumeMl),
        }),
      });
      const sessionData = await sessionRes.json().catch(() => ({}));

      if (sessionRes.status !== 201) {
        setSessionError(sessionData.message || 'Failed to start donation session.');
        setIsSavingSession(false);
        return;
      }

      setCreatedSession(sessionData);

      // 2. Record Pre-Vitals for this session (F-011)
      const vitalsRes = await apiFetch(`/api/donations/${sessionData.donationId}/vitals/pre`, {
        method: 'PUT',
        body: JSON.stringify({
          bpSystolic: Number(vitals.bpSystolic),
          bpDiastolic: Number(vitals.bpDiastolic),
          pulseBpm: Number(vitals.pulseBpm),
          hemoglobinGDl: Number(vitals.hemoglobinGDl),
        }),
      });
      const vitalsData = await vitalsRes.json().catch(() => ({}));

      if (vitalsData.warnings?.length > 0) {
        setVitalsWarnings(vitalsData.warnings);
      }

      // 3. Fetch full unit info for barcode printing (F-012)
      const unitCode = sessionData.unit?.unitId;
      if (unitCode) {
        const unitRes = await apiFetch(`/api/donations/units/${encodeURIComponent(unitCode)}`);
        if (unitRes.status === 200) {
          const unitData = await unitRes.json();
          setCreatedUnit(unitData);
        } else {
          // Fallback constructed unit object
          setCreatedUnit({
            unitId: unitCode,
            barcode: { format: 'CODE128', value: unitCode },
            bloodGroup: 'PENDING',
            component: sessionData.unit.component,
            volumeMl: sessionData.unit.volumeMl,
            status: 'QUARANTINE',
            collectedAt: sessionData.collectedAt,
            expiresAt: sessionData.unit.expiresAt,
          });
        }
      }

      setStep(3);
    } catch {
      setSessionError('Network error connecting to the server.');
    } finally {
      setIsSavingSession(false);
    }
  };

  const handleReset = () => {
    setStep(1);
    setCheckinMode('new');
    setActiveDonor(null);
    setSearchQuery('');
    setSearchError('');
    setNewDonor(DEFAULT_NEW_DONOR);
    setVitals(DEFAULT_VITALS);
    setCreatedSession(null);
    setCreatedUnit(null);
    setVitalsWarnings([]);
    setShowDonorCardModal(false);
  };

  return (
    <div className="collection-wizard-container">
      {/* Stepper Navigation Progress Bar */}
      <div className="wizard-stepper">
        <div className={`step-item ${step >= 1 ? 'active' : ''} ${step > 1 ? 'completed' : ''}`}>
          <div className="step-circle">{step > 1 ? '✓' : '1'}</div>
          <span className="step-label">Donor Check-in</span>
        </div>
        <div className="step-connector" />
        <div className={`step-item ${step >= 2 ? 'active' : ''} ${step > 2 ? 'completed' : ''}`}>
          <div className="step-circle">{step > 2 ? '✓' : '2'}</div>
          <span className="step-label">Draw & Vitals</span>
        </div>
        <div className="step-connector" />
        <div className={`step-item ${step >= 3 ? 'active' : ''}`}>
          <div className="step-circle">3</div>
          <span className="step-label">Unit Barcode Sticker</span>
        </div>
      </div>

      {/* ================= STEP 1: DONOR CHECK-IN ================= */}
      {step === 1 && (
        <div className="wizard-panel">
          <div className="wizard-panel-header">
            <h2>Blood Collection Desk</h2>
            <p className="subtitle">Check in a walk-in donor or search existing records before collection</p>
          </div>

          {/* Toggle between Register New vs Lookup Existing */}
          <div className="tab-toggle-group">
            <button
              type="button"
              className={`toggle-btn ${checkinMode === 'new' ? 'active' : ''}`}
              onClick={() => {
                setCheckinMode('new');
                setActiveDonor(null);
                setSearchError('');
              }}
            >
              Register New Donor
            </button>
            <button
              type="button"
              className={`toggle-btn ${checkinMode === 'search' ? 'active' : ''}`}
              onClick={() => {
                setCheckinMode('search');
                setSearchError('');
              }}
            >
              Search Existing Donor
            </button>
          </div>

          {searchError && (
            <div className="alert-box alert-error mt-3" role="alert">
              {searchError}
            </div>
          )}

          {/* MODE A: REGISTER NEW DONOR */}
          {checkinMode === 'new' && (
            <form onSubmit={handleRegisterNewDonor} noValidate className="donor-registration-form">
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="fullName">Full Legal Name *</label>
                  <input
                    id="fullName"
                    type="text"
                    placeholder="e.g. Rahul Deshmukh"
                    value={newDonor.fullName}
                    onChange={(e) => setNewDonor({ ...newDonor, fullName: e.target.value })}
                    className={donorFormErrors.fullName ? 'input-error' : ''}
                    required
                  />
                  {donorFormErrors.fullName && <span className="field-error">{donorFormErrors.fullName}</span>}
                </div>

                <div className="form-group">
                  <label htmlFor="dateOfBirth">Date of Birth (18–65 yrs) *</label>
                  <input
                    id="dateOfBirth"
                    type="date"
                    value={newDonor.dateOfBirth}
                    onChange={(e) => setNewDonor({ ...newDonor, dateOfBirth: e.target.value })}
                    className={donorFormErrors.dateOfBirth ? 'input-error' : ''}
                    required
                  />
                  {donorFormErrors.dateOfBirth && <span className="field-error">{donorFormErrors.dateOfBirth}</span>}
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="gender">Gender *</label>
                  <select
                    id="gender"
                    value={newDonor.gender}
                    onChange={(e) => setNewDonor({ ...newDonor, gender: e.target.value })}
                  >
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="contact">Phone Number *</label>
                  <input
                    id="contact"
                    type="tel"
                    placeholder="e.g. 9876543210"
                    value={newDonor.contact}
                    onChange={(e) => setNewDonor({ ...newDonor, contact: e.target.value })}
                    className={donorFormErrors.contact ? 'input-error' : ''}
                    required
                  />
                  {donorFormErrors.contact && <span className="field-error">{donorFormErrors.contact}</span>}
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="idProof">Government ID Proof *</label>
                <input
                  id="idProof"
                  type="text"
                  placeholder="e.g. AADHAAR-1234-5678 or PAN-ABCDE1234F"
                  value={newDonor.idProof}
                  onChange={(e) => setNewDonor({ ...newDonor, idProof: e.target.value })}
                  className={donorFormErrors.idProof ? 'input-error' : ''}
                  required
                />
                {donorFormErrors.idProof && <span className="field-error">{donorFormErrors.idProof}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="email">Email Address (Optional - for online portal access)</label>
                <input
                  id="email"
                  type="email"
                  placeholder="e.g. donor@example.com (or leave empty to use Donor ID for login)"
                  value={newDonor.email}
                  onChange={(e) => setNewDonor({ ...newDonor, email: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label htmlFor="medicalHistory">Medical History / Past Conditions</label>
                <textarea
                  id="medicalHistory"
                  rows={3}
                  placeholder="Record any known allergies, chronic diseases, or past surgeries (optional)"
                  value={newDonor.medicalHistory}
                  onChange={(e) => setNewDonor({ ...newDonor, medicalHistory: e.target.value })}
                />
              </div>

              <div className="form-group-consent">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={newDonor.consentGiven}
                    onChange={(e) => setNewDonor({ ...newDonor, consentGiven: e.target.checked })}
                  />
                  <span>I confirm the donor has been informed of the blood donation process and has granted voluntary consent.</span>
                </label>
              </div>

              <div className="portal-tip-box" style={{
                background: 'rgba(59, 130, 246, 0.1)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                borderRadius: '8px',
                padding: '0.65rem 0.9rem',
                fontSize: '0.82rem',
                color: 'var(--text-primary, #ffffff)',
                margin: '0.75rem 0',
              }}>
                An online donor portal account is automatically generated for this donor. Default password syntax: <strong>DDMMYYYY</strong> (Donor's Date of Birth).
              </div>

              <button type="submit" className="btn-primary" disabled={isRegistering}>
                {isRegistering ? 'Registering Donor…' : 'Register & Proceed to Donation →'}
              </button>
            </form>
          )}

          {/* MODE B: SEARCH EXISTING DONOR */}
          {checkinMode === 'search' && (
            <div>
              <form onSubmit={handleSearchDonor} className="search-bar-form">
                <div className="search-input-wrapper">
                  <input
                    type="text"
                    placeholder="Enter Donor ID (e.g. D-000001) or Phone (e.g. 9000000001)"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="search-input"
                  />
                  <button type="submit" className="btn-primary search-btn" disabled={isSearching}>
                    {isSearching ? 'Searching…' : 'Lookup'}
                  </button>
                </div>
              </form>

              {/* Active Donor Found Card */}
              {activeDonor && (
                <div className="found-donor-card">
                  <div className="found-donor-header">
                    <div>
                      <span className="badge-donor-id">{activeDonor.donorCode || activeDonor.donorId}</span>
                      <h3>{activeDonor.fullName}</h3>
                      <p className="donor-meta-text">
                        {activeDonor.gender} · Phone: {activeDonor.phone} · Blood Group: <strong>{activeDonor.bloodGroup || 'Pending Test'}</strong>
                      </p>
                    </div>
                    <div className="status-badges">
                      <span className={`pill-status pill-${activeDonor.eligibilityStatus}`}>
                        {activeDonor.eligibilityStatus}
                      </span>
                      {activeDonor.consentGiven && <span className="pill-status pill-consent">Consent Verified</span>}
                    </div>
                  </div>

                  {activeDonor.eligibilityStatus === 'DEFERRED' ? (
                    <div className="alert-box alert-warning mt-3">
                      <strong>Donor is currently DEFERRED:</strong> {activeDonor.deferralReason || 'Not eligible to donate blood at this time.'}
                    </div>
                  ) : (
                    <div className="donor-action-row" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => setStep(2)}
                      >
                        Start Blood Collection Session for {activeDonor.fullName} →
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setShowDonorCardModal(true)}
                      >
                        Print Donor Card
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ================= STEP 2: COLLECTION & VITALS ================= */}
      {step === 2 && activeDonor && (
        <div className="wizard-panel">
          <div className="donor-context-pill">
            <div className="context-left">
              <span className="context-label">Active Donor:</span>
              <span className="context-name">{activeDonor.fullName}</span>
              <span className="context-id">({activeDonor.donorCode || activeDonor.donorId})</span>
            </div>
            <div className="context-right" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <span className="context-blood-group">{activeDonor.bloodGroup || 'PENDING'}</span>
              <button
                type="button"
                className="btn-secondary"
                style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}
                onClick={() => setShowDonorCardModal(true)}
              >
                View / Print Card
              </button>
            </div>
          </div>

          <div className="wizard-panel-header">
            <h2>Donation Session & Pre-Vitals</h2>
            <p className="subtitle">BBMS-F-010 · Record collection volume and clinical vitals</p>
          </div>

          <div className="alert-box alert-success mt-2" data-testid="portal-account-notice" style={{ fontSize: '0.85rem' }}>
            <strong>Online Portal Account Generated:</strong> Username: <strong>{activeDonor.donorCode || activeDonor.donorId}</strong> · Default Password Syntax: <strong>DDMMYYYY</strong> (Date of Birth). Instruct donor to log into <strong>bbms.pes.edu</strong> and change their password.
          </div>

          {sessionError && (
            <div className="alert-box alert-error mt-3" role="alert">
              {sessionError}
            </div>
          )}

          <form onSubmit={handleStartSessionAndVitals} noValidate className="vitals-form">
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="donationType">Donation Component Type *</label>
                <select
                  id="donationType"
                  value={vitals.donationType}
                  onChange={(e) => setVitals({ ...vitals, donationType: e.target.value })}
                >
                  <option value="WHOLE_BLOOD">Whole Blood</option>
                  <option value="APHERESIS">Apheresis (Platelets/Plasma)</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="volumeMl">Collection Volume (mL) *</label>
                <input
                  id="volumeMl"
                  type="number"
                  placeholder="350 or 450"
                  value={vitals.volumeMl}
                  onChange={(e) => setVitals({ ...vitals, volumeMl: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="vitals-section-title">
              <h3>Clinical Vitals Measurement (BBMS-F-011)</h3>
            </div>

            <div className="form-row vitals-4col">
              <div className="form-group">
                <label htmlFor="bpSystolic">Systolic BP (mmHg) *</label>
                <input
                  id="bpSystolic"
                  type="number"
                  placeholder="100–140"
                  value={vitals.bpSystolic}
                  onChange={(e) => setVitals({ ...vitals, bpSystolic: e.target.value })}
                  className={vitalsErrors.bpSystolic ? 'input-error' : ''}
                  required
                />
                {vitalsErrors.bpSystolic && <span className="field-error">{vitalsErrors.bpSystolic}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="bpDiastolic">Diastolic BP (mmHg) *</label>
                <input
                  id="bpDiastolic"
                  type="number"
                  placeholder="60–90"
                  value={vitals.bpDiastolic}
                  onChange={(e) => setVitals({ ...vitals, bpDiastolic: e.target.value })}
                  className={vitalsErrors.bpDiastolic ? 'input-error' : ''}
                  required
                />
                {vitalsErrors.bpDiastolic && <span className="field-error">{vitalsErrors.bpDiastolic}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="pulseBpm">Pulse (bpm) *</label>
                <input
                  id="pulseBpm"
                  type="number"
                  placeholder="60–100"
                  value={vitals.pulseBpm}
                  onChange={(e) => setVitals({ ...vitals, pulseBpm: e.target.value })}
                  className={vitalsErrors.pulseBpm ? 'input-error' : ''}
                  required
                />
                {vitalsErrors.pulseBpm && <span className="field-error">{vitalsErrors.pulseBpm}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="hemoglobinGDl">Haemoglobin (g/dL) *</label>
                <input
                  id="hemoglobinGDl"
                  type="number"
                  step="0.1"
                  placeholder="≥ 12.5"
                  value={vitals.hemoglobinGDl}
                  onChange={(e) => setVitals({ ...vitals, hemoglobinGDl: e.target.value })}
                  className={vitalsErrors.hemoglobinGDl ? 'input-error' : ''}
                  required
                />
                {vitalsErrors.hemoglobinGDl && <span className="field-error">{vitalsErrors.hemoglobinGDl}</span>}
              </div>
            </div>

            <div className="helper-notice">
              Safe baseline ranges: Systolic 100–140, Diastolic 60–90, Pulse 60–100 bpm, Hb ≥ 12.5 g/dL.
            </div>

            <div className="button-group mt-4">
              <button type="button" className="btn-secondary" onClick={() => setStep(1)}>
                ← Back to Donor
              </button>
              <button type="submit" className="btn-primary" disabled={isSavingSession}>
                {isSavingSession ? 'Creating Session & Allocating Unit…' : 'Complete Draw & Generate Barcode Label'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ================= STEP 3: UNIT BARCODE LABEL ================= */}
      {step === 3 && createdSession && (
        <div className="wizard-panel label-success-panel">
          <div className="success-banner">
            <span className="success-icon">✓</span>
            <div>
              <h3>Collection Complete & Blood Unit Allocated!</h3>
              <p>
                Allocated Unit <strong>{createdUnit?.unitId}</strong> for{' '}
                <strong>{activeDonor?.fullName}</strong> ({activeDonor?.donorCode || activeDonor?.donorId}) · Donation Session Record <strong>#{createdSession.donationId}</strong>.
              </p>
            </div>
          </div>

          {vitalsWarnings.length > 0 && (
            <div className="alert-box alert-warning mt-3">
              <strong>Clinical Range Warning:</strong>
              <ul>
                {vitalsWarnings.map((w, idx) => (
                  <li key={idx}>{w.message}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Quarantine Safety Lock Notification */}
          <div className="quarantine-safety-card">
            <div className="quarantine-badge">STATE: QUARANTINE</div>
            <p>
              Unit <strong>{createdUnit?.unitId}</strong> is securely locked in quarantine. It cannot be issued to
              patients until dual ABO/Rh blood grouping is verified and all 5 TTI tests (HIV, HBV, HCV, Syphilis,
              Malaria) pass in the lab.
            </p>
          </div>

          {/* Barcode Label Display */}
          {createdUnit && (
            <div className="label-print-box">
              <UnitLabel unit={createdUnit} />
            </div>
          )}

          {/* Action buttons */}
          <div className="label-actions-row">
            <button type="button" className="btn-primary" onClick={() => window.print()}>
              Print Unit Barcode Sticker
            </button>
            <button type="button" className="btn-secondary" onClick={() => setShowDonorCardModal(true)}>
              Print Donor Card
            </button>
            <button type="button" className="btn-secondary" onClick={handleReset}>
              Check-in Next Donor
            </button>
          </div>
        </div>
      )}

      {/* Official Donor Card Preview / Print Modal */}
      {showDonorCardModal && activeDonor && (
        <div className="modal-overlay" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1rem',
        }}>
          <div style={{
            background: 'var(--card-bg, #1e293b)',
            borderRadius: '16px',
            padding: '1.5rem',
            maxWidth: '520px',
            width: '100%',
            border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
            boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>Official Donor Card</h3>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowDonorCardModal(false)}
              >
                Close
              </button>
            </div>
            <DonorCard donor={activeDonor} showActions={true} />
          </div>
        </div>
      )}
    </div>
  );
}
