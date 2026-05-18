/**
 * ANTIGRAVITY PULLBACK MODULE — Frontend Controller
 * Renders PQS-scored pullback setups from the intraday scanner.
 * Fully standalone — no dependencies on app.js or intraday.js.
 */

(function PullbackModule() {
  'use strict';

  // ── State ──
  let pollIntervalId = null;
  let isRunning = false;
  let currentFilter = 4;
  let allSetups = [];
  let allWatching = [];

  // ── DOM Refs ──
  const $ = id => document.getElementById(id);

  // ── Tab Switch Integration ──
  function hookTabButton() {
    const btn = $('tabPullbackBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      // Hide all views
      ['viewEOD', 'viewIntraday', 'viewAnalytics', 'viewPullback'].forEach(id => {
        const el = $(id);
        if (el) el.style.display = 'none';
      });
      // Remove active from all tab buttons
      document.querySelectorAll('.tab-nav .btn').forEach(b => b.classList.remove('btn--primary'));
      // Show pullback view + mark tab active
      $('viewPullback').style.display = 'block';
      btn.classList.add('btn--primary');
      // Hide the EOD scan button
      const scanBtn = $('scanBtn');
      if (scanBtn) scanBtn.style.display = 'none';
    });
  }

  // ── API Calls ──
  async function fetchLive() {
    const res = await fetch('/api/pullback/live');
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
  }

  async function triggerScan() {
    const res = await fetch('/api/pullback/scan', { method: 'POST' });
    if (!res.ok) throw new Error(`Scan error ${res.status}`);
    return res.json();
  }

  async function startEngine() {
    await fetch('/api/pullback/engine/start', { method: 'POST' });
  }

  async function stopEngine() {
    await fetch('/api/pullback/engine/stop', { method: 'POST' });
  }

  // ── Polling ──
  async function poll() {
    try {
      const data = await fetchLive();
      allSetups = (data.setups || []).filter(s => s.pqs >= currentFilter);
      allWatching = data.watching || [];
      render(allSetups, allWatching, data.lastRefresh);
    } catch (err) {
      console.error('[PULLBACK UI] Poll error:', err.message);
    }
  }

  function startPoller() {
    if (pollIntervalId) return;
    poll();
    pollIntervalId = setInterval(poll, 30000);
  }

  function stopPoller() {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }

  // ── Rendering ──
  function render(setups, watching, lastRefresh) {
    const dashboard = $('pullbackDashboard');
    const empty = $('pbEmptyState');
    const watchSection = $('pbWatchingSection');
    const watchList = $('pbWatchingList');
    const refreshEl = $('pbLastRefresh');

    if (refreshEl && lastRefresh) {
      const t = new Date(lastRefresh);
      refreshEl.textContent = `Last refresh: ${t.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    }

    // Clear old cards (keep empty state)
    const oldCards = dashboard.querySelectorAll('.pb-card');
    oldCards.forEach(c => c.remove());

    if (!setups || setups.length === 0) {
      empty.style.display = 'flex';
    } else {
      empty.style.display = 'none';
      setups.forEach(s => {
        const card = createPBCard(s);
        dashboard.appendChild(card);
      });
    }

    // Watching pills
    if (watching && watching.length > 0) {
      watchSection.style.display = 'block';
      watchList.innerHTML = '';
      watching.forEach(s => {
        const pill = document.createElement('div');
        pill.className = 'stock-pill';
        pill.style.cssText = 'gap:6px;cursor:default;';
        pill.innerHTML = `
          <span style="font-family:var(--font-mono);font-size:0.8rem;font-weight:700;">${s.symbol}</span>
          <span style="font-size:0.65rem;color:var(--text-muted);">PIL ${s.pilScore || '—'}</span>
        `;
        watchList.appendChild(pill);
      });
    } else {
      watchSection.style.display = 'none';
    }
  }

  function getBandStyle(band) {
    const styles = {
      EXCEPTIONAL:  { bg: 'rgba(255,99,72,0.12)', border: 'rgba(255,99,72,0.4)', text: '#ff6348' },
      VERY_STRONG:  { bg: 'rgba(0,245,212,0.1)',  border: 'rgba(0,245,212,0.35)',text: '#00f5d4' },
      STRONG:       { bg: 'rgba(29,209,161,0.1)', border: 'rgba(29,209,161,0.3)', text: '#1dd1a1' },
      MODERATE:     { bg: 'rgba(255,165,2,0.1)',  border: 'rgba(255,165,2,0.3)', text: '#ffa502' },
      WEAK:         { bg: 'rgba(74,85,104,0.1)',  border: 'rgba(74,85,104,0.3)', text: '#4a5568' }
    };
    return styles[band] || styles.WEAK;
  }

  function signalRow(label, s) {
    if (!s) return '';
    const scoreColor = s.score >= 2 ? '#1dd1a1' : s.score === 1 ? '#ffa502' : '#ff4757';
    const icon = s.score >= 2 ? '✓' : s.score === 1 ? '~' : '✗';
    return `
      <div style="display:grid;grid-template-columns:18px 80px 1fr 28px;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.03);">
        <span style="color:${scoreColor};font-weight:700;font-size:0.8rem;">${icon}</span>
        <span style="font-size:0.7rem;color:var(--text-muted);font-weight:600;">${label}</span>
        <span style="font-size:0.7rem;color:var(--text-secondary);">${s.reason || '—'}</span>
        <span style="font-family:var(--font-mono);font-size:0.75rem;font-weight:700;color:${scoreColor};text-align:right;">+${s.score}</span>
      </div>
    `;
  }

  function createPBCard(s) {
    const card = document.createElement('div');
    card.className = 'score-card glass pb-card';
    card.style.cssText = 'animation: cardFadeIn 0.5s ease-out; cursor:default;';

    const bs = getBandStyle(s.band);
    const signals = s.signals || {};

    // Entry zone display
    const ez = s.entryZone || {};
    const hasEntry = ez.entryPrice > 0;

    // Risk:Reward
    const risk = ez.riskPoints || 0;
    const reward2 = hasEntry ? (ez.target2 - ez.entryPrice) : 0;
    const rr = risk > 0 ? (reward2 / risk).toFixed(1) : '—';

    // PQS ring color
    const pqsMax = 16;
    const pqsPct = Math.round((s.pqs / pqsMax) * 100);

    card.innerHTML = `
      <!-- Header -->
      <div class="score-card__header">
        <div style="display:flex;flex-direction:column;">
          <span class="score-card__symbol">${s.symbol}</span>
          <span style="font-size:0.6rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">
            PIL ${s.pilScore || '—'} · PQS ${s.pqs}/${pqsMax}
          </span>
        </div>
        <span style="padding:4px 14px;border-radius:20px;font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;
                     background:${bs.bg};color:${bs.text};border:1px solid ${bs.border};">
          ${s.grade}
        </span>
      </div>

      <!-- PQS Score Ring -->
      <div style="text-align:center;padding:12px 0;">
        <div style="font-family:var(--font-mono);font-size:3rem;font-weight:900;color:${bs.text};
                    text-shadow:0 0 30px ${bs.text}40;line-height:1;">${s.pqs}</div>
        <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-top:4px;">
          Pullback Quality Score
        </div>
      </div>

      <!-- Market Snapshot -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px;">
        <div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:8px;text-align:center;">
          <div style="font-size:0.6rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;">CMP</div>
          <div style="font-family:var(--font-mono);font-size:0.9rem;font-weight:700;color:#fff;">₹${s.currentPrice?.toFixed(2) || '—'}</div>
        </div>
        <div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:8px;text-align:center;">
          <div style="font-size:0.6rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;">RSI</div>
          <div style="font-family:var(--font-mono);font-size:0.9rem;font-weight:700;color:var(--accent-cyan);">${s.currentRSI?.toFixed(1) || '—'}</div>
        </div>
        <div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:8px;text-align:center;">
          <div style="font-size:0.6rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;">Depth</div>
          <div style="font-family:var(--font-mono);font-size:0.9rem;font-weight:700;color:#ffa502;">${s.pullbackDepthPct?.toFixed(1) || '—'}%</div>
        </div>
      </div>

      <!-- 8 Signals -->
      <div style="margin-bottom:14px;">
        ${signalRow('S1 Volume', signals.S1_vol)}
        ${signalRow('S2 OI', signals.S2_oi)}
        ${signalRow('S3 RSI', signals.S3_rsi)}
        ${signalRow('S4 Level', signals.S4_level)}
        ${signalRow('S5 Fib', signals.S5_fib)}
        ${signalRow('S6 Bounce', signals.S6_bounce)}
        ${signalRow('S7 HL', signals.S7_hl)}
        ${signalRow('S8 EMA', signals.S8_ema)}
      </div>

      <!-- Entry Zone -->
      ${hasEntry ? `
      <div style="background:rgba(0,245,212,0.05);border:1px solid rgba(0,245,212,0.2);border-radius:10px;padding:12px;margin-bottom:10px;">
        <div style="font-size:0.65rem;color:var(--accent-cyan);text-transform:uppercase;letter-spacing:1.5px;font-weight:700;margin-bottom:10px;">⚡ Entry Protocol</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div>
            <div style="font-size:0.6rem;color:var(--text-muted);">ENTRY (above HH)</div>
            <div style="font-family:var(--font-mono);font-weight:700;color:#00f5d4;">₹${ez.entryPrice}</div>
          </div>
          <div>
            <div style="font-size:0.6rem;color:var(--text-muted);">STOP LOSS</div>
            <div style="font-family:var(--font-mono);font-weight:700;color:#ff4757;">₹${ez.stopLoss}</div>
          </div>
          <div>
            <div style="font-size:0.6rem;color:var(--text-muted);">TARGET 1 (Session High)</div>
            <div style="font-family:var(--font-mono);font-weight:700;color:#1dd1a1;">₹${ez.target1}</div>
          </div>
          <div>
            <div style="font-size:0.6rem;color:var(--text-muted);">TARGET 2 (Measured)</div>
            <div style="font-family:var(--font-mono);font-weight:700;color:#1dd1a1;">₹${ez.target2}</div>
          </div>
        </div>
        <div style="margin-top:8px;font-size:0.7rem;color:var(--text-muted);">
          Risk:Reward = 1:${rr} · Position ${s.positionFactor ? (s.positionFactor * 100) + '% of standard' : '—'}
        </div>
      </div>` : ''}

      <!-- Action Box -->
      <div class="action-box" style="border-left-color:${bs.text}">
        ${s.action || s.reason || '—'}
      </div>

      <!-- VWAP / EMA levels -->
      <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap;">
        <span style="font-size:0.65rem;font-family:var(--font-mono);color:var(--text-muted);">
          VWAP ₹${s.vwap?.toFixed(1) || '—'}
        </span>
        <span style="font-size:0.65rem;font-family:var(--font-mono);color:var(--text-muted);">
          EMA20 ₹${s.ema20?.toFixed(1) || '—'}
        </span>
        <span style="font-size:0.65rem;font-family:var(--font-mono);color:var(--text-muted);">
          SessHigh ₹${s.sessionHigh?.toFixed(1) || '—'}
        </span>
      </div>
    `;

    return card;
  }

  // ── Event Handlers ──
  function setPollerUI(running) {
    isRunning = running;
    const badge = $('pbPollerBadge');
    const startBtn = $('btnStartPullback');
    const stopBtn = $('btnStopPullback');
    if (!badge) return;
    if (running) {
      badge.textContent = '● LIVE';
      badge.style.background = 'rgba(29,209,161,0.15)';
      badge.style.color = '#1dd1a1';
      badge.style.borderColor = 'rgba(29,209,161,0.3)';
      if (startBtn) startBtn.style.display = 'none';
      if (stopBtn) stopBtn.style.display = 'inline-flex';
    } else {
      badge.textContent = '● STOPPED';
      badge.style.background = 'rgba(255,71,87,0.15)';
      badge.style.color = '#ff4757';
      badge.style.borderColor = 'rgba(255,71,87,0.3)';
      if (startBtn) startBtn.style.display = 'inline-flex';
      if (stopBtn) stopBtn.style.display = 'none';
    }
  }

  function showToast(msg, type = 'info') {
    if (typeof Components !== 'undefined' && Components.showToast) {
      Components.showToast(msg, type);
    }
  }

  function bindEvents() {
    // Start Scanner
    const startBtn = $('btnStartPullback');
    if (startBtn) {
      startBtn.addEventListener('click', async () => {
        setPollerUI(true);
        startPoller();
        await startEngine();
        showToast('Pullback scanner started (30s refresh)', 'success');
      });
    }

    // Stop Scanner
    const stopBtn = $('btnStopPullback');
    if (stopBtn) {
      stopBtn.addEventListener('click', async () => {
        setPollerUI(false);
        stopPoller();
        await stopEngine();
        showToast('Pullback scanner stopped', 'info');
      });
    }

    // Manual Scan Now
    const scanNowBtn = $('btnScanPullbackNow');
    if (scanNowBtn) {
      scanNowBtn.addEventListener('click', async () => {
        scanNowBtn.disabled = true;
        scanNowBtn.textContent = 'Scanning...';
        showToast('Scanning A-List stocks for pullback setups...', 'info');
        try {
          await triggerScan();
          await poll();
          showToast('Pullback scan complete!', 'success');
        } catch (err) {
          showToast(`Scan failed: ${err.message}`, 'error');
        } finally {
          scanNowBtn.disabled = false;
          scanNowBtn.textContent = '↻ Scan Now';
        }
      });
    }

    // Filter Buttons
    document.querySelectorAll('.pbs-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.pbs-filter-btn').forEach(b => b.classList.remove('btn--primary'));
        btn.classList.add('btn--primary');
        currentFilter = parseInt(btn.dataset.min) || 4;
        // Re-render with new filter
        const filtered = allSetups.filter(s => s.pqs >= currentFilter);
        render(filtered, allWatching, null);
      });
    });
  }

  // ── Init ──
  function init() {
    hookTabButton();
    bindEvents();
    // Fetch once on load in case data already exists
    fetchLive().then(data => {
      allSetups = (data.setups || []).filter(s => s.pqs >= currentFilter);
      allWatching = data.watching || [];
      if (allSetups.length > 0 || allWatching.length > 0) {
        render(allSetups, allWatching, data.lastRefresh);
      }
    }).catch(() => {/* silent fail on page load */});
  }

  document.addEventListener('DOMContentLoaded', init);

})();
