/**
 * BBMS-F-041: Clinical ABO/Rh compatibility rules for blood product transfusions.
 */

// Red Blood Cells & Whole Blood: Recipient blood group -> acceptable donor blood groups
const RED_CELL_COMPATIBILITY = {
  'A+': ['A+', 'A-', 'O+', 'O-'],
  'A-': ['A-', 'O-'],
  'B+': ['B+', 'B-', 'O+', 'O-'],
  'B-': ['B-', 'O-'],
  'AB+': ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
  'AB-': ['AB-', 'A-', 'B-', 'O-'],
  'O+': ['O+', 'O-'],
  'O-': ['O-'],
};

// Plasma (FFP): Inverted antibody profile (AB is universal plasma donor)
const PLASMA_COMPATIBILITY = {
  'O+': ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'],
  'O-': ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'],
  'A+': ['A+', 'A-', 'AB+', 'AB-'],
  'A-': ['A+', 'A-', 'AB+', 'AB-'],
  'B+': ['B+', 'B-', 'AB+', 'AB-'],
  'B-': ['B+', 'B-', 'AB+', 'AB-'],
  'AB+': ['AB+', 'AB-'],
  'AB-': ['AB+', 'AB-'],
};

/**
 * Checks whether a donor unit blood group is clinically compatible with a patient.
 * @param {string} patientGroup (e.g. 'A+')
 * @param {string} donorGroup (e.g. 'O-')
 * @param {string} [component] (e.g. 'PRBC', 'WHOLE_BLOOD', 'FFP', 'PLATELETS', 'CRYO')
 * @returns {boolean}
 */
function isBloodGroupCompatible(patientGroup, donorGroup, component = 'PRBC') {
  if (!donorGroup) return false;
  const d = String(donorGroup).trim().toUpperCase();
  const comp = String(component || 'PRBC').trim().toUpperCase();
  if (!patientGroup) return comp === 'PRBC' && d === 'O-';
  const p = String(patientGroup).trim().toUpperCase();

  if (comp === 'FFP') {
    return PLASMA_COMPATIBILITY[p]?.includes(d) ?? false;
  }

  return RED_CELL_COMPATIBILITY[p]?.includes(d) ?? false;
}

module.exports = {
  RED_CELL_COMPATIBILITY,
  PLASMA_COMPATIBILITY,
  isBloodGroupCompatible,
};
