const express = require('express');
const { requireRole } = require('../../middleware/auth');
const inventoryRepository = require('./inventory.repository');

const router = express.Router();

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const COMPONENTS = ['WHOLE_BLOOD', 'PRBC', 'FFP', 'PLATELETS', 'CRYO'];

router.get('/', requireRole('LAB_TECH', 'MANAGER', 'HOSPITAL', 'ADMIN'), async (req, res) => {
  const { bloodGroup = null, component = null } = req.query;
  const invalidBloodGroup = bloodGroup !== null &&
    (typeof bloodGroup !== 'string' || !BLOOD_GROUPS.includes(bloodGroup));
  const invalidComponent = component !== null &&
    (typeof component !== 'string' || !COMPONENTS.includes(component));
  if (invalidBloodGroup || invalidComponent) {
    return res.status(400).json({
      message: 'Invalid inventory filter',
      errors: {
        ...(invalidBloodGroup
          ? { bloodGroup: `Blood group must be one of: ${BLOOD_GROUPS.join(', ')}` }
          : {}),
        ...(invalidComponent
          ? { component: `Component must be one of: ${COMPONENTS.join(', ')}` }
          : {}),
      },
    });
  }

  try {
    const units = await inventoryRepository.listAvailable({ bloodGroup, component });
    return res.status(200).json({ units });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load available inventory' });
  }
});

module.exports = router;
