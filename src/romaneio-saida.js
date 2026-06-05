import { supabase } from './supabase.js';

let currentView = 'oc_list'; // oc_list, item_list, scanner
let selectedOC = null;
let selectedLine = null;
let currentRomaneio = null; // Stores the 'Em Andamento' romaneio ID
let scannedPackages = []; // array of amarracoes rows
let containerRef = null;
let currentScanner = null;

export async function renderRomaneioSaida(container) {
  containerRef = container;
  currentView = 'oc_list';
  selectedOC = null;
  selectedLine = null;
  currentRomaneio = null;
  scannedPackages = [];
  
  await renderCurrentView();
}

async function renderCurrentView() {
  if (currentScanner) {
    try { await currentScanner.stop(); } catch(e){}
    try { await currentScanner.clear(); } catch(e){}
    currentScanner = null;
  }
  
  containerRef.innerHTML = `
    <div class="header">
      <button id="btn-back" style="color: white; padding: 8px; border:none; background:transparent;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
      </button>
      <div class="header-title">${getTitle()}</div>
      <div style="width: 40px;"></div>
    </div>
    <div class="container mt-4" id="rs-content">
      <div style="text-align:center; padding: 40px;"><div class="spinner"></div></div>
    </div>
  `;

  document.getElementById('btn-back').addEventListener('click', handleBack);

  try {
    if (currentView === 'oc_list') {
      await renderOCList();
    } else if (currentView === 'item_list') {
      await renderItemList();
    } else if (currentView === 'scanner') {
      await renderScanner();
    }
  } catch (err) {
    console.error(err);
    document.getElementById('rs-content').innerHTML = `<div class="error-msg">Erro: ${err.message}</div>`;
  }
}

function getTitle() {
  if (currentView === 'oc_list') return 'Selecione a Ordem';
  if (currentView === 'item_list') return `Itens: ${selectedOC.codigo_oc}`;
  if (currentView === 'scanner') return `Bipar: ${selectedLine.item_code}`;
  return 'Romaneio de Saída';
}

function handleBack() {
  if (currentView === 'scanner') {
    currentView = 'item_list';
    renderCurrentView();
  } else if (currentView === 'item_list') {
    currentView = 'oc_list';
    renderCurrentView();
  } else {
    window.location.hash = '/'; // Go home
  }
}

async function renderOCList() {
  const { data, error } = await supabase
    .from('expedicao_ordens_carregamento')
    .select('*, expedicao_ordens_carregamento_itens(armazem)')
    .eq('liberado_carregamento', true)
    .eq('status', 'Ativa')
    .order('created_at', { ascending: false });

  if (error) throw error;

  const content = document.getElementById('rs-content');
  if (data.length === 0) {
    content.innerHTML = `
      <div style="background: white; padding: 24px; border-radius: 12px; text-align: center;">
        <p style="color: var(--color-text-sec);">Nenhuma Ordem de Carregamento liberada no momento.</p>
      </div>
    `;
    return;
  }

  content.innerHTML = `
    <div style="display: grid; gap: 16px;">
      ${data.map(oc => {
        let destinoText = 'Destino não especificado';
        let isTransf = oc.tipo === 'transferencia_interna';
        
        if (isTransf) {
          destinoText = `${oc.local_partida || ''} &rarr; ${oc.local_destino || ''}`;
        } else {
          const armazens = [...new Set((oc.expedicao_ordens_carregamento_itens || []).map(i => i.armazem).filter(Boolean))];
          if (armazens.length > 0) destinoText = armazens.join(' / ');
        }
        
        return `
        <div class="oc-card" data-id="${oc.id}" style="background: white; padding: 16px; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); cursor: pointer; border-left: 4px solid ${isTransf ? '#f59e0b' : 'var(--color-primary)'};">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <strong style="font-size: 1.1rem; color: ${isTransf ? '#d97706' : 'var(--color-primary)'};">
              ${oc.codigo_oc || 'Sem Código'}
              ${isTransf ? `<span style="font-size: 0.7rem; background: #fef3c7; color: #d97706; padding: 2px 6px; border-radius: 4px; margin-left: 4px; vertical-align: middle;">TRANSF</span>` : ''}
            </strong>
            <span style="font-size: 0.85rem; background: var(--color-surface-alt); padding: 4px 8px; border-radius: 4px;">${oc.placa || 'Sem placa'}</span>
          </div>
          <div style="font-size: 0.9rem; color: var(--color-text-sec); display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="font-weight: 600; color: var(--color-text);">${destinoText}</span>
          </div>
          <div style="font-size: 0.85rem; color: var(--color-text-sec); display: flex; justify-content: space-between;">
            <span>${oc.transportadora || 'Sem transp.'}</span>
            <span>Peso Máx: ${oc.peso_maximo ? oc.peso_maximo + 'kg' : 'N/A'}</span>
          </div>
        </div>
        `;
      }).join('')}
    </div>
  `;

  document.querySelectorAll('.oc-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedOC = data.find(d => d.id === card.dataset.id);
      currentView = 'item_list';
      renderCurrentView();
    });
  });
}

async function renderItemList() {
  const { data, error } = await supabase
    .from('expedicao_ordens_carregamento_itens')
    .select('*')
    .eq('ordem_id', selectedOC.id)
    .order('pedido_numero', { ascending: true });

  if (error) throw error;

  // Fetch past romaneios to calculate correct progress including previous sessions
  const { data: allRoms } = await supabase
    .from('expedicao_romaneios')
    .select('*, expedicao_romaneio_itens(*)')
    .eq('ordem_carregamento_id', selectedOC.id);
    
  currentRomaneio = allRoms?.find(r => r.status === 'Em Andamento') || null;
  const pastRoms = allRoms?.filter(r => r.status === 'Finalizado') || [];

  // Populate scannedPackages from Em Andamento romaneio
  if (currentRomaneio) {
    scannedPackages = currentRomaneio.expedicao_romaneio_itens.map(i => ({
      id: i.id, // romaneio_item id (diferente da amarração, mas para remover funciona se usarmos qrcode)
      qrcode: i.qrcode,
      ordem_item_id: i.ordem_item_id,
      total_calc: i.quantidade,
      peso: i.peso
    }));
  } else {
    scannedPackages = [];
  }

  let totalPastScanned = [];
  pastRoms.forEach(ro => totalPastScanned.push(...ro.expedicao_romaneio_itens));
  
  // Combine past and current for validation
  const allScanned = [...totalPastScanned, ...scannedPackages.map(p => ({
    ordem_item_id: p.ordem_item_id,
    quantidade: Number(p.total_calc) || 0
  }))];

  // Evaluate rules
  let allLinesMet = true;
  let linesChecklistHTML = '';

  if (data) {
    for (const line of data) {
      const expected = Number(line.quantidade_programada) || 0;
      if (expected > 0) {
        const scannedForThisLine = allScanned
          .filter(i => i.ordem_item_id === line.id)
          .reduce((sum, i) => sum + (Number(i.quantidade) || 0), 0);
          
        const isMet = Math.abs(expected - scannedForThisLine) <= 0.01;
        if (!isMet) allLinesMet = false;
        
        linesChecklistHTML += `
          <div style="display: flex; justify-content: space-between; font-size: 0.9rem; padding: 4px 0;">
            <span>${isMet ? '✔️' : '❌'} Linha ${line.item_code}</span>
            <span style="color: ${isMet ? 'var(--color-success)' : 'var(--color-danger)'}">${scannedForThisLine.toFixed(4)} / ${Number(expected.toFixed(4))}</span>
          </div>
        `;
      }
    }
  }

  const totalVolumeAll = allScanned.reduce((sum, i) => sum + (Number(i.quantidade) || 0), 0);
  const minVolMet = selectedOC.quantidade_minima > 0 ? (totalVolumeAll >= Number(selectedOC.quantidade_minima)) : true;
  
  let minVolChecklistHTML = '';
  if (selectedOC.quantidade_minima > 0) {
    minVolChecklistHTML = `
      <div style="display: flex; justify-content: space-between; font-size: 0.9rem; padding: 4px 0; border-top: 1px solid var(--color-border); margin-top: 4px; padding-top: 8px;">
        <span>${minVolMet ? '✔️' : '❌'} Vol. Mínimo OC</span>
        <span style="color: ${minVolMet ? 'var(--color-success)' : 'var(--color-danger)'}">${totalVolumeAll.toFixed(4)} / ${Number(Number(selectedOC.quantidade_minima).toFixed(4))}</span>
      </div>
    `;
  }

  const canFinalize = allLinesMet && minVolMet;

  const content = document.getElementById('rs-content');
  const totalBipadoKg = scannedPackages.reduce((sum, p) => sum + (Number(p.peso) || 0), 0);
  
  const statusResumoHTML = `
    <div style="background: white; padding: 16px; border-radius: 12px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); border: 1px solid ${canFinalize ? 'var(--color-success)' : 'var(--color-border)'};">
      <h3 style="font-size: 1rem; margin-bottom: 12px;">Status da Ordem</h3>
      <div style="display: flex; justify-content: space-between; font-weight: 600;">
        <div style="text-align: center; flex: 1;">
          <div style="font-size: 0.8rem; color: var(--color-text-sec); font-weight: 400;">Pacotes (Sessão)</div>
          <div style="font-size: 1.2rem; color: var(--color-primary);">${scannedPackages.length}</div>
        </div>
        <div style="text-align: center; flex: 1; border-left: 1px solid var(--color-border-light);">
          <div style="font-size: 0.8rem; color: var(--color-text-sec); font-weight: 400;">Peso Atual (Sessão)</div>
          <div style="font-size: 1.2rem; color: var(--color-primary);">${totalBipadoKg.toFixed(2)} / ${selectedOC.peso_maximo || '∞'} kg</div>
        </div>
      </div>
      
      <div style="margin-top: 16px; padding: 12px; background: var(--color-surface-alt); border-radius: 8px;">
        <div style="font-weight: 600; font-size: 0.9rem; margin-bottom: 8px;">Checklist de Liberação (Total Real):</div>
        ${linesChecklistHTML || '<div style="font-size: 0.85rem; color: var(--color-text-sec);">Nenhuma linha obrigatória.</div>'}
        ${minVolChecklistHTML}
      </div>

      ${canFinalize && scannedPackages.length > 0 
        ? '<button id="btn-finalizar-romaneio" class="btn btn-success" style="width: 100%; margin-top: 16px; font-weight: bold;">FINALIZAR ROMANEIO</button>' 
        : '<div style="text-align:center; padding: 12px; background: #fff3e0; color: #e65100; border-radius: 8px; margin-top: 16px; font-size: 0.9rem;">Cumpra o Checklist e bipe pacotes para liberar.</div>'}
    </div>
  `;

  if (data.length === 0) {
    content.innerHTML = statusResumoHTML + `
      <div style="background: white; padding: 24px; border-radius: 12px; text-align: center;">
        <p style="color: var(--color-text-sec);">Nenhum item cadastrado nesta Ordem.</p>
      </div>
    `;
    bindFinalizar();
    return;
  }

  content.innerHTML = statusResumoHTML + `
    <div style="display: grid; gap: 12px;">
      ${data.map(item => {
        const isComplemento = Number(item.quantidade_programada) === 0;
        
        // Count already scanned for this line
        const scannedForLine = scannedPackages.filter(p => p.ordem_item_id === item.id);
        const scannedVol = scannedForLine.reduce((sum, p) => sum + (Number(p.total_calc) || 0), 0);
        
        const statusColor = (scannedVol >= Number(item.quantidade_programada) && !isComplemento) ? 'var(--color-success)' : 'var(--color-text-sec)';
        
        return `
          <div class="item-card" data-id="${item.id}" style="background: white; padding: 16px; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); cursor: pointer; border-left: 4px solid ${isComplemento ? 'var(--color-warning)' : 'var(--color-primary)'};">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <strong style="font-size: 1rem; color: var(--color-text);">${item.item_code} - ${item.item_name}</strong>
              <span style="font-size: 0.85rem; color: var(--color-text-sec);">Ped: ${item.pedido_numero || '-'}</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.9rem; margin-top: 8px;">
              <span style="color: ${statusColor}; font-weight: ${scannedVol > 0 ? '600' : 'normal'};">
                Bipado: ${scannedVol.toFixed(4)} / ${isComplemento ? '∞ (Complemento)' : item.quantidade_programada}
              </span>
              <span style="background: var(--color-surface-alt); padding: 2px 6px; border-radius: 4px;">${scannedForLine.length} pacotes</span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  document.querySelectorAll('.item-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedLine = data.find(d => d.id === card.dataset.id);
      currentView = 'scanner';
      renderCurrentView();
    });
  });
  
  bindFinalizar();
}

function bindFinalizar() {
  const btn = document.getElementById('btn-finalizar-romaneio');
  if (btn) {
    btn.addEventListener('click', handleFinalizar);
  }
}

async function renderScanner() {
  const isComplemento = Number(selectedLine.quantidade_programada) === 0;
  
  const scannedForLine = scannedPackages.filter(p => p.ordem_item_id === selectedLine.id);
  const scannedVol = scannedForLine.reduce((sum, p) => sum + (Number(p.total_calc) || 0), 0);
  const totalBipadoKg = scannedPackages.reduce((sum, p) => sum + (Number(p.peso) || 0), 0);

  const content = document.getElementById('rs-content');
  content.innerHTML = `
    <div style="background: white; padding: 20px; border-radius: 12px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
      <h3 style="font-size: 1.1rem; margin-bottom: 8px;">${selectedLine.item_code}</h3>
      <p style="color: var(--color-text-sec); font-size: 0.9rem; margin-bottom: 16px;">${selectedLine.item_name}</p>
      
      <div style="display: flex; justify-content: space-between; font-size: 0.9rem; padding: 12px; background: var(--color-surface-alt); border-radius: 8px;">
        <div>
          <div style="color: var(--color-text-light);">Vol. nesta linha</div>
          <strong id="lbl-vol-linha">${scannedVol.toFixed(4)} / ${isComplemento ? '∞' : selectedLine.quantidade_programada}</strong>
        </div>
        <div style="text-align: right;">
          <div style="color: var(--color-text-light);">Peso Carga Total</div>
          <strong id="lbl-peso-total">${totalBipadoKg.toFixed(2)} / ${selectedOC.peso_maximo || '∞'} kg</strong>
        </div>
      </div>
      
      <div style="margin-top: 20px;">
        <label style="display: block; font-weight: 600; margin-bottom: 8px;">Ler QR Code do Pacote</label>
        
        <div id="custom-camera-ui" style="margin-bottom: 12px; border-radius: 8px; overflow: hidden; border: 1px solid var(--color-border); background: var(--color-surface-alt); position: relative;">
          <div id="rs-scan-msg" style="text-align: center; padding: 8px; min-height: 20px; font-size: 1rem; font-weight: 600; background: rgba(255,255,255,0.9); width: 100%; z-index: 10; border-bottom: 1px solid var(--color-border);"></div>
          <div id="qr-reader" style="width: 100%; display: none;"></div>
          <div id="camera-overlay" style="padding: 40px 20px; text-align: center;">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" stroke-width="2" style="margin-bottom: 12px;"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
            <p style="font-size: 0.9rem; color: var(--color-text-sec); margin-bottom: 16px;">Toque abaixo para ativar a câmera do celular e ler a etiqueta do pacote.</p>
            <button id="btn-start-camera" class="btn btn-primary" style="width: 100%; border-radius: 8px; display: flex; align-items: center; justify-content: center; gap: 8px;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
              Iniciar Câmera
            </button>
          </div>
        </div>
        
        <div style="text-align: center; font-size: 0.85rem; color: var(--color-text-sec); margin-bottom: 8px;">ou digite/bipe com pistola bluetooth:</div>
        
        <input type="text" id="rs-qrcode-input" class="form-input" style="width: 100%; text-align: center; font-size: 1.2rem; padding: 16px; background: #f0f7ff; border-color: var(--color-primary);" placeholder="Clique e bipe..." autocomplete="off">
      </div>
    </div>
    
    <div style="background: white; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); overflow: hidden;">
      <div id="lbl-pacotes-bipados" style="padding: 12px 16px; background: var(--color-surface-alt); font-weight: 600; font-size: 0.9rem; border-bottom: 1px solid var(--color-border);">Pacotes Bipados (${scannedForLine.length})</div>
      <div id="list-pacotes-bipados" style="max-height: 300px; overflow-y: auto;">
        ${scannedForLine.length === 0 ? '<div style="padding: 16px; text-align: center; color: var(--color-text-sec);">Nenhum pacote bipado.</div>' : ''}
        ${scannedForLine.map(p => `
          <div style="padding: 12px 16px; border-bottom: 1px solid var(--color-border-light); display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-family: monospace; font-size: 0.95rem; font-weight: 600;">${p.qrcode}</div>
              <div style="font-size: 0.8rem; color: var(--color-text-sec);">Vol: ${p.total_calc} | Peso: ${p.peso}kg</div>
            </div>
            <button class="btn btn-ghost btn-sm rs-remove-pkg" data-qrcode="${p.qrcode}" style="color: var(--color-danger); padding: 4px;">Remover</button>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  const input = document.getElementById('rs-qrcode-input');
  
  input.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const qr = input.value.trim();
      input.value = '';
      if (qr) await handleScan(qr);
      // Removed input.focus() to prevent keyboard from popping up unexpectedly on mobile
    }
  });

  document.querySelectorAll('.rs-remove-pkg').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const qr = e.currentTarget.dataset.qrcode;
      scannedPackages = scannedPackages.filter(p => p.qrcode !== qr);
      updateScannerUI(); // Refresh only the UI, not the camera
    });
  });

  // Initialize Custom Camera Scanner
  if (window.Html5Qrcode && !currentScanner) {
    const btnStart = document.getElementById('btn-start-camera');
    const qrReaderDiv = document.getElementById('qr-reader');
    const overlayDiv = document.getElementById('camera-overlay');
    
    let isScanning = false;

    btnStart.addEventListener('click', async () => {
      btnStart.innerHTML = '<div class="spinner" style="width: 20px; height: 20px; border-width: 2px;"></div>';
      
      // Make visible BEFORE starting the scanner so it can calculate dimensions
      overlayDiv.style.display = 'none';
      qrReaderDiv.style.display = 'block';
      
      currentScanner = new Html5Qrcode("qr-reader");
      
      try {
        const cameras = await Html5Qrcode.getCameras();
        if (!cameras || cameras.length === 0) {
          throw new Error("Nenhuma câmera encontrada no dispositivo.");
        }
        
        let cameraId = cameras[0].id;
        const backCamera = cameras.find(c => c.label.toLowerCase().includes('back') || c.label.toLowerCase().includes('traseira') || c.label.toLowerCase().includes('environment'));
        if (backCamera) {
          cameraId = backCamera.id;
        }

        await currentScanner.start(
          cameraId,
          { fps: 10, qrbox: { width: 250, height: 250 } },
          async (decodedText) => {
            if (isScanning) return;
            isScanning = true;
            
            const input = document.getElementById('rs-qrcode-input');
            if (input) input.value = decodedText;
            
            try { currentScanner.pause(); } catch(e){}
            
            await handleScan(decodedText);
            
            setTimeout(() => {
              isScanning = false;
              try { currentScanner.resume(); } catch(e){}
            }, 2000);
          },
          (errorMessage) => { /* ignore frame errors */ }
        );
      } catch (err) {
        console.error(err);
        // Revert UI on error
        overlayDiv.style.display = 'block';
        qrReaderDiv.style.display = 'none';
        btnStart.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
          Iniciar Câmera
        `;
        alert('Erro ao acessar a câmera. Tente recarregar a página e dar a permissão.');
      }
    });
  }
}

async function handleScan(qrcode) {
  const msgDiv = document.getElementById('rs-scan-msg');
  const showScanMsg = (msg, type) => {
    msgDiv.textContent = msg;
    if (type === 'success') {
      msgDiv.style.backgroundColor = '#dcfce7';
      msgDiv.style.color = '#166534';
      msgDiv.style.borderColor = '#22c55e';
    } else if (type === 'error') {
      msgDiv.style.backgroundColor = '#fee2e2';
      msgDiv.style.color = '#991b1b';
      msgDiv.style.borderColor = '#ef4444';
      playErrorSound();
    } else {
      msgDiv.style.backgroundColor = 'rgba(255,255,255,0.9)';
      msgDiv.style.color = 'var(--color-text-sec)';
      msgDiv.style.borderColor = 'var(--color-border)';
    }
  };
  showScanMsg('Buscando pacote...', 'info');

  // 1. Check if already scanned in current session
  if (scannedPackages.find(p => p.qrcode === qrcode)) {
    showScanMsg('Pacote já foi bipado neste romaneio!', 'error');
    return;
  }

  // 2. Fetch from DB
  const { data, error } = await supabase
    .from('amarracoes')
    .select('*')
    .eq('qrcode', qrcode)
    .single();

  if (error || !data) {
    showScanMsg('QR Code não encontrado no estoque!', 'error');
    return;
  }

  // Regra 1: Já saiu
  if (data.saida === true) {
    showScanMsg('BLOQUEADO: Este pacote já possui saída registrada!', 'error');
    return;
  }

  // Regra Transferência: Local de Partida
  if (selectedOC.tipo === 'transferencia_interna') {
    if (data.local_estoque !== selectedOC.local_partida) {
      showScanMsg(`BLOQUEADO: Pacote está no local ${data.local_estoque || 'Desconhecido'}, mas a transferência exige saída de ${selectedOC.local_partida}!`, 'error');
      return;
    }
  }

  // Regra 2: Código do item bate com a linha selecionada
  // We assume item_cod matches cod_item (adjust if needed, but AppSheet logic did this)
  if (data.cod_item !== selectedLine.item_code) {
    showScanMsg(`BLOQUEADO: Pacote é do item ${data.cod_item}, mas a linha exige ${selectedLine.item_code}!`, 'error');
    return;
  }

  // Prepare variables
  const pkgVol = Number(data.total_calc) || 0;
  const pkgPeso = Number(data.peso) || 0;
  
  const isComplemento = Number(selectedLine.quantidade_programada) === 0;
  
  const scannedForLine = scannedPackages.filter(p => p.ordem_item_id === selectedLine.id);
  const scannedVol = scannedForLine.reduce((sum, p) => sum + (Number(p.total_calc) || 0), 0);
  
  const totalBipadoKg = scannedPackages.reduce((sum, p) => sum + (Number(p.peso) || 0), 0);

  // Regra 3: Peso Max
  if (selectedOC.peso_maximo > 0) {
    if ((totalBipadoKg + pkgPeso) > Number(selectedOC.peso_maximo)) {
      showScanMsg('BLOQUEADO: Excede o Peso Máximo da Ordem de Carregamento!', 'error');
      return;
    }
  }

  // Regra 4: Qtd Max (ignora se for complemento)
  if (!isComplemento && Number(selectedLine.quantidade_programada) > 0) {
    // Allowing a small tolerance of 0.01 as per AppSheet formula: (SUM + pkgVol - 0.01) <= limit
    if ((scannedVol + pkgVol - 0.01) > Number(selectedLine.quantidade_programada)) {
      showScanMsg('BLOQUEADO: Excede o volume previsto para esta linha!', 'error');
      return;
    }
  }

  // NEW LOGIC: Create Romaneio if doesn't exist
  if (!currentRomaneio) {
    const { data: roData, error: roError } = await supabase
      .from('expedicao_romaneios')
      .insert([{
        bplid: selectedOC.bplid,
        ordem_carregamento_id: selectedOC.id,
        status: 'Em Andamento'
      }])
      .select()
      .single();
    if (roError) throw roError;
    currentRomaneio = roData;
  }

  // Insert item
  const { data: itemData, error: itemError } = await supabase
    .from('expedicao_romaneio_itens')
    .insert([{
      romaneio_id: currentRomaneio.id,
      qrcode: data.qrcode,
      ordem_item_id: selectedLine.id,
      quantidade: data.total_calc,
      peso: data.peso
    }])
    .select()
    .single();
  if (itemError) throw itemError;

  // Update amarracoes
  if (selectedOC.tipo !== 'transferencia_interna') {
    await supabase
      .from('amarracoes')
      .update({ saida: true })
      .eq('qrcode', data.qrcode);
  }

  const pkgToSave = {
    id: itemData.id,
    qrcode: data.qrcode,
    ordem_item_id: selectedLine.id,
    total_calc: data.total_calc,
    peso: data.peso
  };
  
  scannedPackages.push(pkgToSave);
  
  showScanMsg('Pacote adicionado e salvo com sucesso!', 'success');
  
  // Update UI dynamically instead of destroying the whole page/camera
  updateScannerUI();
  
  // Flash green
  const input = document.getElementById('rs-qrcode-input');
  input.style.backgroundColor = '#e8f5e9';
  setTimeout(() => input.style.backgroundColor = '#f0f7ff', 300);
}

function updateScannerUI() {
  const isComplemento = Number(selectedLine.quantidade_programada) === 0;
  const scannedForLine = scannedPackages.filter(p => p.ordem_item_id === selectedLine.id);
  const scannedVol = scannedForLine.reduce((sum, p) => sum + (Number(p.total_calc) || 0), 0);
  const totalBipadoKg = scannedPackages.reduce((sum, p) => sum + (Number(p.peso) || 0), 0);

  const lblVol = document.getElementById('lbl-vol-linha');
  if (lblVol) lblVol.innerHTML = `${scannedVol.toFixed(4)} / ${isComplemento ? '∞' : selectedLine.quantidade_programada}`;

  const lblPeso = document.getElementById('lbl-peso-total');
  if (lblPeso) lblPeso.innerHTML = `${totalBipadoKg.toFixed(2)} / ${selectedOC.peso_maximo || '∞'} kg`;

  const lblPacotes = document.getElementById('lbl-pacotes-bipados');
  if (lblPacotes) lblPacotes.innerHTML = `Pacotes Bipados (${scannedForLine.length})`;

  const listPacotes = document.getElementById('list-pacotes-bipados');
  if (listPacotes) {
    listPacotes.innerHTML = scannedForLine.length === 0 
      ? '<div style="padding: 16px; text-align: center; color: var(--color-text-sec);">Nenhum pacote bipado.</div>' 
      : scannedForLine.map(p => `
          <div style="padding: 12px 16px; border-bottom: 1px solid var(--color-border-light); display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-family: monospace; font-size: 0.95rem; font-weight: 600;">${p.qrcode}</div>
              <div style="font-size: 0.8rem; color: var(--color-text-sec);">Vol: ${p.total_calc} | Peso: ${p.peso}kg</div>
            </div>
            <button class="btn btn-ghost btn-sm rs-remove-pkg" data-qrcode="${p.qrcode}" style="color: var(--color-danger); padding: 4px;">Remover</button>
          </div>
        `).join('');

    document.querySelectorAll('.rs-remove-pkg').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const qr = e.currentTarget.dataset.qrcode;
        const pkgToRemove = scannedPackages.find(p => p.qrcode === qr);
        if (!pkgToRemove) return;
        
        // Remove from DB
        e.currentTarget.innerHTML = '<div class="spinner" style="width:14px;height:14px;"></div>';
        e.currentTarget.disabled = true;
        
        try {
          const { error: delError } = await supabase.from('expedicao_romaneio_itens').delete().eq('qrcode', qr).throwOnError();
          if (selectedOC.tipo !== 'transferencia_interna') {
            const { error: updError } = await supabase.from('amarracoes').update({ saida: false }).eq('qrcode', qr).throwOnError();
          }
          
          scannedPackages = scannedPackages.filter(p => p.qrcode !== qr);
          updateScannerUI();
        } catch (err) {
          console.error(err);
          alert('Erro ao remover pacote: ' + err.message);
          e.currentTarget.innerHTML = 'Remover';
          e.currentTarget.disabled = false;
        }
      });
    });
  }
}

function playErrorSound() {
  try {
    // simple beep using Web Audio API
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.value = 150;
    gain.gain.value = 0.1;
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch(e){}
}

async function handleFinalizar() {
  if (scannedPackages.length === 0) {
    alert('Nenhum pacote foi bipado.');
    return;
  }

  if (selectedOC.tipo === 'transferencia_interna') {
    return await handleFinalizarTransferencia();
  }

  document.getElementById('rs-content').innerHTML = `
    <div style="text-align:center; padding: 40px;">
      <div class="spinner" style="margin-bottom: 16px;"></div>
      <div style="font-weight: 600;" id="rs-loading-title">Faturando no SAP...</div>
      <div style="font-size: 0.85rem; color: var(--color-text-sec); margin-top: 8px;" id="rs-loading-subtitle">Por favor, aguarde.</div>
    </div>
  `;

  try {
    // 1. Puxar linhas da OC para montar o payload com os dados novos (card_code, unit_price, etc)
    const { data: ocLines, error: linesError } = await supabase
      .from('expedicao_ordens_carregamento_itens')
      .select('*')
      .eq('ordem_id', selectedOC.id);
      
    if (linesError) throw linesError;

    // 2. Agrupar pacotes por Pedido e CardCode
    const groups = {};
    for (const pkg of scannedPackages) {
      const line = ocLines.find(l => l.id === pkg.ordem_item_id);
      if (!line) continue;
      
      const ped = line.pedido_numero || 'SEM_PEDIDO';
      const card = line.cod_pn || '';
      const key = ped + '_' + card;
      
      if (!groups[key]) {
        groups[key] = {
          U_Pedido: ped,
          CardCode: card,
          lines: [],
          totalVolume: 0,
          totalPackages: 0
        };
      }
      
      const pkgVol = Number(pkg.total_calc) || 0;
      groups[key].totalVolume += pkgVol;
      groups[key].totalPackages += 1;
      
      let docLine = groups[key].lines.find(l => l.ItemCode === line.item_code);
      if (!docLine) {
        docLine = {
          ItemCode: line.item_code,
          Quantity: 0,
          UnitPrice: Number(line.unit_price) || 1,
          WarehouseCode: 'DIRETO'
        };
        if (selectedOC.tipo !== 'transferencia_interna') {
          docLine.Usage = selectedOC.usage_sap || 13;
          docLine.Currency = selectedOC.currency || 'USD';
        }
        groups[key].lines.push(docLine);
      }
      
      docLine.Quantity += pkgVol;
    }

    // 3. Fazer o disparo do POST para cada agrupamento (cada Nota)
    for (const key in groups) {
      const group = groups[key];
      
      const payload = {
        CardCode: group.CardCode,
        Comments: 'Emitido via Portal Tableros',
        OpeningRemarks: `Placa: ${selectedOC.placa || ''}, Reboques: ${selectedOC.reboques || ''}, P.I.: ${group.U_Pedido || ''}, Romaneio: ${selectedOC.codigo_oc || ''}`,
        U_Pedido: group.U_Pedido,
        BPL_IDAssignedToInvoice: selectedOC.bplid,
        DocumentLines: group.lines,
        TaxExtension: {
          Carrier: selectedOC.transportadora_cod || '',
          PackQuantity: group.totalPackages,
          PackDescription: 'PALLETS',
          NetWeight: group.totalVolume * 495,
          GrossWeight: group.totalVolume * 500,
          Incoterms: '0'
        }
      };

      try {
        const { data, error } = await supabase.functions.invoke('faturar-sap', {
          body: payload
        });
        
        if (error) {
          // Quando a edge function cai no block `status: 400` do catch interno dela
          // O supabase.js preenche a variavel `error` ou `data.error`
          throw new Error(error.message || (data && data.error) || 'Erro desconhecido da Edge Function');
        }
        
        if (data && data.error) {
          throw new Error(data.error);
        }
        
        const sapDocNum = data?.data?.DocNum;
        if (sapDocNum) {
          // Salva NFe pendente
          await supabase.from('expedicao_notas_fiscais').insert({
            oc_id: selectedOC.id,
            pedido_numero: group.U_Pedido,
            sap_doc_num: String(sapDocNum),
            sap_doc_entry: data?.data?.DocEntry ? String(data.data.DocEntry) : null
          });
          groups[key].sapDocNumSaved = sapDocNum;
          
          // Atualizar amarrações (pacotes) deste grupo garantindo saida=true e vinculando o DocEntry gerado
          const groupQRs = scannedPackages
            .filter(pkg => {
              const line = ocLines.find(l => l.id === pkg.ordem_item_id);
              if (!line) return false;
              const ped = line.pedido_numero || 'SEM_PEDIDO';
              const card = line.cod_pn || '';
              return (ped + '_' + card) === key;
            })
            .map(p => p.qrcode);
            
          if (groupQRs.length > 0) {
             const sapDocEntry = data?.data?.DocEntry;
             await supabase.from('amarracoes')
               .update({ saida: true })
               .in('qrcode', groupQRs);
          }
        }
      } catch (postError) {
        throw new Error(`Falha de comunicação no envio do pedido ${group.U_Pedido}: ${postError.message}`);
      }
    }

    // 4. Se chegou até aqui, o SAP deu certo! Fechamos o Romaneio e a OC garantindo a integridade!
    if (currentRomaneio) {
      const { error: roError } = await supabase
        .from('expedicao_romaneios')
        .update({ status: 'Finalizado' })
        .eq('id', currentRomaneio.id);
      if (roError) throw roError;
    }

    const { error: ocError } = await supabase
      .from('expedicao_ordens_carregamento')
      .update({ status: 'Finalizada' })
      .eq('id', selectedOC.id);
    if (ocError) throw ocError;

    // A partir daqui, rodamos de forma protegida (try/catch) para que falhas de NFe/MDFe não revertam a OC
    try {
      for (const key in groups) {
        const group = groups[key];
        const sapDocNum = groups[key].sapDocNumSaved; // precisamos ter salvo antes
        if (sapDocNum) {
          document.getElementById('rs-loading-title').innerText = `Consultando NFe (Pedido ${group.U_Pedido})...`;
          document.getElementById('rs-loading-subtitle').innerText = `Aguardando autorização da SEFAZ (10s)`;
          
          await new Promise(r => setTimeout(r, 10000));
          
          // Loop de retentativas
          let keyNfe = null;
          let valorDocumento = 0;
          for (let i = 0; i < 3; i++) {
            document.getElementById('rs-loading-subtitle').innerText = `Buscando no Invent... Tentativa ${i+1}/3`;
            const { data: nfeData, error: nfeError } = await supabase.functions.invoke('consultar-nfe', {
              body: { numeroDocumento: String(sapDocNum) }
            });
            
            if (!nfeError && !nfeData?.error && nfeData?.data?.documentosFiscais && nfeData.data.documentosFiscais.length > 0) {
              const docInfo = nfeData.data.documentosFiscais[0];
              if (docInfo.keyNfe) {
                keyNfe = docInfo.keyNfe;
                valorDocumento = docInfo.valorDocumento || 0;
                break;
              }
            }
            if (i < 2) await new Promise(r => setTimeout(r, 5000)); // wait 5s before retry
          }
          
          if (keyNfe) {
             await supabase.from('expedicao_notas_fiscais')
               .update({ key_nfe: keyNfe, valor_documento: valorDocumento })
               .eq('sap_doc_num', String(sapDocNum));
          } else {
             console.warn(`Chave NFe não retornou a tempo para o documento ${sapDocNum}`);
          }
         }
      } // Fim do loop de NFe polling
      
      // Emissão do MDFe apenas para a Tableros (F0121)
    if (selectedOC.transportadora_cod === 'F0121') {
      document.getElementById('rs-loading-title').innerText = 'Emitindo MDFe...';
      document.getElementById('rs-loading-subtitle').innerText = 'Enviando dados para a Brasil NFe';

      const { data: nfes } = await supabase
      .from('expedicao_notas_fiscais')
      .select('key_nfe, pedido_numero, valor_documento')
      .eq('oc_id', selectedOC.id)
      .not('key_nfe', 'is', null);

    if (nfes && nfes.length > 0) {
      let totalValor = nfes.reduce((acc, curr) => acc + (parseFloat(curr.valor_documento) || 0), 0);
      let totalVolumeSum = 0;
      for (const pkg of scannedPackages) {
        const qrString = pkg.amarracao || pkg.qrcode || '';
        const amParts = qrString.split('-');
        if (amParts.length > 1) {
          totalVolumeSum += parseFloat(amParts[1].replace(',', '.'));
        }
      }
      let totalPeso = totalVolumeSum * 500;

      const { data: driverData } = await supabase
        .from('logistica_motoristas')
        .select('nome, cpf')
        .eq('nome', selectedOC.motorista)
        .single();

      let driverCpf = driverData?.cpf ? driverData.cpf.replace(/\\D/g, '') : '00000000000';
      let driverNome = driverData?.nome || selectedOC.motorista || 'Motorista';

      const ufOrigem = selectedOC.uf_carregamento || 'PR';
      const ufDestino = selectedOC.uf_descarregamento || 'RJ';

      const descarregamentos = nfes.map(nfe => {
         const line = ocLines.find(l => l.pedido_numero === nfe.pedido_numero);
         return {
           codMunicipio: parseInt(line?.u_cod_mun || 3304557),
           municipio: "Destino",
           chaveDfe: nfe.key_nfe
         };
      });

      // Busca Placa
      const { data: placaData } = await supabase
        .from('logistica_placas')
        .select('*')
        .eq('placa', selectedOC.placa)
        .single();

      // Busca Reboques
      let reboquesPayload = [];
      if (selectedOC.reboques) {
         const list = selectedOC.reboques.split(',').map(s => s.trim()).filter(Boolean);
         const { data: reboquesData } = await supabase
           .from('logistica_reboques')
           .select('*')
           .in('placa', list);
           
         if (reboquesData) {
           reboquesPayload = reboquesData.map(r => ({
             placa: r.placa.replace(/[^A-Z0-9]/gi, ''),
             tara: r.tara || 0, 
             capKG: r.capacidade_kg || 0, 
             capM3: 0, 
             tipoCarroceria: r.tipo_carroceria || 2,
             uf: r.uf || ufOrigem,
             renavan: r.renavam ? r.renavam.replace(/[^0-9]/g, '') : '00000000000'
           }));
         } else {
           reboquesPayload = list.map(p => ({
             placa: p.replace(/[^A-Z0-9]/gi, ''),
             tara: 0, capKG: 0, capM3: 0, tipoCarroceria: 2, uf: ufOrigem, renavan: '00000000000'
           }));
         }
      }

      let percursoPayload = undefined;
      if (selectedOC.ufs_percurso) {
         const ufs = selectedOC.ufs_percurso.split(',').map(u => u.trim()).filter(Boolean);
         if (ufs.length > 0) {
           percursoPayload = ufs; // Array simples de strings ex: ["SP", "MG"]
         }
      }

      const mdfePayload = {
        tipoAmbiente: 1, // Prod
        tipoEmitente: 2, // Transportador
        ufCarregamento: ufOrigem,
        ufDescarregamento: ufDestino,
        modalidade: 1,
        valor: totalValor,
        peso: totalPeso,
        percursoUfs: percursoPayload,
        Rodoviario: {
          tipoRodado: placaData?.tipo_rodado || 3,
          tipoCarroceria: placaData?.tipo_carroceria || 2,
          placa: selectedOC.placa ? selectedOC.placa.replace(/[^A-Z0-9]/gi, '') : '',
          renavan: placaData?.renavam ? placaData.renavam.replace(/[^0-9]/g, '') : '00000000000',
          tara: placaData?.tara || 0,
          capKG: placaData?.capacidade_kg || 0,
          capM3: 0,
          uf: placaData?.uf || ufOrigem,
          condutores: [{ nome: driverNome, cpf: driverCpf }],
          reboques: reboquesPayload.length > 0 ? reboquesPayload : undefined
        },
        carregamentos: [
          { codMunicipio: 4118204, municipio: "Origem" } // Exemplo PR se ufOrigem=PR
        ],
        descarregamentos: descarregamentos,
        produtoPredominante: {
          tpCarga: 5,
          descricao: "Madeira",
          cEan: "SEM GTIN",
          ncm: "44123900"
        }
      };

      try {
        await supabase.functions.invoke('emitir-mdfe', { body: mdfePayload });
      } catch (err) {
        console.error("Erro no envio do MDFe:", err);
      }
    } // Fim do if (nfes.length > 0)
    } // Fim do IF F0121
    
    } catch (ePost) {
       console.error("Erro nas rotinas pós-SAP (NFe/MDFe):", ePost);
       // Não damos throw, pois a OC já está fechada e o SAP gerado!
    }

    alert('Invoices Geradas no SAP e Romaneio Finalizado com Sucesso!');
    
    // 5. Reinicia estado e volta pra tela inicial
    currentView = 'oc_list';
    scannedPackages = [];
    selectedOC = null;
    selectedLine = null;
    currentRomaneio = null;
    renderCurrentView();

  } catch (err) {
    console.error(err);
    alert('Erro no fechamento: ' + err.message);
    currentView = 'item_list'; 
    renderCurrentView();
  }
}

async function handleFinalizarTransferencia() {
  document.getElementById('rs-content').innerHTML = `
    <div style="text-align:center; padding: 40px;">
      <div class="spinner" style="margin-bottom: 16px;"></div>
      <div style="font-weight: 600;" id="rs-loading-title">Finalizando Transferência...</div>
      <div style="font-size: 0.85rem; color: var(--color-text-sec); margin-top: 8px;" id="rs-loading-subtitle">Movimentando pacotes para o novo local.</div>
    </div>
  `;

  try {
    const qrcodes = scannedPackages.map(p => p.qrcode);
    
    // Atualiza os pacotes para o novo local de destino
    const { error: updError } = await supabase
      .from('amarracoes')
      .update({ local_estoque: selectedOC.local_destino })
      .in('qrcode', qrcodes);

    if (updError) throw updError;

    // Atualiza o Romaneio
    if (currentRomaneio) {
      const { error: roError } = await supabase
        .from('expedicao_romaneios')
        .update({ status: 'Finalizado' })
        .eq('id', currentRomaneio.id);
      if (roError) throw roError;
    }

    // Atualiza a OC
    const { error: ocError } = await supabase
      .from('expedicao_ordens_carregamento')
      .update({ status: 'Finalizada' })
      .eq('id', selectedOC.id);
    if (ocError) throw ocError;

    alert('Transferência Interna finalizada com sucesso! Os pacotes foram movimentados.');
    
    selectedOC = null;
    selectedLine = null;
    currentRomaneio = null;
    scannedPackages = [];
    currentView = 'oc_list';
    loadOCs(); // Refresh list and it will render the list
  } catch (err) {
    console.error('Error in handleFinalizarTransferencia:', err);
    alert('Erro ao finalizar transferência: ' + err.message);
    
    // Fallback para tela anterior
    currentView = 'item_list';
    renderCurrentView();
  }
}
