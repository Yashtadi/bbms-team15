import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import './DonorCard.css';

/**
 * Formats YYYY-MM-DD into human readable date without local timezone offset shift.
 */
function formatDate(dateStr) {
  if (!dateStr) return 'Not Specified';
  try {
    const str = String(dateStr).trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
    if (match) {
      const [, year, month, day] = match;
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthIdx = parseInt(month, 10) - 1;
      return `${day} ${monthNames[monthIdx] || month} ${year}`;
    }
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return String(dateStr);
  }
}

/**
 * Formats Government ID proof to ONLY display the last 4 characters.
 * e.g. 385859302 -> ****9302, AADHAAR-1234-5678 -> ****5678
 */
function formatMaskedIdProof(idVal) {
  if (!idVal) return 'N/A';
  const str = String(idVal).trim();
  const digitsAfterStars = str.match(/\*+([a-zA-Z0-9]+)$/);
  if (digitsAfterStars) {
    return `****${digitsAfterStars[1].slice(-4)}`;
  }
  const alnum = str.replace(/[^a-zA-Z0-9]/g, '');
  if (alnum.length <= 4) {
    return alnum ? `****${alnum}` : '****';
  }
  return `****${alnum.slice(-4)}`;
}

export default function DonorCard({
  donor = {},
  showActions = true,
}) {
  const barcodeRef = useRef(null);

  const donorCode = donor.donorCode || donor.donorId || 'D-000000';
  const fullName = donor.fullName || donor.name || 'Registered Donor';
  const VALID_BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
  const rawBloodGroup = donor.bloodGroup ? String(donor.bloodGroup).trim().toUpperCase() : '';
  const hasBloodGroup = VALID_BLOOD_GROUPS.includes(rawBloodGroup);
  const bloodGroup = hasBloodGroup ? rawBloodGroup : null;
  const phone = donor.phone || donor.contact || 'N/A';
  const dateOfBirth = donor.dateOfBirth;
  const rawIdProof = donor.maskedIdProof || donor.idProof || '';
  const maskedIdProof = formatMaskedIdProof(rawIdProof);

  useEffect(() => {
    if (barcodeRef.current && donorCode) {
      try {
        JsBarcode(barcodeRef.current, donorCode, {
          format: 'CODE128',
          displayValue: false,
          width: 1.6,
          height: 38,
          margin: 0,
          background: '#ffffff',
          lineColor: '#000000',
        });
      } catch {
        // Fallback gracefully if barcode render fails
      }
    }
  }, [donorCode]);

  /**
   * Dedicated Iframe Print:
   * Prints ONLY the card isolated in its own document, ensuring no dashboard or page elements print!
   */
  const handlePrint = () => {
    const cardEl = document.getElementById(`donor-card-${donorCode}`);
    if (!cardEl) {
      window.print();
      return;
    }

    const printFrame = document.createElement('iframe');
    printFrame.style.position = 'fixed';
    printFrame.style.top = '-10000px';
    printFrame.style.left = '-10000px';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = 'none';
    document.body.appendChild(printFrame);

    const doc = printFrame.contentWindow.document;
    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Donor Card - ${donorCode}</title>
          <style>
            @page {
              size: auto;
              margin: 8mm;
            }
            * {
              box-sizing: border-box;
              margin: 0;
              padding: 0;
              font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }
            body {
              background: #ffffff;
              color: #111827;
              display: flex;
              justify-content: center;
              align-items: flex-start;
              padding: 5mm;
            }
            .bbms-donor-card {
              width: 85.6mm !important;
              min-height: 54mm !important;
              border-radius: 6px;
              background: #ffffff;
              color: #111827;
              border: 1.5px solid #111827;
              overflow: hidden;
              display: flex;
              flex-direction: column;
            }
            .bbms-card-header {
              background: #0f172a !important;
              color: #ffffff !important;
              padding: 3mm 4mm 2.5mm;
              display: flex;
              justify-content: space-between;
              align-items: center;
              border-bottom: 2px solid #e63946;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            .card-brand-title {
              font-size: 7.5pt;
              font-weight: 800;
              color: #ffffff !important;
              display: block;
            }
            .card-brand-subtitle {
              font-size: 6pt;
              color: #94a3b8 !important;
              display: block;
            }
            .bbms-card-body {
              display: flex;
              padding: 3mm 4mm 2mm;
              gap: 3.5mm;
              background: #ffffff;
            }
            .bbms-card-avatar-col {
              display: flex;
              flex-direction: column;
              align-items: center;
              width: 20mm;
              flex-shrink: 0;
              gap: 1.5mm;
            }
            .donor-avatar-circle {
              width: 13mm;
              height: 13mm;
              border-radius: 50%;
              background: #e2e8f0;
              color: #1e293b;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 13pt;
              font-weight: 800;
              border: 1.5px solid #94a3b8;
            }
            .blood-group-badge {
              background: #e63946 !important;
              color: #ffffff !important;
              font-weight: 900;
              font-size: 9.5pt;
              padding: 1mm 2mm;
              border-radius: 4px;
              width: 100%;
              text-align: center;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            .blood-group-label {
              font-size: 5pt;
              text-transform: uppercase;
              color: #64748b;
              font-weight: 700;
            }
            .bbms-card-info-col {
              display: flex;
              flex-direction: column;
              gap: 1.2mm;
              flex-grow: 1;
            }
            .card-label {
              font-size: 5pt;
              text-transform: uppercase;
              color: #64748b;
              font-weight: 700;
              display: block;
            }
            .card-value {
              font-size: 7pt;
              color: #0f172a;
              font-weight: 600;
              display: block;
            }
            .card-name-val {
              font-size: 9pt;
              font-weight: 800;
              color: #111827;
            }
            .card-id-val {
              font-family: monospace;
              font-size: 8pt;
              font-weight: 800;
              color: #b91c1c !important;
            }
            .card-consent-val {
              color: #16a34a !important;
              font-weight: 700;
            }
            .card-grid-2col {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 1.5mm;
            }
            .bbms-card-barcode-section {
              display: flex;
              flex-direction: column;
              align-items: center;
              padding: 2mm 3mm 1mm;
              background: #f8fafc;
              border-top: 1px dashed #cbd5e1;
            }
            .card-barcode-svg {
              display: block;
              max-width: 42mm;
              height: 7mm;
            }
            .card-barcode-text {
              font-family: monospace;
              font-size: 6.5pt;
              font-weight: 700;
              color: #334155;
            }
            .bbms-card-footer {
              background: #f1f5f9;
              border-top: 1px solid #e2e8f0;
              padding: 1.5mm 3mm;
              text-align: center;
              font-size: 5pt;
              color: #475569;
            }
            .portal-notice strong {
              color: #0f172a;
            }
          </style>
        </head>
        <body>
          ${cardEl.outerHTML}
        </body>
      </html>
    `);
    doc.close();

    printFrame.contentWindow.focus();
    setTimeout(() => {
      printFrame.contentWindow.print();
      setTimeout(() => {
        if (document.body.contains(printFrame)) {
          document.body.removeChild(printFrame);
        }
      }, 1500);
    }, 250);
  };

  /**
   * High-Resolution 2X PNG Image Download
   */
  const handleDownloadPng = async () => {
    const cardEl = document.getElementById(`donor-card-${donorCode}`);
    if (!cardEl) return;

    try {
      const scale = 2;
      const width = 440;
      const height = 270;
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);

      // Card outer clip with rounded corners
      const radius = 14;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(radius, 0);
      ctx.lineTo(width - radius, 0);
      ctx.quadraticCurveTo(width, 0, width, radius);
      ctx.lineTo(width, height - radius);
      ctx.quadraticCurveTo(width, height, width - radius, height);
      ctx.lineTo(radius, height);
      ctx.quadraticCurveTo(0, height, 0, height - radius);
      ctx.lineTo(0, radius);
      ctx.quadraticCurveTo(0, 0, radius, 0);
      ctx.closePath();
      ctx.clip();

      // White background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      // Header strip
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, width, 46);
      ctx.fillStyle = '#e63946';
      ctx.fillRect(0, 46, width, 3);

      // Header texts
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
      ctx.fillText('BLOOD BANK MANAGEMENT SYSTEM', 16, 22);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px system-ui, -apple-system, sans-serif';
      ctx.fillText('Team 15 · Official Donor Identification', 16, 36);

      // Header Drop Icon (circular badge + SVG blood droplet)
      ctx.save();
      const iconCenterX = width - 24;
      const iconCenterY = 23;
      ctx.fillStyle = 'rgba(230, 57, 70, 0.2)';
      ctx.beginPath();
      ctx.arc(iconCenterX, iconCenterY, 14, 0, Math.PI * 2);
      ctx.fill();

      // Render the blood droplet icon
      ctx.translate(iconCenterX - 11, iconCenterY - 11);
      ctx.scale(22 / 24, 22 / 24);
      ctx.fillStyle = '#e63946';
      if (typeof Path2D !== 'undefined') {
        const dropPath = new Path2D('M12 2.5c-3.6 4.7-6.5 8.4-6.5 11.7a6.5 6.5 0 0 0 13 0c0-3.3-2.9-7-6.5-11.7z');
        ctx.fill(dropPath);
      } else {
        ctx.beginPath();
        ctx.moveTo(12, 2.5);
        ctx.bezierCurveTo(8.4, 7.2, 5.5, 10.9, 5.5, 14.2);
        ctx.arc(12, 14.2, 6.5, Math.PI, 0, true);
        ctx.bezierCurveTo(18.5, 10.9, 15.6, 7.2, 12, 2.5);
        ctx.fill();
      }
      ctx.restore();

      // Avatar circle
      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.arc(52, 94, 25, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#1e293b';
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(fullName ? fullName[0].toUpperCase() : 'D', 52, 101);

      // Blood Group Badge (Only if verified/assigned blood group exists)
      if (hasBloodGroup) {
        ctx.fillStyle = '#e63946';
        ctx.beginPath();
        ctx.roundRect(16, 128, 72, 26, 6);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 15px system-ui, sans-serif';
        ctx.fillText(bloodGroup, 52, 146);

        ctx.fillStyle = '#64748b';
        ctx.font = 'bold 9px system-ui, sans-serif';
        ctx.fillText('BLOOD GROUP', 52, 166);
      }

      // Right Column: Details
      ctx.textAlign = 'left';
      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 9px system-ui, sans-serif';
      ctx.fillText('DONOR NAME', 110, 68);

      ctx.fillStyle = '#111827';
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.fillText(fullName, 110, 86);

      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 9px system-ui, sans-serif';
      ctx.fillText('PERMANENT DONOR ID', 110, 104);

      ctx.fillStyle = '#b91c1c';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(donorCode, 110, 120);

      // Grid: DOB & Phone
      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 9px system-ui, sans-serif';
      ctx.fillText('DATE OF BIRTH', 110, 138);
      ctx.fillText('PHONE', 260, 138);

      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillText(formatDate(dateOfBirth), 110, 152);
      ctx.fillText(phone, 260, 152);

      // Govt ID & Consent
      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 9px system-ui, sans-serif';
      ctx.fillText('GOVT ID PROOF', 110, 168);
      ctx.fillText('CONSENT', 260, 168);

      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillText(maskedIdProof, 110, 182);

      ctx.fillStyle = '#16a34a';
      ctx.fillText('Verified ✓', 260, 182);

      // Barcode Strip
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 192, width, 46);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, 192);
      ctx.lineTo(width, 192);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw barcode image if available
      if (barcodeRef.current) {
        const svgXml = new XMLSerializer().serializeToString(barcodeRef.current);
        const barcodeBlob = new Blob([svgXml], { type: 'image/svg+xml;charset=utf-8' });
        const barcodeUrl = URL.createObjectURL(barcodeBlob);
        const barcodeImg = new Image();
        await new Promise((resolve) => {
          barcodeImg.onload = () => {
            ctx.drawImage(barcodeImg, (width - 180) / 2, 196, 180, 24);
            URL.revokeObjectURL(barcodeUrl);
            resolve();
          };
          barcodeImg.onerror = () => {
            URL.revokeObjectURL(barcodeUrl);
            resolve();
          };
          barcodeImg.src = barcodeUrl;
        });
      }

      ctx.fillStyle = '#334155';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(donorCode, width / 2, 230);

      // Footer notice
      ctx.fillStyle = '#f1f5f9';
      ctx.fillRect(0, 238, width, 32);
      ctx.strokeStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.moveTo(0, 238);
      ctx.lineTo(width, 238);
      ctx.stroke();

      ctx.fillStyle = '#475569';
      ctx.font = '9px system-ui, sans-serif';
      ctx.fillText('Online Portal: portal.pes.edu · Use your Donor ID to log in', width / 2, 250);
      ctx.fillText('24/7 Helpline: 1800-BLOOD-PES', width / 2, 262);

      // Border outline
      ctx.restore();
      ctx.strokeStyle = '#d1d5db';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(1, 1, width - 2, height - 2, radius);
      ctx.stroke();

      // Download as PNG
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `DonorCard_${donorCode}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 'image/png');
    } catch {
      // Fallback
    }
  };

  return (
    <div className="bbms-donor-card-container">
      {showActions && (
        <div className="donor-card-actions no-print">
          <button type="button" className="btn-print-card" onClick={handlePrint}>
            Print Donor Card
          </button>
          <button type="button" className="btn-download-card" onClick={handleDownloadPng}>
            Download PNG Card
          </button>
        </div>
      )}

      {/* Official Physical / Wallet ID Card */}
      <div
        id={`donor-card-${donorCode}`}
        className="bbms-donor-card"
        data-testid="donor-card"
      >
        {/* Card Header Strip */}
        <div className="bbms-card-header">
          <div className="bbms-card-brand">
            <span className="card-brand-title">BLOOD BANK MANAGEMENT SYSTEM</span>
            <span className="card-brand-subtitle">Team 15 · Official Donor Identification</span>
          </div>
          <div className="card-drop-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="#e63946" aria-hidden="true">
              <path d="M12 2.5c-3.6 4.7-6.5 8.4-6.5 11.7a6.5 6.5 0 0 0 13 0c0-3.3-2.9-7-6.5-11.7z" />
            </svg>
          </div>
        </div>

        {/* Card Body */}
        <div className="bbms-card-body">
          {/* Left Column: Avatar & Blood Group */}
          <div className="bbms-card-avatar-col">
            <div className="donor-avatar-circle">
              {fullName ? fullName[0].toUpperCase() : 'D'}
            </div>
            {hasBloodGroup && (
              <>
                <div
                  className="blood-group-badge"
                  data-testid="card-blood-group"
                >
                  {bloodGroup}
                </div>
                <span className="blood-group-label">Blood Group</span>
              </>
            )}
          </div>

          {/* Right Column: Donor Data Grid */}
          <div className="bbms-card-info-col">
            <div className="card-info-group">
              <span className="card-label">Donor Name</span>
              <strong className="card-value card-name-val" data-testid="card-donor-name">
                {fullName}
              </strong>
            </div>

            <div className="card-info-group">
              <span className="card-label">Permanent Donor ID</span>
              <strong className="card-value card-id-val" data-testid="donor-id">
                {donorCode}
              </strong>
            </div>

            <div className="card-grid-2col">
              <div className="card-info-group">
                <span className="card-label">Date of Birth</span>
                <span className="card-value">{formatDate(dateOfBirth)}</span>
              </div>
              <div className="card-info-group">
                <span className="card-label">Phone</span>
                <span className="card-value">{phone}</span>
              </div>
            </div>

            <div className="card-grid-2col">
              <div className="card-info-group">
                <span className="card-label">Govt ID Proof</span>
                <span className="card-value">{maskedIdProof}</span>
              </div>
              <div className="card-info-group">
                <span className="card-label">Consent</span>
                <span className="card-value card-consent-val">Verified ✓</span>
              </div>
            </div>
          </div>
        </div>

        {/* Barcode Strip */}
        <div className="bbms-card-barcode-section">
          <svg
            ref={barcodeRef}
            className="card-barcode-svg"
            role="img"
            aria-label={`Barcode for ${donorCode}`}
          />
          <span className="card-barcode-text">{donorCode}</span>
        </div>

        {/* Card Footer / Portal Access Details (No password shown) */}
        <div className="bbms-card-footer">
          <div className="portal-notice">
            <span>Online Portal: <strong>portal.pes.edu</strong> · Log in with your Donor ID</span>
          </div>
          <div className="helpline-notice">
            <span>24/7 Helpline: 1800-BLOOD-PES</span>
          </div>
        </div>
      </div>
    </div>
  );
}
