import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase.js';
import { currentBPLID, withTimeout, rawRpc, podeAgir, getAccessToken, renderBranchSelector, bindBranchSelector } from './main.js';
import { CARD_STYLE } from './setup-secadores.js';
import { esc } from './lamina-seca.js';
import { capturarFotoComCarimbo } from './foto-carimbo.js';

const SLUG = 'app_qualidade_laminacao';
const BUCKET = 'qualidade-fotos';
const N_CORPOS = 4; // lâminas auditadas por apontamento
const N_ROLETES = 4;
const UPLOADS_SIMULTANEOS = 4;

// RQ03 - Registro de Qualidade - Laminação (plano: PLANO_RQ03.md). Um apontamento = 4 corpos de prova
// (comprimento, largura, espessura, esquadro) + 4 roletes (temperatura), cada medida com foto carimbada.
// A tela é paginada: uma página por medida. A classificação (OK/ALERTA/PROBLEMA) é feita só no banco
// (função registrar_rq03_laminacao) e propositalmente NÃO aparece aqui.
//
// Rascunho: fica em memória (módulo) enquanto o app não for recarregado; sair da tela e voltar continua de onde parou.

const TIPOS = {
  comprimento: { nome: 'Comprimento', unidade: 'm', casas: 2, pontos: 2, padrao: true,
    rotulos: ['Comprimento 1 (lado esquerdo da lâmina)', 'Comprimento 2 (lado direito da lâmina)'], capturas: ['Captura C1', 'Captura C2'] },
  largura: { nome: 'Largura', unidade: 'm', casas: 2, pontos: 2, padrao: true,
    rotulos: ['Largura 1', 'Largura 2'], capturas: ['Captura L1', 'Captura L2'] },
  espessura: { nome: 'Espessura', unidade: 'mm', casas: 2, pontos: 2, padrao: true,
    rotulos: ['Espessura 1', 'Espessura 2'], capturas: ['Captura E1', 'Captura E2'] },
  esquadro: { nome: 'Esquadro', unidade: 'cm', casas: 2, pontos: 1, padrao: false,
    rotulos: ['Esquadro'], capturas: ['Captura Esquadro'] },
  temperatura: { nome: 'Temperatura', unidade: '°C', casas: 1, pontos: 2, padrao: false,
    rotulos: ['Temperatura 1', 'Temperatura 2'], capturas: ['Captura T1', 'Captura T2'] }
};
const ORDEM_POR_CORPO = ['comprimento', 'largura', 'espessura', 'esquadro'];

// Etapas na ordem: para cada corpo (comprimento, largura, espessura, esquadro), depois os roletes, depois a revisão.
const ETAPAS = [];
for (let corpo = 1; corpo <= N_CORPOS; corpo++) ORDEM_POR_CORPO.forEach((tipo) => ETAPAS.push({ tipo, indice: corpo }));
for (let rolete = 1; rolete <= N_ROLETES; rolete++) ETAPAS.push({ tipo: 'temperatura', indice: rolete });
ETAPAS.push({ tipo: 'final' });

const BACK_SVG = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>';
const CAMERA_SVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>';

// ---------- estado do rascunho ----------

let estado = null;

function novoEstado() {
  const medidas = {};
  const ponto = () => ({ valor: '', foto: null, url: null, capturadaEm: null });
  for (const [tipo, cfg] of Object.entries(TIPOS)) {
    const itens = tipo === 'temperatura' ? N_ROLETES : N_CORPOS;
    medidas[tipo] = Array.from({ length: itens }, () => Array.from({ length: cfg.pontos }, ponto));
  }
  return {
    id: crypto.randomUUID(), // vira o id do registro e entra no caminho das fotos (reenvio é idempotente)
    bplId: currentBPLID,
    etapa: 0,
    padroes: { comprimento: '', largura: '', espessura: '' },
    medidas,
    enviadas: new Set() // caminhos de fotos já no Storage (numa nova tentativa só sobe o que falta)
  };
}

const temProgresso = () => estado.etapa > 0
  || Object.values(estado.padroes).some(Boolean)
  || Object.values(estado.medidas).some(itens => itens.some(pts => pts.some(p => p.valor || p.foto)));

function descartarRascunho() {
  if (estado) for (const itens of Object.values(estado.medidas)) for (const pts of itens) for (const p of pts) if (p.url) URL.revokeObjectURL(p.url);
  estado = novoEstado();
}

// ---------- utilidades ----------

/** Mantém só dígitos e um separador decimal, com no máximo `casas` casas. */
function limparNumero(texto, casas) {
  let t = texto.replace(/[^\d.,]/g, '').replace('.', ',');
  const i = t.indexOf(',');
  if (i >= 0) t = t.slice(0, i + 1) + t.slice(i + 1).replace(/,/g, '').slice(0, casas);
  return t;
}

function paraNumero(texto) {
  const n = Number(String(texto).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const caminhoFoto = (tipo, indice, ponto) => `rq03/${estado.bplId}/${estado.id}/${tipo}-${indice}-${ponto}.jpg`;

function tituloEtapa(etapa) {
  if (etapa.tipo === 'final') return 'Revisão e confirmação';
  if (etapa.tipo === 'temperatura') return `Rolete ${etapa.indice} — Temperatura`;
  return `Lâmina ${etapa.indice} auditada — ${TIPOS[etapa.tipo].nome}`;
}

function etapaCompleta(etapa) {
  if (etapa.tipo === 'final') return true;
  const cfg = TIPOS[etapa.tipo];
  const pontos = estado.medidas[etapa.tipo][etapa.indice - 1];
  const padraoOk = !cfg.padrao || paraNumero(estado.padroes[etapa.tipo]) !== null;
  return padraoOk && pontos.every(p => p.foto && paraNumero(p.valor) !== null);
}

// ---------- tela ----------

// O seletor de filial só aparece antes de começar: trocar a filial recarrega o app e perderia o rascunho.
function cabecalho() {
  return `
    <div class="header" style="justify-content: space-between; gap: 8px;">
      <button id="btn-back" style="color: white; padding: 8px; border:none; background:transparent;">${BACK_SVG}</button>
      <div class="header-title" style="flex: 1;">RQ03 · Qualidade Laminação</div>
      ${temProgresso() ? '' : renderBranchSelector()}
    </div>`;
}

function htmlPonto(cfg, etapa, ponto, dados) {
  const foto = dados.foto
    ? `<div style="display: flex; align-items: center; gap: 12px;">
         <img src="${dados.url}" alt="Foto" style="width: 96px; height: 96px; object-fit: cover; border-radius: 8px; border: 2px solid var(--green-400);">
         <button type="button" class="btn-foto" data-ponto="${ponto}" style="padding: 12px 16px; border: 1px solid var(--color-border); border-radius: 8px; background: white; font-weight: 600;">Refazer foto</button>
       </div>`
    : `<button type="button" class="btn btn-primary btn-foto" data-ponto="${ponto}" style="padding: 20px;">${CAMERA_SVG} Tirar foto</button>`;

  return `
    <div style="padding: 14px; border: 1px solid var(--color-border); border-radius: 10px; margin-bottom: 14px;">
      <div class="form-label">${cfg.capturas[ponto]} <span class="required" style="color:#ef4444;">*</span></div>
      <div style="margin-bottom: 14px;">${foto}</div>
      <label class="form-label" for="valor-${ponto}">${cfg.rotulos[ponto]} (${cfg.unidade}) <span class="required" style="color:#ef4444;">*</span></label>
      <input type="text" id="valor-${ponto}" class="form-input valor-input" data-ponto="${ponto}" inputmode="decimal" autocomplete="off" placeholder="0,${'0'.repeat(cfg.casas)}" value="${esc(dados.valor)}" style="font-size: 1.4rem; text-align: center;">
    </div>`;
}

function htmlPadrao(cfg, etapa) {
  if (!cfg.padrao) return '';
  if (etapa.indice === 1) {
    return `
      <div class="form-group">
        <label class="form-label" for="padrao">Padrão de ${cfg.nome.toLowerCase()} (${cfg.unidade}) <span class="required" style="color:#ef4444;">*</span></label>
        <input type="text" id="padrao" class="form-input" inputmode="decimal" autocomplete="off" placeholder="0,${'0'.repeat(cfg.casas)}" value="${esc(estado.padroes[etapa.tipo])}" style="font-size: 1.4rem; text-align: center;">
        <div style="font-size: 0.8rem; color: var(--color-text-sec); margin-top: 6px;">Vale para as 4 lâminas deste registro.</div>
      </div>`;
  }
  return `
    <div style="margin-bottom: 14px; padding: 10px 14px; background: var(--green-50); border-radius: 8px; font-size: 0.95rem;">
      Padrão de ${cfg.nome.toLowerCase()}: <strong>${esc(estado.padroes[etapa.tipo])} ${cfg.unidade}</strong>
    </div>`;
}

function htmlRodape(pos, ultima, permitido) {
  return `
    <div style="display: flex; gap: 10px; margin-top: 8px;">
      <button type="button" id="btn-anterior" class="btn" style="flex: 1; background: white; border: 1px solid var(--color-border); ${pos === 0 ? 'opacity: .4;' : ''}" ${pos === 0 ? 'disabled' : ''}>Voltar</button>
      ${ultima ? '' : `<button type="button" id="btn-proximo" class="btn btn-primary" style="flex: 2;" ${permitido ? '' : 'disabled'}>Próximo</button>`}
    </div>`;
}

function renderEtapa(container) {
  const pos = estado.etapa;
  const etapa = ETAPAS[pos];
  const ultima = etapa.tipo === 'final';
  const progresso = Math.round((pos / (ETAPAS.length - 1)) * 100);

  container.innerHTML = `
    ${cabecalho()}
    <div class="container mt-4">
      <div style="margin-bottom: 14px;">
        <div style="display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--color-text-sec); margin-bottom: 6px;">
          <span>Etapa ${pos + 1} de ${ETAPAS.length}</span>
          ${pos === 0 && temProgresso() ? '<button type="button" id="btn-descartar" style="background:none; border:none; color:#ef4444; font-weight:600; font-size: 0.8rem;">Descartar rascunho</button>' : ''}
        </div>
        <div style="height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden;"><div style="height: 100%; width: ${progresso}%; background: var(--green-400); transition: width .2s;"></div></div>
      </div>
      <div style="${CARD_STYLE}">
        <div style="font-size: 1.15rem; font-weight: 700; margin-bottom: 16px;">${tituloEtapa(etapa)}</div>
        <div id="etapa-corpo"></div>
        <div id="etapa-erro" class="error-text" style="min-height: 20px; margin: 8px 0; text-align: center;"></div>
        <div id="etapa-rodape"></div>
      </div>
    </div>`;

  const back = document.getElementById('btn-back');
  back.addEventListener('click', () => { window.location.hash = '/'; });
  bindBranchSelector();
  document.getElementById('btn-descartar')?.addEventListener('click', () => {
    if (confirm('Descartar tudo o que foi preenchido neste registro?')) { descartarRascunho(); renderEtapa(container); }
  });

  if (ultima) renderRevisao(container);
  else renderMedida(container, etapa);

  window.scrollTo(0, 0);
}

function renderMedida(container, etapa) {
  const cfg = TIPOS[etapa.tipo];
  const pontos = estado.medidas[etapa.tipo][etapa.indice - 1];
  const corpo = document.getElementById('etapa-corpo');
  corpo.innerHTML = htmlPadrao(cfg, etapa) + pontos.map((dados, i) => htmlPonto(cfg, etapa, i, dados)).join('');
  document.getElementById('etapa-rodape').innerHTML = htmlRodape(estado.etapa, false, etapaCompleta(etapa));

  const atualizarProximo = () => {
    const btn = document.getElementById('btn-proximo');
    if (btn) btn.disabled = !etapaCompleta(etapa);
  };

  document.getElementById('padrao')?.addEventListener('input', (e) => {
    e.target.value = limparNumero(e.target.value, cfg.casas);
    estado.padroes[etapa.tipo] = e.target.value;
    atualizarProximo();
  });

  corpo.querySelectorAll('.valor-input').forEach((input) => {
    input.addEventListener('input', () => {
      input.value = limparNumero(input.value, cfg.casas);
      pontos[Number(input.dataset.ponto)].valor = input.value;
      atualizarProximo();
    });
  });

  corpo.querySelectorAll('.btn-foto').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const i = Number(btn.dataset.ponto);
      const erro = document.getElementById('etapa-erro');
      erro.textContent = '';
      try {
        const rotulo = `${etapa.tipo === 'temperatura' ? `Rolete ${etapa.indice}` : `Lâmina ${etapa.indice}`} · ${cfg.rotulos[i].replace(/ \(.*\)/, '')}`;
        const foto = await capturarFotoComCarimbo({ rotulo });
        if (!foto) return;
        const atual = pontos[i];
        if (atual.url) URL.revokeObjectURL(atual.url);
        estado.enviadas.delete(caminhoFoto(etapa.tipo, etapa.indice, i + 1)); // foto nova: precisa subir de novo
        Object.assign(atual, { foto: foto.blob, url: URL.createObjectURL(foto.blob), capturadaEm: foto.capturadaEm });
        renderEtapa(container);
      } catch (err) {
        console.error('Erro na foto:', err);
        erro.textContent = 'Não foi possível tirar a foto. Tente de novo.';
      }
    });
  });

  document.getElementById('btn-anterior').addEventListener('click', () => { if (estado.etapa > 0) { estado.etapa--; renderEtapa(container); } });
  document.getElementById('btn-proximo').addEventListener('click', () => {
    if (!etapaCompleta(etapa)) return;
    estado.etapa++;
    renderEtapa(container);
  });
}

// ---------- revisão + salvar ----------

function primeiraEtapaIncompleta() {
  return ETAPAS.findIndex(e => e.tipo !== 'final' && !etapaCompleta(e));
}

function renderRevisao(container) {
  const faltando = primeiraEtapaIncompleta();
  const linhas = Object.entries(TIPOS).map(([tipo, cfg]) => {
    const padrao = cfg.padrao ? ` · padrão ${esc(estado.padroes[tipo])} ${cfg.unidade}` : '';
    return `<div style="display:flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--color-border); font-size: 0.9rem;"><span>${cfg.nome}</span><span style="color: var(--color-text-sec);">${estado.medidas[tipo].length * cfg.pontos} medidas${padrao}</span></div>`;
  }).join('');

  document.getElementById('etapa-corpo').innerHTML = `
    ${faltando >= 0 ? `<div class="error-text" style="margin-bottom: 12px;">Há etapas sem preencher. <button type="button" id="btn-ir-faltando" style="background:none; border:none; color: var(--green-500); font-weight:700; text-decoration: underline;">Ir para a etapa ${faltando + 1}</button></div>` : ''}
    <div style="margin-bottom: 16px;">${linhas}</div>
    <div class="form-group">
      <label class="form-label text-center" for="pin">Senha (PIN) do apontador</label>
      <input type="text" id="pin" class="form-input pin-input" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="****" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore data-bwignore>
    </div>
    <div id="envio-progresso" style="text-align: center; font-size: 0.9rem; color: var(--color-text-sec); min-height: 20px; margin-bottom: 8px;"></div>`;
  document.getElementById('etapa-rodape').innerHTML = `
    <div style="display: flex; gap: 10px;">
      <button type="button" id="btn-anterior" class="btn" style="flex: 1; background: white; border: 1px solid var(--color-border);">Voltar</button>
      <button type="button" id="btn-salvar" class="btn btn-primary" style="flex: 2;" disabled>Salvar registro</button>
    </div>`;

  const pinInput = document.getElementById('pin');
  const btnSalvar = document.getElementById('btn-salvar');
  const btnAnterior = document.getElementById('btn-anterior');
  const erro = document.getElementById('etapa-erro');
  const progresso = document.getElementById('envio-progresso');
  const pronto = () => faltando < 0 && /^\d{4}$/.test(pinInput.value) && podeAgir(SLUG);

  document.getElementById('btn-ir-faltando')?.addEventListener('click', () => { estado.etapa = faltando; renderEtapa(container); });
  btnAnterior.addEventListener('click', () => { estado.etapa--; renderEtapa(container); });
  pinInput.addEventListener('input', () => { btnSalvar.disabled = !pronto(); });

  btnSalvar.addEventListener('click', async () => {
    if (!pronto()) return;
    btnSalvar.disabled = true;
    btnAnterior.disabled = true;
    pinInput.disabled = true;
    erro.textContent = '';

    const resultado = await salvarRegistro(pinInput.value, (texto) => { progresso.textContent = texto; });

    if (resultado.ok) {
      renderSucesso(container);
      return;
    }
    progresso.textContent = '';
    erro.textContent = resultado.mensagem;
    pinInput.value = '';
    pinInput.disabled = false;
    btnAnterior.disabled = false;
    pinInput.focus();
  });
}

async function enviarFoto(path, blob) {
  const res = await withTimeout(fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${getAccessToken()}`,
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'max-age=31536000',
      'x-upsert': 'false'
    },
    body: blob
  }), 60000);
  if (res.ok) return;
  const corpo = await res.json().catch(() => ({}));
  // Já existe = subiu numa tentativa anterior cuja resposta se perdeu: vale como enviada
  if (String(corpo.statusCode) === '409' || corpo.error === 'Duplicate') return;
  throw new Error(corpo.message || `Falha ao enviar foto (${res.status})`);
}

async function salvarRegistro(pin, aoProgredir) {
  try {
    // 1) Fotos que ainda não estão no Storage (fetch nativo, poucas ao mesmo tempo)
    const pendentes = [];
    for (const [tipo, itens] of Object.entries(estado.medidas)) {
      itens.forEach((pontos, i) => pontos.forEach((p, j) => {
        const path = caminhoFoto(tipo, i + 1, j + 1);
        if (!estado.enviadas.has(path)) pendentes.push({ path, blob: p.foto });
      }));
    }
    const total = pendentes.length;
    let feitas = 0;
    if (total > 0) aoProgredir(`Enviando fotos... 0/${total}`);
    const fila = [...pendentes];
    const trabalhador = async () => {
      while (fila.length > 0) {
        const alvo = fila.shift();
        await enviarFoto(alvo.path, alvo.blob);
        estado.enviadas.add(alvo.path);
        feitas++;
        aoProgredir(`Enviando fotos... ${feitas}/${total}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(UPLOADS_SIMULTANEOS, total) }, trabalhador));

    // 2) Registro (a função confere PIN, permissão, filial e se as 36 fotos existem)
    aoProgredir('Gravando registro...');
    const numero = (t) => Number(String(t).replace(',', '.'));
    const pontosDe = (tipo, i) => estado.medidas[tipo][i].map(p => ({ valor: numero(p.valor), foto_em: p.capturadaEm }));
    const dados = {
      padroes: Object.fromEntries(Object.keys(estado.padroes).map(k => [k, numero(estado.padroes[k])])),
      ...Object.fromEntries(Object.keys(TIPOS).map(tipo => [tipo, estado.medidas[tipo].map((_, i) => pontosDe(tipo, i))]))
    };
    const { data, error } = await withTimeout(rawRpc('registrar_rq03_laminacao', { p_pin: pin, p_bpl_id: estado.bplId, p_id: estado.id, p_dados: dados }), 30000);

    if (error) {
      const msg = String(error.message || '');
      if (msg.includes('PIN_BLOQUEADO')) return { ok: false, mensagem: 'Muitas tentativas com PIN errado. Aguarde 5 minutos e tente novamente.' };
      if (msg.includes('SEM_PERMISSAO')) return { ok: false, mensagem: 'Esta estação não tem permissão para registrar.' };
      if (msg.includes('FILIAL_NAO_PERMITIDA')) return { ok: false, mensagem: 'Esta estação não tem acesso a esta filial.' };
      if (msg.includes('FOTO_AUSENTE')) {
        estado.enviadas.clear(); // o servidor não achou alguma foto: na próxima tentativa reenvia todas
        return { ok: false, mensagem: 'Alguma foto não chegou ao servidor. Toque em Salvar para reenviar.' };
      }
      console.error('Erro ao gravar RQ03:', error);
      return { ok: false, mensagem: 'Não foi possível gravar. Confira os valores e tente de novo.' };
    }
    if (data?.status === 'PIN_INVALIDO') return { ok: false, mensagem: 'PIN inválido ou inativo.' };
    if (data?.status !== 'OK') return { ok: false, mensagem: 'Resposta inesperada do servidor. Tente de novo.' };
    return { ok: true };
  } catch (err) {
    console.error('Erro ao salvar RQ03:', err);
    return { ok: false, mensagem: 'Sem conexão com o servidor. O rascunho foi mantido: toque em Salvar para tentar de novo.' };
  }
}

function renderSucesso(container) {
  descartarRascunho();
  container.innerHTML = `
    <div class="header"><div class="header-title" style="flex: 1;">RQ03 · Qualidade Laminação</div></div>
    <div class="container mt-4">
      <div style="${CARD_STYLE} text-align: center;">
        <div style="font-size: 3rem; color: var(--green-500);">✓</div>
        <div style="font-size: 1.3rem; font-weight: 700; margin-bottom: 20px;">Registro salvo</div>
        <button type="button" id="btn-novo" class="btn btn-primary" style="margin-bottom: 10px;">Novo registro</button>
        <button type="button" id="btn-inicio" class="btn" style="background: white; border: 1px solid var(--color-border);">Voltar ao início</button>
      </div>
    </div>`;
  document.getElementById('btn-novo').addEventListener('click', () => renderEtapa(container));
  document.getElementById('btn-inicio').addEventListener('click', () => { window.location.hash = '/'; });
}

// ---------- entrada ----------

export function renderQualidadeLaminacao(container) {
  if (!podeAgir(SLUG)) {
    container.innerHTML = `
      <div class="header"><button id="btn-back" style="color: white; padding: 8px; border:none; background:transparent;">${BACK_SVG}</button><div class="header-title" style="flex: 1;">RQ03 · Qualidade Laminação</div></div>
      <div class="container mt-4"><div style="${CARD_STYLE} text-align: center;" class="error-text">Somente visualização: seu acesso não permite registrar.</div></div>`;
    document.getElementById('btn-back').addEventListener('click', () => { window.location.hash = '/'; });
    return;
  }
  // Rascunho de outra filial não vale: as fotos vão para a pasta da filial escolhida
  if (!estado || estado.bplId !== currentBPLID) descartarRascunho();
  renderEtapa(container);
}
