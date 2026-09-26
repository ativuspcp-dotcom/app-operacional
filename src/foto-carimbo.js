// Foto pela câmera nativa do aparelho, com carimbo de data/hora no rodapé da própria imagem, redimensionada e
// comprimida (JPEG) para não pesar no Storage. Usa <input capture> (câmera do sistema: foco, toque para focar e
// qualidade melhores para ler a trena do que uma câmera aberta pelo navegador).
// Devolve { blob, capturadaEm } ou null se a pessoa cancelou. O carimbo usa o relógio do aparelho no momento em que
// a foto chega ao app; o instante também é guardado em capturadaEm (vai para o banco como foto_em).

const LADO_MAX = 1024; // px do lado maior (reduzido de 1280 em 2026-09-26: retenção de 60 dias, ver PLANO_RQ03.md)
// 0,45 (reduzido de 0,55 em 2026-09-26, medido em 51 KB/foto em média): resolução mantida de propósito
// (protege a legibilidade da trena/termômetro na foto); só a qualidade JPEG desce. Se a foto ficar ruim
// pra ler, subir esse número; se quiser reduzir mais, mexer aqui antes de mexer em LADO_MAX.
const QUALIDADE_JPEG = 0.45;

const pad = (n) => String(n).padStart(2, '0');
const fmtCarimbo = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

function escolherArquivo() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.addEventListener('change', () => resolve(input.files?.[0] || null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}

function carregarImagem(arquivo) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível ler a foto.')); };
    img.src = url; // o navegador aplica a orientação EXIF ao desenhar no canvas
  });
}

/**
 * @param {{ rotulo?: string }} opcoes rotulo: texto curto impresso junto da data (ex.: "Lâmina 2 · Comprimento 1")
 */
export async function capturarFotoComCarimbo({ rotulo = '' } = {}) {
  const arquivo = await escolherArquivo();
  if (!arquivo) return null;

  const agora = new Date();
  const img = await carregarImagem(arquivo);

  const escala = Math.min(1, LADO_MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * escala);
  const h = Math.round(img.naturalHeight * escala);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);

  // Faixa escura no rodapé com data/hora (e rótulo); a fonte encolhe se o texto não couber na largura
  const texto = rotulo ? `${fmtCarimbo(agora)}  ·  ${rotulo}` : fmtCarimbo(agora);
  let fonte = Math.max(16, Math.round(Math.min(w, h) * 0.04));
  ctx.font = `bold ${fonte}px sans-serif`;
  while (ctx.measureText(texto).width > w - 24 && fonte > 10) {
    fonte -= 1;
    ctx.font = `bold ${fonte}px sans-serif`;
  }
  const faixa = Math.round(fonte * 1.9);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
  ctx.fillRect(0, h - faixa, w, faixa);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(texto, 12, h - faixa / 2);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALIDADE_JPEG));
  if (!blob) throw new Error('Não foi possível processar a foto.');
  return { blob, capturadaEm: agora.toISOString() };
}
