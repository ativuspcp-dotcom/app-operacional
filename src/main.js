import './style.css';
import { supabase } from './supabase.js';
import { renderRomaneioSaida } from './romaneio-saida.js';

let currentSession = null;
let currentPermissions = [];

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  currentSession = session;

  supabase.auth.onAuthStateChange((event, session) => {
    const wasSignedIn = !!currentSession;
    currentSession = session;
    
    if (event === 'SIGNED_OUT' || (event === 'SIGNED_IN' && !wasSignedIn)) {
      route();
    }
  });

  window.addEventListener('hashchange', route);
  route();
}

async function route() {
  const app = document.getElementById('app');
  const path = window.location.hash.slice(1) || '/';

  if (!currentSession && path !== '/login') {
    window.location.hash = '/login';
    return;
  }
  if (currentSession && path === '/login') {
    window.location.hash = '/';
    return;
  }

  if (path === '/login') {
    renderLogin(app);
  } else if (path === '/') {
    await renderHome(app);
  } else if (path === '/amarracao') {
    renderAmarracao(app);
  } else if (path === '/romaneio-saida') {
    renderRomaneioSaida(app);
  } else {
    app.innerHTML = '<div class="container text-center mt-4">Página não encontrada. <br><br><button class="btn btn-primary" onclick="window.location.hash=\'/\'">Voltar</button></div>';
  }
}

function renderLogin(container) {
  container.innerHTML = `
    <div style="min-height: 100vh; display: flex; flex-direction: column; justify-content: center; background: var(--dark-500); padding: 24px;">
      <div style="background: white; border-radius: 16px; padding: 32px 24px; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
        <div class="text-center mb-4">
          <h2 style="color: var(--green-400); font-size: 1.5rem; font-weight: 700;">Tableros</h2>
          <p style="color: var(--color-text-sec); font-size: 0.9rem;">App Operacional</p>
        </div>
        
        <form id="login-form">
          <div class="form-group">
            <label class="form-label">Usuário</label>
            <input type="text" id="username" class="form-input" placeholder="Seu usuário" required autocomplete="username">
          </div>
          <div class="form-group" style="margin-bottom: 32px;">
            <label class="form-label">Senha</label>
            <input type="password" id="password" class="form-input" placeholder="Sua senha" required autocomplete="current-password">
          </div>
          <button type="submit" class="btn btn-primary" id="btn-login">Entrar</button>
        </form>
        <div id="login-error" style="color: #ef4444; font-size: 0.85rem; text-align: center; margin-top: 16px; min-height: 20px;"></div>
      </div>
    </div>
  `;

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = document.getElementById('username').value.trim().toLowerCase();
    const pass = document.getElementById('password').value;
    const btn = document.getElementById('btn-login');
    const err = document.getElementById('login-error');

    err.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Entrando...';

    let userEmail = user;
    if (!userEmail.includes('@')) {
      userEmail = `${userEmail}@app.tableros.com`;
    }

    // No modo Totem, o e-mail não é fake, é um e-mail de "Estação"
    const { error } = await supabase.auth.signInWithPassword({
      email: userEmail,
      password: pass,
    });

    if (error) {
      err.textContent = 'Usuário ou senha incorretos.';
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  });
}

async function renderHome(container) {
  container.innerHTML = `
    <div class="header">
      <div class="header-title">Olá, Operador</div>
      <button id="btn-logout" style="color: white; padding: 8px;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
      </button>
    </div>
    <div class="container" id="home-content">
      <div class="text-center mt-4" style="color: var(--color-text-sec);">Carregando módulos...</div>
    </div>
  `;

  document.getElementById('btn-logout').addEventListener('click', async () => {
    await supabase.auth.signOut();
  });

  // Fetch permissions from user_module_permissions joined with modules
  const { data: perms, error } = await supabase
    .from('user_module_permissions')
    .select(`
      can_view,
      modules (
        name, slug, icon, type, group_name
      )
    `)
    .eq('user_id', currentSession.user.id)
    .eq('can_view', true);

  if (error) {
    document.getElementById('home-content').innerHTML = `<div class="text-center mt-4" style="color: #ef4444;">Erro ao carregar permissões.</div>`;
    return;
  }

  // Filter only app modules
  const appModules = perms.filter(p => p.modules && p.modules.type === 'app').map(p => p.modules);

  if (appModules.length === 0) {
    document.getElementById('home-content').innerHTML = `
      <div class="text-center mt-4" style="padding: 24px; background: white; border-radius: 12px;">
        <h3>Sem Acesso</h3>
        <p style="color: var(--color-text-sec); margin-top: 8px; font-size: 0.9rem;">Esta estação não tem nenhum módulo liberado. Configure no Portal.</p>
      </div>
    `;
    return;
  }

  const content = document.getElementById('home-content');
  content.innerHTML = `<h3 style="font-size: 1.1rem; margin-top: 8px;">Estação de Trabalho</h3><div class="module-grid" id="module-grid"></div>`;
  
  const grid = document.getElementById('module-grid');

  appModules.forEach(mod => {
    const card = document.createElement('div');
    card.className = 'module-card';
    
    // Default factory icon
    let iconSvg = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>';
    if (mod.slug === 'app_amarracao') {
      iconSvg = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>';
    } else if (mod.slug === 'app_romaneio_saida') {
      iconSvg = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17h4V5H2v12h3"></path><path d="M20 17h2v-9h-4V5H14v12h3"></path><path d="M14 17c0 1.66-1.34 3-3 3s-3-1.34-3-3s1.34-3 3-3s3 1.34 3 3z"></path></svg>';
    }

    card.innerHTML = `
      <div class="module-icon">${iconSvg}</div>
      <div class="module-title">${mod.name}</div>
    `;

    card.addEventListener('click', () => {
      if (mod.slug === 'app_amarracao') {
        window.location.hash = '/amarracao';
      } else if (mod.slug === 'app_romaneio_saida') {
        window.location.hash = '/romaneio-saida';
      } else {
        alert('Módulo ' + mod.name + ' em desenvolvimento.');
      }
    });

    grid.appendChild(card);
  });
}

async function renderAmarracao(container) {
  // Fetch items from SAP B1 Service Layer
  let realItems = [];
  try {
    const url = "/api/Items?$select=ItemCode,ItemName,ForeignName,ItemsGroupCode,SalesFactor1,SalesFactor2,SalesFactor3,SalesFactor4,U_Quality&$filter=ItemsGroupCode eq 106 and Properties1 eq 'tYES'";
    const res = await fetch(url, {
      method: 'GET',
      headers: { 
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
        'Prefer': 'odata.maxpagesize=0'
      }
    });
    
    const qualityMap = {
      '001': '1ª QUALIDADE',
      '002': '1ª PERMUTA',
      '003': '2ª QUALIDADE',
      '004': '3ª QUALIDADE',
      '005': 'BG',
      '006': 'SG'
    };

    if (res.ok) {
      const data = await res.json();
      const itemsData = data.value || [];
      realItems = itemsData.map(d => ({
        id: d.ItemCode, // using ItemCode as ID
        cod: d.ItemCode,
        nome: d.ForeignName || d.ItemName,
        qualidade: qualityMap[d.U_Quality] || d.U_Quality || '-',
        uQualityCode: d.U_Quality,
        comprimento: d.SalesFactor1,
        largura: d.SalesFactor2,
        espessura: d.SalesFactor3,
        pecas: d.SalesFactor4
      }));
    } else {
      console.error('Error fetching SAP items:', res.status, res.statusText);
    }
  } catch (error) {
    console.error('Network error fetching SAP items:', error);
  }


  // Busca as OPs de Amarração liberadas
  let ops = [];
  try {
    const { data } = await supabase
      .from('pcp_op_amarracao')
      .select('id, pi_numero, item_code, item_name, status, qtd_caixas')
      .eq('liberada_producao', true)
      .in('status', ['Pendente', 'Em Produção'])
      .order('created_at', { ascending: true });
    if (data) ops = data;
  } catch(e) { console.error('Error fetching OPs:', e); }

  const today = new Date().toISOString().split('T')[0];

  container.innerHTML = `
    <div class="header">
      <button id="btn-back" style="color: white; padding: 8px; border:none; background:transparent;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
      </button>
      <div class="header-title">Amarração de Caixas</div>
      <div style="width: 40px;"></div>
    </div>
    
    <div class="container mt-4">
      <div style="background: white; padding: 24px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
        
        <form id="amarracao-form">
          <div class="form-group">
            <label class="form-label">Data Prod.</label>
            <input type="date" id="data_producao" class="form-input" value="${today}" required>
          </div>

          <div class="form-group">
            <label class="form-label">Local Prod.</label>
            <div class="toggle-group" id="toggle-local-prod">
              <button type="button" class="toggle-btn active" data-val="PRINCIPAL">PRINCIPAL</button>
              <button type="button" class="toggle-btn" data-val="ERGO">ERGO</button>
            </div>
          </div>

          <div class="form-group" style="display: flex; align-items: center; margin-bottom: 12px;">
            <input type="checkbox" id="check_descarte" style="width: 18px; height: 18px; accent-color: var(--color-primary); cursor: pointer;">
            <label for="check_descarte" class="form-label" style="margin-left: 8px; margin-bottom: 0; cursor: pointer;">Descartes / Avulsas</label>
          </div>

          <div class="form-group">
            <label class="form-label">Ordem de Produção <span class="required">*</span></label>
            <select id="op_select" class="form-input" style="appearance: auto; height: 48px; background-color: var(--dark-300);" required>
              <option value="" disabled selected>Selecione uma OP...</option>
              ${ops.map(op => `<option value="${op.id}" data-item="${op.item_code}">${op.pi_numero ? op.pi_numero + ' - ' : ''}${op.item_name} (${op.status})</option>`).join('')}
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">Item</label>
            <div class="custom-dropdown-container">
              <input type="text" id="item_search" class="form-input" placeholder="Comece a digitar para buscar..." required autocomplete="off" readonly>
              <div id="item_dropdown" class="custom-dropdown" style="display: none;"></div>
            </div>
          </div>

          <div class="grid-2">
            <div class="form-group">
              <label class="form-label">Cód. Item</label>
              <input type="text" id="cod_item" class="form-input input-readonly" readonly>
            </div>
            <div class="form-group">
              <label class="form-label">Qualidade</label>
              <input type="text" id="qualidade" class="form-input input-readonly" readonly>
            </div>
          </div>

          <div class="grid-2">
            <div class="form-group">
              <label class="form-label">Peças</label>
              <input type="number" id="pecas" class="form-input" min="1" step="1" required>
            </div>
            <div class="form-group">
              <label class="form-label">Total (m³)</label>
              <input type="text" id="total_m3" class="form-input input-readonly" readonly placeholder="0.0000">
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Peso (kg)</label>
            <input type="number" id="peso" class="form-input" min="1" step="1" required>
          </div>

          <div class="form-group">
            <label class="form-label">Local Estoque</label>
            <div class="toggle-group" id="toggle-local-estoque">
              <button type="button" class="toggle-btn active" data-val="PLUS">PLUS</button>
              <button type="button" class="toggle-btn" data-val="OSB">OSB</button>
              <button type="button" class="toggle-btn" data-val="PLY">PLY</button>
            </div>
          </div>

          <div class="form-group" style="margin-top: 32px; border-top: 1px solid var(--color-border); padding-top: 24px;">
            <label class="form-label text-center">Senha (PIN)</label>
            <input type="password" id="pin" class="form-input pin-input" inputmode="numeric" maxlength="4" placeholder="****" required>
          </div>

          <div class="form-group">
            <label class="form-label text-center">Responsável</label>
            <input type="text" id="responsavel_nome" class="form-input input-readonly text-center" style="font-size: 1.2rem;" readonly placeholder="Aguardando PIN...">
            <input type="hidden" id="responsavel_id">
          </div>

          <div class="form-group" style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 16px; margin-bottom: 24px;">
            <input type="checkbox" id="imprimir_checkbox" checked style="width: 20px; height: 20px; accent-color: var(--color-primary); cursor: pointer;">
            <label for="imprimir_checkbox" style="font-size: 1.1rem; font-weight: 500; cursor: pointer; user-select: none;">Imprimir Etiqueta na Inserção</label>
          </div>

          <div id="form-error" class="text-center error-text mb-4"></div>
          <div id="form-success" class="text-center success-text mb-4"></div>

          <button type="submit" id="btn-save" class="btn btn-primary" style="padding: 20px; font-size: 1.1rem;" disabled>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
            Salvar Apontamento
          </button>
        </form>
      </div>
    </div>
  `;

  // Navigation
  document.getElementById('btn-back').addEventListener('click', () => {
    window.location.hash = '/';
  });

  // Toggle button logic
  let localProd = 'PRINCIPAL';
  let localEstoque = 'PLUS';

  function setupToggles(groupId, callback) {
    const group = document.getElementById(groupId);
    group.addEventListener('click', (e) => {
      if (e.target.classList.contains('toggle-btn')) {
        group.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('active'));
        e.target.classList.add('active');
        callback(e.target.dataset.val);
      }
    });
  }

  setupToggles('toggle-local-prod', val => localProd = val);
  setupToggles('toggle-local-estoque', val => localEstoque = val);

  // Auto-fill Item logic via custom dropdown
  let selectedItem = null;
  const searchInput = document.getElementById('item_search');
  const dropdown = document.getElementById('item_dropdown');

  function calcTotalM3() {
    const pecasInput = document.getElementById('pecas');
    const totalInput = document.getElementById('total_m3');
    
    if (!selectedItem || !pecasInput.value) {
      totalInput.value = '';
      return;
    }
    
    const pecas = parseInt(pecasInput.value) || 0;
    const comp = parseFloat(selectedItem.comprimento) || 0;
    const larg = parseFloat(selectedItem.largura) || 0;
    const esp = parseFloat(selectedItem.espessura) || 0;
    
    if (comp && larg && esp && pecas) {
      const total = comp * larg * esp * pecas;
      totalInput.value = total.toFixed(4);
    } else {
      totalInput.value = '';
    }
  }

  document.getElementById('pecas').addEventListener('input', calcTotalM3);

  function renderDropdown(query) {
    const q = query.toLowerCase();
    
    const matches = realItems.filter(m => {
      return m.cod.toLowerCase().includes(q) || m.nome.toLowerCase().includes(q);
    }).slice(0, 50);

    if (matches.length === 0) {
      dropdown.innerHTML = '<div class="dropdown-item-empty">Nenhum item encontrado.</div>';
    } else {
      dropdown.innerHTML = matches.map(m => `
        <div class="dropdown-item" data-id="${m.id}">
          <div class="dropdown-item-code">${m.cod}</div>
          <div class="dropdown-item-name">${m.nome}</div>
        </div>
      `).join('');
    }
    dropdown.style.display = 'block';

    dropdown.querySelectorAll('.dropdown-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        selectedItem = realItems.find(x => x.id === id);
        
        searchInput.value = `${selectedItem.cod} - ${selectedItem.nome}`;
        document.getElementById('cod_item').value = selectedItem.cod;
        document.getElementById('qualidade').value = selectedItem.qualidade;
        if (selectedItem.pecas) document.getElementById('pecas').value = selectedItem.pecas;
        
        calcTotalM3();
        dropdown.style.display = 'none';
      });
    });
  }

  searchInput.addEventListener('focus', () => renderDropdown(searchInput.value));
  searchInput.addEventListener('input', (e) => {
    selectedItem = null;
    document.getElementById('cod_item').value = '';
    document.getElementById('qualidade').value = '';
    renderDropdown(e.target.value);
  });

  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });

  const checkDescarte = document.getElementById('check_descarte');
  const opSelect = document.getElementById('op_select');

  checkDescarte.addEventListener('change', (e) => {
    const isDescarte = e.target.checked;
    opSelect.required = !isDescarte;
    opSelect.disabled = isDescarte;
    
    if (isDescarte) {
      opSelect.value = ''; // clear OP selection
      searchInput.readOnly = false; // allow typing
      selectedItem = null;
      document.getElementById('cod_item').value = '';
      document.getElementById('qualidade').value = '';
      searchInput.value = '';
      if (document.getElementById('pecas')) document.getElementById('pecas').value = '';
      calcTotalM3();
    } else {
      searchInput.readOnly = true;
      searchInput.value = '';
      selectedItem = null;
      document.getElementById('cod_item').value = '';
      document.getElementById('qualidade').value = '';
      if (document.getElementById('pecas')) document.getElementById('pecas').value = '';
      calcTotalM3();
    }
  });

  // Logic for OP Selection
  opSelect.addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    const itemCode = opt ? opt.getAttribute('data-item') : null;
    if (itemCode) {
      const item = realItems.find(i => i.cod === itemCode);
      if (item) {
        selectedItem = item;
        searchInput.value = `${item.cod} - ${item.nome}`;
        document.getElementById('cod_item').value = item.cod;
        document.getElementById('qualidade').value = item.qualidade;
        if (item.pecas) document.getElementById('pecas').value = item.pecas;
        calcTotalM3();
        searchInput.readOnly = true; // Block manual search when OP is selected
        dropdown.style.display = 'none';
      }
    } else {
      searchInput.readOnly = false; // Unblock
      searchInput.value = '';
      document.getElementById('cod_item').value = '';
      document.getElementById('qualidade').value = '';
      selectedItem = null;
    }
  });

  // PIN validation logic
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
      
      const { data, error } = await supabase
        .from('app_apontadores')
        .select('id, nome_completo')
        .eq('pin', val)
        .eq('status', 'ATIVO')
        .single();
        
      if (error || !data) {
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
    } else {
      respInput.value = '';
      respIdInput.value = '';
      respInput.classList.remove('success-text');
      btnSave.disabled = true;
    }
  });

  // Form submission
  document.getElementById('amarracao-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.textContent = '';
    formSuccess.textContent = '';

    if (!selectedItem) {
      formError.textContent = 'Selecione um item válido da lista.';
      return;
    }
    if (!respIdInput.value) {
      formError.textContent = 'Digite um PIN válido para prosseguir.';
      return;
    }

    btnSave.disabled = true;
    btnSave.innerHTML = 'Salvando...';

    try {
      const opId = document.getElementById('op_select').value || null;

      // VALIDATION: Check if OP limit is reached
      if (opId) {
        const selectedOp = ops.find(o => o.id === opId);
        if (selectedOp && selectedOp.qtd_caixas > 0) {
          const { count, error: countError } = await supabase
            .from('amarracoes')
            .select('id', { count: 'exact', head: true })
            .eq('op_id', opId);
            
          if (!countError && count >= selectedOp.qtd_caixas) {
            const proceed = window.confirm(`AVISO: A OP selecionada previa apenas ${selectedOp.qtd_caixas} pacotes e este limite já foi atingido.\n\nDeseja apontar e adicionar este pacote à OP mesmo assim?`);
            if (!proceed) {
              btnSave.disabled = false;
              btnSave.innerHTML = `
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                Salvar Apontamento
              `;
              return;
            }
          }
        }
      }

      const payload = {
        data_producao: document.getElementById('data_producao').value,
        local_producao: localProd,
        cod_item: selectedItem.cod,
        nome_item: selectedItem.nome,
        qualidade: selectedItem.qualidade,
        pecas: parseInt(document.getElementById('pecas').value),
        total_calc: parseFloat(document.getElementById('total_m3').value) || 0,
        local_estoque: localEstoque,
        peso: parseInt(document.getElementById('peso').value),
        responsavel_id: respIdInput.value,
        responsavel_nome: respInput.value,
        tablet_user_id: currentSession.user.id,
        op_id: opId
      };

      const { data: insertData, error: insertError } = await supabase
        .from('amarracoes')
        .insert(payload)
        .select()
        .single();
      
      if (insertError) throw insertError;

      const imprimir = document.getElementById('imprimir_checkbox').checked;

      if (imprimir) {
        // Obter data e hora local do navegador (Brasil)
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const localTimeFormatted = `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;

        const sapEndpoint = localProd === 'PRINCIPAL' ? '/api/estoque' : '/api/acab-ergo';
        const sapPayload = {
          data: localTimeFormatted,
          responsavel: respInput.value,
          local: localEstoque,
          codigo_item: selectedItem.cod,
          item: selectedItem.nome,
          pecas: document.getElementById('pecas').value,
          quantidade: document.getElementById('total_m3').value,
          qrcode: insertData.qrcode,
          peso: document.getElementById('peso').value
        };

        let printerMsg = '';
        try {
          const sapRes = await fetch(sapEndpoint, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify(sapPayload)
          });
          
          const responseText = await sapRes.text();
          
          if (!sapRes.ok) {
            await supabase.from('amarracoes').delete().eq('id', insertData.id);
            formError.textContent = `Impressora falhou (${sapRes.status}). Apontamento cancelado e não salvo no banco. Detalhe: ${responseText}`;
          } else {
            formSuccess.textContent = `Apontamento salvo! Impressora: ${responseText || 'OK'}`;
          }
        } catch (printErr) {
          await supabase.from('amarracoes').delete().eq('id', insertData.id);
          formError.textContent = `Impressora falhou (Rede). Apontamento cancelado e não salvo no banco. Erro: ${printErr.message}`;
        }
      } else {
        formSuccess.textContent = 'Apontamento salvo no banco! (Impressão desativada)';
      }
      
      // Reset only PIN and Responsável to keep the form filled for the next package
      const pinInput = document.getElementById('pin');
      pinInput.value = '';
      pinInput.disabled = false;
      pinInput.focus();
      
      respInput.value = '';
      respIdInput.value = '';
      respInput.classList.remove('success-text');
      
      setTimeout(() => { formSuccess.textContent = ''; }, 3000);
      
    } catch (err) {
      console.error(err);
      formError.textContent = 'Erro ao salvar: ' + err.message;
    } finally {
      btnSave.disabled = true; // Disabled because PIN is cleared
      btnSave.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
        Salvar Apontamento
      `;
    }
  });
}

init();
