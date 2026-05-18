const express = require('express');
const router = express.Router();
const PILScore = require('../models/PILScore');
const Stock = require('../models/Stock');
const { runFullScan } = require('../services/streak-tracker');
const { getMarketQuotes, getHistoricalCandles } = require('../services/upstox-data');
const { getInstrumentMap } = require('../utils/instrument-resolver');
const { calculateRSI } = require('../services/rsi-calculator');

// Amplifier context — stored in memory per session
let amplifierContext = {
  isExpiryWeek: false,
  postResultsDayNum: 0,
  fiiBuyStreak: 0
};

// Run full PIL scan for all active stocks
router.post('/scan', async (req, res) => {
  try {
    const { isEODScanValid } = require('../utils/market-hours');
    
    // We allow passing a bypass flag if the user explicitly wants to force it for testing,
    // but by default we reject if the market is closed (e.g. weekend or intraday).
    if (!isEODScanValid() && !req.body.forceScan) {
      return res.status(400).json({ 
        error: 'Market is currently closed or intraday is running. EOD Scan should be run after 3:30 PM on weekdays.' 
      });
    }

    const ctx = { ...amplifierContext, ...req.body };
    console.log('[PIL] Starting full EOD scan...');
    const scanResult = await runFullScan(ctx);
    console.log(`[PIL] Scan complete — ${scanResult.results.length} stocks scored`);
    res.json(scanResult);
  } catch (err) {
    console.error('[PIL] Scan error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get latest score for a symbol
router.get('/score/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const score = await PILScore.findOne({ symbol }).sort({ date: -1 });
    if (!score) return res.status(404).json({ error: 'No score found' });
    res.json(score);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get score history for a symbol
router.get('/history/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const days = parseInt(req.query.days) || 7;
    const history = await PILScore.find({ symbol }).sort({ date: -1 }).limit(days);
    res.json({ symbol, history: history.reverse() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get historical chart data for a symbol (daily candles)
router.get('/chart/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    
    // Look up the stock in the database to fetch its F&O key
    const stock = await Stock.findOne({ symbol });
    
    let instrKey;
    if (stock) {
      instrKey = stock.instrumentKeyFO || stock.instrumentKeyEQ;
    } else {
      const instrMap = getInstrumentMap();
      instrKey = instrMap[symbol];
    }
    
    if (!instrKey) {
      return res.status(404).json({ error: `Instrument key not found for ${symbol}` });
    }
    
    // Fetch last 60 days of daily candles using the resolved F&O key
    const candles = await getHistoricalCandles(instrKey, 60);

    // Upstox historical data for daily candles may not include the live (today's) running candle.
    // Fetch live quote and append it if it's missing.
    const quotes = await getMarketQuotes(instrKey);
    const liveData = quotes[instrKey];
    
    if (liveData && candles.length > 0) {
      const todayDate = new Date().toISOString().split('T')[0];
      const lastCandleDate = candles[candles.length - 1].date;
      
      // If the last historical candle isn't today, append today's live data as a new candle
      if (lastCandleDate !== todayDate) {
        candles.push({
          date: todayDate,
          open: liveData.open || liveData.prevClose, // fallback
          high: liveData.high || liveData.ltp,
          low: liveData.low || liveData.ltp,
          close: liveData.ltp,
          volume: liveData.volume || 0,
          oi: liveData.oi || 0
        });
      } else {
        // If it is today, update it with the latest live tick
        const lastCandle = candles[candles.length - 1];
        lastCandle.close = liveData.ltp;
        lastCandle.high = Math.max(lastCandle.high, liveData.high || liveData.ltp);
        lastCandle.low = Math.min(lastCandle.low, liveData.low || liveData.ltp);
        lastCandle.volume = Math.max(lastCandle.volume, liveData.volume || 0);
        lastCandle.oi = liveData.oi || lastCandle.oi || 0;
      }
    }

    // Compute RSI for all candles to pass to the frontend
    const closes = candles.map(c => c.close);
    // Need at least 14 days for RSI
    if (closes.length >= 14) {
      for (let i = 0; i < candles.length; i++) {
        if (i >= 14) {
          const slice = closes.slice(0, i + 1);
          const rsiData = calculateRSI(slice, 14);
          candles[i].rsi = rsiData ? rsiData.rsi : null;
        } else {
          candles[i].rsi = null;
        }
      }
    }

    res.json({ symbol, candles });
  } catch (err) {
    console.error(`[PIL] Chart error for ${req.params.symbol}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get priority ranked list for a specific date (defaults to today)
router.get('/priority', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const targetDate = req.query.date || today;

    // Get all scores for the target date
    const scores = await PILScore.find({ date: targetDate }).sort({ finalScore: -1 });
    
    // Sync Live LTP for the top results to ensure accuracy
    const keys = scores.slice(0, 50).map(s => s.instrumentKeyFO || s.instrumentKeyEQ).filter(Boolean);
    if (keys.length > 0) {
      const quotes = await getMarketQuotes(keys);
      scores.forEach(s => {
        const key = s.instrumentKeyFO || s.instrumentKeyEQ;
        const live = quotes[key];
        if (live && s.rawData) {
          s.rawData.close = live.ltp; 
          s.rawData.stockChange = live.changePercent;
        }
      });
    }

    res.json({ 
      priority: scores.filter(s => s.finalScore >= 7), // High probability setups
      allResults: scores, // All scanned stocks for verification
      date: targetDate,
      count: scores.length
    });
  } catch (err) {
    console.error('[PIL] Priority sync error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Set amplifier context
router.post('/amplifiers', (req, res) => {
  const { isExpiryWeek, postResultsDayNum, fiiBuyStreak, isSectorOutperforming } = req.body;
  if (isExpiryWeek !== undefined) amplifierContext.isExpiryWeek = isExpiryWeek;
  if (postResultsDayNum !== undefined) amplifierContext.postResultsDayNum = postResultsDayNum;
  if (fiiBuyStreak !== undefined) amplifierContext.fiiBuyStreak = fiiBuyStreak;
  if (isSectorOutperforming !== undefined) amplifierContext.isSectorOutperforming = isSectorOutperforming;
  res.json({ amplifierContext, message: 'Amplifiers updated' });
});

// Get current amplifier context
router.get('/amplifiers', (req, res) => {
  res.json({ amplifierContext });
});

module.exports = router;
