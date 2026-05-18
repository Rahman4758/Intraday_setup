/**
 * Charts — Canvas-based gauge and visualization rendering
 */
const Charts = {

  /**
   * Render animated circular score gauge
   */
  renderScoreGauge(canvas, score, maxScore, bandColor) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = canvas.width = canvas.height = 180;
    const cx = size / 2, cy = size / 2, radius = 70;
    const lineWidth = 10;
    const startAngle = 0.75 * Math.PI;
    const endAngle = 2.25 * Math.PI;
    const totalAngle = endAngle - startAngle;

    ctx.clearRect(0, 0, size, size);

    // Background arc
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Score arc
    const pct = Math.min(score / maxScore, 1);
    const scoreAngle = startAngle + totalAngle * pct;

    if (pct > 0) {
      const grad = ctx.createLinearGradient(0, 0, size, size);
      grad.addColorStop(0, '#00f5d4');
      grad.addColorStop(1, bandColor || '#7b2ff7');

      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, scoreAngle);
      ctx.strokeStyle = grad;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Glow effect
      ctx.shadowColor = bandColor || '#00f5d4';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, scoreAngle - 0.05, scoreAngle);
      ctx.strokeStyle = bandColor || '#00f5d4';
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Center score text
    ctx.fillStyle = '#e8ecf4';
    ctx.font = '700 36px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(score, cx, cy - 6);

    ctx.fillStyle = '#8892a6';
    ctx.font = '500 10px "Inter", sans-serif';
    ctx.fillText(`/ ${maxScore}`, cx, cy + 18);
  },

  /**
   * Render pillar breakdown bars (DOM-based, not canvas)
   */
  renderPillarBars(container, pillars) {
    if (!container) return;
    const pillarMeta = [
      { id: 'P1', name: 'OI Streak', max: 3 },
      { id: 'P2', name: 'ATR Compress', max: 2 },
      { id: 'P3', name: 'Relative Str', max: 3 },
      { id: 'P4', name: 'Volume Dry', max: 2 },
      { id: 'P5', name: 'RSI Zone', max: 2 },
      { id: 'P6', name: 'Options Sig', max: 3 }
    ];

    container.innerHTML = '';
    for (const pm of pillarMeta) {
      const p = pillars[pm.id] || { score: 0, streak: 0 };
      const pct = (p.score / pm.max) * 100;
      const row = document.createElement('div');
      row.className = 'pillar-row';
      row.innerHTML = `
        <span class="pillar-row__name">${pm.name}</span>
        <div class="pillar-row__bar"><div class="pillar-row__fill" style="width:${pct}%"></div></div>
        <span class="pillar-row__score">${p.score}/${pm.max}${p.streak > 0 ? `<span class="pillar-row__streak"> ×${p.streak}d</span>` : ''}</span>
      `;
      container.appendChild(row);
    }
  }
};
