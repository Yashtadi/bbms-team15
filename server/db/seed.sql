-- Fake data for local development, tests and demos. These are NOT real people.
-- Runs after schema.sql (npm run db:setup does both).
-- Dates are relative to NOW() so expiry alerts and FEFO always have something to show.
-- password_hash values are placeholders. SR-002 (login) replaces them with real bcrypt hashes.

-- One user per role (+ a second lab tech for F-020 two-step verification)
INSERT INTO users (id, email, password_hash, full_name, role, organisation) VALUES
  (1, 'admin@bbms.test',    'SET_IN_SR-002', 'Asha Admin',         'ADMIN',    NULL),
  (2, 'manager@bbms.test',  'SET_IN_SR-002', 'Manoj Manager',      'MANAGER',  NULL),
  (3, 'labtech@bbms.test',  'SET_IN_SR-002', 'Lata LabTech',       'LAB_TECH', NULL),
  (4, 'labtech2@bbms.test', 'SET_IN_SR-002', 'Kiran LabTech',      'LAB_TECH', NULL),
  (5, 'hospital@bbms.test', 'SET_IN_SR-002', 'City Hospital Desk', 'HOSPITAL', 'City General Hospital'),
  (6, 'donor@bbms.test',    'SET_IN_SR-002', 'Ravi Kumar',         'DONOR',    NULL);

-- Donors in different states
INSERT INTO donors (id, donor_code, user_id, full_name, date_of_birth, gender, blood_group, phone,
                    id_proof, medical_history, eligibility_status, deferral_reason, consent_given, consent_at) VALUES
  (1, 'D-000001', 6,    'Ravi Kumar',   '1995-04-12', 'MALE',   'O-', '9000000001', 'ID-000001', 'None',         'ELIGIBLE', NULL,                  TRUE,  NOW()),
  (2, 'D-000002', NULL, 'Priya Sharma', '1990-08-30', 'FEMALE', 'A+', '9000000002', 'ID-000002', 'None',         'ELIGIBLE', NULL,                  TRUE,  NOW()),
  (3, 'D-000003', NULL, 'Arjun Rao',    '1988-01-05', 'MALE',   'B+', '9000000003', 'ID-000003', 'None',         'DEFERRED', 'Reactive TTI (HIV)', TRUE,  NOW()),
  (4, 'D-000004', NULL, 'Neha Iyer',    '2001-11-20', 'FEMALE', NULL, '9000000004', 'ID-000004', 'None',         'ELIGIBLE', NULL,                  TRUE,  NOW()),
  (5, 'D-000005', NULL, 'Sameer Khan',  '2004-02-14', 'MALE',   NULL, '9000000005', 'ID-000005', 'None',         'PENDING',  NULL,                  FALSE, NULL);

-- Donations (collected by lab tech 3)
INSERT INTO donations (id, donor_id, collected_by, collected_at, status, volume_ml,
                       weight_kg, hemoglobin_g_dl, bp_systolic, bp_diastolic, pulse_bpm, temperature_c) VALUES
  (1, 1, 3, NOW() - INTERVAL 10 DAY, 'COMPLETED', 450, 72.0, 14.2, 120, 80, 72, 36.8),
  (2, 2, 3, NOW() - INTERVAL 40 DAY, 'COMPLETED', 350, 58.5, 13.1, 112, 74, 76, 36.6),
  (3, 3, 3, NOW() - INTERVAL 5 DAY,  'COMPLETED', 450, 80.0, 15.0, 126, 82, 70, 36.9),
  (4, 4, 3, NOW(),                   'COMPLETED', 350, 52.0, 12.8, 110, 70, 78, 36.7);

-- Blood units covering every status
-- Shelf life: PRBC 42 days, FFP 1 year, platelets 5 days, whole blood 35 days
INSERT INTO blood_units (id, unit_code, donation_id, component, blood_group, volume_ml,
                         collected_at, expires_at, status, discard_reason) VALUES
  (1, 'U-2026-000001', 1, 'PRBC',        'O-', 280, NOW() - INTERVAL 10 DAY, NOW() + INTERVAL 32 DAY,  'AVAILABLE',  NULL),
  (2, 'U-2026-000002', 1, 'FFP',         'O-', 200, NOW() - INTERVAL 10 DAY, NOW() + INTERVAL 355 DAY, 'AVAILABLE',  NULL),
  (3, 'U-2026-000003', 1, 'PLATELETS',   'O-',  50, NOW() - INTERVAL 10 DAY, NOW() - INTERVAL 5 DAY,   'EXPIRED',    NULL),
  (4, 'U-2026-000004', 2, 'PRBC',        'A+', 220, NOW() - INTERVAL 40 DAY, NOW() + INTERVAL 2 DAY,   'AVAILABLE',  NULL),  -- near expiry (F-032)
  (5, 'U-2026-000005', 2, 'FFP',         'A+', 150, NOW() - INTERVAL 40 DAY, NOW() + INTERVAL 325 DAY, 'AVAILABLE',  NULL),
  (6, 'U-2026-000006', 3, 'WHOLE_BLOOD', 'B+', 450, NOW() - INTERVAL 5 DAY,  NOW() + INTERVAL 30 DAY,  'DISCARDED',  'Reactive TTI: HIV'),
  (7, 'U-2026-000007', 4, 'WHOLE_BLOOD', NULL, 350, NOW(),                   NOW() + INTERVAL 35 DAY,  'QUARANTINE', NULL);  -- awaiting lab tests

-- Lab results: donations 1 and 2 passed everything, donation 3 is HIV reactive, donation 4 not tested yet
INSERT INTO lab_results (donation_id, test_type, result, tested_by, verified_by, verified_at) VALUES
  (1, 'ABO_RH',   'O-',           3, 4, NOW()),
  (1, 'HIV',      'NON_REACTIVE', 3, NULL, NULL),
  (1, 'HBV',      'NON_REACTIVE', 3, NULL, NULL),
  (1, 'HCV',      'NON_REACTIVE', 3, NULL, NULL),
  (1, 'SYPHILIS', 'NON_REACTIVE', 3, NULL, NULL),
  (1, 'MALARIA',  'NON_REACTIVE', 3, NULL, NULL),
  (2, 'ABO_RH',   'A+',           3, 4, NOW()),
  (2, 'HIV',      'NON_REACTIVE', 3, NULL, NULL),
  (2, 'HBV',      'NON_REACTIVE', 3, NULL, NULL),
  (2, 'HCV',      'NON_REACTIVE', 3, NULL, NULL),
  (2, 'SYPHILIS', 'NON_REACTIVE', 3, NULL, NULL),
  (2, 'MALARIA',  'NON_REACTIVE', 3, NULL, NULL),
  (3, 'ABO_RH',   'B+',           3, 4, NOW()),
  (3, 'HIV',      'REACTIVE',     3, NULL, NULL),
  (3, 'HBV',      'NON_REACTIVE', 3, NULL, NULL),
  (3, 'HCV',      'NON_REACTIVE', 3, NULL, NULL),
  (3, 'SYPHILIS', 'NON_REACTIVE', 3, NULL, NULL),
  (3, 'MALARIA',  'NON_REACTIVE', 3, NULL, NULL);

-- Hospital requests: one routine, one emergency (F-044)
INSERT INTO blood_requests (id, request_code, hospital_user_id, patient_name, patient_blood_group,
                            component, units_requested, priority, status, required_by) VALUES
  (1, 'R-000001', 5, 'Patient One', 'A+', 'PRBC', 1, 'ROUTINE',   'PENDING', NOW() + INTERVAL 2 DAY),
  (2, 'R-000002', 5, 'Patient Two', 'O-', 'PRBC', 1, 'EMERGENCY', 'PENDING', NOW());
