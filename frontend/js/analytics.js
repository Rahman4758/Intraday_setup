document.addEventListener('DOMContentLoaded', () => {

  // -----------------------------------
  // TAB ELEMENTS
  // -----------------------------------
  const tabAnalyticsBtn =
    document.getElementById('tabAnalyticsBtn');

  const viewEOD =
    document.getElementById('viewEOD');

  const viewIntraday =
    document.getElementById('viewIntraday');

  const viewAnalytics =
    document.getElementById('viewAnalytics');

  const scanBtn =
    document.getElementById('scanBtn');

  // -----------------------------------
  // ANALYTICS STATS
  // -----------------------------------
  const statTotalTrades =
    document.getElementById('statTotalTrades');

  const statWinRate =
    document.getElementById('statWinRate');

  const statTotalPnL =
    document.getElementById('statTotalPnL');

  const statProfitFactor =
    document.getElementById('statProfitFactor');

  const statExpectancy =
    document.getElementById('statExpectancy');

  const statMaxProfit =
    document.getElementById('statMaxProfit');

  const statMaxLoss =
    document.getElementById('statMaxLoss');

  // -----------------------------------
  // TABLES
  // -----------------------------------
  const journalTableBody =
    document.getElementById('journalTableBody');

  const strategyAnalyticsBody =
    document.getElementById('strategyAnalyticsBody');

  // -----------------------------------
  // FILTERS
  // -----------------------------------
  const filterSymbol =
    document.getElementById('filterSymbol');

  const filterStrategy =
    document.getElementById('filterStrategy');

  const filterStartDate =
    document.getElementById('filterStartDate');

  const filterEndDate =
    document.getElementById('filterEndDate');

  const applyFiltersBtn =
    document.getElementById('applyFiltersBtn');

  // -----------------------------------
  // PAGINATION
  // -----------------------------------
  let currentPage = 1;

  const limit = 20;

  // -----------------------------------
  // TAB ROUTING
  // -----------------------------------
  if (tabAnalyticsBtn) {

    tabAnalyticsBtn.addEventListener('click', () => {

      document
        .getElementById('tabEODBtn')
        .classList.remove('btn--primary');

      document
        .getElementById('tabIntradayBtn')
        .classList.remove('btn--primary');

      tabAnalyticsBtn
        .classList.add('btn--primary');

      viewEOD.style.display = 'none';

      viewIntraday.style.display = 'none';

      viewAnalytics.style.display = 'block';

      if (scanBtn) {
        scanBtn.style.display = 'none';
      }

      loadAnalytics();

      loadTrades();

      loadStrategyAnalytics();
    });
  }

  // -----------------------------------
  // APPLY FILTERS
  // -----------------------------------
  if (applyFiltersBtn) {

    applyFiltersBtn.addEventListener('click', () => {

      currentPage = 1;

      loadTrades();
    });
  }

  // -----------------------------------
  // LOAD ANALYTICS
  // -----------------------------------
  async function loadAnalytics() {

    try {

      const res =
        await fetch('/api/journal/analytics');

      const data =
        await res.json();

      if (data.status !== 'success') {
        return;
      }

      const stats = data.data;

      if (statTotalTrades)
        statTotalTrades.textContent = stats.totalTrades || 0;

      if (statWinRate)
        statWinRate.textContent = `${stats.winRate || 0}%`;

      if (statTotalPnL) {
        statTotalPnL.textContent = `₹${stats.totalPnLAmount || 0}`;
        statTotalPnL.style.color = Number(stats.totalPnLAmount) >= 0
          ? 'var(--band-alert)' : '#ff4757';
      }

      if (statProfitFactor)
        statProfitFactor.textContent = stats.profitFactor || '0';

      if (statExpectancy) {
        statExpectancy.textContent = `₹${stats.expectancy || 0}`;
        statExpectancy.style.color = Number(stats.expectancy) >= 0
          ? 'var(--band-alert)' : '#ff4757';
      }

      if (statMaxProfit)
        statMaxProfit.textContent = `₹${stats.maxProfit || 0}`;

      if (statMaxLoss)
        statMaxLoss.textContent = `₹${stats.maxLoss || 0}`;

    } catch (err) {

      console.error(
        '[ANALYTICS] Failed:',
        err
      );
    }
  }

  // -----------------------------------
  // LOAD TRADES
  // -----------------------------------
  async function loadTrades() {

    try {

      const params = new URLSearchParams({

        page: currentPage,

        limit
      });

      // FILTERS
      if (filterSymbol?.value) {

        params.append(
          'symbol',
          filterSymbol.value.trim()
        );
      }

      if (filterStrategy?.value) {

        params.append(
          'strategy',
          filterStrategy.value.trim()
        );
      }

      if (filterStartDate?.value) {

        params.append(
          'startDate',
          filterStartDate.value
        );
      }

      if (filterEndDate?.value) {

        params.append(
          'endDate',
          filterEndDate.value
        );
      }

      const res =
        await fetch(`/api/journal?${params}`);

      const data =
        await res.json();

      if (data.status !== 'success') {
        return;
      }

      renderLedger(data.data);

      renderPagination(
        data.pagination
      );

    } catch (err) {

      console.error(
        '[JOURNAL] Load error:',
        err
      );

      journalTableBody.innerHTML = `
        <tr>
          <td colspan="8"
              style="
                padding:20px;
                text-align:center;
                color:#ff4757;
              ">
            Failed to load journal data.
          </td>
        </tr>
      `;
    }
  }

  // -----------------------------------
  // LOAD STRATEGY ANALYTICS
  // -----------------------------------
  async function loadStrategyAnalytics() {

    try {

      const res =
        await fetch(
          '/api/journal/analytics/strategy'
        );

      const data =
        await res.json();

      if (data.status !== 'success') {
        return;
      }

      renderStrategyAnalytics(
        data.data
      );

    } catch (err) {

      console.error(
        '[STRATEGY ANALYTICS] Error:',
        err
      );
    }
  }

  // -----------------------------------
  // RENDER STRATEGY ANALYTICS
  // -----------------------------------
  function renderStrategyAnalytics(data) {

    if (
      !strategyAnalyticsBody ||
      !data ||
      data.length === 0
    ) {
      return;
    }

    let html = '';

    data.forEach(strategy => {

      const winRate =
        strategy.totalTrades > 0

          ? (
              (
                strategy.winningTrades /
                strategy.totalTrades
              ) * 100
            ).toFixed(1)

          : 0;

      html += `
        <tr
          style="
            border-bottom:
            1px solid rgba(255,255,255,0.05);
          "
        >

          <td style="padding:12px 8px;">
            ${strategy._id || 'Unknown'}
          </td>

          <td style="padding:12px 8px;">
            ${strategy.totalTrades}
          </td>

          <td style="
            padding:12px 8px;
            color:
              ${strategy.totalPnL >= 0
                ? 'var(--band-alert)'
                : '#ff4757'
              };
          ">
            ₹${strategy.totalPnL.toFixed(2)}
          </td>

          <td style="padding:12px 8px;">
            ${winRate}%
          </td>

        </tr>
      `;
    });

    strategyAnalyticsBody.innerHTML =
      html;
  }

  // -----------------------------------
  // RENDER LEDGER
  // -----------------------------------
  function renderLedger(trades) {

    if (!trades || trades.length === 0) {

      journalTableBody.innerHTML = `
        <tr>
          <td colspan="8"
              style="
                padding:20px;
                text-align:center;
                color:var(--text-muted);
              ">
            No trades found.
          </td>
        </tr>
      `;

      return;
    }

    let html = '';

    trades.forEach(t => {

      const pnlColor =
        t.pnlAmount >= 0
          ? 'var(--band-alert)'
          : '#ff4757';

      const pnlSign =
        t.pnlAmount >= 0 ? '+' : '';

      const dateStr =
        new Date(t.entryTime)
          .toLocaleString('en-IN', {

            month: 'short',

            day: 'numeric',

            hour: '2-digit',

            minute: '2-digit'
          });

      html += `
        <tr
          style="
            border-bottom:
            1px solid rgba(255,255,255,0.05);
          "
        >

          <td style="padding:12px 8px;">
            ${dateStr}
          </td>

          <td style="
            padding:12px 8px;
            font-weight:700;
          ">
            ${t.symbol}
          </td>

          <td style="padding:12px 8px;">
            ${t.strategy || '--'}
          </td>

          <td style="padding:12px 8px;">
            ₹${t.entryPrice.toFixed(2)}
          </td>

          <td style="padding:12px 8px;">
            ${t.quantity}
          </td>

          <td style="padding:12px 8px;">
            ₹${t.exitPrice
              ? t.exitPrice.toFixed(2)
              : '--'}
          </td>

          <td style="
            padding:12px 8px;
            font-size:0.75rem;
          ">
            ${t.exitReason
              ? t.exitReason.replace(/_/g, ' ')
              : '--'}
          </td>

          <td style="
            padding:12px 8px;
            color:${pnlColor};
            font-weight:700;
          ">
            ${pnlSign}
            ₹${t.pnlAmount
              ? t.pnlAmount.toFixed(2)
              : '0.00'}
          </td>

        </tr>
      `;
    });

    journalTableBody.innerHTML = html;
  }

  // -----------------------------------
  // PAGINATION
  // -----------------------------------
  function renderPagination(pagination) {

    const el =
      document.getElementById(
        'journalPagination'
      );

    if (!el || !pagination) {
      return;
    }

    let html = '';

    for (
      let i = 1;
      i <= pagination.totalPages;
      i++
    ) {

      html += `
        <button
          class="
            btn
            ${i === pagination.page
              ? 'btn--primary'
              : ''
            }
          "
          data-page="${i}"
        >
          ${i}
        </button>
      `;
    }

    el.innerHTML = html;

    // EVENTS
    el.querySelectorAll('button')
      .forEach(btn => {

        btn.addEventListener('click', () => {

          currentPage =
            Number(btn.dataset.page);

          loadTrades();
        });
      });
  }
});
