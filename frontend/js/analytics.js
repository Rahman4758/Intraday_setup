document.addEventListener('DOMContentLoaded', () => {
  const tabAnalyticsBtn = document.getElementById('tabAnalyticsBtn');
  const viewEOD = document.getElementById('viewEOD');
  const viewIntraday = document.getElementById('viewIntraday');
  const viewAnalytics = document.getElementById('viewAnalytics');
  const scanBtn = document.getElementById('scanBtn');

  // Elements
  const statTotalTrades = document.getElementById('statTotalTrades');
  const statWinRate = document.getElementById('statWinRate');
  const statTotalPnL = document.getElementById('statTotalPnL');
  const journalTableBody = document.getElementById('journalTableBody');

  // Tab routing
  if (tabAnalyticsBtn) {
    tabAnalyticsBtn.addEventListener('click', () => {
      document.getElementById('tabEODBtn').classList.remove('btn--primary');
      document.getElementById('tabIntradayBtn').classList.remove('btn--primary');
      tabAnalyticsBtn.classList.add('btn--primary');

      viewEOD.style.display = 'none';
      viewIntraday.style.display = 'none';
      viewAnalytics.style.display = 'block';
      if (scanBtn) scanBtn.style.display = 'none';

      loadAnalytics();
    });
  }

  async function loadAnalytics() {
    try {
      // 1. Fetch Metrics
      const mRes = await fetch('/api/journal/analytics');
      const mData = await mRes.json();
      if (mData.status === 'success') {
        const stats = mData.data;
        statTotalTrades.textContent = stats.totalTrades;
        statWinRate.textContent = `${stats.winRate}%`;
        statTotalPnL.textContent = `₹${stats.totalPnLAmount}`;
        statTotalPnL.style.color = stats.totalPnLAmount >= 0 ? 'var(--band-alert)' : '#ff4757';
      }

      // 2. Fetch Ledger
      const tRes = await fetch('/api/journal');
      const tData = await tRes.json();
      if (tData.status === 'success') {
        renderLedger(tData.data);
      }
    } catch (err) {
      console.error('Failed to load analytics:', err);
      journalTableBody.innerHTML = `<tr><td colspan="7" style="padding:20px; text-align:center; color:#ff4757;">Failed to load journal data.</td></tr>`;
    }
  }

  function renderLedger(trades) {
    if (!trades || trades.length === 0) {
      journalTableBody.innerHTML = `<tr><td colspan="7" style="padding:20px; text-align:center; color:var(--text-muted);">No paper trades recorded yet.</td></tr>`;
      return;
    }

    let html = '';
    trades.forEach(t => {
      const pnlColor = t.pnlAmount >= 0 ? 'var(--band-alert)' : '#ff4757';
      const pnlSign = t.pnlAmount >= 0 ? '+' : '';
      const dateStr = new Date(t.entryTime).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      
      html += `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
          <td style="padding:12px 8px;">${dateStr}</td>
          <td style="padding:12px 8px; font-weight:700;">${t.symbol}</td>
          <td style="padding:12px 8px;">₹${t.entryPrice.toFixed(2)}</td>
          <td style="padding:12px 8px;">${t.quantity}</td>
          <td style="padding:12px 8px;">₹${t.exitPrice ? t.exitPrice.toFixed(2) : '--'}</td>
          <td style="padding:12px 8px; font-size:0.7rem;">${t.exitReason ? t.exitReason.replace(/_/g, ' ') : '--'}</td>
          <td style="padding:12px 8px; color:${pnlColor}; font-weight:700;">${pnlSign}₹${t.pnlAmount ? t.pnlAmount.toFixed(2) : '0.00'}</td>
        </tr>
      `;
    });

    journalTableBody.innerHTML = html;
  }
});
