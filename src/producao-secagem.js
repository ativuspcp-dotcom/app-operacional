import { currentBPLID, renderBranchSelector, bindBranchSelector, withTimeout, rawRpc, podeAgir, getCurrentUserId } from './main.js';
import { fetchSecadoresEAtivos } from './setup-secadores.js';
import { ENDERECOS, fmtBitola, fmtMedida, esc, calcularTotal, carregarItensSap, acharItemSap, rawInsert, rawDelete, enviarParaImpressora, fetchRegrasCubagem } from './lamina-seca.js';

const SLUG = 'app_secagem';

const LOCAIS_ESTOQUE = ['CONSUMIR', 'RESSECAR', 'SERRAR'];

const BACK_SVG = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>';
const SPINNER = '<div style="width: 32px; height: 32px; margin: 0 auto; border: 3px solid var(--color-border); border-top-color: var(--green-400); border-radius: 50%; animation: spin 1s linear infinite;"></div>';

// Cache das lâminas secas do SAP (grupo 145): carregado ao entrar na tela e mantido em memória.
// Para atualizar, o usuário recarrega o app rolando a tela para baixo (mesmo jeito do compensado).
let carregamentoItensSap = null;

export async function renderProducaoSecagem(container) {
  // Carrega os itens do SAP em segundo plano assim que a tela abre; o .catch evita aviso de rejeição
  // não tratada (quem usa o resultado trata o erro no seu próprio try/catch).
  carregamentoItensSap = carregarItensSap();
  carregamentoItensSap.catch(() => {});

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
        <div class="grid-2">
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
        </div>

        <div class="form-group">
          <label class="form-label">Opção <span class="required">*</span></label>
          <select id="ps-opcao" class="form-input" style="appearance: auto; height: 48px;" disabled required>
            <option value="" selected>Selecione o Local</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Produto encontrado</label>
          <div id="ps-produto" style="min-height: 64px; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--color-border); background: var(--dark-300); display: flex; flex-direction: column; justify-content: center;"></div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0 16px;">
          <div class="form-group">
            <label class="form-label" id="ps-quantidade-label">Altura/Peças <span class="required">*</span></label>
            <input type="number" id="ps-altura-pecas" class="form-input" step="any" min="0" required>
          </div>
          <div class="form-group">
            <label class="form-label">Desconto (%)</label>
            <input type="number" id="ps-desconto" class="form-input" step="1" min="0" max="100" value="0">
          </div>
          <div class="form-group">
            <label class="form-label">Total (m³)</label>
            <input type="text" id="ps-total" class="form-input input-readonly" readonly placeholder="-">
          </div>
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

        <div class="form-group" style="margin-top: 8px; border-top: 1px solid var(--color-border); padding-top: 16px;">
          <label style="display: flex; align-items: center; gap: 12px; font-size: 1rem; font-weight: 600; cursor: pointer;">
            <input type="checkbox" id="ps-etiqueta-manual" style="width: 24px; height: 24px;">
            Inserir etiqueta manual
          </label>
          <div id="ps-etiqueta-manual-box" style="display: none; margin-top: 12px;">
            <label class="form-label" for="ps-qrcode-manual">Bipe a etiqueta pré-impressa (QR Code) <span class="required">*</span></label>
            <input type="text" id="ps-qrcode-manual" class="form-input" placeholder="Bipe a etiqueta" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" data-lpignore="true" data-1p-ignore data-bwignore style="font-size: 1.3rem; height: 56px; text-align: center; font-family: monospace; letter-spacing: 1px; text-transform: uppercase;">
            <div id="ps-qrcode-manual-msg" style="font-size: 0.85rem; margin-top: 6px; min-height: 18px;"></div>
            <div style="font-size: 0.8rem; color: var(--color-text-sec);">Com etiqueta manual o sistema não gera código automático e não imprime.</div>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0 16px; margin-top: 8px; border-top: 1px solid var(--color-border); padding-top: 16px;">
          <div class="form-group">
            <label class="form-label text-center">Senha (PIN)</label>
            <input type="text" id="pin" class="form-input pin-input" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="****" required autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore data-bwignore>
          </div>
          <div class="form-group">
            <label class="form-label text-center">Responsável</label>
            <input type="text" id="responsavel_nome" class="form-input input-readonly text-center" style="font-size: 1rem;" readonly placeholder="Aguardando PIN...">
            <input type="hidden" id="responsavel_id">
          </div>
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

function bindForm(locaisComSetup) {
  const localSelect = document.getElementById('ps-local');
  const opcaoSelect = document.getElementById('ps-opcao');
  const produtoBox = document.getElementById('ps-produto');
  const quantidadeLabel = document.getElementById('ps-quantidade-label');
  const quantidadeInput = document.getElementById('ps-altura-pecas');
  const descontoInput = document.getElementById('ps-desconto');
  const totalInput = document.getElementById('ps-total');

  let opSelecionada = null;
  let regrasDisponiveis = [];
  let regraSelecionada = null;
  let itemSelecionado = null;
  let buscaItemId = 0;

  // Medidas usadas no item e no cálculo: override da regra (ex.: 1,300 fixo) ou as do setup.
  const medidasResolvidas = () => ({
    comprimento: Number(regraSelecionada.comprimento_override ?? opSelecionada.comprimento),
    largura: Number(regraSelecionada.largura_override ?? opSelecionada.largura)
  });

  // Cartão único do produto: mostra o item achado, um aviso (busca em andamento) ou o erro (bloqueia o apontamento).
  const mostrarProduto = ({ item, texto, erro }) => {
    if (item) {
      produtoBox.style.background = 'var(--green-50)';
      produtoBox.style.borderColor = 'var(--green-400)';
      produtoBox.innerHTML = `
        <div style="font-size: 0.8rem; color: var(--color-text-sec); font-family: monospace;">${esc(item.codigo)}</div>
        <div style="font-weight: 700; font-size: 1.05rem;">${esc(item.nome)}</div>`;
    } else if (erro) {
      produtoBox.style.background = '#fef2f2';
      produtoBox.style.borderColor = '#ef4444';
      produtoBox.innerHTML = `<div style="color: #ef4444; font-weight: 600; font-size: 0.95rem;">${esc(texto)}</div>`;
    } else {
      produtoBox.style.background = 'var(--dark-300)';
      produtoBox.style.borderColor = 'var(--color-border)';
      produtoBox.innerHTML = `<div style="color: var(--color-text-sec); font-size: 0.95rem;">${esc(texto || 'Selecione a Opção para ver o produto.')}</div>`;
    }
  };
  const mostrarMsgItem = (texto, erro) => mostrarProduto({ texto, erro });

  const limparItem = () => {
    buscaItemId++;
    itemSelecionado = null;
    mostrarProduto({});
  };
  mostrarProduto({});

  const atualizarRotuloQuantidade = () => {
    const modo = regraSelecionada?.modo_cubagem;
    quantidadeLabel.innerHTML = `${modo === 'PEÇAS' ? 'Peças' : modo === 'ALTURA' ? 'Altura (m)' : 'Altura/Peças'} <span class="required">*</span>`;
    quantidadeInput.step = modo === 'PEÇAS' ? '1' : 'any';
  };

  /** Recalcula o Total na tela; devolve o valor (ou null se faltar dado). */
  const atualizarTotal = () => {
    const quantidade = parseFloat(quantidadeInput.value);
    if (!opSelecionada || !regraSelecionada || !(quantidade > 0)) {
      totalInput.value = '';
      return null;
    }
    const { comprimento, largura } = medidasResolvidas();
    const total = calcularTotal({
      modoCubagem: regraSelecionada.modo_cubagem,
      comprimento,
      largura,
      bitolaMm: Number(opSelecionada.bitola),
      quantidade,
      desconto: Math.min(100, Math.max(0, parseInt(descontoInput.value) || 0))
    });
    totalInput.value = total.toFixed(4).replace('.', ',');
    return total;
  };

  const atualizarItem = async () => {
    limparItem();
    if (!opSelecionada || !regraSelecionada) return;

    const meuId = buscaItemId;
    const { comprimento, largura } = medidasResolvidas();
    const descricao = `${opSelecionada.especie} · ${regraSelecionada.classe || 'sem classe'} · ${regraSelecionada.opcao} · ${fmtMedida(comprimento)} × ${fmtMedida(largura)} m · ${fmtBitola(opSelecionada.bitola)} mm`;
    mostrarMsgItem('Buscando item...', false);

    try {
      const itens = await carregamentoItensSap; // já carregado ao entrar na tela (só espera se ainda estiver carregando)
      if (meuId !== buscaItemId) return; // o usuário já mudou a Opção/Local

      const r = acharItemSap(itens, {
        especie: opSelecionada.especie,
        classe: regraSelecionada.classe,
        opcao: regraSelecionada.opcao,
        comprimento,
        largura,
        bitolaMm: Number(opSelecionada.bitola)
      });

      if (r.item) {
        itemSelecionado = r.item;
        mostrarProduto({ item: r.item });
      } else if (r.erro === 'CLASSE_INDEFINIDA') {
        mostrarMsgItem('Esta Opção está sem Classe definida. Peça ao PCP para preencher em Configurações. Apontamento bloqueado.', true);
      } else if (r.erro === 'MAIS_DE_UM') {
        mostrarMsgItem(`Mais de um item encontrado no SAP para: ${descricao}. Avise o PCP. Apontamento bloqueado.`, true);
      } else {
        mostrarMsgItem(`Item não encontrado no SAP para: ${descricao}. Apontamento bloqueado.`, true);
      }
    } catch (err) {
      console.error('Erro ao carregar itens do SAP:', err);
      if (meuId !== buscaItemId) return;
      mostrarMsgItem('Falha ao carregar os itens do SAP. Atualize o app rolando a tela para baixo e tente de novo. Apontamento bloqueado.', true);
    }
  };

  const limparOpcao = (placeholder) => {
    regrasDisponiveis = [];
    regraSelecionada = null;
    opcaoSelect.innerHTML = `<option value="" selected>${placeholder}</option>`;
    opcaoSelect.disabled = true;
    limparItem();
    atualizarRotuloQuantidade();
    atualizarTotal();
  };

  localSelect.addEventListener('change', async () => {
    const local = locaisComSetup.find(l => l.nome === localSelect.value);
    opSelecionada = local?.op || null;

    if (!opSelecionada) {
      limparOpcao('Selecione o Local');
      return;
    }

    limparOpcao('Carregando...');
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
    if (regraSelecionada) {
      descontoInput.value = regraSelecionada.desconto;
    }
    atualizarRotuloQuantidade();
    atualizarTotal();
    atualizarItem();
  });

  quantidadeInput.addEventListener('input', atualizarTotal);
  descontoInput.addEventListener('input', atualizarTotal);

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

  // Etiqueta manual: etiqueta impressa antecipadamente, com código próprio. Sem código automático e sem impressão;
  // o banco aceita o código bipado (em MAIÚSCULAS) desde que ainda não exista em nenhum apontamento.
  const manualCheck = document.getElementById('ps-etiqueta-manual');
  const manualBox = document.getElementById('ps-etiqueta-manual-box');
  const qrManualInput = document.getElementById('ps-qrcode-manual');
  const qrManualMsg = document.getElementById('ps-qrcode-manual-msg');
  let etiquetaManualEmUso = false;
  let verificacaoId = 0;

  const msgQr = (texto, cor) => {
    qrManualMsg.textContent = texto;
    qrManualMsg.style.color = cor || 'var(--color-text-sec)';
  };

  const verificarEtiquetaManual = async () => {
    const qr = qrManualInput.value.trim().toUpperCase();
    qrManualInput.value = qr;
    etiquetaManualEmUso = false;
    if (!qr) { msgQr(''); return; }

    const meuId = ++verificacaoId;
    msgQr('Conferindo etiqueta...');
    try {
      const { data, error } = await withTimeout(rawRpc('qrcode_em_uso', { p_qrcode: qr }), 10000);
      if (meuId !== verificacaoId) return;
      if (error) throw new Error(error.message || 'ERRO');
      if (data === true) {
        etiquetaManualEmUso = true;
        msgQr('Etiqueta já usada em outro apontamento. Bipe outra.', '#ef4444');
        qrManualInput.select();
      } else {
        msgQr('✓ Etiqueta livre', '#059669');
      }
    } catch (err) {
      if (meuId !== verificacaoId) return;
      msgQr('Não deu para conferir agora; o banco confere ao salvar.');
    }
  };

  manualCheck.addEventListener('change', () => {
    manualBox.style.display = manualCheck.checked ? 'block' : 'none';
    qrManualInput.required = manualCheck.checked;
    verificacaoId++;
    etiquetaManualEmUso = false;
    qrManualInput.value = '';
    msgQr('');
    if (manualCheck.checked) qrManualInput.focus();
  });

  qrManualInput.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault(); // o leitor termina o QR com Enter: não pode enviar o formulário
    await verificarEtiquetaManual();
    if (!etiquetaManualEmUso && qrManualInput.value) pinInput.focus();
  });
  qrManualInput.addEventListener('change', verificarEtiquetaManual);

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
    if (!itemSelecionado) {
      formError.textContent = 'Item não encontrado no SAP para esta Opção: não é possível registrar o apontamento.';
      return;
    }
    const quantidade = parseFloat(quantidadeInput.value);
    if (!(quantidade > 0)) {
      formError.textContent = regraSelecionada.modo_cubagem === 'PEÇAS' ? 'Informe a quantidade de peças.' : 'Informe a altura.';
      return;
    }
    if (regraSelecionada.modo_cubagem === 'PEÇAS' && !Number.isInteger(quantidade)) {
      formError.textContent = 'A quantidade de peças deve ser um número inteiro.';
      return;
    }
    const manual = manualCheck.checked;
    const qrManual = qrManualInput.value.trim().toUpperCase();
    if (manual) {
      if (!qrManual) {
        formError.textContent = 'Bipe a etiqueta manual.';
        qrManualInput.focus();
        return;
      }
      if (etiquetaManualEmUso) {
        formError.textContent = 'Esta etiqueta já foi usada em outro apontamento. Bipe outra.';
        return;
      }
    }
    if (!respIdInput.value) {
      formError.textContent = 'Digite um PIN válido para prosseguir.';
      return;
    }

    btnSave.disabled = true;
    btnSave.innerHTML = 'Salvando...';

    try {
      const payload = {
        ...(manual ? { qrcode: qrManual } : {}),
        data_producao: document.getElementById('ps-data-producao').value,
        local: opSelecionada.secador,
        turno: opSelecionada.turno,
        modo: opSelecionada.tipo,
        especie: opSelecionada.especie,
        bitola: opSelecionada.bitola,
        cod_item: itemSelecionado.codigo,
        item: itemSelecionado.nome,
        comprimento: medidasResolvidas().comprimento,
        largura: medidasResolvidas().largura,
        modo_cubagem: regraSelecionada.modo_cubagem,
        altura_pecas: quantidade,
        desconto: Math.min(100, Math.max(0, parseInt(descontoInput.value) || 0)),
        total: atualizarTotal(),
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

      if (manual) {
        // Etiqueta pré-impressa: não imprime nada, o código é o que foi bipado
        formSuccess.textContent = `Apontamento ${insertData.qrcode} salvo com etiqueta manual (sem impressão).`;
      } else {
      // Etiqueta: POST para a impressora (https://tableros.ngrok.app/secagem). Valores como texto, igual ao da
      // Amarração; pecas_altura é a quantidade digitada no form (peças ou altura), não a Opção.
      const etiqueta = {
        qrcode: insertData.qrcode,
        turno: payload.turno,
        local: payload.local,
        pecas_altura: quantidadeInput.value,
        desconto: String(payload.desconto),
        total: Number(payload.total).toFixed(4),
        modo: payload.modo,
        local_estoque: payload.local_estoque,
        item: payload.item
      };
      const impressao = await enviarParaImpressora('/api/secagem', etiqueta);

      if (impressao.ok) {
        formSuccess.textContent = `Apontamento ${insertData.qrcode} salvo! Impressora: ${impressao.texto || 'OK'}`;
      } else {
        // Sem etiqueta a lâmina não tem como ser identificada: cancela o apontamento (mesmo comportamento da Amarração)
        const motivo = impressao.status ? `(${impressao.status})` : '(Rede)';
        const { error: delError } = await rawDelete('secagem_apontamentos', insertData.id);
        formError.textContent = delError
          ? `Impressora falhou ${motivo} e NÃO foi possível cancelar o apontamento ${insertData.qrcode}. Avise o PCP. Detalhe: ${impressao.texto}`
          : `Impressora falhou ${motivo}. Apontamento cancelado e não salvo no banco. Detalhe: ${impressao.texto}`;
      }
      }

      // Reset só PIN e Responsável: mantém o resto preenchido para o próximo apontamento da mesma remessa
      pinInput.value = '';
      pinInput.disabled = false;
      if (manual) {
        // Próxima etiqueta pré-impressa: limpa o campo e já deixa pronto para bipar
        qrManualInput.value = '';
        etiquetaManualEmUso = false;
        msgQr('');
        qrManualInput.focus();
      } else {
        pinInput.focus();
      }
      respInput.value = '';
      respIdInput.value = '';
      respInput.classList.remove('success-text');

      setTimeout(() => { formSuccess.textContent = ''; }, 3000);
    } catch (err) {
      console.error('[PRODUCAO SECAGEM ERROR]', err);
      const msg = String(err.message);
      if (msg.includes('QRCODE_DUPLICADO')) {
        // Outro tablet usou a etiqueta no meio tempo: nada foi gravado; pede outra etiqueta e o PIN de novo
        formError.textContent = 'Esta etiqueta já foi usada em outro apontamento. Nada foi salvo. Bipe outra etiqueta.';
        qrManualInput.value = '';
        etiquetaManualEmUso = false;
        msgQr('');
        qrManualInput.focus();
        pinInput.value = '';
        respInput.value = '';
        respIdInput.value = '';
        respInput.classList.remove('success-text');
      } else if (msg.includes('QRCODE_INVALIDO')) {
        formError.textContent = 'Código de etiqueta inválido (máximo de 60 caracteres). Bipe de novo.';
      } else {
        formError.textContent = 'Erro ao salvar: ' + msg;
      }
    } finally {
      btnSave.disabled = true; // Desabilitado porque o PIN foi limpo
      btnSave.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
        Salvar Apontamento
      `;
    }
  });
}
