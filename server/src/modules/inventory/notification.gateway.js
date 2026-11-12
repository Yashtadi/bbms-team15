/**
 * BBMS-F-034: Mock Notification Gateway for Low-Stock Alerts.
 * Simulates external notification dispatch (Email/SMS/Webhook) to the blood bank manager.
 * In-app alert is the primary visible implementation; this gateway handles external channels.
 */

let dispatchedAlerts = [];

/**
 * Sends a low-stock alert notification to the blood bank manager.
 * @param {object} payload
 * @param {string} payload.bloodGroup (e.g. 'O-')
 * @param {number} payload.availableUnits
 * @param {number} payload.threshold
 * @param {string} [payload.recipient='manager@bbms.test']
 * @param {string} [payload.channel='EMAIL']
 * @returns {Promise<{ success: boolean, notificationId: string, timestamp: string }>}
 */
async function sendLowStockAlert({
  bloodGroup,
  availableUnits,
  threshold,
  recipient = 'manager@bbms.test',
  channel = 'EMAIL',
} = {}) {
  const notificationId = `NOTIF-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const record = {
    notificationId,
    bloodGroup,
    availableUnits,
    threshold,
    recipient,
    channel,
    timestamp: new Date().toISOString(),
    status: 'DELIVERED',
  };

  dispatchedAlerts.push(record);

  return {
    success: true,
    notificationId,
    timestamp: record.timestamp,
  };
}

/**
 * Retrieves all dispatched alerts (for testing / inspection).
 * @returns {Array<object>}
 */
function getDispatchedAlerts() {
  return [...dispatchedAlerts];
}

/**
 * Clears the in-memory dispatch history (for test isolation).
 */
function clearDispatchedAlerts() {
  dispatchedAlerts = [];
}

module.exports = {
  sendLowStockAlert,
  getDispatchedAlerts,
  clearDispatchedAlerts,
};
