/**
 * PULLBACK POLLER
 * 30-second background polling engine for intraday pullback detection.
 * Scans A-List PIL stocks (score >= 7), scores each for PQS, saves results to DB.
 * Independent of CSMC engine — no shared state.
 */

const PullbackScan = require('../models/PullbackScan');
const PILScore = require('../models/PILScore');
const { getIntradayCandles, getHistoricalCandles, getMarketQuotes, getNiftyQuote } = require('../services/upstox-data');
const { getInstrumentMap } = require('./instrument-resolver');
const { calculateRSI } = require('../services/rsi-calculator');
const { scanStock } = require('../services/pullback-engine');

// ── Build 5-min candles from 1-min candles (reusing same logic as csmc-intraday-engine) ──
function build5MinCandles(oneMinCandles) {
  const fiveMinCandles = [];
  let current5Min = null;

  for (const c of oneMinCandles) {
    const timeStr = c.timestamp.split('T')[1].substring(0, 5);
    const mins = parseInt(timeStr.split(':')[1]);
    const blockStartMins = Math.floor(mins / 5) * 5;
    const blockKey = `${timeStr.split(':')[0]}:${blockStartMins.toString().padStart(2, '0')}`;

    if (!current5Min || current5Min.blockKey !== blockKey) {
      if (current5Min) fiveMinCandles.push(current5Min);
      current5Min = {
        blockKey,
        open: c.open, high: c.high, low: c.low, close: c.close,
        volume: c.volume, oi: c.oi || 0,
        isGreen: c.close > c.open, isRed: c.close < c.open
      };
    } else {
      current5Min.high = Math.max(current5Min.high, c.high);
      current5Min.low = Math.min(current5Min.low, c.low);
      current5Min.close = c.close;
      current5Min.volume += c.volume;
      current5Min.oi = c.oi || current5Min.oi;
      current5Min.isGreen = current5Min.close > current5Min.open;
      current5Min.isRed = current5Min.close < current5Min.open;
    }
  }
  if (current5Min) fiveMinCandles.push(current5Min);
  return fiveMinCandles;
}

// ── State ──
let pollerIntervalId = null;
let pollerRunning = false;
let lastScanResults = [];

function isPollerRunning() {
  return pollerRunning;
}

/**
 * Core scan logic — run once for all stocks
 * Can be called manually (POST /api/pullback/scan) or by the poller
 */
async function runPullbackScan() {
  const today = new Date().toISOString().split('T')[0];

  try {
    // 1. Get A-List stocks (latest PIL score >= 7 per symbol)
    const allScores = await PILScore.find({ finalScore: { $gte: 7 } })
      .sort({ date: -1 })
      .limit(100);

    // Deduplicate: one entry per symbol (most recent)
    const seen = new Set();
    const aList = [];
    for (const s of allScores) {
      if (!seen.has(s.symbol)) {
        seen.add(s.symbol);
        aList.push({ symbol: s.symbol, pilScore: s.finalScore });
      }
    }

    if (aList.length === 0) {
      console.log('[PULLBACK] No A-List stocks found (PIL >= 7). Run EOD scan first.');
      return [];
    }

    console.log(`[PULLBACK] Scanning ${aList.length} A-List stocks for pullback setups...`);

    // 2. Fetch Nifty change for trend alignment check
    let niftyChangePct = 0;
    try {
      const nifty = await getNiftyQuote();
      niftyChangePct = nifty?.changePercent || 0;
    } catch (e) {
      console.log('[PULLBACK] Nifty fetch failed — defaulting to 0');
    }

    const instrMap = getInstrumentMap();
    const results = [];

    // 3. Process each stock sequentially (avoid rate limits)
    for (const { symbol, pilScore } of aList) {
      const instrKey = instrMap[symbol];
      if (!instrKey) {
        console.log(`[PULLBACK] No instrument key for ${symbol} — skip`);
        continue;
      }

      try {
        // Fetch 1-min candles → build 5-min candles
        const candles1m = await getIntradayCandles(instrKey);
        if (!candles1m || candles1m.length < 30) {
          console.log(`[PULLBACK] ${symbol}: insufficient 1-min candles (${candles1m?.length || 0})`);
          continue;
        }

        const candles5m = build5MinCandles(candles1m);
        if (candles5m.length < 12) continue;

        // ── Fetch yesterday's daily candle for prevDayClose + prevDayHigh ──
        // getHistoricalCandles returns candles oldest→newest
        // We fetch 4 days to guarantee we get at least 1 completed trading day
        let prevDayClose = 0;
        let prevDayHigh = 0;
        try {
          const dailyCandles = await getHistoricalCandles(instrKey, 4);
          // The last candle IS today (incomplete), so second-to-last = yesterday
          if (dailyCandles && dailyCandles.length >= 2) {
            const yesterday = dailyCandles[dailyCandles.length - 2];
            prevDayClose = yesterday.close;
            prevDayHigh  = yesterday.high;
          }
        } catch (histErr) {
          console.log(`[PULLBACK] ${symbol}: daily candle fetch failed — ${histErr.message}`);
        } 

        // Calculate live RSI from 5-min closes
        const closes5m = candles5m.map(c => c.close);
        let currentRSI = 50;
        let minRSIToday = 50;
        if (closes5m.length >= 15) {
          const rsiData = calculateRSI(closes5m, 14);
          if (rsiData) currentRSI = rsiData.rsi;
          // Calculate rolling RSI to find min in session
          const allRSIs = [];
          for (let i = 15; i <= closes5m.length; i++) {
            const rd = calculateRSI(closes5m.slice(0, i), 14);
            if (rd) allRSIs.push(rd.rsi);
          }
          if (allRSIs.length > 0) minRSIToday = Math.min(...allRSIs);
        }


        // Run the pullback scoring engine
        const scanResult = scanStock(
          symbol, candles5m, niftyChangePct,
          prevDayHigh,   // yesterday's high  → used in S4 (key level: is price near PDH?)
          prevDayClose,  // yesterday's close → used in prereq (open above prevClose?)
          currentRSI, minRSIToday
        );

        // Save result to DB (upsert by symbol+date+minute-bucket)
        const scanDoc = {
          symbol,
          date: today,
          scannedAt: new Date(),
          pilScore,
          ...scanResult
        };

        await PullbackScan.create(scanDoc);
        results.push(scanDoc);

        const pqsDisplay = scanResult.pqs >= 4 ? `⚡ PQS ${scanResult.pqs}` : `PQS ${scanResult.pqs}`;
        console.log(`[PULLBACK] ${symbol}: ${pqsDisplay} — ${scanResult.grade} | ${scanResult.reason?.substring(0, 60)}`);

      } catch (stockErr) {
        console.log(`[PULLBACK] ${symbol}: error — ${stockErr.message}`);
      }
    }

    lastScanResults = results;
    console.log(`[PULLBACK] Scan complete. ${results.filter(r => r.pqs >= 4 && r.inPullback).length} active setups found.`);
    return results;

  } catch (err) {
    console.error('[PULLBACK] runPullbackScan error:', err.message);
    return [];
  }
}

// ── Poller loop ──
async function pollTick() {
  if (!pollerRunning) return;
  const now = new Date();
  const hour = now.getHours();
  const min = now.getMinutes();

  // Only scan during market hours: 9:20 AM – 3:15 PM IST
  const inMarketHours = (hour > 9 || (hour === 9 && min >= 20)) && hour < 15 || (hour === 15 && min <= 15);
  if (!inMarketHours) {
    console.log('[PULLBACK] Outside market hours — skip poll');
    return;
  }

  await runPullbackScan();
}

function startPullbackPoller() {
  if (pollerRunning) {
    console.log('[PULLBACK] Poller already running');
    return;
  }
  pollerRunning = true;
  console.log('[PULLBACK] Starting 30-second pullback scanner...');
  pollTick(); // immediate first run
  pollerIntervalId = setInterval(pollTick, 30000);
}

function stopPullbackPoller() {
  if (!pollerRunning) return;
  pollerRunning = false;
  clearInterval(pollerIntervalId);
  pollerIntervalId = null;
  console.log('[PULLBACK] Poller stopped.');
}

function getLastResults() {
  return lastScanResults;
}

module.exports = {
  runPullbackScan,
  startPullbackPoller,
  stopPullbackPoller,
  isPollerRunning,
  getLastResults
};
