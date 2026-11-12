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
  const isLabStaff = ['LAB_TECH', 'MANAGER', 'ADMIN'].includes(hospitalUser?.role);

  const defaultTab = isHospitalRole ? 'form' : 'list';
  const [activeTab, setActiveTab] = useState(defaultTab); // 'form' | 'list'
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [formGeneralError, setFormGeneralError] = useState(null);
  const [lastCreated, setLastCreated] = useState(null);

  const [requests, setRequests] = useState([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [listError, setListError] = useState(null);
  const [filterStatus, setFilterStatus] = useState('ALL');

  // BBMS-F-041: Cross-match state
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [crossmatches, setCrossmatches] = useState([]);
  const [loadingCrossmatches, setLoadingCrossmatches] = useState(false);
  const [crossmatchUnitCode, setCrossmatchUnitCode] = useState('');
  const [crossmatchResult, setCrossmatchResult] = useState('COMPATIBLE');
  const [crossmatchSubmitting, setCrossmatchSubmitting] = useState(false);
  const [crossmatchError, setCrossmatchError] = useState(null);
  const [crossmatchSuccess, setCrossmatchSuccess] = useState(null);

  // BBMS-F-033: FEFO suggested units state
  const [fefoSuggestions, setFefoSuggestions] = useState([]);
  const [loadingFefo, setLoadingFefo] = useState(false);

  const loadFefoSuggestions = useCallback(async (reqCode) => {
    setLoadingFefo(true);
    try {
      const res = await apiFetch(`/api/blood-requests/${reqCode}/fefo-suggestions`);
      if (res.ok) {
        const data = await res.json();
        setFefoSuggestions(data.suggestedUnits || []);
      } else {
        setFefoSuggestions([]);
      }
    } catch {
      setFefoSuggestions([]);
    } finally {
      setLoadingFefo(false);
    }
  }, []);

  const loadCrossmatches = useCallback(async (reqCode) => {
    setLoadingCrossmatches(true);
    setCrossmatchError(null);
    try {
      const res = await apiFetch(`/api/blood-requests/${reqCode}/crossmatches`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Failed to load cross-match records');
      }
      const data = await res.json();
      setCrossmatches(data.crossmatches || []);
    } catch (err) {
      setCrossmatchError(err.message || 'Error loading cross-matches');
    } finally {
      setLoadingCrossmatches(false);
    }
  }, []);

  const handleSelectRequest = (req) => {
    setSelectedRequest(req);
    setCrossmatchSuccess(null);
    setCrossmatchError(null);
    setCrossmatchUnitCode('');
    setCrossmatchResult('COMPATIBLE');
    loadCrossmatches(req.requestCode);
    loadFefoSuggestions(req.requestCode);
  };

  const handleCloseDetails = () => {
    setSelectedRequest(null);
    setCrossmatches([]);
    setFefoSuggestions([]);
    setCrossmatchError(null);
    setCrossmatchSuccess(null);
  };

  const handleRecordCrossmatch = async (e) => {
    e.preventDefault();
    if (!crossmatchUnitCode.trim()) {
      setCrossmatchError('Unit code is required');
      return;
    }

    setCrossmatchSubmitting(true);
    setCrossmatchError(null);
    setCrossmatchSuccess(null);

    try {
      const res = await apiFetch(`/api/blood-requests/${selectedRequest.requestCode}/crossmatch`, {
        method: 'POST',
        body: JSON.stringify({
          unitCode: crossmatchUnitCode.trim(),
          result: crossmatchResult,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to record cross-match');
      }

      const outcomeMsg =
        data.crossmatch?.result === 'COMPATIBLE'
          ? `Cross-match recorded: COMPATIBLE. Unit ${data.crossmatch.unitCode} is ready for issuance.`
          : `Cross-match recorded: INCOMPATIBLE. Issuance is blocked for unit ${data.crossmatch.unitCode}.`;

      setCrossmatchSuccess(outcomeMsg);
      setCrossmatchUnitCode('');
      await loadCrossmatches(selectedRequest.requestCode);
      await fetchRequests(); // Refresh requests in case status changes
    } catch (err) {
      setCrossmatchError(err.message || 'Error recording cross-match');
    } finally {
      setCrossmatchSubmitting(false);
    }
  };

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
                      <th scope="col">Actions</th>
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
                        <td>
                          <button
                            type="button"
                            className="btn-details"
                            data-testid={`btn-view-${req.requestCode}`}
                            onClick={() => handleSelectRequest(req)}
                          >
                            Cross-match & Details
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {selectedRequest && (
              <div className="crossmatch-panel-card" data-testid="crossmatch-panel">
                <div className="crossmatch-panel-header">
                  <div>
                    <span className="hospital-badge-tag">REQUEST DETAILS &amp; CROSS-MATCH</span>
                    <h3>Request {selectedRequest.requestCode} — {selectedRequest.patientName}</h3>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={handleCloseDetails}
                  >
                    Close Panel
                  </button>
                </div>

                <div className="request-summary-grid">
                  <div>
                    <span className="summary-label">Patient Name:</span>
                    <strong>{selectedRequest.patientName}</strong>
                  </div>
                  <div>
                    <span className="summary-label">Blood Group:</span>
                    <strong className="badge-group">{selectedRequest.patientBloodGroup}</strong>
                  </div>
                  <div>
                    <span className="summary-label">Component:</span>
                    <strong>{selectedRequest.component}</strong>
                  </div>
                  <div>
                    <span className="summary-label">Units Requested:</span>
                    <strong>{selectedRequest.unitsRequested}</strong>
                  </div>
                  <div>
                    <span className="summary-label">Priority:</span>
                    <strong className={`priority-text priority-${selectedRequest.priority.toLowerCase()}`}>
                      {selectedRequest.priority}
                    </strong>
                  </div>
                  <div>
                    <span className="summary-label">Status:</span>
                    <strong className={`status-tag status-tag-${selectedRequest.status.toLowerCase()}`}>
                      {selectedRequest.status}
                    </strong>
                  </div>
                </div>

                <div
                  className={`issuance-status-banner ${
                    crossmatches.some((c) => c.result === 'COMPATIBLE')
                      ? 'banner-ready'
                      : crossmatches.length > 0
                      ? 'banner-blocked'
                      : 'banner-awaiting'
                  }`}
                  data-testid="issuance-banner"
                >
                  {crossmatches.some((c) => c.result === 'COMPATIBLE') ? (
                    <div>
                      <h4 className="banner-title">Ready for Issuance</h4>
                      <p className="banner-desc">
                        Compatible cross-match verified for unit(s):{' '}
                        <strong>
                          {crossmatches
                            .filter((c) => c.result === 'COMPATIBLE')
                            .map((c) => c.unitCode)
                            .join(', ')}
                        </strong>.
                        This unit is cleared for patient issuance.
                      </p>
                    </div>
                  ) : crossmatches.length > 0 ? (
                    <div>
                      <h4 className="banner-title">Issuance Blocked</h4>
                      <p className="banner-desc">
                        Cross-match result is INCOMPATIBLE. Issuance is strictly blocked until a compatible unit is verified.
                      </p>
                    </div>
                  ) : (
                    <div>
                      <h4 className="banner-title">Issuance Blocked: Awaiting Cross-match</h4>
                      <p className="banner-desc">
                        A unit can only be marked ready for issuance after a cross-match result is recorded as compatible.
                      </p>
                    </div>
                  )}
                </div>

                <div className="crossmatch-records-section">
                  <h4>Cross-match History</h4>
                  {loadingCrossmatches ? (
                    <p className="loading-text">Loading cross-match records...</p>
                  ) : crossmatches.length === 0 ? (
                    <p className="empty-subtext" data-testid="no-crossmatches-msg">
                      No cross-match tests recorded for this request yet.
                    </p>
                  ) : (
                    <div className="requests-table-container">
                      <table className="requests-table crossmatch-table" aria-label="Cross-match Records">
                        <thead>
                          <tr>
                            <th scope="col">Unit Code</th>
                            <th scope="col">Unit Group</th>
                            <th scope="col">Component</th>
                            <th scope="col">Result</th>
                            <th scope="col">Issuance Readiness</th>
                            <th scope="col">Performed By</th>
                            <th scope="col">Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {crossmatches.map((cm) => (
                            <tr key={cm.id} data-testid={`crossmatch-row-${cm.unitCode}`}>
                              <td className="code-cell font-mono">{cm.unitCode}</td>
                              <td><span className="badge-group">{cm.unitBloodGroup || '—'}</span></td>
                              <td>{cm.component || '—'}</td>
                              <td>
                                <span className={`result-tag tag-${cm.result.toLowerCase()}`}>
                                  {cm.result}
                                </span>
                              </td>
                              <td>
                                <span className={`readiness-pill ${cm.readyForIssuance ? 'pill-ready' : 'pill-blocked'}`}>
                                  {cm.readyForIssuance ? 'Ready for Issuance' : 'Blocked'}
                                </span>
                              </td>
                              <td>{cm.performedBy?.fullName || 'Technician'}</td>
                              <td>{cm.performedAt ? new Date(cm.performedAt).toLocaleString() : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* BBMS-F-033: Suggested Units for Allocation (FEFO - First Expiry First Out) */}
                <div className="fefo-suggestions-section" data-testid="fefo-suggestions-section">
                  <div className="fefo-header">
                    <h4>Suggested Units for Allocation (FEFO)</h4>
                    <p className="section-desc">
                      BBMS-F-033 · Soonest-to-expire compatible unit suggested first to minimize inventory wastage.
                    </p>
                  </div>

                  {loadingFefo ? (
                    <p className="loading-text">Loading FEFO unit suggestions...</p>
                  ) : fefoSuggestions.length === 0 ? (
                    <p className="empty-subtext" data-testid="no-fefo-units">
                      No compatible available units currently in inventory for patient group {selectedRequest.patientBloodGroup} ({selectedRequest.component}).
                    </p>
                  ) : (
                    <div className="requests-table-container">
                      <table className="requests-table fefo-table" aria-label="FEFO Suggested Units">
                        <thead>
                          <tr>
                            <th scope="col">Priority Rank</th>
                            <th scope="col">Unit Code</th>
                            <th scope="col">Blood Group</th>
                            <th scope="col">Component</th>
                            <th scope="col">Volume</th>
                            <th scope="col">Expires</th>
                            <th scope="col">Shelf Life Remaining</th>
                            {isLabStaff && <th scope="col">Allocation</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {fefoSuggestions.map((unit) => (
                            <tr key={unit.unitCode} data-testid={`fefo-row-${unit.unitCode}`}>
                              <td>
                                <span className={`rank-badge ${unit.rank === 1 ? 'rank-top' : ''}`}>
                                  #{unit.rank} {unit.rank === 1 ? '(Soonest Expiry)' : ''}
                                </span>
                              </td>
                              <td className="code-cell font-mono">
                                <strong>{unit.unitCode}</strong>
                              </td>
                              <td>
                                <span className="badge-group">{unit.bloodGroup}</span>
                              </td>
                              <td>{unit.component}</td>
                              <td>{unit.volumeMl} ml</td>
                              <td>{new Date(unit.expiresAt).toLocaleDateString()}</td>
                              <td>
                                <span className="urgency-pill urgency-warning">
                                  {unit.daysRemaining <= 1 ? `${unit.hoursRemaining}h remaining` : `${unit.daysRemaining} days left`}
                                </span>
                              </td>
                              {isLabStaff && (
                                <td>
                                  <button
                                    type="button"
                                    className="btn-select-fefo"
                                    data-testid={`btn-select-fefo-${unit.unitCode}`}
                                    onClick={() => {
                                      setCrossmatchUnitCode(unit.unitCode);
                                      setCrossmatchError(null);
                                    }}
                                  >
                                    Select for Cross-match
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {isLabStaff && (
                  <div className="record-crossmatch-section">
                    <h4>Record Cross-match Test</h4>
                    <p className="section-desc">
                      Verify ABO/Rh compatibility between patient sample and blood unit before recording test result.
                    </p>

                    {crossmatchSuccess && (
                      <div className="alert-box alert-success" role="alert">
                        {crossmatchSuccess}
                      </div>
                    )}

                    {crossmatchError && (
                      <div className="alert-box alert-error" role="alert">
                        {crossmatchError}
                      </div>
                    )}

                    <form onSubmit={handleRecordCrossmatch} className="crossmatch-form" noValidate>
                      <div className="form-row align-end">
                        <div className="form-group flex-2">
                          <label htmlFor="crossmatchUnitCode">
                            Blood Unit Code <span className="req-star">*</span>
                          </label>
                          <input
                            id="crossmatchUnitCode"
                            data-testid="crossmatch-unit-input"
                            type="text"
                            className="form-input"
                            placeholder="e.g. U-2026-000001"
                            value={crossmatchUnitCode}
                            onChange={(e) => setCrossmatchUnitCode(e.target.value)}
                            required
                          />
                        </div>

                        <div className="form-group flex-1">
                          <label htmlFor="crossmatchResult">
                            Cross-match Result <span className="req-star">*</span>
                          </label>
                          <select
                            id="crossmatchResult"
                            data-testid="crossmatch-result-select"
                            className="form-select"
                            value={crossmatchResult}
                            onChange={(e) => setCrossmatchResult(e.target.value)}
                          >
                            <option value="COMPATIBLE">Compatible</option>
                            <option value="INCOMPATIBLE">Incompatible</option>
                          </select>
                        </div>

                        <div className="form-group">
                          <button
                            type="submit"
                            data-testid="btn-record-crossmatch"
                            className="btn-primary"
                            disabled={crossmatchSubmitting || !crossmatchUnitCode.trim()}
                          >
                            {crossmatchSubmitting ? 'Recording...' : 'Record Cross-match'}
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
