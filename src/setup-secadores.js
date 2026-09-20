import { supabase } from './supabase.js';
import { currentBPLID, renderBranchSelector, bindBranchSelector, withTimeout, rawRpc, podeAgir } from './main.js';

const SLUG = 'app_setup_secadores';

const TIPOS = ['PRODUÇÃO', 'RESSEQUE'];
const ESPECIES = ['PINUS', 'EUCALIPTO'];
const BITOLAS = [1.5, 1.8, 2.0, 2.2, 2.5, 2.7, 3.1, 3.3];
const TURNOS = ['00:00 - 06:00', '06:00 - 12:00', '12:00 - 18:00', '18:00 - 00:00'];

// Regras de preenchimento por secador (por nome). Também existem na função do banco salvar_setup_secador
// (a que valida de verdade) e no portal (SECADOR_CONFIG em pages/op/secagem.js): alterar nos 3 lugares.
const CONFIG = {
  FEZER: {
    larguras: [2.6],
    comprimentosFor: () => [1.3, 0.87]
  },
  OMECO: {
    larguras: [2.6, 1.3],
    comprimentosFor: (largura) => (largura === 2.6 ? [1.3, 0.87] : [0.87])
  }
};

const BACK_SVG = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>';
const SPINNER = '<div style="width: 32px; height: 32px; margin: 0 auto; border: 3px solid var(--color-border); border-top-color: var(--green-400); border-radius: 50%; animation: spin 1s linear infinite;"></div>';
const CARD_STYLE = 'background: white; padding: 20px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);';

const fmtDim = (v) => Number(v).toFixed(3).replace('.', ',');
const fmtBitola = (v) => Number(v).toFixed(1).replace('.', ',');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function headerHtml(title, backHash) {
  return `
    <div class="header" style="justify-content: space-between; gap: 8px;">
      <button id="btn-back" data-back="${backHash}" style="color: white; padding: 8px; border:none; background:transparent;">${BACK_SVG}</button>
      <div class="header-title" style="flex: 1;">${title}</div>
      ${renderBranchSelector()}
    </div>
  `;
}

function bindHeader() {
  bindBranchSelector();
  const back = document.getElementById('btn-back');
  back.addEventListener('click', () => { window.location.hash = back.dataset.back; });
}

// Secadores cadastrados na filial atual (pcp_secadores) e o setup ativo de cada um.
// Sequencial de propósito: o supabase-js trava com várias chamadas simultâneas (Web Lock).
async function fetchSecadoresEAtivos() {
  const { data: sec, error: secError } = await withTimeout(
    supabase.from('pcp_secadores').select('nome').eq('bpl_id', currentBPLID).eq('ativo', true).order('nome'),
    10000
  );
  if (secError) throw secError;

  const { data: ativos, error } = await withTimeout(
    supabase.from('pcp_op_secagem').select('*').eq('bpl_id', currentBPLID).eq('status', 'Ativa'),
    10000
  );
  if (error) throw error;

  return { secadores: (sec || []).map(s => s.nome), ativos: ativos || [] };
}

function renderErro(container, mensagem) {
  container.innerHTML = `
    <div style="${CARD_STYLE} text-align: center;">
      <div class="error-text mb-4">${esc(mensagem)}</div>
      <button class="btn btn-primary" id="btn-retry">Tentar novamente</button>
    </div>
  `;
  document.getElementById('btn-retry').addEventListener('click', () => window.dispatchEvent(new HashChangeEvent('hashchange')));
}

function cardSecador(secador, op) {
  const linha = (rotulo, valor) => `
    <div>
      <div style="font-size: 0.75rem; color: var(--color-text-sec);">${rotulo}</div>
      <div style="font-weight: 600;">${valor}</div>
    </div>`;

  return `
    <div class="secador-card" data-secador="${secador}" style="${CARD_STYLE} margin-bottom: 12px; border: 2px solid transparent; cursor: pointer;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <div style="font-size: 1.3rem; font-weight: 700;">${secador}</div>
        ${op
          ? `<span style="background: var(--green-50); color: var(--green-500); font-weight: 600; font-size: 0.8rem; padding: 4px 10px; border-radius: 20px;">ATIVO · ${esc(op.codigo_op)}</span>`
          : '<span style="background: #fef2f2; color: #ef4444; font-weight: 600; font-size: 0.8rem; padding: 4px 10px; border-radius: 20px;">SEM SETUP ATIVO</span>'}
      </div>
      ${op ? `
        <div class="grid-2" style="row-gap: 12px;">
          ${linha('Tipo', esc(op.tipo))}
          ${linha('Espécie', esc(op.especie))}
          ${linha('Largura', `${fmtDim(op.largura)} m`)}
          ${linha('Comprimento', `${fmtDim(op.comprimento)} m`)}
          ${linha('Bitola', `${fmtBitola(op.bitola)} mm`)}
          ${linha('Turno', esc(op.turno))}
        </div>
        ${op.responsavel_nome ? `<div style="margin-top: 14px; font-size: 0.8rem; color: var(--color-text-sec);">Definido por ${esc(op.responsavel_nome)}</div>` : ''}
      ` : '<div style="color: var(--color-text-sec); font-size: 0.9rem;">Toque para definir o setup deste secador.</div>'}
      ${podeAgir(SLUG)
        ? `<div style="margin-top: 16px; text-align: right; color: var(--color-primary); font-weight: 600; font-size: 0.9rem;">${op ? 'Alterar setup ›' : 'Definir setup ›'}</div>`
        : ''}
    </div>
  `;
}

export async function renderSetupSecadores(container) {
  container.innerHTML = `
    ${headerHtml('Setup Secadores', '/')}
    <div class="container mt-4" id="secadores-content">
      <div class="text-center" style="padding: 40px;">${SPINNER}</div>
    </div>
  `;
  bindHeader();

  let dados;
  try {
    dados = await fetchSecadoresEAtivos();
  } catch (err) {
    console.error('Erro ao carregar setups dos secadores:', err);
    const content = document.getElementById('secadores-content');
    if (content) renderErro(content, 'Erro ao carregar os setups. Verifique a conexão.');
    return;
  }

  const content = document.getElementById('secadores-content');
  if (!content) return;

  if (dados.secadores.length === 0) {
    content.innerHTML = `<div style="${CARD_STYLE} text-align: center; color: var(--color-text-sec);">Nenhum secador cadastrado nesta filial.</div>`;
    return;
  }

  content.innerHTML = dados.secadores.map(s => cardSecador(s, dados.ativos.find(op => op.secador === s))).join('');
  content.querySelectorAll('.secador-card').forEach(card => {
    card.addEventListener('click', () => {
      if (!podeAgir(SLUG)) return;
      if (!CONFIG[card.dataset.secador]) {
        window.alert('As regras de preenchimento deste secador ainda não foram configuradas.');
        return;
      }
      window.location.hash = `/setup-secadores/${card.dataset.secador}`;
    });
  });
}

function toggleHtml(id, opcoes, selecionado, formatar) {
  return `<div class="toggle-group" id="${id}">${opcoes.map(o => `
    <button type="button" class="toggle-btn ${o === selecionado ? 'active' : ''}" data-val="${o}">${formatar(o)}</button>`).join('')}
  </div>`;
}

function selectHtml(id, opcoes, selecionado, formatar) {
  return `<select id="${id}" class="form-input" style="appearance: auto; height: 48px;">
    <option value="" disabled ${selecionado == null ? 'selected' : ''}>Selecione...</option>
    ${opcoes.map(o => `<option value="${o}" ${o === selecionado ? 'selected' : ''}>${formatar(o)}</option>`).join('')}
  </select>`;
}

export async function renderSetupSecadorForm(container, secador) {
  if (!CONFIG[secador] || !podeAgir(SLUG)) {
    window.location.hash = '/setup-secadores';
    return;
  }

  container.innerHTML = `
    ${headerHtml(`Setup ${secador}`, '/setup-secadores')}
    <div class="container mt-4" id="setup-form-content">
      <div class="text-center" style="padding: 40px;">${SPINNER}</div>
    </div>
  `;
  bindHeader();

  let ativo;
  try {
    const dados = await fetchSecadoresEAtivos();
    if (!dados.secadores.includes(secador)) {
      window.location.hash = '/setup-secadores';
      return;
    }
    ativo = dados.ativos.find(op => op.secador === secador) || null;
  } catch (err) {
    console.error('Erro ao carregar o setup ativo:', err);
    const content = document.getElementById('setup-form-content');
    if (content) renderErro(content, 'Erro ao carregar o setup atual. Verifique a conexão.');
    return;
  }

  const content = document.getElementById('setup-form-content');
  if (!content) return;

  const config = CONFIG[secador];
  const state = {
    tipo: ativo?.tipo ?? null,
    especie: ativo?.especie ?? null,
    largura: ativo ? Number(ativo.largura) : config.larguras[0],
    comprimento: ativo ? Number(ativo.comprimento) : null,
    bitola: ativo ? Number(ativo.bitola) : null,
    turno: ativo?.turno ?? null
  };
  let responsavelValidado = false;

  content.innerHTML = `
    <div style="${CARD_STYLE}">
      <div style="margin-bottom: 20px; padding: 12px; background: var(--green-50); border-radius: 8px; font-size: 0.85rem;">
        ${ativo
          ? `Setup ativo: <strong>${esc(ativo.codigo_op)}</strong>. Ao salvar uma alteração, uma nova OP é aberta com o novo setup.`
          : 'Este secador ainda não tem setup ativo. Defina o primeiro setup abaixo.'}
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
          <label class="form-label">Largura (m) <span class="required">*</span></label>
          <div id="wrap-largura"></div>
        </div>

        <div class="form-group">
          <label class="form-label">Comprimento (m) <span class="required">*</span></label>
          <div id="wrap-comprimento"></div>
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

  const renderLargura = () => {
    document.getElementById('wrap-largura').innerHTML = toggleHtml('toggle-largura', config.larguras, state.largura, fmtDim);
    bindToggle('toggle-largura', (v) => {
      state.largura = Number(v);
      renderComprimento();
      atualizarBotao();
    });
  };

  const renderComprimento = () => {
    const opcoes = config.comprimentosFor(state.largura);
    if (!opcoes.includes(state.comprimento)) {
      state.comprimento = opcoes.length === 1 ? opcoes[0] : null;
    }
    document.getElementById('wrap-comprimento').innerHTML = toggleHtml('toggle-comprimento', opcoes, state.comprimento, fmtDim);
    bindToggle('toggle-comprimento', (v) => {
      state.comprimento = Number(v);
      atualizarBotao();
    });
  };

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
  renderLargura();
  renderComprimento();
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
      && Number(ativo.largura) === state.largura && Number(ativo.comprimento) === state.comprimento
      && Number(ativo.bitola) === state.bitola && ativo.turno === state.turno;
    if (semAlteracao) {
      formError.textContent = 'Nenhuma alteração no setup.';
      return;
    }

    const aviso = ativo
      ? `Alterar o setup do ${secador}?\n\nA OP ${ativo.codigo_op} será encerrada e uma nova OP será aberta com o novo setup.`
      : `Definir o primeiro setup do ${secador}?`;
    if (!window.confirm(aviso)) return;

    const textoBotao = btnSave.innerHTML;
    btnSave.disabled = true;
    btnSave.innerHTML = 'Salvando...';
    pinInput.disabled = true;

    let salvou = false;
    try {
      const { data, error } = await withTimeout(rawRpc('salvar_setup_secador', {
        p_secador: secador,
        p_pin: pinInput.value,
        p_tipo: state.tipo,
        p_especie: state.especie,
        p_largura: state.largura,
        p_comprimento: state.comprimento,
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
      setTimeout(() => { window.location.hash = '/setup-secadores'; }, 1200);
    } catch (err) {
      console.error('Erro ao salvar setup:', err);
      const msg = String(err.message);
      if (msg.includes('PIN_BLOQUEADO')) formError.textContent = 'Muitas tentativas com PIN errado. Aguarde 5 minutos e tente novamente.';
      else if (msg.includes('SEM_PERMISSAO')) formError.textContent = 'Esta estação não tem permissão para alterar o setup.';
      else if (msg.includes('FILIAL_NAO_PERMITIDA')) formError.textContent = 'Esta estação não tem acesso a esta filial.';
      else if (msg.includes('SETUP_INVALIDO')) formError.textContent = 'Combinação de setup inválida para este secador.';
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
