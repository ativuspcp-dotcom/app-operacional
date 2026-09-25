import { supabase } from './supabase.js';
import { currentBPLID, withTimeout, rawRpc, podeAgir } from './main.js';
import { headerHtml, bindHeader, renderErro, toggleHtml, SPINNER } from './setup-secadores.js';
import { fmtBitola, fmtMedida, esc } from './lamina-seca.js';

const SLUG = 'app_consumo_serra';
const MAX_HISTORICO = 8;
const STORAGE_SERRA = 'consumo_serra_local';

// Consumo da Serra: sem setup e sem PIN. A estação escolhe a serra (SERRA 1 / SERRA 2 = local do consumo) e bipa
// o QR Code (LS<yy>-<n>) de uma lâmina seca; a função do banco consumir_lamina_seca marca a saída da lâmina e
// registra o consumo naquela serra. Se a etiqueta não existe, é da Serra ou já foi consumida, a tela avisa e
// nada é gravado.

let historico = []; // últimos consumos desta sessão (só para conferência visual)

// Serra escolhida por último neste aparelho (a estação costuma ficar sempre na mesma serra).
function lerSerraSalva() {
  try { return localStorage.getItem(STORAGE_SERRA); } catch (_) { return null; }
}
function salvarSerra(nome) {
  try { localStorage.setItem(STORAGE_SERRA, nome); } catch (_) { /* opcional */ }
}

// Avisos sonoros curtos (chão de fábrica é barulhento, então a cor grande da tela é o aviso principal).
function beep(ok) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = ok ? 880 : 220;
    gain.gain.value = 0.15;
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.12 : 0.6));
    osc.onended = () => ctx.close();
  } catch (_) { /* som é opcional */ }
  try { if (!ok) navigator.vibrate?.(300); } catch (_) { /* vibração é opcional */ }
}

function fmtDataHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} às ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const fmtTotal = (v) => (v === null || v === undefined ? '-' : Number(v).toFixed(4).replace('.', ','));

function cartaoResultado(r) {
  const base = 'padding: 20px; border-radius: 12px; margin-top: 16px; text-align: center;';
  const titulo = (texto, cor) => `<div style="font-size: 1.6rem; font-weight: 800; color: ${cor}; margin-bottom: 8px;">${texto}</div>`;
  const linha = (rotulo, valor) => `<div><span style="color: var(--color-text-sec); font-size: 0.8rem;">${rotulo}</span><br><strong>${valor}</strong></div>`;

  if (r.status === 'OK') {
    return `
      <div style="${base} background: #ecfdf5; border: 3px solid #10b981;">
        ${titulo('✓ CONSUMIDA', '#059669')}
        <div style="font-size: 0.95rem; font-weight: 700; margin-bottom: 6px;">${esc(r.serra)}</div>
        <div style="font-family: monospace; font-size: 1.1rem; margin-bottom: 4px;">${esc(r.qrcode)}</div>
        <div style="font-size: 0.85rem; color: var(--color-text-sec);">${esc(r.cod_item || 'S/N')}</div>
        <div style="font-weight: 700; font-size: 1.05rem; margin-bottom: 12px;">${esc(r.item || '-')}</div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px;">
          ${linha('Espécie', esc(r.especie))}
          ${linha('Bitola', `${fmtBitola(r.bitola)} mm`)}
          ${linha('Medida', `${fmtMedida(r.comprimento)} × ${fmtMedida(r.largura)}`)}
          ${linha('Total', `${fmtTotal(r.total)} m³`)}
        </div>
      </div>`;
  }

  let titulo1 = 'ERRO';
  let detalhe = '';
  if (r.status === 'JA_CONSUMIDA') {
    titulo1 = 'JÁ CONSUMIDA';
    detalhe = `<div style="font-family: monospace; font-size: 1.1rem;">${esc(r.qrcode)}</div>
      <div style="font-weight: 600;">${esc(r.item || '')}</div>
      <div style="font-size: 0.9rem; margin-top: 6px;">${r.data_consumo ? `Consumida em ${fmtDataHora(r.data_consumo)}${r.serra ? ` na ${esc(r.serra)}` : ''}${r.consumido_por ? ` por ${esc(r.consumido_por)}` : ''}.` : 'Esta lâmina já teve saída.'}</div>`;
  } else if (r.status === 'NAO_ENCONTRADA') {
    titulo1 = 'ETIQUETA NÃO ENCONTRADA';
    detalhe = `<div style="font-family: monospace; font-size: 1.1rem;">${esc(r.qrcode)}</div>
      <div style="font-size: 0.9rem; margin-top: 6px;">Não existe lâmina seca com esse QR Code.</div>`;
  } else if (r.status === 'ETIQUETA_SERRA') {
    titulo1 = 'ETIQUETA DA SERRA';
    detalhe = `<div style="font-family: monospace; font-size: 1.1rem;">${esc(r.qrcode)}</div>
      <div style="font-size: 0.9rem; margin-top: 6px;">Esta etiqueta é de uma produção da Serra, não de uma lâmina seca da Secagem.</div>`;
  } else if (r.status === 'SERRA_INVALIDA') {
    titulo1 = 'SERRA INVÁLIDA';
    detalhe = `<div style="font-size: 0.9rem;">Escolha a serra (botões acima) e bipe de novo.</div>`;
  } else if (r.status === 'FALHA') {
    titulo1 = 'FALHA AO CONSULTAR';
    detalhe = `<div style="font-size: 0.9rem;">${esc(r.mensagem)}</div>`;
  }

  return `
    <div style="${base} background: #fef2f2; border: 3px solid #ef4444;">
      ${titulo(titulo1, '#dc2626')}
      ${detalhe}
    </div>`;
}

function historicoHtml() {
  if (historico.length === 0) return '';
  return `
    <div style="margin-top: 20px;">
      <div style="font-size: 0.8rem; color: var(--color-text-sec); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Últimos consumos desta sessão</div>
      ${historico.map(h => `
        <div style="display: flex; justify-content: space-between; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--color-border); font-size: 0.85rem;">
          <span style="font-family: monospace; font-weight: 600;">${esc(h.qrcode)}</span>
          <span style="font-weight: 600;">${esc(h.serra)}</span>
          <span style="flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(h.item || '')}</span>
          <span>${fmtTotal(h.total)}</span>
        </div>`).join('')}
    </div>`;
}

export async function renderConsumoSerra(container) {
  container.innerHTML = `
    ${headerHtml('Consumo Serra', '/')}
    <div class="container mt-4" id="cs-content">
      <div class="text-center" style="padding: 40px;">${SPINNER}</div>
    </div>
  `;
  bindHeader();

  // Serras da filial (sequencial: o supabase-js trava com várias chamadas simultâneas)
  let serras;
  try {
    const { data, error } = await withTimeout(
      supabase.from('pcp_serras').select('nome').eq('bpl_id', currentBPLID).eq('ativo', true).order('nome'),
      10000
    );
    if (error) throw error;
    serras = (data || []).map(s => s.nome);
  } catch (err) {
    console.error('Erro ao carregar as serras:', err);
    const content = document.getElementById('cs-content');
    if (content) renderErro(content, 'Erro ao carregar as serras. Verifique a conexão.');
    return;
  }

  const content = document.getElementById('cs-content');
  if (!content) return;

  if (serras.length === 0) {
    content.innerHTML = `<div style="background: white; padding: 24px; border-radius: 12px; text-align: center; color: var(--color-text-sec);">Nenhuma serra cadastrada nesta filial.</div>`;
    return;
  }

  const podeConsumir = podeAgir(SLUG);
  let serraSelecionada = serras.includes(lerSerraSalva()) ? lerSerraSalva() : null;

  content.innerHTML = `
    <div style="background: white; padding: 24px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
      ${!podeConsumir ? '<div class="text-center error-text mb-4">Somente visualização: seu acesso não permite registrar consumo.</div>' : ''}
      <div class="form-group">
        <label class="form-label" style="font-size: 1rem;">Local do consumo <span class="required">*</span></label>
        ${toggleHtml('cs-serra', serras, serraSelecionada, o => o)}
      </div>
      <label class="form-label" for="cs-qrcode" style="font-size: 1rem;">Bipe a etiqueta (QR Code) da lâmina</label>
      <input type="text" id="cs-qrcode" class="form-input" placeholder="${serraSelecionada ? 'LS26-1' : 'Escolha a serra acima'}" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" data-lpignore="true" data-1p-ignore data-bwignore style="font-size: 1.6rem; height: 64px; text-align: center; font-family: monospace; letter-spacing: 2px; text-transform: uppercase;" ${podeConsumir && serraSelecionada ? '' : 'disabled'}>
      <div id="cs-resultado"></div>
      <div id="cs-historico">${historicoHtml()}</div>
    </div>
  `;

  if (!podeConsumir) {
    content.querySelectorAll('button').forEach(b => { b.disabled = true; });
    return;
  }

  const input = document.getElementById('cs-qrcode');
  const resultado = document.getElementById('cs-resultado');
  const historicoEl = document.getElementById('cs-historico');
  const grupoSerra = document.getElementById('cs-serra');
  let processando = false;

  const focar = () => { if (!input.disabled) input.focus(); };
  focar();

  // Escolha da serra: destaca o botão, libera o campo e já deixa pronto para bipar
  grupoSerra.addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    grupoSerra.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    serraSelecionada = btn.dataset.val;
    salvarSerra(serraSelecionada);
    resultado.innerHTML = '';
    input.disabled = false;
    input.placeholder = 'LS26-1';
    focar();
  });

  // Se o foco cair no vazio (toque na área da tela), volta para o campo: a estação só serve para bipar.
  // Não mexe quando o foco foi para outro controle (botões das serras, seletor de filial, botão voltar).
  input.addEventListener('blur', () => {
    setTimeout(() => {
      const ativo = document.activeElement;
      if (document.getElementById('cs-qrcode') === input && (!ativo || ativo === document.body)) focar();
    }, 150);
  });

  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();

    const qrcode = input.value.trim();
    if (!qrcode || processando) return;

    if (!serraSelecionada) {
      resultado.innerHTML = cartaoResultado({ status: 'SERRA_INVALIDA' });
      beep(false);
      return;
    }

    processando = true;
    input.readOnly = true;
    resultado.innerHTML = `<div style="margin-top: 16px; text-align: center; color: var(--color-text-sec);">Consultando...</div>`;

    let r;
    try {
      const { data, error } = await withTimeout(rawRpc('consumir_lamina_seca', { p_qrcode: qrcode, p_serra: serraSelecionada, p_bpl_id: currentBPLID }), 15000);
      if (error) {
        const msg = String(error.message || '');
        r = { status: 'FALHA', mensagem: msg.includes('SEM_PERMISSAO') ? 'Esta estação não tem permissão para registrar consumo.' : 'Não foi possível registrar. Tente bipar de novo.' };
      } else {
        r = data;
      }
    } catch (err) {
      console.error('Erro no consumo da serra:', err);
      r = { status: 'FALHA', mensagem: 'Sem conexão com o servidor. Tente bipar de novo.' };
    }

    beep(r.status === 'OK');
    resultado.innerHTML = cartaoResultado(r);

    if (r.status === 'OK') {
      historico = [{ qrcode: r.qrcode, serra: r.serra, item: r.item, total: r.total }, ...historico].slice(0, MAX_HISTORICO);
      historicoEl.innerHTML = historicoHtml();
    }

    // Em falha de rede o QR fica no campo para reenviar; nos demais casos limpa para o próximo bip.
    if (r.status !== 'FALHA') input.value = '';
    input.readOnly = false;
    processando = false;
    focar();
  });
}
