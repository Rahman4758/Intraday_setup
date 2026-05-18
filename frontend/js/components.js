/**
 * UI Component Builders
 */
const Components = {

  /**
   * Create full PIL score card for a stock
   */
  createScoreCard(result) {
    const card = document.createElement('div');
    card.className = 'score-card glass';
    card.id = `card-${result.symbol}`;

    const bandClass = `band-${result.band}`;
    const maxGauge = 15;

    card.innerHTML = `
      <div class="score-card__header">
        <div style="display:flex;flex-direction:column;">
          <span class="score-card__symbol">${result.symbol}</span>
          <span style="font-size:0.6rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">
            ${result.finalScore >= 12 ? '⚡ Explosive Setup' : result.finalScore >= 9 ? '🔥 High Conviction' : '🟢 Moderate Entry'}
          </span>
        </div>
        <span class="score-card__band ${bandClass}">${result.status || result.band}</span>
      </div>
      <div class="gauge-container">
        <canvas class="gauge-canvas" data-score="${result.finalScore}" data-color="${result.color}"></canvas>
      </div>
      <div class="pillars" id="pillars-${result.symbol}"></div>
      ${result.amplifiers && result.amplifiers.amplifiersApplied && result.amplifiers.amplifiersApplied.length > 0 ?
        `<div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${result.amplifiers.amplifiersApplied.map(a => `<span class="stock-pill" style="font-size:0.65rem;padding:3px 10px;">${a}</span>`).join('')}
        </div>` : ''}
      <div class="action-box" style="border-left-color:${result.color || '#4a5568'}">
        ${result.action || 'No action determined'}
      </div>
      ${result.rawData && result.rawData.rsi ? `
        <div style="display:flex;flex-direction:column;gap:4px;font-size:0.7rem;color:var(--text-muted);font-family:var(--font-mono);">
          <div style="display:flex;justify-content:space-between;color:var(--text-primary);border-bottom:1px solid rgba(255,255,255,0.05);padding-bottom:4px;margin-bottom:4px;">
            <span>CMP: ₹${result.rawData.close.toFixed(2)}</span>
            <span style="color:${result.rawData.stockChange >= 0 ? 'var(--band-alert)' : 'var(--band-not-ready)'}">${result.rawData.stockChange >= 0 ? '+' : ''}${result.rawData.stockChange.toFixed(2)}%</span>
          </div>
          <div style="display:flex;gap:12px;opacity:0.8;">
            <span>RSI: ${result.rawData.rsi.toFixed(1)}</span>
            <span>Vol: ${(result.rawData.volume / 100000).toFixed(1)}L</span>
            <span>OI: ${(result.rawData.oi / 100000).toFixed(1)}L</span>
          </div>
        </div>
      ` : ''}
    `;

    // Render gauge after DOM insertion
    requestAnimationFrame(() => {
      const canvas = card.querySelector('.gauge-canvas');
      if (canvas) Charts.renderScoreGauge(canvas, result.finalScore, maxGauge, result.color);
      const pillarContainer = card.querySelector(`#pillars-${result.symbol}`);
      if (pillarContainer) Charts.renderPillarBars(pillarContainer, result.pillars || {});
    });

    // Add click event to open detail modal
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => {
      if (typeof openDetailModal === 'function') {
        openDetailModal(result);
      }
    });

    return card;
  },

  /**
   * Create priority ranking card
   */
  createPriorityCard(result, rank) {
    const card = document.createElement('div');
    card.className = 'priority-card';
    card.innerHTML = `
      <span class="priority-card__rank">#${rank} Priority</span>
      <span class="priority-card__symbol">${result.symbol}</span>
      <span class="priority-card__score" style="color:${result.color || '#e8ecf4'}">${result.finalScore}</span>
      <span class="score-card__band band-${result.band}" style="align-self:flex-start;">${result.status || result.band}</span>
      <span class="priority-card__action">${result.action || ''}</span>
    `;
    return card;
  },

  /**
   * Create stock pill
   */
  createStockPill(symbol, onRemove) {
    const pill = document.createElement('span');
    pill.className = 'stock-pill';
    pill.innerHTML = `${symbol} <span class="stock-pill__remove" data-symbol="${symbol}">×</span>`;
    pill.querySelector('.stock-pill__remove').addEventListener('click', () => onRemove(symbol));
    return pill;
  },

  /**
   * Show toast notification
   */
  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3500);
  }
};
