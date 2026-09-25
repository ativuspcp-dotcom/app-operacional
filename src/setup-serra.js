import { supabase } from './supabase.js';
import { currentBPLID, withTimeout, rawRpc, podeAgir } from './main.js';
import { headerHtml, bindHeader, renderErro, toggleHtml, selectHtml, ESPECIES, BITOLAS, TURNOS, CARD_STYLE, SPINNER, fmtBitola, fmtDataHora } from './setup-secadores.js';
import { esc } from './lamina-seca.js';

const SLUG = 'app_setup_serra';

// Setup das serras (SERRA 1, SERRA 2...): mesmo padrão dos secadores. Tipo é só PRODUÇÃO; espécie/bitola/turno
// são as mesmas listas dos secadores (importadas de setup-secadores.js). Comprimento e largura NÃO fazem parte
// do setup: são informados no apontamento. A função do banco salvar_setup_serra é quem valida de verdade.
const TIPOS = ['PRODUÇÃO'];

// Serras cadastradas na filial atual (pcp_serras) e o setup ativo de cada uma (pcp_op_serra).
// Sequencial de propósito: o supabase-js trava com várias chamadas simultâneas (Web Lock).
// Reaproveitada em producao-serra.js para montar o campo "Local" do apontamento.
export async function fetchSerrasEAtivas() {
  const { data: serras, error: serraError } = await withTimeout(
    supabase.from('pcp_serras').select('nome').eq('bpl_id', currentBPLID).eq('ativo', true).order('nome'),
    10000
  );
  if (serraError) throw serraError;

  const { data: ativas, error } = await withTimeout(
    supabase.from('pcp_op_serra').select('*').eq('bpl_id', currentBPLID).eq('status', 'Ativa'),
    10000
  );
  if (error) throw error;

  return { serras: (serras || []).map(s => s.nome), ativas: ativas || [] };
}

function cardSerra(serra, op) {
  const linha = (rotulo, valor) => `
    <div>
      <div style="font-size: 0.75rem; color: var(--color-text-sec);">${rotulo}</div>
      <div style="font-weight: 600;">${valor}</div>
    </div>`;

  return `
    <div class="serra-card" data-serra="${esc(serra)}" style="${CARD_STYLE} margin-bottom: 12px; border: 2px solid transparent; cursor: pointer;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <div style="font-size: 1.3rem; font-weight: 700;">${esc(serra)}</div>
        ${op
          ? `<span style="background: var(--green-50); color: var(--green-500); font-weight: 600; font-size: 0.8rem; padding: 4px 10px; border-radius: 20px;">ATIVO · ${esc(op.codigo_op)}</span>`
          : '<span style="background: #fef2f2; color: #ef4444; font-weight: 600; font-size: 0.8rem; padding: 4px 10px; border-radius: 20px;">SEM SETUP ATIVO</span>'}
      </div>
      ${op ? `
        <div class="grid-2" style="row-gap: 12px;">
          ${linha('Tipo', esc(op.tipo))}
          ${linha('Espécie', esc(op.especie))}
          ${linha('Bitola', `${fmtBitola(op.bitola)} mm`)}
          ${linha('Turno', esc(op.turno))}
        </div>
        ${op.responsavel_nome ? `<div style="margin-top: 14px; font-size: 0.8rem; color: var(--color-text-sec);">Definido por ${esc(op.responsavel_nome)} · efetivada em ${fmtDataHora(op.created_at)}</div>` : ''}
      ` : '<div style="color: var(--color-text-sec); font-size: 0.9rem;">Toque para definir o setup desta serra.</div>'}
      ${podeAgir(SLUG)
        ? `<div style="margin-top: 16px; text-align: right; color: var(--color-primary); font-weight: 600; font-size: 0.9rem;">${op ? 'Alterar setup ›' : 'Definir setup ›'}</div>`
        : ''}
    </div>
  `;
}

export async function renderSetupSerra(container) {
  container.innerHTML = `
    ${headerHtml('Setup Serra', '/')}
    <div class="container mt-4" id="serras-content">
      <div class="text-center" style="padding: 40px;">${SPINNER}</div>
    </div>
  `;
  bindHeader();

  let dados;
  try {
    dados = await fetchSerrasEAtivas();
  } catch (err) {
    console.error('Erro ao carregar setups das serras:', err);
    const content = document.getElementById('serras-content');
    if (content) renderErro(content, 'Erro ao carregar os setups. Verifique a conexão.');
    return;
  }

  const content = document.getElementById('serras-content');
  if (!content) return;

  if (dados.serras.length === 0) {
    content.innerHTML = `<div style="${CARD_STYLE} text-align: center; color: var(--color-text-sec);">Nenhuma serra cadastrada nesta filial.</div>`;
    return;
  }

  content.innerHTML = dados.serras.map(s => cardSerra(s, dados.ativas.find(op => op.serra === s))).join('');
  content.querySelectorAll('.serra-card').forEach(card => {
    card.addEventListener('click', () => {
      if (!podeAgir(SLUG)) return;
      window.location.hash = `/setup-serra/${encodeURIComponent(card.dataset.serra)}`;
    });
  });
}

export async function renderSetupSerraForm(container, serra) {
  if (!podeAgir(SLUG)) {
    window.location.hash = '/setup-serra';
    return;
  }

  container.innerHTML = `
    ${headerHtml(`Setup ${esc(serra)}`, '/setup-serra')}
    <div class="container mt-4" id="setup-form-content">
      <div class="text-center" style="padding: 40px;">${SPINNER}</div>
    </div>
  `;
  bindHeader();

  let ativo;
  try {
    const dados = await fetchSerrasEAtivas();
    if (!dados.serras.includes(serra)) {
      window.location.hash = '/setup-serra';
      return;
    }
    ativo = dados.ativas.find(op => op.serra === serra) || null;
  } catch (err) {
    console.error('Erro ao carregar o setup ativo:', err);
    const content = document.getElementById('setup-form-content');
    if (content) renderErro(content, 'Erro ao carregar o setup atual. Verifique a conexão.');
    return;
  }

  const content = document.getElementById('setup-form-content');
  if (!content) return;

  const state = {
    tipo: ativo?.tipo ?? TIPOS[0],
    especie: ativo?.especie ?? null,
    bitola: ativo ? Number(ativo.bitola) : null,
    turno: ativo?.turno ?? null
  };
  let responsavelValidado = false;

  content.innerHTML = `
    <div style="${CARD_STYLE}">
      <div style="margin-bottom: 20px; padding: 12px; background: var(--green-50); border-radius: 8px; font-size: 0.85rem;">
        ${ativo
          ? `Setup ativo: <strong>${esc(ativo.codigo_op)}</strong>. Ao salvar uma alteração, uma nova OP é aberta com o novo setup.`
          : 'Esta serra ainda não tem setup ativo. Defina o primeiro setup abaixo.'}
      </div>

      <form id="setup-form" autocomplete="off">
        <div class="form-group">
          <label class="form-label">Tipo <span class="required">*</span></label>
          ${toggleHtml('toggle-tipo', TIPOS, state.tipo, o => o)}
        </div>

        <div class="form-group">
          <label class="form-label">Espécie <span class="required">*</span></label>
          ${toggleHtml('toggle-especie', ESPECIES, state.especie, o => o)}
        </div>

        <div class="form-group">
          <label class="form-label">Bitola (mm) <span class="required">*</span></label>
          ${selectHtml('sel-bitola', BITOLAS, state.bitola, fmtBitola)}
        </div>

        <div class="form-group">
          <label class="form-label">Turno <span class="required">*</span></label>
          ${selectHtml('sel-turno', TURNOS, state.turno, o => o)}
        </div>

        <div class="form-group" style="margin-top: 32px; border-top: 1px solid var(--color-border); padding-top: 24px;">
          <label class="form-label text-center">Senha (PIN)</label>
          <input type="text" id="pin" class="form-input pin-input" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="****" required autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore data-bwignore>
        </div>

        <div class="form-group">
          <label class="form-label text-center">Responsável</label>
          <input type="text" id="responsavel_nome" class="form-input input-readonly text-center" style="font-size: 1.2rem;" readonly placeholder="Aguardando PIN...">
        </div>

        <div id="form-error" class="text-center error-text mb-4"></div>
        <div id="form-success" class="text-center success-text mb-4"></div>

        <button type="submit" id="btn-save" class="btn btn-primary" style="padding: 20px; font-size: 1.1rem;" disabled>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
          Salvar Setup
        </button>
      </form>
    </div>
  `;

  const pinInput = document.getElementById('pin');
  const respInput = document.getElementById('responsavel_nome');
  const btnSave = document.getElementById('btn-save');
  const formError = document.getElementById('form-error');
  const formSuccess = document.getElementById('form-success');

  const formularioCompleto = () => Object.values(state).every(v => v !== null && v !== undefined);
  const atualizarBotao = () => { btnSave.disabled = !(formularioCompleto() && responsavelValidado); };

  function bindToggle(groupId, onChange) {
    const group = document.getElementById(groupId);
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('.toggle-btn');
      if (!btn) return;
      group.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onChange(btn.dataset.val);
    });
  }

  bindToggle('toggle-tipo', (v) => { state.tipo = v; atualizarBotao(); });
  bindToggle('toggle-especie', (v) => { state.especie = v; atualizarBotao(); });
  document.getElementById('sel-bitola').addEventListener('change', (e) => { state.bitola = Number(e.target.value); atualizarBotao(); });
  document.getElementById('sel-turno').addEventListener('change', (e) => { state.turno = e.target.value; atualizarBotao(); });
  atualizarBotao();

  const limparResponsavel = () => {
    responsavelValidado = false;
    respInput.value = '';
    respInput.classList.remove('success-text');
    atualizarBotao();
  };

  pinInput.addEventListener('input', async (e) => {
    const val = e.target.value;
    formError.textContent = '';
    if (val.length !== 4) {
      limparResponsavel();
      return;
    }

    pinInput.disabled = true;
    respInput.value = 'Buscando...';
    try {
      // PIN validado no servidor (função validar_pin): o PIN dos operadores nunca chega ao dispositivo
      const { data: rows, error: pinError } = await withTimeout(rawRpc('validar_pin', { p_pin: val }), 15000);
      if (pinError) throw new Error(pinError.message || 'PIN_ERRO');
      const resp = rows && rows[0];

      if (!resp) {
        formError.textContent = 'PIN Inválido ou Inativo.';
        pinInput.value = '';
        limparResponsavel();
      } else {
        respInput.value = resp.nome_completo;
        respInput.classList.add('success-text');
        responsavelValidado = true;
        atualizarBotao();
      }
    } catch (err) {
      console.error(err);
      formError.textContent = String(err.message).includes('PIN_BLOQUEADO')
        ? 'Muitas tentativas com PIN errado. Aguarde 5 minutos e tente novamente.'
        : 'Erro ao validar. Tente novamente.';
      pinInput.value = '';
      limparResponsavel();
    } finally {
      pinInput.disabled = false;
      if (!responsavelValidado) pinInput.focus();
    }
  });

  document.getElementById('setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.textContent = '';
    formSuccess.textContent = '';

    if (!formularioCompleto() || !responsavelValidado) return;
    if (!podeAgir(SLUG)) return;

    const semAlteracao = ativo
      && ativo.tipo === state.tipo && ativo.especie === state.especie
      && Number(ativo.bitola) === state.bitola && ativo.turno === state.turno;
    if (semAlteracao) {
      formError.textContent = 'Nenhuma alteração no setup.';
      return;
    }

    const aviso = ativo
      ? `Alterar o setup da ${serra}?\n\nA OP ${ativo.codigo_op} será encerrada e uma nova OP será aberta com o novo setup.`
      : `Definir o primeiro setup da ${serra}?`;
    if (!window.confirm(aviso)) return;

    const textoBotao = btnSave.innerHTML;
    btnSave.disabled = true;
    btnSave.innerHTML = 'Salvando...';
    pinInput.disabled = true;

    let salvou = false;
    try {
      const { data, error } = await withTimeout(rawRpc('salvar_setup_serra', {
        p_serra: serra,
        p_pin: pinInput.value,
        p_tipo: state.tipo,
        p_especie: state.especie,
        p_bitola: state.bitola,
        p_turno: state.turno,
        p_bpl_id: currentBPLID
      }), 20000);

      if (error) throw new Error(error.message || 'ERRO');

      const novo = data && data[0];
      if (!novo) {
        formError.textContent = 'PIN Inválido ou Inativo.';
        pinInput.value = '';
        limparResponsavel();
        return;
      }

      salvou = true;
      formSuccess.textContent = `Setup salvo! Nova OP ${novo.codigo_op}.`;
      setTimeout(() => { window.location.hash = '/setup-serra'; }, 1200);
    } catch (err) {
      console.error('Erro ao salvar setup da serra:', err);
      const msg = String(err.message);
      if (msg.includes('PIN_BLOQUEADO')) formError.textContent = 'Muitas tentativas com PIN errado. Aguarde 5 minutos e tente novamente.';
      else if (msg.includes('SEM_PERMISSAO')) formError.textContent = 'Esta estação não tem permissão para alterar o setup.';
      else if (msg.includes('FILIAL_NAO_PERMITIDA')) formError.textContent = 'Esta estação não tem acesso a esta filial.';
      else if (msg.includes('SETUP_INVALIDO')) formError.textContent = 'Combinação de setup inválida.';
      else formError.textContent = 'Erro ao salvar: ' + msg;
    } finally {
      pinInput.disabled = false;
      pinInput.value = '';
      if (!salvou) {
        btnSave.innerHTML = textoBotao;
        limparResponsavel();
      }
    }
  });
}
