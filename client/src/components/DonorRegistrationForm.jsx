import { useState } from 'react';
import { apiFetch } from '../api';
import DonorCard from './DonorCard';

export default function DonorRegistrationForm({ onSuccess }) {
  const [formData, setFormData] = useState({
    name: '',
    age: '',
    gender: 'MALE',
    contact: '',
    idProof: '',
    medicalHistory: '',
    consentGiven: true,
  });

  const [fieldErrors, setFieldErrors] = useState({});
  const [generalError, setGeneralError] = useState('');
  const [registrationResult, setRegistrationResult] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
    if (fieldErrors[name]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const validateForm = () => {
    const errors = {};
    if (!formData.name.trim()) {
      errors.name = 'Full name is required';
    }

    const ageNum = Number(formData.age);
    if (!formData.age && formData.age !== 0) {
      errors.age = 'Age is required';
    } else if (isNaN(ageNum) || ageNum < 18 || ageNum > 65) {
      errors.age = 'Age must be between 18 and 65';
    }

    const phoneRegex = /^\+?[0-9]{10,15}$/;
    if (!formData.contact.trim()) {
      errors.contact = 'Contact number is required';
    } else if (!phoneRegex.test(formData.contact.trim().replace(/[\s-]/g, ''))) {
      errors.contact = 'Invalid contact number';
    }

    if (!formData.idProof.trim()) {
      errors.idProof = 'ID proof is required';
    }

    return errors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setGeneralError('');
    const errors = validateForm();

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await apiFetch('/api/donors', {
        method: 'POST',
        body: JSON.stringify({
          name: formData.name.trim(),
          age: Number(formData.age),
          gender: formData.gender,
          contact: formData.contact.trim(),
          idProof: formData.idProof.trim(),
          medicalHistory: formData.medicalHistory.trim() || undefined,
          consentGiven: Boolean(formData.consentGiven),
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (response.status === 201) {
        setRegistrationResult(data);
        if (onSuccess) {
          onSuccess(data);
        }
      } else if (response.status === 409) {
        setGeneralError(data.message || 'A donor with this ID proof is already registered');
      } else if (response.status === 400 && data.errors) {
        setFieldErrors(data.errors);
      } else {
        setGeneralError(data.message || 'Registration failed. Please verify your details.');
      }
    } catch {
      setGeneralError('Network error: unable to reach the server. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setFormData({
      name: '',
      age: '',
      gender: 'MALE',
      contact: '',
      idProof: '',
      medicalHistory: '',
      consentGiven: true,
    });
    setRegistrationResult(null);
    setFieldErrors({});
    setGeneralError('');
  };

  // AC 5: Shown on the success screen / donor card (BBMS-F-001, F-003, F-004)
  if (registrationResult) {
    const donorName = formData.name || registrationResult.fullName || 'Registered Donor';
    return (
      <div className="registration-success-card" data-testid="success-screen">
        <div className="success-badge">✓</div>
        <h2>Registration Successful!</h2>
        <p className="subtitle">The donor has been permanently assigned their official system ID.</p>

        {/* Official BBMS Printable Donor Card */}
        <DonorCard
          donor={{
            donorCode: registrationResult.donorId,
            fullName: donorName,
            phone: formData.contact,
            maskedIdProof: formData.idProof,
            bloodGroup: registrationResult.bloodGroup || null,
          }}
          showActions={true}
        />

        <div className="alert-box alert-success no-print" style={{ margin: '1rem 0', fontSize: '0.85rem' }}>
          <strong>Online Portal Account Generated:</strong> Username: <strong>{registrationResult.donorId}</strong> · Default Password Syntax: <strong>DDMMYYYY</strong> (Date of Birth). Instruct donor to log into <strong>portal.pes.edu</strong> and change their password.
        </div>

        <div className="donor-card-meta no-print" style={{ display: 'flex', justifyContent: 'space-between', margin: '1rem 0' }}>
          <div>
            <span className="info-label">Initial Status: </span>
            <span className="status-pill">{registrationResult.status || 'PENDING'}</span>
          </div>
          <div className="text-right">
            <span className="info-label">Digital Consent: </span>
            <span className="consent-pill" data-testid="consent-status">
              {formData.consentGiven ? 'Recorded ✓' : 'Pending'}
            </span>
          </div>
        </div>

        <button type="button" className="btn-primary no-print" onClick={handleReset}>
          Register Another Donor
        </button>
      </div>
    );
  }

  return (
    <div className="registration-form-container">
      <h2>Donor Registration</h2>
      <p className="subtitle">Enter donor personal details and medical history</p>

      {generalError && (
        <div className="alert-box alert-error" role="alert" data-testid="general-error">
          {generalError}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div className="form-group">
          <label htmlFor="name">Full Name *</label>
          <input
            id="name"
            name="name"
            type="text"
            placeholder="e.g. Ramesh Patel"
            value={formData.name}
            onChange={handleChange}
            className={fieldErrors.name ? 'input-error' : ''}
          />
          {fieldErrors.name && (
            <span className="field-error" data-testid="error-name">{fieldErrors.name}</span>
          )}
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="age">Age (18–65) *</label>
            <input
              id="age"
              name="age"
              type="number"
              min="18"
              max="65"
              placeholder="e.g. 28"
              value={formData.age}
              onChange={handleChange}
              className={fieldErrors.age ? 'input-error' : ''}
            />
            {fieldErrors.age && (
              <span className="field-error" data-testid="error-age">{fieldErrors.age}</span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="gender">Gender *</label>
            <select
              id="gender"
              name="gender"
              value={formData.gender}
              onChange={handleChange}
            >
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="contact">Contact Number *</label>
          <input
            id="contact"
            name="contact"
            type="tel"
            placeholder="e.g. 9876543210"
            value={formData.contact}
            onChange={handleChange}
            className={fieldErrors.contact ? 'input-error' : ''}
          />
          {fieldErrors.contact && (
            <span className="field-error" data-testid="error-contact">{fieldErrors.contact}</span>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="idProof">ID Proof Number (Aadhaar / Passport / Voter ID) *</label>
          <input
            id="idProof"
            name="idProof"
            type="text"
            placeholder="e.g. AADHAAR-1234-5678"
            value={formData.idProof}
            onChange={handleChange}
            className={fieldErrors.idProof ? 'input-error' : ''}
          />
          {fieldErrors.idProof && (
            <span className="field-error" data-testid="error-idProof">{fieldErrors.idProof}</span>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="medicalHistory">Medical History / Past Conditions</label>
          <textarea
            id="medicalHistory"
            name="medicalHistory"
            rows="3"
            placeholder="Enter any previous illnesses, surgeries, or medications"
            value={formData.medicalHistory}
            onChange={handleChange}
          />
        </div>

        {/* BBMS-F-004: Digitally capture and record donor consent */}
        <div className="form-group-consent">
          <label className="checkbox-label" htmlFor="consentGiven">
            <input
              id="consentGiven"
              name="consentGiven"
              type="checkbox"
              checked={formData.consentGiven}
              onChange={handleChange}
            />
            <span>I digitally provide consent for blood donation and health screening</span>
          </label>
        </div>

        <button
          type="submit"
          className="btn-primary"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Registering...' : 'Register Donor'}
        </button>
      </form>
    </div>
  );
}
