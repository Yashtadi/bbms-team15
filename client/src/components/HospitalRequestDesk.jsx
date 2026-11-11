import { useState, useEffect, useCallback } from 'react';
import { apiFetch, getSession } from '../api';
import './HospitalRequestDesk.css';

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const COMPONENTS = [
  { value: 'PRBC', label: 'Packed Red Blood Cells (PRBC)' },
  { value: 'WHOLE_BLOOD', label: 'Whole Blood' },
  { value: 'FFP', label: 'Fresh Frozen Plasma (FFP)' },
  { value: 'PLATELETS', label: 'Platelets' },
  { value: 'CRYO', label: 'Cryoprecipitate (CRYO)' },
];
const PRIORITIES = [
  { value: 'ROUTINE', label: 'Routine (Standard Care)', desc: 'Standard procedure, needed in >24 hours' },
  { value: 'URGENT', label: 'Urgent (Required Soon)', desc: 'Elective urgent surgery or acute need' },
  { value: 'EMERGENCY', label: 'Emergency (Immediate)', desc: 'Life-threatening trauma, immediate release' },
];

const INITIAL_FORM = {
  patientName: '',
  patientBloodGroup: 'O+',
  component: 'PRBC',
  unitsRequested: 1,
  priority: 'ROUTINE',
  requiredBy: '',
};

export default function HospitalRequestDesk() {
  const session = getSession();
  const hospitalUser = session?.user;
  const isHospitalRole = hospitalUser?.role === 'HOSPITAL';

  const [activeTab, setActiveTab] = useState('form'); // 'form' | 'list'
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [formGeneralError, setFormGeneralError] = useState(null);
  const [lastCreated, setLastCreated] = useState(null);

  const [requests, setRequests] = useState([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [listError, setListError] = useState(null);
  const [filterStatus, setFilterStatus] = useState('ALL');

  const fetchRequests = useCallback(async () => {
    setLoadingRequests(true);
    setListError(null);
    try {
      const res = await apiFetch('/api/blood-requests');
      if (!res.ok) {
        throw new Error('Failed to load blood requests');
      }
      const data = await res.json();
      setRequests(data.requests || []);
    } catch (err) {
      setListError(err.message || 'Error loading requests');
    } finally {
      setLoadingRequests(false);
    }
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const handleInputChange = (field) => (e) => {
    setFormData((prev) => ({ ...prev, [field]: e.target.value }));
    if (fieldErrors[field]) {
      setFieldErrors((prev) => ({ ...prev, [field]: null }));
    }
  };

  const handlePrioritySelect = (priorityVal) => {
    setFormData((prev) => ({ ...prev, priority: priorityVal }));
    if (fieldErrors.priority) {
      setFieldErrors((prev) => ({ ...prev, priority: null }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setFieldErrors({});
    setFormGeneralError(null);
    setLastCreated(null);

    // Client validation
    const errors = {};
    if (!formData.patientName.trim()) {
      errors.patientName = 'Patient legal name is required';
    }
    const units = Number(formData.unitsRequested);
    if (!formData.unitsRequested || Number.isNaN(units) || units < 1 || units > 20) {
      errors.unitsRequested = 'Units requested must be between 1 and 20';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setSubmitting(false);
      return;
    }

    try {
      const payload = {
        patientName: formData.patientName.trim(),
        patientBloodGroup: formData.patientBloodGroup,
        component: formData.component,
        unitsRequested: Number(formData.unitsRequested),
        priority: formData.priority,
        requiredBy: formData.requiredBy ? new Date(formData.requiredBy).toISOString() : null,
      };

      const response = await apiFetch('/api/blood-requests', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (response.status === 201) {
        setLastCreated(data);
        setFormData(INITIAL_FORM);
        fetchRequests();
      } else if (response.status === 400) {
        setFieldErrors(data.errors || {});
        setFormGeneralError(data.message || 'Validation error');
      } else {
        setFormGeneralError(data.message || 'Server error submitting request');
      }
    } catch {
      setFormGeneralError('Unable to connect to server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredRequests = requests.filter((r) => {
    if (filterStatus === 'ALL') return true;
    return r.status === filterStatus;
  });

  return (
    <div className="hospital-desk-container">
      {/* Hospital Identity Header Card */}
      <section className="hospital-hero-card">
        <div className="hospital-hero-info">
          <div className="hospital-badge-tag">HOSPITAL DESK</div>
          <h2>{hospitalUser?.organisation || 'Hospital Blood Request Desk'}</h2>
          <p className="hospital-desk-subtitle">
            Authenticated Personnel: <strong>{hospitalUser?.fullName || 'Hospital Staff'}</strong> ({hospitalUser?.email})
            {' · '}Source: <em>BBMS-F-040 Standard Blood Request Workflow</em>
          </p>
        </div>
        <div className="hospital-stats-pills">
          <div className="stat-pill">
            <span className="stat-pill-label">Total Requests</span>
            <span className="stat-pill-val">{requests.length}</span>
          </div>
          <div className="stat-pill stat-pill-pending">
            <span className="stat-pill-label">Pending</span>
            <span className="stat-pill-val">{requests.filter((r) => r.status === 'PENDING').length}</span>
          </div>
        </div>
      </section>

      {/* Navigation Sub-Tabs */}
      <nav className="desk-subnav" role="tablist" aria-label="Hospital Desk Navigation">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'form'}
          className={`subnav-btn ${activeTab === 'form' ? 'active' : ''}`}
          onClick={() => setActiveTab('form')}
        >
          <span>Submit New Blood Request</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'list'}
          className={`subnav-btn ${activeTab === 'list' ? 'active' : ''}`}
          onClick={() => setActiveTab('list')}
        >
          <span>Active Requests ({requests.length})</span>
        </button>
      </nav>

      {/* Main Panel Content */}
      <div className="desk-content-panel">
        {activeTab === 'form' && (
          <div className="request-form-wrapper">
            {lastCreated && (
              <div className="request-success-banner" role="alert" data-testid="request-success-alert">
                <div className="success-header-row">
                  <span className="success-check-icon">✓</span>
                  <div>
                    <h4>Blood Request Successfully Submitted!</h4>
                    <p>
                      Assigned Permanent Request ID: <strong className="request-id-highlight">{lastCreated.requestCode}</strong>
                    </p>
                  </div>
                  <span className={`status-tag status-tag-${lastCreated.status.toLowerCase()}`}>
                    {lastCreated.status}
                  </span>
                </div>
                <div className="success-details-grid">
                  <div>
                    <span className="detail-lbl">Patient:</span>
                    <strong>{lastCreated.patientName}</strong>
                  </div>
                  <div>
                    <span className="detail-lbl">Blood Group:</span>
                    <strong className="badge-group">{lastCreated.patientBloodGroup}</strong>
                  </div>
                  <div>
                    <span className="detail-lbl">Product:</span>
                    <strong>{lastCreated.unitsRequested} Unit(s) {lastCreated.component}</strong>
                  </div>
                  <div>
                    <span className="detail-lbl">Priority:</span>
                    <strong className={`priority-text priority-${lastCreated.priority.toLowerCase()}`}>
                      {lastCreated.priority}
                    </strong>
                  </div>
                </div>
                <div className="success-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setActiveTab('list')}
                  >
                    View in Active Requests List
                  </button>
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => setLastCreated(null)}
                  >
                    Dismiss Notice
                  </button>
                </div>
              </div>
            )}

            {formGeneralError && (
              <div className="alert-box alert-error" role="alert">
                {formGeneralError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="blood-request-form" noValidate>
              <div className="form-section-title">
                <h3>1. Patient Information</h3>
                <p>Enter the clinical recipient details requiring blood component support</p>
              </div>

              <div className="form-row">
                <div className="form-group flex-2">
                  <label htmlFor="patientName">
                    Patient Legal Full Name <span className="req-star">*</span>
                  </label>
                  <input
                    id="patientName"
                    type="text"
                    className={`form-input ${fieldErrors.patientName ? 'input-error' : ''}`}
                    placeholder="e.g. Ramesh Chandra"
                    value={formData.patientName}
                    onChange={handleInputChange('patientName')}
                    required
                  />
                  {fieldErrors.patientName && (
                    <span className="field-error-msg">{fieldErrors.patientName}</span>
                  )}
                </div>

                <div className="form-group flex-1">
                  <label htmlFor="patientBloodGroup">
                    Patient Blood Group <span className="req-star">*</span>
                  </label>
                  <select
                    id="patientBloodGroup"
                    className={`form-select ${fieldErrors.patientBloodGroup ? 'input-error' : ''}`}
                    value={formData.patientBloodGroup}
                    onChange={handleInputChange('patientBloodGroup')}
                  >
                    {BLOOD_GROUPS.map((bg) => (
                      <option key={bg} value={bg}>
                        {bg}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.patientBloodGroup && (
                    <span className="field-error-msg">{fieldErrors.patientBloodGroup}</span>
                  )}
                </div>
              </div>

              <div className="form-section-title mt-4">
                <h3>2. Blood Product & Quantity</h3>
                <p>Specify component requirements and required units</p>
              </div>

              <div className="form-row">
                <div className="form-group flex-2">
                  <label htmlFor="component">
                    Required Component <span className="req-star">*</span>
                  </label>
                  <select
                    id="component"
                    className={`form-select ${fieldErrors.component ? 'input-error' : ''}`}
                    value={formData.component}
                    onChange={handleInputChange('component')}
                  >
                    {COMPONENTS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.component && (
                    <span className="field-error-msg">{fieldErrors.component}</span>
                  )}
                </div>

                <div className="form-group flex-1">
                  <label htmlFor="unitsRequested">
                    Units Requested (1–20) <span className="req-star">*</span>
                  </label>
                  <input
                    id="unitsRequested"
                    type="number"
                    min="1"
                    max="20"
                    className={`form-input ${fieldErrors.unitsRequested ? 'input-error' : ''}`}
                    value={formData.unitsRequested}
                    onChange={handleInputChange('unitsRequested')}
                    required
                  />
                  {fieldErrors.unitsRequested && (
                    <span className="field-error-msg">{fieldErrors.unitsRequested}</span>
                  )}
                </div>
              </div>

              <div className="form-section-title mt-4">
                <h3>3. Urgency & Delivery Timing</h3>
                <p>Select request priority to guide blood bank cross-matching and issuance</p>
              </div>

              <div className="priority-selection-grid" role="radiogroup" aria-label="Request Priority">
                {PRIORITIES.map((p) => {
                  const isSelected = formData.priority === p.value;
                  return (
                    <div
                      key={p.value}
                      tabIndex={0}
                      role="radio"
                      aria-checked={isSelected}
                      className={`priority-card priority-card-${p.value.toLowerCase()} ${
                        isSelected ? 'selected' : ''
                      }`}
                      onClick={() => handlePrioritySelect(p.value)}
                      onKeyDown={(e) => {
                        if (e.key === ' ' || e.key === 'Enter') {
                          handlePrioritySelect(p.value);
                        }
                      }}
                    >
                      <div className="priority-card-top">
                        <span className="priority-radio-dot" />
                        <span className="priority-card-title">{p.label}</span>
                      </div>
                      <p className="priority-card-desc">{p.desc}</p>
                    </div>
                  );
                })}
              </div>
              {fieldErrors.priority && (
                <span className="field-error-msg">{fieldErrors.priority}</span>
              )}

              <div className="form-row mt-3">
                <div className="form-group flex-2">
                  <label htmlFor="requiredBy">
                    Required By Date / Time <em>(Optional)</em>
                  </label>
                  <input
                    id="requiredBy"
                    type="datetime-local"
                    className={`form-input ${fieldErrors.requiredBy ? 'input-error' : ''}`}
                    value={formData.requiredBy}
                    onChange={handleInputChange('requiredBy')}
                  />
                  {fieldErrors.requiredBy && (
                    <span className="field-error-msg">{fieldErrors.requiredBy}</span>
                  )}
                </div>
              </div>

              <div className="form-actions-row">
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary btn-submit-request"
                >
                  {submitting ? 'Submitting Request...' : 'Submit Blood Request'}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setFormData(INITIAL_FORM);
                    setFieldErrors({});
                    setFormGeneralError(null);
                  }}
                >
                  Reset Form
                </button>
              </div>
            </form>
          </div>
        )}

        {activeTab === 'list' && (
          <div className="requests-list-wrapper">
            <div className="list-controls-bar">
              <div className="filter-group">
                <label htmlFor="filterStatus">Status Filter:</label>
                <select
                  id="filterStatus"
                  className="form-select filter-select"
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                >
                  <option value="ALL">All Statuses ({requests.length})</option>
                  <option value="PENDING">Pending</option>
                  <option value="RESERVED">Reserved</option>
                  <option value="ISSUED">Issued</option>
                  <option value="REJECTED">Rejected</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              </div>

              <button
                type="button"
                className="btn-secondary btn-refresh"
                onClick={fetchRequests}
                disabled={loadingRequests}
              >
                {loadingRequests ? 'Refreshing...' : 'Refresh List'}
              </button>
            </div>

            {listError && (
              <div className="alert-box alert-error" role="alert">
                {listError}
              </div>
            )}

            {loadingRequests && requests.length === 0 ? (
              <div className="loading-state" data-testid="requests-loading">
                <div className="loading-spinner" />
                <p>Loading active blood requests...</p>
              </div>
            ) : filteredRequests.length === 0 ? (
              <div className="empty-state" data-testid="requests-empty">
                <p>No blood requests found matching the current criteria.</p>
                <button
                  type="button"
                  className="btn-secondary mt-2"
                  onClick={() => setActiveTab('form')}
                >
                  Submit a Blood Request
                </button>
              </div>
            ) : (
              <div className="requests-table-container">
                <table className="requests-table" aria-label="Hospital Blood Requests">
                  <thead>
                    <tr>
                      <th scope="col">Request ID</th>
                      <th scope="col">Patient</th>
                      <th scope="col">Group</th>
                      <th scope="col">Component</th>
                      <th scope="col">Units</th>
                      <th scope="col">Priority</th>
                      <th scope="col">Status</th>
                      <th scope="col">Submitted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRequests.map((req) => (
                      <tr key={req.id || req.requestCode} data-testid={`request-row-${req.requestCode}`}>
                        <td className="code-cell font-mono">
                          <strong>{req.requestCode}</strong>
                        </td>
                        <td className="patient-cell">{req.patientName}</td>
                        <td className="group-cell">
                          <span className="badge-group">{req.patientBloodGroup}</span>
                        </td>
                        <td>{req.component}</td>
                        <td className="units-cell">{req.unitsRequested}</td>
                        <td>
                          <span className={`priority-badge priority-${req.priority.toLowerCase()}`}>
                            {req.priority}
                          </span>
                        </td>
                        <td>
                          <span className={`status-badge status-${req.status.toLowerCase()}`}>
                            {req.status}
                          </span>
                        </td>
                        <td className="date-cell">
                          {req.createdAt ? new Date(req.createdAt).toLocaleDateString() : '—'}
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
    </div>
  );
}
