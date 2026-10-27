import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import './UnitLabel.css';

// BBMS-F-012: printable blood-unit label. The barcode encodes exactly the unit ID, which
// is also printed underneath so it can be typed if a scan fails.

const COMPONENT_NAMES = {
  WHOLE_BLOOD: 'Whole Blood',
  PRBC: 'PRBC',
  FFP: 'FFP',
  PLATELETS: 'Platelets',
  CRYO: 'Cryo',
};

// e.g. 27 Oct 2026: the month name avoids DD/MM vs MM/DD mix-ups
function formatDate(value) {
  return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function UnitLabel({ unit }) {
  const svgRef = useRef(null);
  const { format, value } = unit.barcode;

  useEffect(() => {
    // displayValue: false, because the unit ID is printed as text below the barcode
    JsBarcode(svgRef.current, value, { format, displayValue: false, width: 2, height: 56, margin: 0 });
  }, [format, value]);

  const isPending = unit.bloodGroup === 'PENDING';

  return (
    <div className="unit-label" data-testid="unit-label">
      <div className="unit-label-header">
        <span>BBMS BLOOD UNIT</span>
        <span data-testid="label-component">{COMPONENT_NAMES[unit.component] || unit.component}</span>
      </div>

      <svg
        ref={svgRef}
        className="unit-label-barcode"
        role="img"
        aria-label={`Barcode for ${value}`}
        data-testid="unit-barcode"
      />
      <div className="unit-label-id" data-testid="label-unit-id">{unit.unitId}</div>

      <dl className="unit-label-fields">
        <div>
          <dt>Blood group</dt>
          <dd
            className={isPending ? 'unit-label-group unit-label-group-pending' : 'unit-label-group'}
            data-testid="label-blood-group"
          >
            {unit.bloodGroup}
          </dd>
        </div>
        <div>
          <dt>Collected</dt>
          <dd data-testid="label-collected">{formatDate(unit.collectedAt)}</dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd data-testid="label-expires">{formatDate(unit.expiresAt)}</dd>
        </div>
      </dl>
    </div>
  );
}
