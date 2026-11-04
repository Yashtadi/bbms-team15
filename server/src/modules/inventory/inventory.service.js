const inventoryRepository = require('./inventory.repository');

// BBMS-F-030: real-time stock summary for the inventory dashboard.
// Returns releasable stock per blood group and component, plus overall totals.
// generatedAt tells the dashboard how fresh the numbers are (AC: changes visible within 5 s).
async function getStockSummary({ now = new Date() } = {}) {
  const rows = await inventoryRepository.summarizeAvailable();

  const stock = rows.map((row) => ({
    bloodGroup: row.blood_group,
    component: row.component,
    units: Number(row.units),
    volumeMl: Number(row.volume_ml), // MySQL returns SUM() as a string
    nextExpiry: row.next_expiry,
  }));

  const totals = stock.reduce(
    (sum, entry) => ({
      units: sum.units + entry.units,
      volumeMl: sum.volumeMl + entry.volumeMl,
      nextExpiry:
        sum.nextExpiry === null || new Date(entry.nextExpiry) < new Date(sum.nextExpiry)
          ? entry.nextExpiry
          : sum.nextExpiry,
    }),
    { units: 0, volumeMl: 0, nextExpiry: null }
  );

  return { generatedAt: now.toISOString(), totals, stock };
}

module.exports = { getStockSummary };
