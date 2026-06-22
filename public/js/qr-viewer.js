/**
 * AUD-04 — Script QR viewer externalisé (retrait unsafe-inline CSP)
 * Les données dynamiques sont passées via data-* sur le conteneur.
 */
(function () {
  const container = document.getElementById('qr-container');
  if (!container) return;

  const qrData   = atob(container.dataset.qrb64);
  const ref      = container.dataset.ref;

  try {
    new QRCode(container, {
      text:         qrData,
      width:        200,
      height:       200,
      colorDark:    '#1e293b',
      colorLight:   '#ffffff',
      correctLevel: QRCode.CorrectLevel.H,
    });
  } catch (e) {
    const errP = document.createElement('p');
    errP.style.cssText = 'color:#ef4444;font-size:0.8rem';
    errP.textContent   = 'Erreur QR';
    container.appendChild(errP);
  }

  const btnDl = document.getElementById('btn-dl');
  if (btnDl) {
    btnDl.addEventListener('click', () => {
      setTimeout(() => {
        const canvas = container.querySelector('canvas');
        if (!canvas) { alert('QR non disponible'); return; }
        const link    = document.createElement('a');
        link.download = `komerce-qr-${ref}.png`;
        link.href     = canvas.toDataURL('image/png');
        link.click();
      }, 200);
    });
  }
}());
