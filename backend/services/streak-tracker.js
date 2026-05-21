// const StreakState = require('../models/StreakState');
// const PILScore = require('../models/PILScore');
// const Stock = require('../models/Stock');
// const { getHistoricalCandles, getMarketQuotes, getNiftyQuote, getOptionChain } = require('./upstox-data');
// const { calculateRSI } = require('./rsi-calculator');
// const { scoreP1, scoreP2, scoreP3, scoreP4, scoreP5, scoreP6, computeBaseScore, interpretBand, checkInvalidations } = require('./pil-engine');
// const { applyAmplifiers } = require('./amplifier');
// const { resolveInstrumentKeys } = require('../utils/instrument-resolver');
// const { getNextMonthlyExpiry } = require('../utils/nse-calendar');

// /**
//  * Recalculate streaks from scratch using historical candles
//  */
// function recalculateStreaks(candles, niftyChange = 0) {
//   let p1_streak = 0;
//   let p2_streak = 0;
//   let p3_streak = 0;
//   let p4_streak = 0;

//   let finalP1, finalP2, finalP3, finalP4;

//   for (let i = 1; i < candles.length; i++) {
//     const today = candles[i];
//     const yesterday = candles[i - 1];

//     const stockChange = yesterday.close > 0 ? ((today.close - yesterday.close) / yesterday.close) * 100 : 0;
//     const todayRange = today.high - today.low;
//     const yesterdayRange = yesterday.high - yesterday.low;

//     const volDays = 20;
//     const startIdx = Math.max(0, i - volDays + 1);
//     const recentVols = candles.slice(startIdx, i + 1).map(c => c.volume);
//     const avgVol20 = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
//     const isRedCandle = today.close < today.open;

//     finalP1 = scoreP1(today.oi, yesterday.oi, stockChange, p1_streak);
//     finalP2 = scoreP2(todayRange, yesterdayRange, p2_streak);
//     finalP3 = scoreP3(stockChange, niftyChange, p3_streak);
//     finalP4 = scoreP4(today.volume, yesterday.volume, avgVol20, isRedCandle, p4_streak, candles.slice(0, i + 1));

//     p1_streak = finalP1.streak;
//     p2_streak = finalP2.streak;
//     p3_streak = finalP3.streak;
//     p4_streak = finalP4.streak;
//   }

//   return { p1: finalP1, p2: finalP2, p3: finalP3, p4: finalP4 };
// }

// /**
//  * Run full PIL scan for a single stock
//  */
// async function scanStock(stock, niftyData, amplifierContext, preFetchedQuotes = null) {
//   const symbol = stock.symbol;
//   console.log(`[PIL] Scanning ${symbol}...`);

//   try {
//     // Get or create streak state
//     let streak = await StreakState.findOne({ symbol });
//     if (!streak) {
//       streak = await StreakState.create({ symbol });
//     }

//     // Resolve instrument keys if missing
//     if (!stock.instrumentKeyEQ) {
//       const keys = resolveInstrumentKeys(symbol);
//       stock.instrumentKeyEQ = keys.eq;
//       stock.instrumentKeyFO = keys.fo;
//       await stock.save();
//     }

//     // Fetch historical data (last 30 trading days for RSI + volume avg)
//     const histKey = stock.instrumentKeyFO || stock.instrumentKeyEQ;
//     let candles = await getHistoricalCandles(histKey, 30);

//     if (candles.length < 15) {
//       console.log(`[PIL] ${symbol}: Insufficient data (${candles.length} candles)`);
//       return null;
//     }

//     // ===== INTEGRATE LIVE QUOTE FOR ACCURACY =====
//     const quotes = preFetchedQuotes || await getMarketQuotes([stock.instrumentKeyFO, stock.instrumentKeyEQ].filter(Boolean));
//     const liveFO = quotes[stock.instrumentKeyFO];
//     const liveEQ = quotes[stock.instrumentKeyEQ];
//     const liveData = liveFO || liveEQ;

//     if (liveData) {
//       // Use Asia/Kolkata timezone for today's date string
//       const todayDate = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
//       const lastCandle = candles[candles.length - 1];
      
//       const newCandle = {
//         date: todayDate,
//         open: liveData.open,
//         high: liveData.high,
//         low: liveData.low,
//         close: liveData.ltp,
//         volume: liveData.volume,
//         oi: liveFO ? liveFO.oi : 0
//       };

//       if (lastCandle.date === todayDate) {
//         // Update today's candle with live data
//         candles[candles.length - 1] = newCandle;
//       } else if (new Date(todayDate) > new Date(lastCandle.date)) {
//         // Append today's candle if missing from historical
//         candles.push(newCandle);
//       }
//     }

//     // Latest candle is today's data
//     const today = candles[candles.length - 1];
//     const yesterday = candles[candles.length - 2];

//     // ===== COMPUTE RSI =====
//     const closes = candles.map(c => c.close);
//     const rsiResult = calculateRSI(closes, parseInt(process.env.PIL_RSI_LOOKBACK) || 14);
//     const rsi = rsiResult ? rsiResult.rsi : 0;

//     // ===== COMPUTE 20-DAY AVG VOLUME =====
//     const volDays = parseInt(process.env.PIL_VOLUME_AVG_DAYS) || 20;
//     const recentVols = candles.slice(-volDays).map(c => c.volume);
//     const avgVol20 = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;

//     // ===== STOCK & NIFTY CHANGE =====
//     const stockChange = yesterday.close > 0 ? ((today.close - yesterday.close) / yesterday.close) * 100 : 0;
//     const niftyChange = niftyData.changePercent || 0;

//     // ===== TODAY'S RANGE =====
//     const todayRange = today.high - today.low;
//     const yesterdayRange = yesterday.high - yesterday.low;

//     // ===== RECALCULATE STREAKS FOR CONVICTION =====
//     const historicalStreaks = recalculateStreaks(candles, niftyChange);
    
//     // Update streak state with recalculated values
//     streak.P1_streak = historicalStreaks.p1_streak;
//     streak.P2_streak = historicalStreaks.p2_streak;
//     streak.P3_streak = historicalStreaks.p3_streak;
//     streak.P4_streak = historicalStreaks.p4_streak;

//     // ===== CHECK FULL INVALIDATIONS =====
//     const invalidations = checkInvalidations({
//       rsi,
//       prevClose: yesterday.close,
//       open: today.open,
//       niftyChange
//     });

//     if (invalidations.includes('RSI_BELOW_58') || invalidations.includes('GAP_DOWN_1PCT')) {
//       // FULL RESET
//       streak.P1_streak = 0; streak.P2_streak = 0; streak.P3_streak = 0;
//       streak.P4_streak = 0; streak.P6_ivDeclineDays = 0;
//       streak.isFullReset = true;
//       await streak.save();

//       const result = buildResult(symbol, today, rsi, stockChange, niftyChange, avgVol20,
//         { score: 0, streak: 0 }, { score: 0, streak: 0 }, { score: 0, streak: 0 },
//         { score: 0, streak: 0 }, { score: 0, fullReset: true }, { score: 0, flags: [] },
//         0, { finalScore: 0 }, invalidations);
      
//       await saveScore(result);
//       return result;
//     }

//     // ===== SCORE ALL 6 PILLARS =====
//     const p1 = historicalStreaks.p1;
//     const p2 = historicalStreaks.p2;
//     const p3 = historicalStreaks.p3;
//     const p4 = historicalStreaks.p4;
//     const p5 = scoreP5(rsi);
    
//     // P5 full reset check
//     if (p5.fullReset) {
//       streak.P1_streak = 0; streak.P2_streak = 0; streak.P3_streak = 0;
//       streak.P4_streak = 0; streak.P6_ivDeclineDays = 0;
//       streak.isFullReset = true;
//       await streak.save();

//       const res = buildResult(symbol, today, rsi, stockChange, niftyChange, avgVol20,
//         { score: 0, streak: 0 }, { score: 0, streak: 0 }, { score: 0, streak: 0 },
//         { score: 0, streak: 0 }, p5, { score: 0, flags: [] },
//         0, { finalScore: 0 }, ['RSI_BELOW_58']);
      
//       await saveScore(res);
//       return res;
//     }

//     // P6 — Options (try, but don't fail if unavailable)
//     let p6 = { score: 0, flags: [], reason: 'Options data unavailable' };
//     try {
//       const optData = await analyzeOptions(stock, today.close, streak);
//       p6 = scoreP6(optData, today.close);
//     } catch (err) {
//       console.log(`[PIL] ${symbol}: Options analysis skipped — ${err.message}`);
//     }

//     // ===== BASE SCORE =====
//     const baseScore = computeBaseScore(p1, p2, p3, p4, p5, p6);

//     // ===== AMPLIFIERS =====
//     const ampResult = applyAmplifiers(baseScore, amplifierContext);

//     // ===== UPDATE STREAKS =====
//     streak.P1_streak = p1.streak;
//     streak.P2_streak = p2.streak;
//     streak.P3_streak = p3.streak;
//     streak.P4_streak = p4.streak;
//     streak.P5_lastRSI = rsi;
//     streak.P1_lastOI = today.oi;
//     streak.P2_lastRange = (today.high - today.low);
//     streak.P4_lastVolume = today.volume;
//     streak.lastDate = today.date;
//     streak.lastUpdated = new Date();
//     streak.isFullReset = false;
//     await streak.save();

//     // ===== AUDIT TRAIL =====
//     const history = extractHistory(candles, 5);

//     const result = buildResult(symbol, today, rsi, stockChange, niftyChange, avgVol20,
//       p1, p2, p3, p4, p5, p6, baseScore, ampResult, [], history);
    
//     // Save EVERY scan result to the database for transparency and historical analysis
//     await saveScore(result);
    
//     return result;
//   } catch (err) {
//     console.error(`[PIL] Error scanning ${symbol}:`, err.message);
//     return { symbol, error: err.message };
//   }
// }

// /**
//  * Analyze options data for P6
//  */
// async function analyzeOptions(stock, currentPrice, streak) {
//   const expiryDate = stock.foExpiry || getNextMonthlyExpiry(new Date()).toISOString().split('T')[0];
//   const key = stock.instrumentKeyEQ; // Upstox option chain expects equity key for the underlying
//   const chain = await getOptionChain(key, expiryDate);

//   if (!chain.strikes || chain.strikes.length === 0) {
//     return { ivCrush: false, putWall: false, callUnwind: false, levels: { support: 'N/A', resistance: 'N/A' } };
//   }

//   // Find ATM strike (closest to current price)
//   const atm = chain.strikes.reduce((prev, curr) =>
//     Math.abs(curr.strikePrice - currentPrice) < Math.abs(prev.strikePrice - currentPrice) ? curr : prev
//   );

//   // IV Crush: check if ATM IV is declining
//   const currentIV = (atm.callIV + atm.putIV) / 2;
//   const ivCrush = streak.P6_lastIV > 0 && currentIV < streak.P6_lastIV;

//   // Put Wall: find strike with max Put OI near support (within 3% below CMP)
//   const supportStrikes = chain.strikes.filter(s => s.strikePrice < currentPrice && s.strikePrice > currentPrice * 0.97);
//   const maxPutOI = supportStrikes.length > 0 ? Math.max(...supportStrikes.map(s => s.putOI)) : 0;
//   const putWall = maxPutOI > 0 && supportStrikes.some(s => s.putOI === maxPutOI && s.putOI > s.putPrevOI);

//   // Call Unwind: Call OI at nearest resistance reducing
//   const resistStrikes = chain.strikes.filter(s => s.strikePrice > currentPrice && s.strikePrice < currentPrice * 1.03);
//   const callUnwind = resistStrikes.some(s => s.callOI < s.callPrevOI);

//   // Update streak state for next comparison
//   streak.P6_lastIV = currentIV;
//   if (supportStrikes.length > 0) streak.P6_lastPutOI = maxPutOI;

//   // Major Support & Resistance based on absolute max OI across the chain
//   const supportStrikesAll = chain.strikes.filter(s => s.strikePrice < currentPrice);
//   const maxPutStrikeObj = supportStrikesAll.length > 0 ? supportStrikesAll.reduce((prev, curr) => (curr.putOI > prev.putOI) ? curr : prev) : null;
//   const majorSupport = maxPutStrikeObj ? maxPutStrikeObj.strikePrice : 'N/A';

//   const resistStrikesAll = chain.strikes.filter(s => s.strikePrice > currentPrice);
//   const maxCallStrikeObj = resistStrikesAll.length > 0 ? resistStrikesAll.reduce((prev, curr) => (curr.callOI > prev.callOI) ? curr : prev) : null;
//   const majorResistance = maxCallStrikeObj ? maxCallStrikeObj.strikePrice : 'N/A';

//   return { ivCrush, putWall, callUnwind, levels: { support: majorSupport, resistance: majorResistance } };
// }

// function buildResult(symbol, today, rsi, stockChange, niftyChange, avgVol20, p1, p2, p3, p4, p5, p6, baseScore, ampResult, invalidations, history = []) {
//   const band = interpretBand(ampResult.finalScore || 0);
//   return {
//     symbol,
//     date: today.date,
//     pillars: {
//       P1: { score: p1.score, streak: p1.streak, meta: { reason: p1.reason } },
//       P2: { score: p2.score, streak: p2.streak, meta: { reason: p2.reason } },
//       P3: { score: p3.score, streak: p3.streak, meta: { reason: p3.reason } },
//       P4: { score: p4.score, streak: p4.streak, meta: { reason: p4.reason } },
//       P5: { score: p5.score, streak: 0, meta: { rsi, reason: p5.reason } },
//       P6: { score: p6.score, streak: 0, meta: { flags: p6.flags, reason: p6.reason, levels: p6.levels } }
//     },
//     baseScore,
//     amplifiers: ampResult,
//     finalScore: ampResult.finalScore || 0,
//     band: band.band,
//     status: band.status,
//     action: band.action,
//     color: band.color,
//     priority: band.priority,
//     invalidations,
//     rawData: { open: today.open, high: today.high, low: today.low, close: today.close, volume: today.volume, oi: today.oi, rsi, stockChange, niftyChange, avgVol20 },
//     history
//   };
// }

// async function saveScore(result) {
//   try {
//     await PILScore.findOneAndUpdate(
//       { symbol: result.symbol, date: result.date },
//       {
//         ...result,
//         pillars: result.pillars,
//         amplifiers: result.amplifiers,
//         rawData: result.rawData,
//         history: result.history
//       },
//       { upsert: true, new: true }
//     );
//   } catch (err) {
//     console.error(`[PIL] Error saving score for ${result.symbol}:`, err.message);
//   }
// }

// /**
//  * Run full scan for all active stocks
//  */
// async function runFullScan(amplifierContext = {}) {
//   const stocks = await Stock.find({ isActive: true });
//   if (stocks.length === 0) return { results: [], message: 'No active stocks to scan' };

//   // 1. Fetch all instrument keys for batch quoting
//   const allKeys = stocks.map(s => s.instrumentKeyFO || s.instrumentKeyEQ).filter(Boolean);
  
//   // 2. Fetch Nifty data
//   let niftyData;
//   try {
//     niftyData = await getNiftyQuote();
//   } catch {
//     niftyData = { changePercent: 0 };
//     console.log('[PIL] Could not fetch Nifty data — using 0%');
//   }

//   // 3. Batch fetch all market quotes in chunks of 50 (Upstox limit is ~100)
//   const allQuotes = {};
//   const chunkSize = 50;
//   for (let i = 0; i < allKeys.length; i += chunkSize) {
//     const chunk = allKeys.slice(i, i + chunkSize);
//     try {
//       const quotes = await getMarketQuotes(chunk);
//       Object.assign(allQuotes, quotes);
//     } catch (err) {
//       console.error(`[PIL] Error fetching quotes chunk:`, err.message);
//     }
//   }

//   // Auto-detect Monday
//   amplifierContext.isMonday = amplifierContext.isMonday !== undefined ? amplifierContext.isMonday : (new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata", weekday: 'short' }) === 'Mon');

//   // 4. Scan all stocks using pre-fetched quotes
//   const results = [];
//   for (const stock of stocks) {
//     const stockQuotes = {};
//     if (stock.instrumentKeyFO) stockQuotes[stock.instrumentKeyFO] = allQuotes[stock.instrumentKeyFO];
//     if (stock.instrumentKeyEQ) stockQuotes[stock.instrumentKeyEQ] = allQuotes[stock.instrumentKeyEQ];

//     const result = await scanStock(stock, niftyData, amplifierContext, stockQuotes);
//     if (result) {
//       results.push(result);
//     }
//   }

//   // Sort by finalScore descending
//   results.sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));
//   return { results, niftyChange: niftyData.changePercent, scannedAt: new Date().toISOString() };
// }

// module.exports = { runFullScan, scanStock };

// /**
//  * Extract 5-day history for audit trail
//  */
// function extractHistory(candles, lookback = 5) {
//   const history = [];
//   const startIdx = Math.max(0, candles.length - lookback);
//   const closes = candles.map(c => c.close);
  
//   for (let i = startIdx; i < candles.length; i++) {
//     const c = candles[i];
//     // Calculate RSI for this specific historical day
//     const rsiResult = calculateRSI(closes.slice(0, i + 1), 14);
    
//     history.push({
//       date: c.date,
//       close: c.close,
//       oi: c.oi || 0,
//       volume: c.volume || 0,
//       rsi: rsiResult ? rsiResult.rsi : 0,
//       range: c.high - c.low
//     });
//   }
//   return history;
// }





const StreakState = require('../models/StreakState');
const PILScore = require('../models/PILScore');
const Stock = require('../models/Stock');

const {
  getHistoricalCandles,
  getMarketQuotes,
  getNiftyQuote,
  getOptionChain
} = require('./upstox-data');

const {
  buildNiftyChangeMap
} = require('../utils/nifty-history-loader');

const {
  calculateRSI
} = require('./rsi-calculator');

const {
  scoreP1,
  scoreP2,
  scoreP3,
  scoreP4,
  scoreP5,
  scoreP6,
  computeBaseScore,
  interpretBand,
  checkInvalidations
} = require('./pil-engine');

const {
  applyAmplifiers
} = require('./amplifier');

const {
  resolveInstrumentKeys
} = require('../utils/instrument-resolver');

const {
  getNextMonthlyExpiry
} = require('../utils/nse-calendar');

// -----------------------------------
// ENGINE LOCK
// -----------------------------------
let isScanRunning = false;

// -----------------------------------
// CACHE
// -----------------------------------
const cache = new Map();

const CACHE_TTL = {
  OPTION_CHAIN: 10000,
  QUOTES: 3000
};

// -----------------------------------
// CACHE HELPERS
// -----------------------------------
function getCache(key, ttl) {

  const cached = cache.get(key);

  if (!cached) {
    return null;
  }

  const age =
    Date.now() - cached.timestamp;

  if (age > ttl) {

    cache.delete(key);

    return null;
  }

  return cached.data;
}

function setCache(key, data) {

  cache.set(key, {

    data,

    timestamp: Date.now()
  });
}

// -----------------------------------
// SAFE DATE
// -----------------------------------
function normalizeDate(date) {

  return new Date(date)
    .toISOString()
    .split('T')[0];
}

// -----------------------------------
// SAFE AVERAGE
// -----------------------------------
function average(arr = []) {

  if (!arr.length) {
    return 0;
  }

  return (
    arr.reduce((a, b) => a + b, 0)
    / arr.length
  );
}

// -----------------------------------
// TIMEOUT WRAPPER
// -----------------------------------
async function withTimeout(
  promise,
  ms = 10000
) {

  let timeoutId;

  const timeout = new Promise((_, reject) => {

    timeoutId = setTimeout(() => {

      reject(
        new Error('Request timeout')
      );

    }, ms);
  });

  const result =
    await Promise.race([
      promise,
      timeout
    ]);

  clearTimeout(timeoutId);

  return result;
}

// -----------------------------------
// RECALCULATE STREAKS
// -----------------------------------
function recalculateStreaks(
  candles,
  changeMap = null
) {

  let p1_streak = 0;
  let p2_streak = 0;
  let p3_streak = 0;
  let p4_streak = 0;

  let finalP1 = {
    score: 0,
    streak: 0
  };

  let finalP2 = {
    score: 0,
    streak: 0
  };

  let finalP3 = {
    score: 0,
    streak: 0
  };

  let finalP4 = {
    score: 0,
    streak: 0
  };

  for (
    let i = 1;
    i < candles.length;
    i++
  ) {

    const today =
      candles[i];

    const yesterday =
      candles[i - 1];

    const stockChange =

      yesterday.close > 0

        ? (
            (
              today.close -
              yesterday.close
            ) /
            yesterday.close
          ) * 100

        : 0;

    const todayRange =
      today.high - today.low;

    const yesterdayRange =
      yesterday.high -
      yesterday.low;

    const recentVols =
      candles
        .slice(
          Math.max(0, i - 19),
          i + 1
        )
        .map(c => c.volume || 0);

    const avgVol20 =
      average(recentVols);

    const isRed =
      today.close < today.open;

    finalP1 = scoreP1(
      today.oi || 0,
      yesterday.oi || 0,
      stockChange,
      p1_streak
    );

    finalP2 = scoreP2(
      todayRange,
      yesterdayRange,
      p2_streak
    );

    const candleDateKey = String(today.date || '').substring(0, 10);
    const liveNiftyChange = (changeMap && changeMap.get(candleDateKey)) ?? 0;

    finalP3 = scoreP3(
      stockChange,
      liveNiftyChange,
      p3_streak
    );

    finalP4 = scoreP4(
      today.volume || 0,
      yesterday.volume || 0,
      avgVol20,
      isRed,
      p4_streak,
      candles.slice(0, i + 1)
    );

    p1_streak =
      finalP1.streak || 0;

    p2_streak =
      finalP2.streak || 0;

    p3_streak =
      finalP3.streak || 0;

    p4_streak =
      finalP4.streak || 0;
  }

  return {

    p1: finalP1,

    p2: finalP2,

    p3: finalP3,

    p4: finalP4
  };
}

// -----------------------------------
// OPTIONS ANALYSIS
// -----------------------------------
async function analyzeOptions(
  stock,
  currentPrice,
  streak
) {

  const expiryDate =

    stock.foExpiry ||

    getNextMonthlyExpiry(
      new Date()
    )
      .toISOString()
      .split('T')[0];

  const cacheKey =
    `option:${stock.symbol}`;

  let chain =
    getCache(
      cacheKey,
      CACHE_TTL.OPTION_CHAIN
    );

  if (!chain) {

    chain =
      await withTimeout(

        getOptionChain(
          stock.instrumentKeyEQ,
          expiryDate
        ),

        10000
      );

    setCache(
      cacheKey,
      chain
    );
  }

  if (
    !chain?.strikes?.length
  ) {

    return {

      score: 0,

      flags: [],

      reason:
        'No option chain'
    };
  }

  const atm =
    chain.strikes.reduce(
      (prev, curr) =>

        Math.abs(
          curr.strikePrice -
          currentPrice
        ) <

        Math.abs(
          prev.strikePrice -
          currentPrice
        )

          ? curr
          : prev
    );

  const currentIV =
    (
      (atm.callIV || 0) +
      (atm.putIV || 0)
    ) / 2;

  const ivCrush =

    streak.P6_lastIV > 0 &&

    currentIV <
    streak.P6_lastIV;

  const supportStrikes =
    chain.strikes.filter(

      s =>

        s.strikePrice <
          currentPrice &&

        s.strikePrice >
          currentPrice * 0.97
    );

  const resistStrikes =
    chain.strikes.filter(

      s =>

        s.strikePrice >
          currentPrice &&

        s.strikePrice <
          currentPrice * 1.03
    );

  const putWall =
    supportStrikes.some(

      s =>

        s.putOI >
        (s.putPrevOI || 0)
    );

  const callUnwind =
    resistStrikes.some(

      s =>

        s.callOI <
        (s.callPrevOI || 0)
    );

  streak.P6_lastIV =
    currentIV;

  return scoreP6({

    ivCrush,

    putWall,

    callUnwind,

    levels: {

      support:

        supportStrikes[0]
          ?.strikePrice || 'N/A',

      resistance:

        resistStrikes[0]
          ?.strikePrice || 'N/A'
    }

  }, currentPrice);
}

// -----------------------------------
// BUILD RESULT
// -----------------------------------
function buildResult({
  symbol,
  today,
  rsi,
  stockChange,
  niftyChange,
  avgVol20,
  p1,
  p2,
  p3,
  p4,
  p5,
  p6,
  baseScore,
  ampResult,
  invalidations,
  history = []
}) {

  const band =
    interpretBand(
      ampResult.finalScore || 0
    );

  return {

    symbol,

    date: today.date,

    pillars: {

      P1: p1,
      P2: p2,
      P3: p3,
      P4: p4,
      P5: p5,
      P6: p6
    },

    baseScore,

    amplifiers:
      ampResult,

    finalScore:
      ampResult.finalScore || 0,

    band: band.band,

    status:
      band.status,

    action:
      band.action,

    color:
      band.color,

    priority:
      band.priority,

    invalidations,

    rawData: {

      open:
        today.open,

      high:
        today.high,

      low:
        today.low,

      close:
        today.close,

      volume:
        today.volume,

      oi:
        today.oi,

      rsi,

      stockChange,

      niftyChange,

      avgVol20
    },

    history
  };
}

// -----------------------------------
// SAVE SCORE
// -----------------------------------
async function saveScore(
  result
) {

  try {

    await PILScore.findOneAndUpdate(

      {

        symbol:
          result.symbol,

        date:
          result.date
      },

      result,

      {

        upsert: true,

        new: true
      }

    );

  } catch (err) {

    console.error(

      `[PIL] Save error ${result.symbol}:`,

      err.message
    );
  }
}

// -----------------------------------
// EXTRACT HISTORY
// -----------------------------------
function extractHistory(
  candles,
  lookback = 5
) {

  const history = [];

  const closes =
    candles.map(c => c.close);

  for (

    let i =
      Math.max(
        0,
        candles.length - lookback
      );

    i < candles.length;

    i++

  ) {

    const candle =
      candles[i];

    const rsiData =
      calculateRSI(

        closes.slice(0, i + 1),

        14
      );

    history.push({

      date:
        candle.date,

      close:
        candle.close,

      oi:
        candle.oi || 0,

      volume:
        candle.volume || 0,

      rsi:
        rsiData?.rsi || 0,

      range:
        candle.high -
        candle.low
    });
  }

  return history;
}

// -----------------------------------
// SCAN STOCK
// -----------------------------------
async function scanStock(
  stock,
  niftyData,
  amplifierContext,
  preFetchedQuotes = {}
) {

  const symbol =
    stock.symbol;

  try {

    let streak =
      await StreakState.findOne({
        symbol
      });

    if (!streak) {

      streak =
        await StreakState.create({
          symbol
        });
    }

    // RESOLVE KEYS
    if (!stock.instrumentKeyEQ) {

      const keys =
        resolveInstrumentKeys(
          symbol
        );

      stock.instrumentKeyEQ =
        keys.eq;

      stock.instrumentKeyFO =
        keys.fo;

      await stock.save();
    }

    // FETCH CANDLES
    const histKey =

      stock.instrumentKeyFO ||

      stock.instrumentKeyEQ;

    const candles =
      await withTimeout(

        getHistoricalCandles(
          histKey,
          30
        ),

        10000
      );

    if (

      !Array.isArray(candles) ||

      candles.length < 15

    ) {

      return null;
    }

    // LIVE QUOTES
    const liveFO =

      stock.instrumentKeyFO

        ? preFetchedQuotes[
            stock.instrumentKeyFO
          ]

        : null;

    const liveEQ =

      stock.instrumentKeyEQ

        ? preFetchedQuotes[
            stock.instrumentKeyEQ
          ]

        : null;

    const liveData =
      liveFO || liveEQ;

    // LIVE MERGE
    if (liveData) {

      const todayDate =
        new Date()
          .toLocaleDateString(
            'en-CA',
            {
              timeZone:
                'Asia/Kolkata'
            }
          );

      const lastCandle =
        candles[
          candles.length - 1
        ];

      const newCandle = {

        date: todayDate,

        open:
          Number(
            liveData.open || 0
          ),

        high:
          Number(
            liveData.high || 0
          ),

        low:
          Number(
            liveData.low || 0
          ),

        close:
          Number(
            liveData.ltp || 0
          ),

        volume:
          Number(
            liveData.volume || 0
          ),

        oi:
          Number(
            liveFO?.oi || 0
          )
      };

      if (

        normalizeDate(
          lastCandle.date
        ) === todayDate

      ) {

        candles[
          candles.length - 1
        ] = newCandle;

      } else {

        candles.push(
          newCandle
        );
      }
    }

    const today =
      candles[
        candles.length - 1
      ];

    const yesterday =
      candles[
        candles.length - 2
      ];

    // RSI
    const closes =
      candles.map(c => c.close);

    const rsiData =
      calculateRSI(
        closes,
        parseInt(
          process.env
            .PIL_RSI_LOOKBACK
        ) || 14
      );

    const rsi =
      rsiData?.rsi || 0;

    // VOLUME
    const recentVols =
      candles
        .slice(-20)
        .map(c => c.volume || 0);

    const avgVol20 =
      average(recentVols);

    // PRICE CHANGE
    const stockChange =

      yesterday.close > 0

        ? (
            (
              today.close -
              yesterday.close
            ) /
            yesterday.close
          ) * 100

        : 0;

    const niftyChange =
      niftyData.changePercent || 0;

    // STREAKS
    const historicalStreaks =
      recalculateStreaks(
        candles,
        niftyData.changeMap
      );

    // INVALIDATIONS
    const invalidations =
      checkInvalidations({

        rsi,

        prevClose:
          yesterday.close,

        open:
          today.open,

        niftyChange
      });

    // RESET
    if (

      invalidations.includes(
        'RSI_BELOW_58'
      ) ||

      invalidations.includes(
        'GAP_DOWN_1PCT'
      )

    ) {

      streak.P1_streak = 0;
      streak.P2_streak = 0;
      streak.P3_streak = 0;
      streak.P4_streak = 0;
      streak.P6_ivDeclineDays = 0;

      streak.isFullReset = true;

      await streak.save();

      return null;
    }

    // PILLARS
    const p1 =
      historicalStreaks.p1;

    const p2 =
      historicalStreaks.p2;

    const p3 =
      historicalStreaks.p3;

    const p4 =
      historicalStreaks.p4;

    const p5 =
      scoreP5(rsi);

    let p6 = {

      score: 0,

      flags: [],

      reason:
        'Options unavailable'
    };

    try {

      p6 =
        await analyzeOptions(
          stock,
          today.close,
          streak
        );

    } catch (err) {

      console.log(

        `[PIL] ${symbol} options skipped`
      );
    }

    // SCORE
    const baseScore =
      computeBaseScore(
        p1,
        p2,
        p3,
        p4,
        p5,
        p6
      );

    const ampResult =
      applyAmplifiers(
        baseScore,
        amplifierContext
      );

    // UPDATE STREAKS
    streak.P1_streak =
      p1?.streak || 0;

    streak.P2_streak =
      p2?.streak || 0;

    streak.P3_streak =
      p3?.streak || 0;

    streak.P4_streak =
      p4?.streak || 0;

    streak.P5_lastRSI =
      rsi;

    streak.P1_lastOI =
      today.oi || 0;

    streak.P4_lastVolume =
      today.volume || 0;

    streak.lastDate =
      today.date;

    streak.lastUpdated =
      new Date();

    streak.isFullReset =
      false;

    await streak.save();

    // HISTORY
    const history =
      extractHistory(
        candles,
        5
      );

    const result =
      buildResult({

        symbol,

        today,

        rsi,

        stockChange,

        niftyChange,

        avgVol20,

        p1,

        p2,

        p3,

        p4,

        p5,

        p6,

        baseScore,

        ampResult,

        invalidations,

        history
      });

    await saveScore(result);

    return result;

  } catch (err) {

    console.error(

      `[PIL] ${symbol} error:`,

      err.message
    );

    return {

      symbol,

      error:
        err.message
    };
  }
}

// -----------------------------------
// FULL SCAN
// -----------------------------------
async function runFullScan(
  amplifierContext = {}
) {

  if (isScanRunning) {

    return {

      results: [],

      message:
        'Scan already running'
    };
  }

  isScanRunning = true;

  try {

    const stocks =
      await Stock.find({

        isActive: true
      });

    if (!stocks.length) {

      return {

        results: [],

        message:
          'No active stocks'
      };
    }

    // NIFTY
    let niftyData;

    try {

      niftyData =
        await getNiftyQuote();

    } catch {

      niftyData = {

        changePercent: 0
      };
    }

    // Historical Nifty Change Map (Fix 2)
    try {
      niftyData.changeMap = await buildNiftyChangeMap(getHistoricalCandles, 90);
    } catch (err) {
      console.error('[PIL] Failed to build Nifty history map:', err.message);
      niftyData.changeMap = new Map();
    }

    // BATCH QUOTES
    const allKeys =
      stocks
        .map(

          s =>

            s.instrumentKeyFO ||

            s.instrumentKeyEQ
        )
        .filter(Boolean);

    const allQuotes = {};

    const chunkSize = 50;

    for (
      let i = 0;
      i < allKeys.length;
      i += chunkSize
    ) {

      const chunk =
        allKeys.slice(
          i,
          i + chunkSize
        );

      try {

        const quotes =
          await getMarketQuotes(
            chunk
          );

        Object.assign(
          allQuotes,
          quotes
        );

      } catch (err) {

        console.error(

          '[PIL] Quote chunk error:',

          err.message
        );
      }
    }

    // MONDAY
    if (
      amplifierContext.isMonday ===
      undefined
    ) {

      amplifierContext.isMonday =

        new Date()
          .toLocaleString(
            'en-US',
            {
              timeZone:
                'Asia/Kolkata',

              weekday:
                'short'
            }
          ) === 'Mon';
    }

    // CONCURRENCY
    const concurrency = 5;

    const results = [];

    for (
      let i = 0;
      i < stocks.length;
      i += concurrency
    ) {

      const batch =
        stocks.slice(
          i,
          i + concurrency
        );

      const batchResults =
        await Promise.all(

          batch.map(stock => {

            const stockQuotes =
              {};

            if (
              stock.instrumentKeyFO
            ) {

              stockQuotes[
                stock.instrumentKeyFO
              ] =

                allQuotes[
                  stock.instrumentKeyFO
                ];
            }

            if (
              stock.instrumentKeyEQ
            ) {

              stockQuotes[
                stock.instrumentKeyEQ
              ] =

                allQuotes[
                  stock.instrumentKeyEQ
                ];
            }

            return scanStock(

              stock,

              niftyData,

              amplifierContext,

              stockQuotes
            );
          })
        );

      results.push(
        ...batchResults.filter(Boolean)
      );
    }

    // SORT
    results.sort(

      (a, b) =>

        (b.finalScore || 0) -

        (a.finalScore || 0)
    );

    return {

      results,

      niftyChange:
        niftyData.changePercent,

      scannedAt:
        new Date()
          .toISOString()
    };

  } finally {

    isScanRunning = false;
  }
}

module.exports = {

  runFullScan,

  scanStock
};
