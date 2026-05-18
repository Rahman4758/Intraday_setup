// intraday.js - Handles the Live CSMC Radar UI and 15s polling

document.addEventListener('DOMContentLoaded', () => {
  const tabEODBtn = document.getElementById('tabEODBtn');
  const tabIntradayBtn = document.getElementById('tabIntradayBtn');
  const tabPullbackBtn = document.getElementById('tabPullbackBtn');
  const viewEOD = document.getElementById('viewEOD');
  const viewIntraday = document.getElementById('viewIntraday');
  const viewPullback = document.getElementById('viewPullback');
  const scanBtn = document.getElementById('scanBtn'); // The global run EOD scan btn

  const btnStartEngine = document.getElementById('btnStartEngine');
  const btnStopEngine = document.getElementById('btnStopEngine');
  const intradayDashboard = document.getElementById('intradayDashboard');
  const intradayEmptyState = document.getElementById('intradayEmptyState');

  let pollInterval = null;

  // --- Tab Switching ---
  tabEODBtn.addEventListener('click', () => {
    tabEODBtn.classList.add('btn--primary');
    tabIntradayBtn.classList.remove('btn--primary');
    if (tabPullbackBtn) tabPullbackBtn.classList.remove('btn--primary');
    viewEOD.style.display = 'block';
    viewIntraday.style.display = 'none';
    if (viewPullback) viewPullback.style.display = 'none';
    scanBtn.style.display = 'block';
  });

  tabIntradayBtn.addEventListener('click', () => {
    tabIntradayBtn.classList.add('btn--primary');
    tabEODBtn.classList.remove('btn--primary');
    if (tabPullbackBtn) tabPullbackBtn.classList.remove('btn--primary');
    viewEOD.style.display = 'none';
    viewIntraday.style.display = 'block';
    if (viewPullback) viewPullback.style.display = 'none';
    scanBtn.style.display = 'none';
  });

  // --- Engine Controls ---
  btnStartEngine.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/intraday/engine/start', { method: 'POST' });
      const data = await res.json();
      
      if (!res.ok || data.status === 'error') {
        intradayDashboard.innerHTML = `
          <div class="empty-state" style="border-color: #ff4757; color: #ff4757;">
            <div class="empty-state__icon">⛔</div>
            <div class="empty-state__title">Market Closed</div>
            <div class="empty-state__text">${data.message || data.error || 'Intraday scanning is only available during market hours.'}</div>
          </div>
        `;
        return;
      }

      btnStartEngine.style.display = 'none';
      btnStopEngine.style.display = 'inline-block';
      intradayEmptyState.style.display = 'none';
      startPolling();
    } catch (err) {
      console.error(err);
      alert('Failed to start engine: ' + err.message);
    }
  });

  btnStopEngine.addEventListener('click', async () => {
    try {
      await fetch('/api/intraday/engine/stop', { method: 'POST' });
      btnStopEngine.style.display = 'none';
      btnStartEngine.style.display = 'inline-block';
      stopPolling();
    } catch (err) {
      console.error(err);
    }
  });

  // --- Polling Logic ---
  function startPolling() {
    fetchIntradayData(); // immediate
    pollInterval = setInterval(fetchIntradayData, 15000);
  }

  function stopPolling() {
    if (pollInterval) clearInterval(pollInterval);
  }

  async function fetchIntradayData() {
    try {
      const res = await fetch('/api/intraday/live');
      const data = await res.json();
      if (data.status === 'success') {
        renderIntradayGrid(data.data);
      }
    } catch (err) {
      console.error('Error fetching intraday data:', err);
    }
  }

  // --- Render Grid ---
  function renderIntradayGrid(states) {
    if (!states || states.length === 0) {
      intradayDashboard.innerHTML = `<div class="empty-state"><div class="empty-state__title">Engine Running...</div><div class="empty-state__text">Waiting for top-rated stocks to be processed.</div></div>`;
      return;
    }

    let html = `<div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px;">`;
    
    states.forEach(s => {
      // Color coding based on status
      let borderColor = '#4a5568';
      let statusIcon = '⏳';
      if (s.status === 'COMPRESSION_FORMED') { borderColor = '#ffa502'; statusIcon = '⚡'; }
      if (s.status === 'CORRECTING') { borderColor = '#1dd1a1'; statusIcon = '📉'; }
      if (s.status === 'ACTIVE') { borderColor = '#00f5d4'; statusIcon = '🔥'; }
      if (s.status === 'ABORTED' || s.status === 'EXITED') { borderColor = '#ff4757'; statusIcon = '❌'; }

      html += `
        <div class="score-card glass" style="border-top: 3px solid ${borderColor}; position:relative; overflow:hidden;">
          <div style="display:flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px;">
            <div style="font-size: 1.2rem; font-weight: 700; color: var(--text-primary);">${s.symbol}</div>
            <div style="font-size: 0.8rem; font-family: var(--font-mono); color: ${borderColor}; font-weight: 600;">${statusIcon} ${s.status.replace(/_/g, ' ')}</div>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;">
            <div style="background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">
              <div style="font-size:0.6rem; color:var(--text-muted); text-transform:uppercase;">Live CMP</div>
              <div style="font-size:1rem; font-family:var(--font-mono); font-weight:700;">₹${s.cmp ? s.cmp.toFixed(2) : '--'}</div>
            </div>
            <div style="background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">
              <div style="font-size:0.6rem; color:var(--text-muted); text-transform:uppercase;">Live RSI</div>
              <div style="font-size:1rem; font-family:var(--font-mono); font-weight:700; color: ${s.liveRSI >= 55 ? 'var(--band-alert)' : 'var(--band-not-ready)'}">${s.liveRSI ? s.liveRSI.toFixed(1) : '--'}</div>
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;">
            <div style="background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">
              <div style="font-size:0.6rem; color:var(--text-muted); text-transform:uppercase;">OI Support</div>
              <div style="font-size:0.8rem; font-family:var(--font-mono);">${s.liveSupport ? s.liveSupport : '--'}</div>
            </div>
            <div style="background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">
              <div style="font-size:0.6rem; color:var(--text-muted); text-transform:uppercase;">OI Resistance</div>
              <div style="font-size:0.8rem; font-family:var(--font-mono);">${s.liveResistance ? s.liveResistance : '--'}</div>
            </div>
          </div>

          ${s.status === 'ACTIVE' ? `
            <div style="background: rgba(0, 245, 212, 0.1); border: 1px solid rgba(0, 245, 212, 0.3); padding: 10px; border-radius: 4px; margin-bottom: 8px;">
              <div style="display:flex; justify-content: space-between; font-size: 0.7rem; font-family: var(--font-mono);">
                <span>Entry: ₹${s.entryPrice.toFixed(2)} (Qty: ${s.quantity || '--'})</span>
                <span style="color: ${s.currentPnL >= 0 ? '#00f5d4' : '#ff4757'}; font-weight:700;">
                  ₹${s.currentPnLAmount ? s.currentPnLAmount.toFixed(2) : '0.00'} (${s.currentPnL ? s.currentPnL.toFixed(2) : '0.00'}%)
                </span>
              </div>
              <div style="display:flex; justify-content: space-between; font-size: 0.7rem; font-family: var(--font-mono); margin-top: 4px; color: var(--text-muted);">
                <span>SL: ₹${s.stopLoss.toFixed(2)}</span>
                <span>Tgt: ₹${s.target2.toFixed(2)}</span>
              </div>
            </div>
          ` : ''}

          ${s.invalidationReason ? `
            <div style="font-size: 0.7rem; color: #ff4757; font-family: var(--font-mono); padding-top: 4px; text-align: center;">
              Reason: ${s.invalidationReason}
            </div>
          ` : ''}
        </div>
      `;
    });
    
    html += `</div>`;
    intradayDashboard.innerHTML = html;
  }
});
