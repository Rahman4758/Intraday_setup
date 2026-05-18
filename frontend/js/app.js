/**
 * APP — Main orchestrator & DOM controller
 */
document.addEventListener('DOMContentLoaded', () => {

  // ═══════ INIT ═══════
  const $ = id => document.getElementById(id);
  const dateEl = $('currentDate');
  const authBadge = $('authBadge');
  const stockPills = $('stockPills');
  const stockInput = $('stockInput');
  const addStockBtn = $('addStockBtn');
  const dashboard = $('dashboard');
  const emptyState = $('emptyState');
  const prioritySection = $('prioritySection');
  const priorityList = $('priorityList');
  const scanBtn = $('scanBtn');
  const ampExpiry = $('ampExpiry');
  const ampMonday = $('ampMonday');
  const ampPostResults = $('ampPostResults');
  const ampFIIStreak = $('ampFIIStreak');

  // Set date
  const now = new Date();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  dateEl.textContent = `${dayNames[now.getDay()]} · ${now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  // Auto-detect Monday
  if (now.getDay() === 1) {
    ampMonday.classList.add('active');
  }

  // ═══════ AUTH CHECK ═══════
  async function checkAuth() {
    try {
      const status = await API.checkAuth();
      if (status.authenticated) {
        authBadge.className = 'auth-badge auth-badge--ok';
        authBadge.textContent = '● CONNECTED';
      } else {
        authBadge.className = 'auth-badge auth-badge--fail';
        authBadge.textContent = '● NOT CONNECTED';
        authBadge.onclick = async () => {
          try {
            const { loginURL } = await API.getLoginURL();
            window.open(loginURL, '_blank');
          } catch { Components.showToast('Could not get login URL', 'error'); }
        };
      }
    } catch {
      authBadge.className = 'auth-badge auth-badge--fail';
      authBadge.textContent = '● OFFLINE';
    }
  }

  // ═══════ STOCK MANAGEMENT ═══════
  async function loadStocks() {
    try {
      const { stocks } = await API.getStocks();
      stockPills.innerHTML = '';
      for (const s of stocks) {
        stockPills.appendChild(Components.createStockPill(s.symbol, removeStock));
      }
    } catch (err) {
      console.error('Load stocks:', err);
    }
  }

  async function addStock() {
    const symbol = stockInput.value.trim().toUpperCase();
    if (!symbol) return;
    try {
      await API.addStock(symbol);
      stockInput.value = '';
      Components.showToast(`${symbol} added to watchlist`, 'success');
      loadStocks();
    } catch (err) {
      Components.showToast(err.message, 'error');
    }
  }

  async function removeStock(symbol) {
    try {
      await API.removeStock(symbol);
      Components.showToast(`${symbol} removed`, 'info');
      loadStocks();
    } catch (err) {
      Components.showToast(err.message, 'error');
    }
  }

  addStockBtn.addEventListener('click', addStock);
  stockInput.addEventListener('keydown', e => { if (e.key === 'Enter') addStock(); });

  // ═══════ AMPLIFIER TOGGLES ═══════
  const ampSectorOutperforming = $('ampSectorOutperforming');

  [ampExpiry, ampMonday, ampSectorOutperforming].forEach(el => {
    el.addEventListener('click', () => {
      el.classList.toggle('active');
      saveAmplifiers();
    });
  });

  ampPostResults.addEventListener('change', saveAmplifiers);
  ampFIIStreak.addEventListener('change', saveAmplifiers);

  function getAmplifierContext() {
    return {
      isExpiryWeek: ampExpiry.classList.contains('active'),
      isMonday: ampMonday.classList.contains('active'),
      isSectorOutperforming: ampSectorOutperforming.classList.contains('active'),
      postResultsDayNum: parseInt(ampPostResults.value) || 0,
      fiiBuyStreak: parseInt(ampFIIStreak.value) || 0
    };
  }

  async function saveAmplifiers() {
    try {
      await API.setAmplifiers(getAmplifierContext());
    } catch { /* silent */ }
  }

  // ═══════ SCAN ═══════
  scanBtn.addEventListener('click', async () => {
    scanBtn.classList.add('loading');
    scanBtn.textContent = '⟳ SCANNING...';
    scanBtn.disabled = true;

    try {
      const ctx = getAmplifierContext();
      const result = await API.runScan(ctx);

      if (result.results && result.results.length > 0) {
        const priorityResults = result.results.filter(s => s.finalScore >= 7);
        renderDashboard(priorityResults);
        renderPriority(priorityResults);
        Components.showToast(`Scan complete — ${priorityResults.length} high priority setups found`, 'success');
      } else {
        Components.showToast(result.message || 'No results', 'info');
      }
    } catch (err) {
      console.error(err);
      // Determine if it's the market closed error or another error
      if (err.message.includes('Market is currently closed') || err.message.includes('Market closed')) {
        Components.showToast('⛔ ' + err.message, 'error');
      } else {
        Components.showToast('Error: ' + err.message, 'error');
      }
    } finally {
      scanBtn.classList.remove('loading');
      scanBtn.textContent = '▶ RUN EOD SCAN';
      scanBtn.disabled = false;
    }
  });

  // ═══════ RENDER DASHBOARD ═══════
  function renderDashboard(results) {
    dashboard.innerHTML = '';
    emptyState.style.display = 'none';

    for (const r of results) {
      const card = Components.createScoreCard(r);
      dashboard.appendChild(card);
    }
  }

  // ═══════ RENDER PRIORITY ═══════
  function renderPriority(results) {
    if (!results || results.length === 0) {
      prioritySection.style.display = 'none';
      return;
    }

    prioritySection.style.display = 'block';
    priorityList.innerHTML = '';

    const sorted = [...results].sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));
    sorted.forEach((r, i) => {
      priorityList.appendChild(Components.createPriorityCard(r, i + 1));
    });
  }

  // ═══════ LOAD PREVIOUS SCORES ═══════
  async function loadLatestScores() {
    try {
      const { priority, date } = await API.getPriority();
      if (priority && priority.length > 0) {
        renderDashboard(priority);
        renderPriority(priority);
      }
    } catch { /* No previous scores */ }
  }

  // ═══════ MODAL LOGIC ═══════
  window.openDetailModal = function(result) {
    console.log('Opening detail page for:', result.symbol);
    window.open(`/stock-detail.html?symbol=${result.symbol}`, '_blank');
  };

  // ═══════ BOOT ═══════
  checkAuth();
  loadStocks();
  loadLatestScores();
});
