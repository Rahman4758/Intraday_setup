document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const symbol = urlParams.get('symbol');

  if (!symbol) {
    document.getElementById('loading').textContent = 'Error: No symbol provided';
    return;
  }

  try {
    // 1. Fetch data
    const [scoreRes, chartRes] = await Promise.all([
      fetch(`/api/pil/score/${symbol}`).then(r => r.json()),
      fetch(`/api/pil/chart/${symbol}`).then(r => r.json())
    ]);

    if (scoreRes.error) throw new Error(scoreRes.error);
    if (chartRes.error) throw new Error(chartRes.error);

    const scoreData = scoreRes;
    const candles = chartRes.candles;

    // 2. Update Header & Sidebar UI
    document.getElementById('uiSymbol').textContent = symbol;
    document.getElementById('uiLtp').textContent = `₹${scoreData.rawData?.close || '--'}`;
    document.getElementById('uiScore').textContent = `${scoreData.finalScore}/15`;

    const p6Meta = scoreData.pillars?.P6?.meta || {};
    const levels = p6Meta.levels || { support: null, resistance: null };
    
    document.getElementById('uiSupport').textContent = levels.support ? `₹${levels.support}` : 'N/A';
    document.getElementById('uiResistance').textContent = levels.resistance ? `₹${levels.resistance}` : 'N/A';

    renderPillars(scoreData.pillars);

    // 3. Render Chart
    renderChart(candles, levels.support, levels.resistance);

    // Hide loading
    document.getElementById('loading').style.display = 'none';

  } catch (err) {
    console.error('Failed to load detail page:', err);
    document.getElementById('loading').textContent = `Error: ${err.message}`;
  }
});

function renderPillars(pillars) {
  const container = document.getElementById('pillarsContainer');
  if (!pillars) {
    container.innerHTML = '<div class="pillar-reason">No detailed breakdown available</div>';
    return;
  }

  const pNames = {
    P1: 'OI Buildup (Delivery + Futures)',
    P2: 'ATR Compression',
    P3: 'Relative Strength',
    P4: 'Volume Dry-up',
    P5: 'RSI Sweet Zone',
    P6: 'Options Intelligence'
  };

  ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].forEach(pKey => {
    const p = pillars[pKey];
    if (!p) return;
    
    const card = document.createElement('div');
    card.className = 'pillar-card';
    
    const isZero = p.score === 0;
    card.innerHTML = `
      <div class="pillar-header">
        <span class="pillar-name">${pNames[pKey] || pKey}</span>
        <span class="pillar-score ${isZero ? 'zero' : ''}">${p.score} pt</span>
      </div>
      <div class="pillar-reason">${p.meta?.reason || 'Criteria met'}</div>
    `;
    container.appendChild(card);
  });
}

function renderChart(candles, supportVal, resistanceVal) {
  const commonOptions = {
    layout: {
      textColor: '#8b949e',
      background: { type: 'solid', color: '#0f1115' },
    },
    grid: {
      vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
      horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
    },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: 'rgba(255, 255, 255, 0.1)' },
    timeScale: {
      borderColor: 'rgba(255, 255, 255, 0.1)',
      timeVisible: true,
    },
  };

  const containerPrice = document.getElementById('tvchart-price');
  const containerRsi = document.getElementById('tvchart-rsi');

  // --- Price Chart ---
  const priceChart = LightweightCharts.createChart(containerPrice, commonOptions);
  
  // Allocate bottom 25% of price chart for volume
  priceChart.priceScale('right').applyOptions({
    scaleMargins: { top: 0.05, bottom: 0.25 },
  });

  const candlestickSeries = priceChart.addCandlestickSeries({
    upColor: '#00e676',
    downColor: '#ff1744',
    borderVisible: false,
    wickUpColor: '#00e676',
    wickDownColor: '#ff1744',
  });

  const volumeSeries = priceChart.addHistogramSeries({
    color: '#26a69a',
    priceFormat: { type: 'volume' },
    priceScaleId: '', // overlay
    scaleMargins: { top: 0.8, bottom: 0 },
  });

  // --- RSI Chart ---
  const rsiChart = LightweightCharts.createChart(containerRsi, { ...commonOptions });
  const rsiSeries = rsiChart.addLineSeries({
    color: '#ff9800',
    lineWidth: 2,
  });
  rsiChart.priceScale('right').applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });

  // --- OI Chart (Sensibull-style histogram) ---
  const containerOi = document.getElementById('tvchart-oi');
  const oiChart = LightweightCharts.createChart(containerOi, {
    ...commonOptions,
    timeScale: { ...commonOptions.timeScale, visible: false }, // hide bottom axis on OI, price chart is master
  });
  const oiSeries = oiChart.addHistogramSeries({
    color: 'rgba(179, 157, 219, 0.7)',
    priceFormat: { type: 'volume' },
  });
  oiChart.priceScale('right').applyOptions({ scaleMargins: { top: 0.1, bottom: 0.0 } });

  // --- Sync Time Scales across all 3 charts ---
  function syncTime(master, ...slaves) {
    let isSyncing = false;
    const handler = (from, to) => {
      if (isSyncing) return;
      isSyncing = true;
      try { to.timeScale().setVisibleRange(from); } catch(e) {}
      isSyncing = false;
    };
    master.timeScale().subscribeVisibleTimeRangeChange(range => {
      if (range !== null && range.from != null && range.to != null)
        slaves.forEach(s => handler(range, s));
    });
    slaves.forEach(slave => {
      slave.timeScale().subscribeVisibleTimeRangeChange(range => {
        if (range !== null && range.from != null && range.to != null) {
          handler(range, master);
          slaves.filter(s => s !== slave).forEach(s => handler(range, s));
        }
      });
    });
  }
  syncTime(priceChart, rsiChart, oiChart);

  // --- Format Data ---
  const candleData = [];
  const volumeData = [];
  const rsiData   = [];
  const oiData    = [];

  candles.forEach(c => {
    candleData.push({ time: c.date, open: c.open, high: c.high, low: c.low, close: c.close });
    volumeData.push({
      time: c.date, value: c.volume,
      color: c.close > c.open ? 'rgba(0, 230, 118, 0.4)' : 'rgba(255, 23, 68, 0.4)'
    });
    if (c.rsi !== null && c.rsi !== undefined) {
      rsiData.push({ time: c.date, value: c.rsi });
    }
    if (c.oi !== null && c.oi !== undefined && c.oi > 0) {
      oiData.push({ time: c.date, value: c.oi });
    }
  });

  // Sort by time
  const byTime = (a, b) => new Date(a.time) - new Date(b.time);
  candleData.sort(byTime);
  volumeData.sort(byTime);
  rsiData.sort(byTime);
  oiData.sort(byTime);
  
  // Deduplicate
  const uniqueCandles = [], uniqueVolume = [], uniqueRsi = [], uniqueOi = [];
  let lastTime = null;
  for (let i = 0; i < candleData.length; i++) {
    if (candleData[i].time !== lastTime) {
      uniqueCandles.push(candleData[i]);
      uniqueVolume.push(volumeData[i]);
      lastTime = candleData[i].time;
    }
  }

  let lastRsiTime = null;
  for (const r of rsiData) {
    if (r.time !== lastRsiTime) { uniqueRsi.push(r); lastRsiTime = r.time; }
  }

  // OI: color purple if OI increased from previous bar, red if decreased
  let lastOiTime = null;
  for (let i = 0; i < oiData.length; i++) {
    if (oiData[i].time !== lastOiTime) {
      const prevOi = i > 0 ? oiData[i - 1].value : oiData[i].value;
      uniqueOi.push({
        time:  oiData[i].time,
        value: oiData[i].value,
        color: oiData[i].value >= prevOi ? 'rgba(179, 157, 219, 0.8)' : 'rgba(255, 82, 82, 0.7)'
      });
      lastOiTime = oiData[i].time;
    }
  }

  candlestickSeries.setData(uniqueCandles);
  volumeSeries.setData(uniqueVolume);
  rsiSeries.setData(uniqueRsi);
  if (uniqueOi.length > 0) oiSeries.setData(uniqueOi);

  // Add RSI Reference Lines
  rsiSeries.createPriceLine({
    price: 50, color: 'rgba(255, 255, 255, 0.2)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: false,
  });
  rsiSeries.createPriceLine({
    price: 38, color: 'rgba(0, 230, 118, 0.3)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted, axisLabelVisible: false,
  });

  // Add Demand/Supply Zones to Price Chart
  if (supportVal && !isNaN(parseFloat(supportVal))) {
    candlestickSeries.createPriceLine({
      price: parseFloat(supportVal), color: '#00e676', lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Solid, axisLabelVisible: true, title: 'DEMAND ZONE',
    });
  }

  if (resistanceVal && !isNaN(parseFloat(resistanceVal))) {
    candlestickSeries.createPriceLine({
      price: parseFloat(resistanceVal), color: '#ff1744', lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Solid, axisLabelVisible: true, title: 'SUPPLY ZONE',
    });
  }

  priceChart.timeScale().fitContent();

  // Make charts responsive
  window.addEventListener('resize', () => {
    priceChart.applyOptions({ width: containerPrice.clientWidth, height: containerPrice.clientHeight });
    rsiChart.applyOptions({ width: containerRsi.clientWidth, height: containerRsi.clientHeight });
    oiChart.applyOptions({ width: containerOi.clientWidth, height: containerOi.clientHeight });
  });
}
