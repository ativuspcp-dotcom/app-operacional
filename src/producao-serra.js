import { supabase } from './supabase.js';
import { withTimeout, rawRpc, podeAgir, getCurrentUserId } from './main.js';
import { headerHtml, bindHeader, renderErro, SPINNER } from './setup-secadores.js';
import { fetchSerraEAtiva } from './setup-serra.js';
import { ENDERECOS, fmtBitola, fmtMedida, esc, calcularTotal, carregarItensSap, acharItemSap, rawInsert, fetchRegrasCubagem } from './lamina-seca.js';

const SLUG = 'app_serra';
const SERRA = 'SERRA'; // nome usado nas tabelas de medidas/regras (compartilhadas com a Secagem)
const LOCAIS_ESTOQUE = ['CONSUMIR', 'MERCADO INTERNO'];

// Igual à Produção Secagem (tela de totem), com duas diferenças: comprimento e largura NÃO vêm do setup,
// são escolhidos aqui numa lista de medidas cadastrada no portal (Configurações > PCP > Serra), e as Opções
// dependem dessa medida; e o Local Estoque tem outras opções.

// Cache das lâminas secas do SAP (grupo 145): carregado ao entrar na tela e mantido em memória.
// Para atualizar, o usuário recarrega o app rolando a tela para baixo (mesmo jeito do compensado).
let carregamentoItensSap = null;

// Medidas ativas da Serra (comprimento x largura). Chamar depois de fetchSerraEAtiva, nunca junto: o
// supabase-js trava com várias chamadas simultâneas (Web Lock).
async function fetchMedidasSerra() {
  const { data, error } = await withTimeout(
    supabase.from('pcp_secagem_setup_medidas')
      .select('comprimento, largura')
      .eq('secador', SERRA)
      .eq('ativo', true),
    10000
  );
  if (error) throw error;
  return (data || [])
    .map(m => ({ comprimento: Number(m.comprimento), largura: Number(m.largura) }))
    .sort((a, b) => b.comprimento - a.comprimento || b.largura - a.largura);
}

const mensagemCard = (texto) => `<div style="background: white; padding: 24px; border-radius: 12px; text-align: center; color: var(--color-text-sec);">${texto}</div>`;

export async function renderProducaoSerra(container) {
  // Carrega os itens do SAP em segundo plano assim que a tela abre; o .catch evita aviso de rejeição
  // não tratada (quem usa o resultado trata o erro no seu próprio try/catch).
  carregamentoItensSap = carregarItensSap();
  carregamentoItensSap.catch(() => {});

  container.innerHTML = `
    ${headerHtml('Produção Serra', '/')}
    <div class="container mt-4" id="pr-content">
      <div class="text-center" style="padding: 40px;">${SPINNER}</div>
    </div>
  `;
  bindHeader();

  let dados;
  let medidas;
  try {
    dados = await fetchSerraEAtiva();
    medidas = await fetchMedidasSerra();
  } catch (err) {
    console.error('Erro ao carregar a serra:', err);
    const content = document.getElementById('pr-content');
    if (content) renderErro(content, 'Erro ao carregar a serra. Verifique a conexão.');
    return;
  }

  const content = document.getElementById('pr-content');
  if (!content) return;

  if (!dados.temSerra) {
    content.innerHTML = mensagemCard('Nenhuma serra cadastrada nesta filial.');
    return;
  }
  if (!dados.ativa) {
    content.innerHTML = mensagemCard('A serra está sem setup ativo. Defina o setup em <strong>Setup Serra</strong> antes de apontar.');
    return;
  }
  if (medidas.length === 0) {
    content.innerHTML = mensagemCard('Nenhuma medida cadastrada para a serra. Peça ao PCP para cadastrar em Configurações &gt; PCP &gt; Serra.');
    return;
  }

  const podeApontar = podeAgir(SLUG);
  const today = new Date().toISOString().split('T')[0];

  content.innerHTML = `
    <div style="background: white; padding: 24px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
      ${!podeApontar ? '<div class="text-center error-text mb-4">Somente visualização: seu acesso não permite registrar apontamentos.</div>' : ''}
      <form id="pr-form" autocomplete="off">
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Data Produção <span class="required">*</span></label>
            <input type="date" id="pr-data-producao" class="form-input" value="${today}" required>
          </div>
          <div class="form-group">
            <label class="form-label">Medida (Comp. × Larg.) <span class="required">*</span></label>
            <select id="pr-medida" class="form-input" style="appearance: auto; height: 48px; background-color: var(--dark-300);" required>
              <option value="" disabled selected>Selecione...</option>
              ${medidas.map(m => `<option value="${m.comprimento}|${m.largura}">${fmtMedida(m.comprimento)} × ${fmtMedida(m.largura)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Opção <span class="required">*</span></label>
          <select id="pr-opcao" class="form-input" style="appearance: auto; height: 48px;" disabled required>
            <option value="" selected>Selecione a Medida</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Produto encontrado</label>
          <div id="pr-produto" style="min-height: 64px; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--color-border); background: var(--dark-300); display: flex; flex-direction: column; justify-content: center;"></div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0 16px;">
          <div class="form-group">
            <label class="form-label" id="pr-quantidade-label">Altura/Peças <span class="required">*</span></label>
            <input type="number" id="pr-altura-pecas" class="form-input" step="any" min="0" required>
          </div>
          <div class="form-group">
            <label class="form-label">Desconto (%)</label>
            <input type="number" id="pr-desconto" class="form-input" step="1" min="0" max="100" value="0">
          </div>
          <div class="form-group">
            <label class="form-label">Total (m³)</label>
            <input type="text" id="pr-total" class="form-input input-readonly" readonly placeholder="-">
          </div>
        </div>

        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Local Estoque <span class="required">*</span></label>
            <select id="pr-local-estoque" class="form-input" style="appearance: auto; height: 48px; background-color: var(--dark-300);" required>
              <option value="" disabled selected>Selecione...</option>
              ${LOCAIS_ESTOQUE.map(o => `<option value="${o}">${o}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Endereço <span class="required">*</span></label>
            <select id="pr-endereco" class="form-input" style="appearance: auto; height: 48px; background-color: var(--dark-300);" required>
              <option value="" disabled selected>Selecione...</option>
              ${ENDERECOS.map(o => `<option value="${o}">${o}</option>`).join('')}
            </select>
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

  bindForm(dados.ativa);
}

function bindForm(op) {
  const medidaSelect = document.getElementById('pr-medida');
  const opcaoSelect = document.getElementById('pr-opcao');
  const produtoBox = document.getElementById('pr-produto');
  const quantidadeLabel = document.getElementById('pr-quantidade-label');
  const quantidadeInput = document.getElementById('pr-altura-pecas');
  const descontoInput = document.getElementById('pr-desconto');
  const totalInput = document.getElementById('pr-total');

  let medidaSelecionada = null; // { comprimento, largura } escolhida no apontamento
  let regrasDisponiveis = [];
  let regraSelecionada = null;
  let itemSelecionado = null;
  let buscaItemId = 0;

  // Medidas usadas no item e no cálculo: override da regra (ex.: 1,300 fixo) ou as escolhidas no apontamento.
  const medidasResolvidas = () => ({
    comprimento: Number(regraSelecionada.comprimento_override ?? medidaSelecionada.comprimento),
    largura: Number(regraSelecionada.largura_override ?? medidaSelecionada.largura)
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
    if (!medidaSelecionada || !regraSelecionada || !(quantidade > 0)) {
      totalInput.value = '';
      return null;
    }
    const { comprimento, largura } = medidasResolvidas();
    const total = calcularTotal({
      modoCubagem: regraSelecionada.modo_cubagem,
      comprimento,
      largura,
      bitolaMm: Number(op.bitola),
      quantidade,
      desconto: Math.min(100, Math.max(0, parseInt(descontoInput.value) || 0))
    });
    totalInput.value = total.toFixed(4).replace('.', ',');
    return total;
  };

  const atualizarItem = async () => {
    limparItem();
    if (!medidaSelecionada || !regraSelecionada) return;

    const meuId = buscaItemId;
    const { comprimento, largura } = medidasResolvidas();
    const descricao = `${op.especie} · ${regraSelecionada.classe || 'sem classe'} · ${regraSelecionada.opcao} · ${fmtMedida(comprimento)} × ${fmtMedida(largura)} m · ${fmtBitola(op.bitola)} mm`;
    mostrarProduto({ texto: 'Buscando item...' });

    try {
      const itens = await carregamentoItensSap; // já carregado ao entrar na tela (só espera se ainda estiver carregando)
      if (meuId !== buscaItemId) return; // o usuário já mudou a Medida/Opção

      const r = acharItemSap(itens, {
        especie: op.especie,
        classe: regraSelecionada.classe,
        opcao: regraSelecionada.opcao,
        comprimento,
        largura,
        bitolaMm: Number(op.bitola)
      });

      if (r.item) {
        itemSelecionado = r.item;
        mostrarProduto({ item: r.item });
      } else if (r.erro === 'CLASSE_INDEFINIDA') {
        mostrarProduto({ texto: 'Esta Opção está sem Classe definida. Peça ao PCP para preencher em Configurações. Apontamento bloqueado.', erro: true });
      } else if (r.erro === 'MAIS_DE_UM') {
        mostrarProduto({ texto: `Mais de um item encontrado no SAP para: ${descricao}. Avise o PCP. Apontamento bloqueado.`, erro: true });
      } else {
        mostrarProduto({ texto: `Item não encontrado no SAP para: ${descricao}. Apontamento bloqueado.`, erro: true });
      }
    } catch (err) {
      console.error('Erro ao carregar itens do SAP:', err);
      if (meuId !== buscaItemId) return;
      mostrarProduto({ texto: 'Falha ao carregar os itens do SAP. Atualize o app rolando a tela para baixo e tente de novo. Apontamento bloqueado.', erro: true });
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

  medidaSelect.addEventListener('change', async () => {
    const [comprimento, largura] = medidaSelect.value.split('|').map(Number);
    medidaSelecionada = medidaSelect.value ? { comprimento, largura } : null;

    if (!medidaSelecionada) {
      limparOpcao('Selecione a Medida');
      return;
    }

    limparOpcao('Carregando...');
    const medidaDaBusca = medidaSelecionada;
    try {
      regrasDisponiveis = await fetchRegrasCubagem(SERRA, comprimento, largura);
    } catch (err) {
      console.error('Erro ao carregar regras de cubagem:', err);
      regrasDisponiveis = [];
    }
    if (medidaSelecionada !== medidaDaBusca) return; // o usuário já trocou a Medida

    if (regrasDisponiveis.length === 0) {
      limparOpcao('Configuração pendente para esta medida');
      return;
    }

    opcaoSelect.disabled = false;
    opcaoSelect.innerHTML = `<option value="" disabled selected>Selecione...</option>` +
      regrasDisponiveis.map(r => `<option value="${esc(r.opcao)}">${esc(r.opcao)}</option>`).join('');
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

  document.getElementById('pr-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.textContent = '';
    formSuccess.textContent = '';
    if (!podeAgir(SLUG)) return;

    if (!medidaSelecionada) {
      formError.textContent = 'Selecione a Medida.';
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
    if (!respIdInput.value) {
      formError.textContent = 'Digite um PIN válido para prosseguir.';
      return;
    }

    btnSave.disabled = true;
    btnSave.innerHTML = 'Salvando...';

    try {
      const { comprimento, largura } = medidasResolvidas();
      const payload = {
        data_producao: document.getElementById('pr-data-producao').value,
        turno: op.turno,
        modo: op.tipo,
        especie: op.especie,
        bitola: op.bitola,
        cod_item: itemSelecionado.codigo,
        item: itemSelecionado.nome,
        comprimento,
        largura,
        modo_cubagem: regraSelecionada.modo_cubagem,
        altura_pecas: quantidade,
        desconto: Math.min(100, Math.max(0, parseInt(descontoInput.value) || 0)),
        total: atualizarTotal(),
        local_estoque: document.getElementById('pr-local-estoque').value,
        endereco: document.getElementById('pr-endereco').value,
        responsavel_id: respIdInput.value,
        responsavel_nome: respInput.value,
        tablet_user_id: getCurrentUserId(),
        op_id: op.id
      };

      const { data: insertData, error: insertError } = await withTimeout(rawInsert('serra_apontamentos', payload), 15000);
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
      console.error('[PRODUCAO SERRA ERROR]', err);
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
