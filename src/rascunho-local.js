// Auto-save de rascunho de formulário em IndexedDB (não em localStorage: aqui o rascunho carrega fotos,
// que são Blob — o IndexedDB guarda Blob nativamente, sem precisar converter para base64/texto).
// Sobrevive a recarga do app (o PWA recarrega sozinho ao publicar versão nova; o navegador também pode
// descarregar a aba em segundo plano, ex.: ao abrir a câmera nativa em aparelhos com pouca memória).
// Genérico de propósito: qualquer formulário paginado novo (outro RQ, por exemplo) pode reusar com sua
// própria `chave`, sem duplicar esta lógica.

const DB_NAME = 'tableros-rascunhos';
const STORE = 'rascunhos';

function abrirDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Grava (substitui) o rascunho sob `chave`. Best-effort: nunca lança — um app de fábrica não pode travar por isso. */
export async function salvarRascunho(chave, dados) {
  try {
    const db = await abrirDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ dados, atualizadoEm: Date.now() }, chave);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.error('Erro ao salvar rascunho local:', chave, err);
  }
}

/**
 * Lê o rascunho salvo sob `chave`, ou `null` se não houver (ou já tiver passado de `prazoMs` desde a
 * última gravação — trata como abandonado e apaga sozinho; ex.: 4h para um formulário de conferência
 * de hora em hora).
 */
export async function lerRascunho(chave, prazoMs) {
  try {
    const db = await abrirDb();
    const registro = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(chave);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!registro) return null;
    if (prazoMs && Date.now() - registro.atualizadoEm > prazoMs) {
      await limparRascunho(chave);
      return null;
    }
    return registro.dados;
  } catch (err) {
    console.error('Erro ao ler rascunho local:', chave, err);
    return null;
  }
}

/** Apaga o rascunho salvo sob `chave` (registro concluído ou descartado). */
export async function limparRascunho(chave) {
  try {
    const db = await abrirDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(chave);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.error('Erro ao limpar rascunho local:', chave, err);
  }
}
