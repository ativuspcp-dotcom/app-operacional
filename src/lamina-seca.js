import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase.js';
import { withTimeout } from './main.js';

// Código compartilhado entre Produção Secagem e Produção Serra: formatação, ordem das Opções, busca do item
// no SAP (lâminas secas, grupo 145), cálculo do Total, gravação e regras de cubagem.

export const ENDERECOS = Array.from({ length: 30 }, (_, i) => `PILHA ${i + 1}`);

export const fmtBitola = (v) => Number(v).toFixed(1).replace('.', ',');
export const fmtMedida = (v) => Number(v).toFixed(3).replace('.', ',');
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Ordem de exibição das Opções (a mesma da tela de Configurações do portal).
export const ORDEM_OPCOES = ['A', 'B', 'C', 'CP', 'D', 'L', 'G', 'CASCA'];
export const posicaoOpcao = (opcao) => {
  const i = ORDEM_OPCOES.indexOf(opcao);
  return i === -1 ? ORDEM_OPCOES.length : i;
};

// Códigos de U_Class / U_Quality no SAP (mesmos da tela Lâminas Secas do portal).
const CLASSES_SAP = { CAPA: '601', ENCHIMENTO: '602', MIOLO: '603' };
const QUALIDADES_SAP = { A: '601', B: '602', C: '603', CP: '604', D: '605', L: '606', G: '607', CASCA: '608' };

/**
 * Total em m³. PEÇAS: comprimento x largura x bitola (mm -> m) x peças. ALTURA: comprimento x largura x altura.
 * Nos dois casos aplica o desconto em % (0 = sem desconto).
 */
export function calcularTotal({ modoCubagem, comprimento, largura, bitolaMm, quantidade, desconto }) {
  const base = modoCubagem === 'PEÇAS'
    ? comprimento * largura * (bitolaMm / 1000) * quantidade
    : comprimento * largura * quantidade;
  return Number((base * (1 - desconto / 100)).toFixed(4));
}

export async function carregarItensSap() {
  const url = encodeURI("/api/Items?$select=ItemCode,ItemName,SalesFactor1,SalesFactor2,SalesFactor3,U_Class,U_Quality&$filter=ItemsGroupCode eq 145 and Properties1 eq 'tYES'");
  const res = await withTimeout(fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true', 'Prefer': 'odata.maxpagesize=0' }
  }), 60000);
  if (!res.ok) throw new Error(`SAP respondeu ${res.status}`);
  return (await res.json()).value || [];
}

/**
 * Acha a lâmina seca na lista carregada do SAP. A espécie só existe no nome do item (filtro por texto);
 * a bitola vem do SAP em metros (0,0015 = 1,5 mm). Medidas comparadas com tolerância (números decimais).
 * Devolve { item } ou { erro: 'NAO_ENCONTRADO' | 'MAIS_DE_UM' | 'CLASSE_INDEFINIDA' }.
 */
export function acharItemSap(itens, { especie, classe, opcao, comprimento, largura, bitolaMm }) {
  const uClass = CLASSES_SAP[classe];
  const uQuality = QUALIDADES_SAP[opcao];
  if (!uClass) return { erro: 'CLASSE_INDEFINIDA' };
  if (!uQuality) return { erro: 'NAO_ENCONTRADO' };

  const bate = (valor, esperado, tolerancia) => Math.abs(Number(valor) - esperado) < tolerancia;
  const achados = itens.filter(i =>
    i.U_Class === uClass &&
    i.U_Quality === uQuality &&
    String(i.ItemName || '').toUpperCase().includes(especie) &&
    bate(i.SalesFactor1, comprimento, 0.0005) &&
    bate(i.SalesFactor2, largura, 0.0005) &&
    bate(Number(i.SalesFactor3) * 1000, bitolaMm, 0.005)
  );

  if (achados.length === 0) return { erro: 'NAO_ENCONTRADO' };
  if (achados.length > 1) return { erro: 'MAIS_DE_UM' };
  return { item: { codigo: achados[0].ItemCode, nome: achados[0].ItemName } };
}

/**
 * rawInsert: fetch nativo direto para a API REST do Supabase, bypassing o Web Lock interno
 * do supabase-js que trava inserts em sequência rápida (mesmo padrão de main.js/romaneio-saida.js).
 */
export async function rawInsert(table, payload) {
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

/** Busca as regras de cubagem (Opção/Modo Cubagem/overrides/Desconto) para uma combinação de setup. */
export async function fetchRegrasCubagem(secador, comprimento, largura) {
  const { data, error } = await supabase
    .from('pcp_secagem_regras_cubagem')
    .select('opcao, classe, modo_cubagem, comprimento_override, largura_override, desconto')
    .eq('secador', secador)
    .eq('comprimento_setup', comprimento)
    .eq('largura_setup', largura);
  if (error) throw error;
  // Ordem fixa pedida pelo usuário (também usada na tela de Configurações do portal). Opção fora da
  // lista (nova, cadastrada depois) vai para o fim, em ordem alfabética.
  return (data || []).sort((a, b) => posicaoOpcao(a.opcao) - posicaoOpcao(b.opcao) || a.opcao.localeCompare(b.opcao));
}

