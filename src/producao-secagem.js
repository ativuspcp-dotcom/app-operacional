import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase.js';
import { currentBPLID, renderBranchSelector, bindBranchSelector, withTimeout, rawRpc, podeAgir, getCurrentUserId } from './main.js';
import { fetchSecadoresEAtivos } from './setup-secadores.js';

const SLUG = 'app_secagem';

const LOCAIS_ESTOQUE = ['CONSUMIR', 'RESSECAR', 'SERRAR'];
const ENDERECOS = Array.from({ length: 30 }, (_, i) => `PILHA ${i + 1}`);

const BACK_SVG = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>';
const SPINNER = '<div style="width: 32px; height: 32px; margin: 0 auto; border: 3px solid var(--color-border); border-top-color: var(--green-400); border-radius: 50%; animation: spin 1s linear infinite;"></div>';

const fmtBitola = (v) => Number(v).toFixed(1).replace('.', ',');

/**
 * rawInsert: fetch nativo direto para a API REST do Supabase, bypassing o Web Lock interno
 * do supabase-js que trava inserts em sequência rápida (mesmo padrão de main.js/romaneio-saida.js).
 */
async function rawInsert(table, payload) {
  const storageKey = `sb-mqtyjzdwwgeycvmbiqsg-auth-token`;
  let token = '';
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) token = JSON.parse(raw)?.access_token || '';
  } catch (_) {}

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${token}`,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (!res.ok) return { data: null, error: json };
  const record = Array.isArray(json) ? json[0] : json;
  return { data: record, error: null };
}

export async function renderProducaoSecagem(container) {
  container.innerHTML = `
    <div class="header" style="justify-content: space-between; gap: 8px;">
      <button id="btn-back" style="color: white; padding: 8px; border:none; background:transparent;">${BACK_SVG}</button>
      <div class="header-title" style="flex: 1;">Produção Secagem</div>
      ${renderBranchSelector()}
    </div>
    <div class="container mt-4" id="ps-content">
      <div class="text-center" style="padding: 40px;">${SPINNER}</div>
    </div>
  `;

  bindBranchSelector();
  document.getElementById('btn-back').addEventListener('click', () => { window.location.hash = '/'; });

  let dados;
  try {
    dados = await fetchSecadoresEAtivos();
  } catch (err) {
    console.error('Erro ao carregar secadores:', err);
    document.getElementById('ps-content').innerHTML = `
      <div style="background: white; padding: 24px; border-radius: 12px; text-align: center;">
        <div class="error-text mb-4">Erro ao carregar os secadores. Verifique a conexão.</div>
        <button class="btn btn-primary" id="ps-retry">Tentar novamente</button>
      </div>
    `;
    document.getElementById('ps-retry').addEventListener('click', () => renderProducaoSecagem(container));
    return;
  }

  const content = document.getElementById('ps-content');
  const locaisComSetup = dados.secadores.map(nome => ({
    nome,
    op: dados.ativos.find(op => op.secador === nome) || null
  }));

  if (locaisComSetup.length === 0) {
    content.innerHTML = `<div style="background: white; padding: 24px; border-radius: 12px; text-align: center; color: var(--color-text-sec);">Nenhum secador cadastrado nesta filial.</div>`;
    return;
  }

  const podeApontar = podeAgir(SLUG);
  const today = new Date().toISOString().split('T')[0];

  content.innerHTML = `
    <div style="background: white; padding: 24px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
      ${!podeApontar ? '<div class="text-center error-text mb-4">Somente visualização: seu acesso não permite registrar apontamentos.</div>' : ''}
      <form id="ps-form" autocomplete="off">
        <div class="form-group">
          <label class="form-label">Data Produção <span class="required">*</span></label>
          <input type="date" id="ps-data-producao" class="form-input" value="${today}" required>
        </div>

        <div class="form-group">
          <label class="form-label">Local <span class="required">*</span></label>
          <select id="ps-local" class="form-input" style="appearance: auto; height: 48px; background-color: var(--dark-300);" required>
            <option value="" disabled selected>Selecione...</option>
            ${locaisComSetup.map(l => `<option value="${l.nome}" ${!l.op ? 'disabled' : ''}>${l.nome}${!l.op ? ' (sem setup ativo)' : ''}</option>`).join('')}
          </select>
        </div>

        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Turno</label>
            <input type="text" id="ps-turno" class="form-input input-readonly" readonly placeholder="-">
          </div>
          <div class="form-group">
            <label class="form-label">Modo</label>
            <input type="text" id="ps-modo" class="form-input input-readonly" readonly placeholder="-">
          </div>
        </div>

        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Espécie</label>
            <input type="text" id="ps-especie" class="form-input input-readonly" readonly placeholder="-">
          </div>
          <div class="form-group">
            <label class="form-label">Bitola (mm)</label>
            <input type="text" id="ps-bitola" class="form-input input-readonly" readonly placeholder="-">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Opção <span class="required">*</span></label>
          <select id="ps-opcao" class="form-input" style="appearance: auto; height: 48px;" disabled required>
            <option value="" selected>Selecione o Local</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Modo Cubagem</label>
          <input type="text" id="ps-modo-cubagem" class="form-input input-readonly" readonly placeholder="-">
        </div>

        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Altura/Peças <span class="required">*</span></label>
            <input type="number" id="ps-altura-pecas" class="form-input" step="any" min="0" required>
          </div>
          <div class="form-group">
            <label class="form-label">Desconto</label>
            <input type="number" id="ps-desconto" class="form-input" step="1" min="0" value="0">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Total</label>
          <input type="text" id="ps-total" class="form-input input-readonly" readonly placeholder="Fórmula pendente">
        </div>

        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Local Estoque <span class="required">*</span></label>
            <select id="ps-local-estoque" class="form-input" style="appearance: auto; height: 48px; background-color: var(--dark-300);" required>
              <option value="" disabled selected>Selecione...</option>
              ${LOCAIS_ESTOQUE.map(o => `<option value="${o}">${o}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Endereço <span class="required">*</span></label>
            <select id="ps-endereco" class="form-input" style="appearance: auto; height: 48px; background-color: var(--dark-300);" required>
              <option value="" disabled selected>Selecione...</option>
              ${ENDERECOS.map(o => `<option value="${o}">${o}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="form-group" style="margin-top: 32px; border-top: 1px solid var(--color-border); padding-top: 24px;">
          <label class="form-label text-center">Senha (PIN)</label>
          <input type="text" id="pin" class="form-input pin-input" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="****" required autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore data-bwignore>
        </div>

        <div class="form-group">
          <label class="form-label text-center">Responsável</label>
          <input type="text" id="responsavel_nome" class="form-input input-readonly text-center" style="font-size: 1.2rem;" readonly placeholder="Aguardando PIN...">
          <input type="hidden" id="responsavel_id">
        </div>

        <div id="form-error" class="text-center error-text mb-4"></div>
        <div id="form-success" class="text-center success-text mb-4"></div>

        <button type="submit" id="btn-save" class="btn btn-primary" style="padding: 20px; font-size: 1.1rem;" disabled>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
          Salvar Apontamento
        </button>
      </form>
    </div>
  `;

  if (!podeApontar) {
    content.querySelectorAll('input, select, button').forEach(el => { el.disabled = true; });
    return;
  }

  bindForm(locaisComSetup);
}

/** Busca as regras de cubagem (Opção/Modo Cubagem/overrides/Desconto) para uma combinação de setup. */
async function fetchRegrasCubagem(secador, comprimento, largura) {
  const { data, error } = await supabase
    .from('pcp_secagem_regras_cubagem')
    .select('opcao, modo_cubagem, comprimento_override, largura_override, desconto')
    .eq('secador', secador)
    .eq('comprimento_setup', comprimento)
    .eq('largura_setup', largura)
    .order('opcao');
  if (error) throw error;
  return data || [];
}

function bindForm(locaisComSetup) {
  const localSelect = document.getElementById('ps-local');
  const turnoInput = document.getElementById('ps-turno');
  const modoInput = document.getElementById('ps-modo');
  const especieInput = document.getElementById('ps-especie');
  const bitolaInput = document.getElementById('ps-bitola');
  const opcaoSelect = document.getElementById('ps-opcao');
  const modoCubagemInput = document.getElementById('ps-modo-cubagem');

  let opSelecionada = null;
  let regrasDisponiveis = [];
  let regraSelecionada = null;

  const limparOpcao = (placeholder) => {
    regrasDisponiveis = [];
    regraSelecionada = null;
    opcaoSelect.innerHTML = `<option value="" selected>${placeholder}</option>`;
    opcaoSelect.disabled = true;
    modoCubagemInput.value = '';
  };

  localSelect.addEventListener('change', async () => {
    const local = locaisComSetup.find(l => l.nome === localSelect.value);
    opSelecionada = local?.op || null;

    turnoInput.value = opSelecionada?.turno || '';
    modoInput.value = opSelecionada?.tipo || '';
    especieInput.value = opSelecionada?.especie || '';
    bitolaInput.value = opSelecionada ? fmtBitola(opSelecionada.bitola) : '';

    if (!opSelecionada) {
      limparOpcao('Selecione o Local');
      return;
    }

    opcaoSelect.innerHTML = `<option value="" selected>Carregando...</option>`;
    try {
      regrasDisponiveis = await fetchRegrasCubagem(opSelecionada.secador, opSelecionada.comprimento, opSelecionada.largura);
    } catch (err) {
      console.error('Erro ao carregar regras de cubagem:', err);
      regrasDisponiveis = [];
    }

    if (regrasDisponiveis.length === 0) {
      limparOpcao('Configuração pendente para este setup');
      return;
    }

    opcaoSelect.disabled = false;
    opcaoSelect.innerHTML = `<option value="" disabled selected>Selecione...</option>` +
      regrasDisponiveis.map(r => `<option value="${r.opcao}">${r.opcao}</option>`).join('');
  });

  opcaoSelect.addEventListener('change', () => {
    regraSelecionada = regrasDisponiveis.find(r => r.opcao === opcaoSelect.value) || null;
    modoCubagemInput.value = regraSelecionada?.modo_cubagem || '';
    if (regraSelecionada) {
      document.getElementById('ps-desconto').value = regraSelecionada.desconto;
    }
  });

  const pinInput = document.getElementById('pin');
  const respInput = document.getElementById('responsavel_nome');
  const respIdInput = document.getElementById('responsavel_id');
  const btnSave = document.getElementById('btn-save');
  const formError = document.getElementById('form-error');
  const formSuccess = document.getElementById('form-success');

  pinInput.addEventListener('input', async (e) => {
    const val = e.target.value;
    if (val.length === 4) {
      pinInput.disabled = true;
      respInput.value = 'Buscando...';
      formError.textContent = '';

      try {
        // PIN validado no servidor (função validar_pin): o PIN dos operadores nunca chega ao dispositivo
        const { data: rows, error: pinError } = await withTimeout(rawRpc('validar_pin', { p_pin: val }), 15000);
        if (pinError) throw new Error(pinError.message || 'PIN_ERRO');
        const data = rows && rows[0];

        if (!data) {
          formError.textContent = 'PIN Inválido ou Inativo.';
          respInput.value = '';
          respIdInput.value = '';
          pinInput.disabled = false;
          pinInput.value = '';
          pinInput.focus();
          btnSave.disabled = true;
        } else {
          respInput.value = data.nome_completo;
          respIdInput.value = data.id;
          respInput.classList.add('success-text');
          pinInput.disabled = false;
          btnSave.disabled = false;
        }
      } catch (err) {
        console.error(err);
        formError.textContent = String(err.message).includes('PIN_BLOQUEADO')
          ? 'Muitas tentativas com PIN errado. Aguarde 5 minutos e tente novamente.'
          : 'Erro ao validar. Tente novamente.';
        respInput.value = '';
        respIdInput.value = '';
        pinInput.disabled = false;
        pinInput.value = '';
        pinInput.focus();
        btnSave.disabled = true;
      }
    } else {
      respInput.value = '';
      respIdInput.value = '';
      respInput.classList.remove('success-text');
      btnSave.disabled = true;
    }
  });

  document.getElementById('ps-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.textContent = '';
    formSuccess.textContent = '';
    if (!podeAgir(SLUG)) return;

    if (!opSelecionada) {
      formError.textContent = 'Selecione um Local com setup ativo.';
      return;
    }
    if (!regraSelecionada) {
      formError.textContent = 'Selecione uma Opção.';
      return;
    }
    if (!respIdInput.value) {
      formError.textContent = 'Digite um PIN válido para prosseguir.';
      return;
    }

    btnSave.disabled = true;
    btnSave.innerHTML = 'Salvando...';

    try {
      const payload = {
        data_producao: document.getElementById('ps-data-producao').value,
        local: opSelecionada.secador,
        turno: opSelecionada.turno,
        modo: opSelecionada.tipo,
        especie: opSelecionada.especie,
        bitola: opSelecionada.bitola,
        comprimento: regraSelecionada.comprimento_override ?? opSelecionada.comprimento,
        largura: regraSelecionada.largura_override ?? opSelecionada.largura,
        modo_cubagem: regraSelecionada.modo_cubagem,
        altura_pecas: parseFloat(document.getElementById('ps-altura-pecas').value),
        desconto: parseInt(document.getElementById('ps-desconto').value) || 0,
        local_estoque: document.getElementById('ps-local-estoque').value,
        endereco: document.getElementById('ps-endereco').value,
        responsavel_id: respIdInput.value,
        responsavel_nome: respInput.value,
        tablet_user_id: getCurrentUserId(),
        op_id: opSelecionada.id
      };

      const { data: insertData, error: insertError } = await withTimeout(rawInsert('secagem_apontamentos', payload), 15000);
      if (insertError) throw new Error(insertError.message || JSON.stringify(insertError));
      if (!insertData) throw new Error('Insert não retornou dados.');

      formSuccess.textContent = `Apontamento ${insertData.qrcode} salvo com sucesso!`;

      // Reset só PIN e Responsável: mantém o resto preenchido para o próximo apontamento da mesma remessa
      pinInput.value = '';
      pinInput.disabled = false;
      pinInput.focus();
      respInput.value = '';
      respIdInput.value = '';
      respInput.classList.remove('success-text');

      setTimeout(() => { formSuccess.textContent = ''; }, 3000);
    } catch (err) {
      console.error('[PRODUCAO SECAGEM ERROR]', err);
      formError.textContent = 'Erro ao salvar: ' + err.message;
    } finally {
      btnSave.disabled = true; // Desabilitado porque o PIN foi limpo
      btnSave.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
        Salvar Apontamento
      `;
    }
  });
}
