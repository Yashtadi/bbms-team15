import { useState } from 'react';

export default function DonorRegistrationForm({ onSuccess }) {
  const [formData, setFormData] = useState({
    name: '',
    age: '',
    gender: 'MALE',
    contact: '',
    idProof: '',
    medicalHistory: '',
  });

  const [fieldErrors, setFieldErrors] = useState({});
  const [generalError, setGeneralError] = useState('');
  const [registrationResult, setRegistrationResult] = useState(null);
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

    // Client-side quick checks
    const errors = {};
    if (!formData.name.trim()) errors.name = 'Full name is required';
    if (!formData.age) {
      errors.age = 'Age is required';
    } else if (Number(formData.age) < 18 || Number(formData.age) > 65) {
      errors.age = 'Age must be between 18 and 65';
    }
    if (!formData.contact.trim()) {
      errors.contact = 'Contact number is required';
    } else if (!/^\+?[0-9]{10,15}$/.test(formData.contact.trim().replace(/[\s-]/g, ''))) {
      errors.contact = 'Invalid contact number';
    }
    if (!formData.idProof.trim()) errors.idProof = 'ID proof is required';

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/donors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name.trim(),
          age: Number(formData.age),
          gender: formData.gender,
          contact: formData.contact.trim(),
          idProof: formData.idProof.trim(),
          medicalHistory: formData.medicalHistory.trim() || undefined,
        }),
      });

      const data = await response.json();

      if (response.status === 201) {
        setRegistrationResult(data);
        if (onSuccess) onSuccess(data);
      } else if (response.status === 400) {
        setFieldErrors(data.errors || {});
        setGeneralError(data.message || 'Please correct the invalid fields.');
      } else if (response.status === 409) {
        setGeneralError(data.message || 'Registering twice with the same ID proof is not allowed.');
      } else {
        setGeneralError(data.message || 'An unexpected error occurred. Please try again.');
      }
    } catch (err) {
      setGeneralError('Network error: unable to connect to the server.');
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
    });
    setRegistrationResult(null);
    setFieldErrors({});
    setGeneralError('');
  };

  // AC 5: Success screen shows the new Donor ID
  if (registrationResult) {
    return (
      <div className="registration-success-card" data-testid="success-screen">
        <div className="success-badge">✓</div>
        <h2>Registration Successful!</h2>
        <p>The donor has been successfully registered in the system.</p>
        <div className="donor-id-display">
          <span>Donor ID</span>
          <strong data-testid="donor-id">{registrationResult.donorId}</strong>
        </div>
        <p className="status-indicator">
          Status: <span className="status-pill">{registrationResult.status}</span>
        </p>
        <button type="button" className="btn-primary" onClick={handleReset}>
          Register Another Donor
        </button>
      </div>
    );
  }

  return (
    <div className="registration-form-container">
      <h2>Donor Registration</h2>
      <p className="subtitle">BBMS-F-001 · Enter donor personal details and medical history</p>

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
              placeholder="e.g. 25"
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
              className={fieldErrors.gender ? 'input-error' : ''}
            >
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="OTHER">Other</option>
            </select>
            {fieldErrors.gender && (
              <span className="field-error" data-testid="error-gender">{fieldErrors.gender}</span>
            )}
          </div>
        </div>

        <div className="form-row">
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
            <label htmlFor="idProof">ID Proof Number *</label>
            <input
              id="idProof"
              name="idProof"
              type="text"
              placeholder="e.g. AADHAAR / Govt ID"
              value={formData.idProof}
              onChange={handleChange}
              className={fieldErrors.idProof ? 'input-error' : ''}
            />
            {fieldErrors.idProof && (
              <span className="field-error" data-testid="error-idProof">{fieldErrors.idProof}</span>
            )}
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="medicalHistory">Medical History / Past Conditions</label>
          <textarea
            id="medicalHistory"
            name="medicalHistory"
            rows={3}
            placeholder="Record any known allergies, chronic diseases, medications, or past surgeries (optional)"
            value={formData.medicalHistory}
            onChange={handleChange}
          />
        </div>

        <button type="submit" className="btn-primary" disabled={isSubmitting}>
          {isSubmitting ? 'Registering...' : 'Register Donor'}
        </button>
      </form>
    </div>
  );
}
