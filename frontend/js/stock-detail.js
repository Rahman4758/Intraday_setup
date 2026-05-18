document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const symbol = urlParams.get('symbol');

  if (!symbol) {
    document.getElementById('loading').textContent = 'Error: No symbol provided';
    return;
  }

  try {
    // 1. Fetch score, chart, and option chain data in parallel
    const [scoreRes, chartRes, chainRes] = await Promise.all([
      fetch(`/api/pil/score/${symbol}`).then(r => r.json()),
      fetch(`/api/pil/chart/${symbol}`).then(r => r.json()),
      fetch(`/api/data/option-chain/${symbol}`).then(r => r.json()).catch(() => ({ chain: { strikes: [] } }))
    ]);

    if (scoreRes.error) throw new Error(scoreRes.error);
    if (chartRes.error) throw new Error(chartRes.error);

    const scoreData = scoreRes;
    const candles = chartRes.candles;
    const strikes = chainRes.chain?.strikes || [];

    // 2. Update Header & Sidebar UI
    document.getElementById('uiSymbol').textContent = symbol;
    document.getElementById('uiLtp').textContent = `₹${scoreData.rawData?.close || '--'}`;
    document.getElementById('uiScore').textContent = `${scoreData.finalScore}/15`;

    const p6Meta = scoreData.pillars?.P6?.meta || {};
    const levels = p6Meta.levels || { support: null, resistance: null };
    
    document.getElementById('uiSupport').textContent = levels.support ? `₹${levels.support}` : 'N/A';
    document.getElementById('uiResistance').textContent = levels.resistance ? `₹${levels.resistance}` : 'N/A';

    renderPillars(scoreData.pillars);

    // 3. Render Chart with Candlesticks and horizontal Sensibull OI Profile
    renderChart(candles, levels.support, levels.resistance, strikes);

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

function renderChart(candles, supportVal, resistanceVal, strikes = []) {
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
    handleScroll: {
      mouseWheel: true,
      pressedMouseMove: true,
      horzTouchDrag: true,
      vertTouchDrag: true,
    },
    handleScale: {
      mouseWheel: false,
      pinch: true,
      axisPressedMouseMove: true,
    },
  };

  const containerPrice = document.getElementById('tvchart-price');
  const containerRsi = document.getElementById('tvchart-rsi');
  const canvas = document.getElementById('oi-profile-canvas');

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

  // --- Sync Time Scales between Price and RSI charts ---
  function syncTime(master, slave) {
    let isSyncing = false;
    const handler = (from, to) => {
      if (isSyncing) return;
      isSyncing = true;
      try { to.timeScale().setVisibleRange(from); } catch(e) {}
      isSyncing = false;
    };
    master.timeScale().subscribeVisibleTimeRangeChange(range => {
      if (range !== null && range.from != null && range.to != null)
        handler(range, slave);
    });
    slave.timeScale().subscribeVisibleTimeRangeChange(range => {
      if (range !== null && range.from != null && range.to != null)
        handler(range, master);
    });
  }
  syncTime(priceChart, rsiChart);

  // --- Format Data ---
  const candleData = [];
  const volumeData = [];
  const rsiData   = [];

  candles.forEach(c => {
    candleData.push({ time: c.date, open: c.open, high: c.high, low: c.low, close: c.close });
    volumeData.push({
      time: c.date, value: c.volume,
      color: c.close > c.open ? 'rgba(0, 230, 118, 0.4)' : 'rgba(255, 23, 68, 0.4)'
    });
    if (c.rsi !== null && c.rsi !== undefined) {
      rsiData.push({ time: c.date, value: c.rsi });
    }
  });

  // Sort by time
  const byTime = (a, b) => new Date(a.time) - new Date(b.time);
  candleData.sort(byTime);
  volumeData.sort(byTime);
  rsiData.sort(byTime);
  
  // Deduplicate
  const uniqueCandles = [], uniqueVolume = [], uniqueRsi = [];
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

  candlestickSeries.setData(uniqueCandles);
  volumeSeries.setData(uniqueVolume);
  rsiSeries.setData(uniqueRsi);

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

  // --- Sensibull Horizontal OI Profile drawing logic ---
  function drawOiProfile() {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    
    // Set device pixel ratio for super-sharp Retina/High-DPI rendering
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    
    ctx.clearRect(0, 0, rect.width, rect.height);
    
    if (!strikes || strikes.length === 0) {
      // Show error state if option chain empty
      ctx.fillStyle = '#ff1744';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText('NO ACTIVE OPTION CHAIN DATA', rect.width - 75, 20);
      return;
    }
    
    // Draw Legend on top-left of chart area
    ctx.fillStyle = '#8b949e';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    
    // Call OI Indicator
    ctx.fillStyle = 'rgba(255, 23, 68, 0.7)';
    ctx.fillRect(15, 15, 8, 8);
    ctx.fillStyle = '#8b949e';
    ctx.fillText('Call OI (Resistance)', 28, 14);
    
    // Put OI Indicator
    ctx.fillStyle = 'rgba(0, 230, 118, 0.7)';
    ctx.fillRect(15, 28, 8, 8);
    ctx.fillStyle = '#8b949e';
    ctx.fillText('Put OI (Support)', 28, 27);
    
    // Scale horizontal bars based on max OI
    const maxOI = Math.max(...strikes.map(s => Math.max(s.callOI, s.putOI)));
    if (maxOI <= 0) return;
    
    // Position start right before the Y-axis scale (typically 65px wide)
    const rightBorder = rect.width - 65;
    const maxBarWidth = 140; // Max width of horizontal profile bars
    
    strikes.forEach(s => {
      const y = candlestickSeries.priceToCoordinate(s.strikePrice);
      if (y === null || y < 0 || y > rect.height) return; // Ignore strikes off-screen
      
      const callWidth = (s.callOI / maxOI) * maxBarWidth;
      const putWidth = (s.putOI / maxOI) * maxBarWidth;
      
      const barHeight = 4; // Height of bars
      
      // Draw Call OI (Red) - Top Bar
      ctx.fillStyle = 'rgba(255, 23, 68, 0.35)';
      ctx.fillRect(rightBorder - callWidth, y - barHeight - 1, callWidth, barHeight);
      ctx.fillStyle = 'rgba(255, 23, 68, 0.85)';
      ctx.fillRect(rightBorder - callWidth, y - barHeight - 1, 2, barHeight); // bright edge
      
      // Draw Put OI (Green) - Bottom Bar
      ctx.fillStyle = 'rgba(0, 230, 118, 0.35)';
      ctx.fillRect(rightBorder - putWidth, y + 1, putWidth, barHeight);
      ctx.fillStyle = 'rgba(0, 230, 118, 0.85)';
      ctx.fillRect(rightBorder - putWidth, y + 1, 2, barHeight); // bright edge
      
      // Draw Strike Price Label next to the bars
      ctx.fillStyle = '#8b949e';
      ctx.font = '9px monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.strikePrice, rightBorder - Math.max(callWidth, putWidth) - 8, y);
    });
  }

  // Draw immediately on data render
  priceChart.timeScale().fitContent();
  setTimeout(drawOiProfile, 100);

  // Redraw when the user zooms/pans the price chart
  priceChart.timeScale().subscribeVisibleTimeRangeChange(() => {
    requestAnimationFrame(drawOiProfile);
  });

  // Redraw on window resize
  window.addEventListener('resize', () => {
    priceChart.applyOptions({ width: containerPrice.clientWidth, height: containerPrice.clientHeight });
    rsiChart.applyOptions({ width: containerRsi.clientWidth, height: containerRsi.clientHeight });
    setTimeout(drawOiProfile, 50);
  });
}
