-- BBMS database schema v1
-- Owner: [SETUP] Database schema v1 (#2). Change it only through a reviewed PR.
--
-- WARNING: running this file DELETES all data. It drops and recreates every table.
-- Run it inside the bbms database (see CONTRIBUTING.md).

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS notifications, audit_log, issuances, crossmatches, lab_results,
                     blood_units, blood_requests, donations, donors, users;
SET FOREIGN_KEY_CHECKS = 1;

-- 1. users: login accounts. Roles: SR-002. MFA: SR-005.
CREATE TABLE users (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  email          VARCHAR(255) NOT NULL UNIQUE,
  password_hash  VARCHAR(255) NOT NULL,
  full_name      VARCHAR(100) NOT NULL,
  role           ENUM('DONOR','LAB_TECH','MANAGER','HOSPITAL','ADMIN') NOT NULL,
  organisation   VARCHAR(150) NULL,              -- hospital name, for HOSPITAL users
  mfa_secret     VARCHAR(255) NULL,              -- SR-005, ADMIN and MANAGER only
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. donors: F-001 registration, F-002 eligibility, F-004 consent
CREATE TABLE donors (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  donor_code          VARCHAR(20) NULL UNIQUE,   -- e.g. D-000001 (generated post-insert in same transaction)
  user_id             INT NULL UNIQUE,               -- set if the donor has a login
  full_name           VARCHAR(100) NOT NULL,
  date_of_birth       DATE NOT NULL,
  gender              ENUM('MALE','FEMALE','OTHER') NOT NULL,
  blood_group         ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-') NULL,
  phone               VARCHAR(15) NOT NULL,
  email               VARCHAR(255) NULL,
  address             VARCHAR(255) NULL,
  id_proof            VARCHAR(50) NOT NULL UNIQUE,   -- F-001 ID proof
  medical_history     TEXT NULL,                     -- F-001 medical history
  eligibility_status  ENUM('PENDING','ELIGIBLE','DEFERRED') NOT NULL DEFAULT 'PENDING',
  deferral_reason     VARCHAR(255) NULL,
  deferred_until      DATE NULL,
  consent_given       BOOLEAN NOT NULL DEFAULT FALSE,
  consent_at          DATETIME NULL,
  follow_up_required  BOOLEAN NOT NULL DEFAULT FALSE,
  follow_up_reason    VARCHAR(255) NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 3. donations: one visit where blood is taken. F-010 session, F-011 vitals, F-013 camps
CREATE TABLE donations (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  donor_id           INT NOT NULL,
  collected_by       INT NULL,
  collected_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  camp_location      VARCHAR(150) NULL,             -- set when collected at a blood camp
  donation_type      ENUM('WHOLE_BLOOD','APHERESIS') NOT NULL DEFAULT 'WHOLE_BLOOD',  -- F-010
  status             ENUM('IN_PROGRESS','COMPLETED','ABORTED') NOT NULL DEFAULT 'IN_PROGRESS',
  volume_ml          SMALLINT NULL,
  -- pre-donation vitals
  weight_kg          DECIMAL(5,2) NULL,
  hemoglobin_g_dl    DECIMAL(4,1) NULL,
  bp_systolic        SMALLINT NULL,
  bp_diastolic       SMALLINT NULL,
  pulse_bpm          SMALLINT NULL,
  temperature_c      DECIMAL(4,1) NULL,
  -- post-donation vitals
  post_bp_systolic   SMALLINT NULL,
  post_bp_diastolic  SMALLINT NULL,
  post_pulse_bpm     SMALLINT NULL,
  post_hemoglobin_g_dl DECIMAL(4,1) NULL,           -- F-011
  adverse_reaction   VARCHAR(255) NULL,
  FOREIGN KEY (donor_id) REFERENCES donors(id),
  FOREIGN KEY (collected_by) REFERENCES users(id)
);

-- 6. blood_requests: created before blood_units, because units can be reserved for a request.
--    F-040 request, F-044 emergency priority
CREATE TABLE blood_requests (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  request_code         VARCHAR(20) NOT NULL UNIQUE,   -- e.g. R-000001
  hospital_user_id     INT NOT NULL,
  patient_name         VARCHAR(100) NOT NULL,
  patient_blood_group  ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-') NOT NULL,
  component            ENUM('WHOLE_BLOOD','PRBC','FFP','PLATELETS','CRYO') NOT NULL,
  units_requested      TINYINT UNSIGNED NOT NULL,
  priority             ENUM('ROUTINE','URGENT','EMERGENCY') NOT NULL DEFAULT 'ROUTINE',
  status               ENUM('PENDING','RESERVED','ISSUED','REJECTED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  required_by          DATETIME NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_user_id) REFERENCES users(id)
);

-- 4. blood_units: one bag. F-012 barcode, F-030 to F-034 inventory, F-042 reservation
CREATE TABLE blood_units (
  id                       INT AUTO_INCREMENT PRIMARY KEY,
  unit_code                VARCHAR(30) NOT NULL UNIQUE,   -- barcode, e.g. U-2026-000001
  donation_id              INT NOT NULL,
  component                ENUM('WHOLE_BLOOD','PRBC','FFP','PLATELETS','CRYO') NOT NULL DEFAULT 'WHOLE_BLOOD',
  blood_group              ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-') NULL,  -- set after F-020
  volume_ml                SMALLINT NOT NULL,
  collected_at             DATETIME NOT NULL,
  expires_at               DATETIME NOT NULL,
  status                   ENUM('QUARANTINE','AVAILABLE','RESERVED','ISSUED','DISCARDED','EXPIRED')
                           NOT NULL DEFAULT 'QUARANTINE',
  discard_reason           VARCHAR(255) NULL,
  reserved_for_request_id  INT NULL,
  created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (donation_id) REFERENCES donations(id),
  FOREIGN KEY (reserved_for_request_id) REFERENCES blood_requests(id),
  INDEX idx_units_stock (status, blood_group, component, expires_at)  -- fast stock + FEFO queries (NF-001)
);

-- 5. lab_results: tests run on a donation's sample. F-020 ABO/Rh, F-021 TTI tests
CREATE TABLE lab_results (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  donation_id  INT NOT NULL,
  test_type    ENUM('ABO_RH','HIV','HBV','HCV','SYPHILIS','MALARIA') NOT NULL,
  result       VARCHAR(20) NOT NULL,      -- ABO_RH: 'A+', 'O-', ...   others: 'NON_REACTIVE' / 'REACTIVE'
  method       ENUM('NAT','ELISA') NULL,   -- Required by the API for TTI results
  tested_by    INT NOT NULL,
  tested_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_by  INT NULL,                  -- F-020 two-step check: must be a different technician
  verified_at  DATETIME NULL,
  verification_result VARCHAR(5) NULL,    -- Captures a mismatched ABO/Rh verification attempt
  verification_status ENUM('PENDING','MISMATCH','VERIFIED') NOT NULL DEFAULT 'PENDING',
  UNIQUE (donation_id, test_type),        -- each test recorded once per donation
  FOREIGN KEY (donation_id) REFERENCES donations(id),
  FOREIGN KEY (tested_by) REFERENCES users(id),
  FOREIGN KEY (verified_by) REFERENCES users(id),
  CHECK (
    (test_type = 'ABO_RH' AND result IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'))
    OR (test_type <> 'ABO_RH' AND result IN ('REACTIVE', 'NON_REACTIVE'))
  ),
  CHECK (
    (test_type = 'ABO_RH' AND method IS NULL)
    OR (test_type <> 'ABO_RH' AND method IS NOT NULL)
  )
);

-- 7. crossmatches: F-041, a unit must be compatible with the patient before issue
CREATE TABLE crossmatches (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  request_id    INT NOT NULL,
  unit_id       INT NOT NULL,
  result        ENUM('COMPATIBLE','INCOMPATIBLE') NOT NULL,
  performed_by  INT NOT NULL,
  performed_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id) REFERENCES blood_requests(id),
  FOREIGN KEY (unit_id) REFERENCES blood_units(id),
  FOREIGN KEY (performed_by) REFERENCES users(id)
);

-- 8. issuances: chain of custody. F-043. One row per bag handed over.
CREATE TABLE issuances (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  request_id     INT NOT NULL,
  unit_id        INT NOT NULL UNIQUE,      -- a bag can only ever be issued once
  crossmatch_id  INT NOT NULL,             -- F-041: no issuance without a cross-match
  issued_by      INT NOT NULL,
  issued_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  received_by    VARCHAR(100) NULL,
  FOREIGN KEY (request_id) REFERENCES blood_requests(id),
  FOREIGN KEY (unit_id) REFERENCES blood_units(id),
  FOREIGN KEY (crossmatch_id) REFERENCES crossmatches(id),
  FOREIGN KEY (issued_by) REFERENCES users(id)
);

-- 9. audit_log: SR-004. Rows are only ever inserted, never updated or deleted.
CREATE TABLE audit_log (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT NULL,                  -- NULL for system actions (e.g. automatic expiry)
  action       VARCHAR(50) NOT NULL,      -- e.g. 'DONOR_REGISTERED', 'UNIT_ISSUED'
  entity_type  VARCHAR(30) NOT NULL,      -- e.g. 'donor', 'blood_unit'
  entity_id    VARCHAR(30) NOT NULL,      -- e.g. 'D-000001'
  details      JSON NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_audit_entity (entity_type, entity_id)
);

-- Confidential in-app alerts are delivered only to their intended staff recipient.
CREATE TABLE notifications (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  recipient_user_id  INT NOT NULL,
  event_type         ENUM('REACTIVE_TTI') NOT NULL,
  message            VARCHAR(255) NOT NULL,
  entity_type        VARCHAR(30) NOT NULL,
  entity_id          VARCHAR(30) NOT NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at            DATETIME NULL,
  FOREIGN KEY (recipient_user_id) REFERENCES users(id),
  INDEX idx_notifications_recipient (recipient_user_id, created_at)
);
