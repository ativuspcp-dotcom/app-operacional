import QrScanner from 'qr-scanner';

// Leitor de QR Code pela câmera do aparelho (tela cheia). Usa o detector nativo do navegador quando existe e um
// leitor próprio quando não (Android e iOS). Exige HTTPS (o app em produção já é) e a permissão da câmera.
// Devolve o texto do QR lido, ou null se a pessoa cancelou / a câmera não abriu (a tela mostra o motivo).

const CSS_OVERLAY = 'position: fixed; inset: 0; z-index: 10000; background: #000; display: flex; flex-direction: column;';

function mensagemDoErro(err) {
  const nome = err?.name || String(err);
  if (nome === 'NotAllowedError' || String(err).includes('Permission')) {
    return 'A câmera está bloqueada. Permita o uso da câmera para este app nas configurações do navegador e tente de novo.';
  }
  if (nome === 'NotFoundError' || String(err).includes('No camera')) return 'Este aparelho não tem câmera disponível.';
  if (nome === 'NotReadableError') return 'A câmera está em uso por outro aplicativo. Feche-o e tente de novo.';
  return 'Não foi possível abrir a câmera.';
}

export function lerQrComCamera({ titulo = 'Aponte a câmera para o QR Code' } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = CSS_OVERLAY;
    overlay.innerHTML = `
      <div style="padding: 14px 16px; color: white; font-weight: 700; font-size: 1.05rem; display: flex; justify-content: space-between; align-items: center; gap: 12px;">
        <span>${titulo}</span>
        <button type="button" id="cam-fechar" style="background: #ef4444; color: white; border: none; border-radius: 8px; padding: 10px 18px; font-size: 1rem; font-weight: 700;">Cancelar</button>
      </div>
      <div style="flex: 1; min-height: 0; position: relative;">
        <video id="cam-video" playsinline muted style="width: 100%; height: 100%; object-fit: cover;"></video>
      </div>
      <div id="cam-msg" style="padding: 14px 16px; color: white; text-align: center; font-size: 0.95rem; min-height: 48px;">Abrindo a câmera...</div>
    `;
    document.body.appendChild(overlay);

    const video = overlay.querySelector('#cam-video');
    const msg = overlay.querySelector('#cam-msg');
    let scanner = null;
    let finalizado = false;

    const finalizar = (valor) => {
      if (finalizado) return;
      finalizado = true;
      document.removeEventListener('keydown', aoTeclar);
      try { scanner?.stop(); scanner?.destroy(); } catch (_) { /* já parado */ }
      overlay.remove();
      resolve(valor);
    };

    const aoTeclar = (e) => { if (e.key === 'Escape') finalizar(null); };
    document.addEventListener('keydown', aoTeclar);
    overlay.querySelector('#cam-fechar').addEventListener('click', () => finalizar(null));

    (async () => {
      try {
        if (!(await QrScanner.hasCamera())) {
          msg.textContent = 'Este aparelho não tem câmera disponível.';
          return;
        }
        scanner = new QrScanner(
          video,
          (resultado) => {
            try { navigator.vibrate?.(120); } catch (_) { /* opcional */ }
            finalizar(String(resultado.data || '').trim());
          },
          {
            preferredCamera: 'environment',
            highlightScanRegion: true,
            highlightCodeOutline: true,
            maxScansPerSecond: 8,
            returnDetailedScanResult: true
          }
        );
        await scanner.start();
        msg.textContent = 'Centralize o QR Code na tela.';
      } catch (err) {
        console.error('Erro ao abrir a câmera:', err);
        msg.textContent = mensagemDoErro(err);
      }
    })();
  });
}
