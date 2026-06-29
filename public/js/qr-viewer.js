/**
 * @komerce-arch-lite
 * @role          platform-qr-viewer
 * @domain        platform
 * @layer         infrastructure
 * @owner         dashboards
 * @purpose       Lecteur/afficheur QR code pour scan colis et validation.
 * @impact-areas  platform
 * @version       2026-06
 */
// AUD-04: script QR externalisé depuis routes/orders/qr.js (retrait unsafe-inline CSP)
(function () {
  const dataEl = document.getElementById('qr-data');
  if (!dataEl) return;

  const qrData = atob(dataEl.dataset.qrb64 || '');
  const ref = dataEl.dataset.ref || '';
  const container = document.getElementById('qr-container');

  try {
    new QRCode(container, {
      text: qrData,
      width: 200, height: 200,
      colorDark: '#1e293b', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.H
    });
  } catch (e) {
    // Pas d'innerHTML avec des données utilisateur — contenu statique via createElement (coffre-fort v1.0)
    const errP = document.createElement('p');
    errP.style.cssText = 'color:#ef4444;font-size:0.8rem';
    errP.textContent = 'Erreur QR';
    container.appendChild(errP);
  }

  // Téléchargement via canvas
  const btnDl = document.getElementById('btn-dl');
  if (btnDl) {
    btnDl.addEventListener('click', () => {
      setTimeout(() => {
        const canvas = container.querySelector('canvas');
        if (!canvas) { alert('QR non disponible'); return; }
        const link = document.createElement('a');
        link.download = 'komerce-qr-' + ref + '.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
      }, 200);
    });
  }
})();
