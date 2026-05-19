// const axios = require('axios');
// const { getValidToken } = require('./upstox-auth');

// const UPSTOX_BASE = 'https://api.upstox.com/v2';

// async function getHeaders() {
//   const token = await getValidToken();
//   return { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };
// }

// /**
//  * Get historical daily candles (oldest → newest)
//  */
// async function getHistoricalCandles(instrumentKey, days = 30) {
//   const headers = await getHeaders();
//   const toDate = new Date();
//   const fromDate = new Date();
//   fromDate.setDate(fromDate.getDate() - Math.ceil(days * 1.6));

//   const to = toDate.toISOString().split('T')[0];
//   const from = fromDate.toISOString().split('T')[0];
//   const encodedKey = encodeURIComponent(instrumentKey);

//   try {
//     const res = await axios.get(
//       `${UPSTOX_BASE}/historical-candle/${encodedKey}/day/${to}/${from}`,
//       { headers, timeout: 15000 }
//     );

//     if (res.data?.status !== 'success' || !res.data?.data?.candles) return [];

//     // Candles come newest first — reverse for chronological order
//     return res.data.data.candles.reverse().map(c => ({
//       date: c[0].split('T')[0],
//       open: c[1],
//       high: c[2],
//       low: c[3],
//       close: c[4],
//       volume: c[5],
//       oi: c[6] || 0
//     }));
//   } catch (err) {
//     console.error(`[UPSTOX] Historical error ${instrumentKey}:`, err.response?.data?.message || err.message);
//     return [];
//   }
// }

// /**
//  * Get intraday 5-minute candles
//  */
// async function getIntradayCandles(instrumentKey) {
//   const headers = await getHeaders();
//   const encodedKey = encodeURIComponent(instrumentKey);

//   try {
//     const res = await axios.get(
//       `${UPSTOX_BASE}/historical-candle/intraday/${encodedKey}/1minute`, // fetch 1m to build 5m or fetch 5m direct
//       { headers, timeout: 15000 }
//     );
//     // Upstox intraday endpoint doesn't support 5minute directly on /intraday/. Actually, their docs say: /historical-candle/intraday/{instrumentKey}/1minute
//     // Wait, let's use 1minute and return the raw candles.
//     if (res.data?.status !== 'success' || !res.data?.data?.candles) return [];

//     return res.data.data.candles.reverse().map(c => ({
//       timestamp: c[0],
//       open: c[1],
//       high: c[2],
//       low: c[3],
//       close: c[4],
//       volume: c[5],
//       oi: c[6] || 0
//     }));
//   } catch (err) {
//     console.error(`[UPSTOX] Intraday error ${instrumentKey}:`, err.response?.data?.message || err.message);
//     return [];
//   }
// }

// /**
//  * Get live market quotes
//  * Handles Upstox response format: keys are "NSE_EQ:SYMBOL" (colon-separated)
//  */
// async function getMarketQuotes(instrumentKeys) {
//   const headers = await getHeaders();
//   const keys = Array.isArray(instrumentKeys) ? instrumentKeys.join(',') : instrumentKeys;

//   try {
//     const res = await axios.get(`${UPSTOX_BASE}/market-quote/quotes`, {
//       headers,
//       params: { instrument_key: keys },
//       timeout: 10000
//     });

//     if (res.data?.status !== 'success') return {};

//     const result = {};
//     for (const [key, q] of Object.entries(res.data.data || {})) {
//       const ltp = q.last_price || 0;
//       const netChange = q.net_change !== undefined ? q.net_change : 0;
//       const token = q.instrument_token || key; // Use instrument_token for mapping consistency
      
//       const prevClose = (netChange !== 0) ? (ltp - netChange) : (q.ohlc?.close || ltp);
//       const changePercent = prevClose > 0 ? (netChange / prevClose) * 100 : 0;

//       result[token] = {
//         ltp,
//         open: q.ohlc?.open || 0,
//         high: q.ohlc?.high || 0,
//         low: q.ohlc?.low || 0,
//         close: prevClose,
//         volume: q.volume || 0,
//         oi: q.oi || 0,
//         prevClose,
//         change: netChange,
//         changePercent: q.percentage_change !== undefined ? q.percentage_change : changePercent
//       };
//     }
//     return result;
//   } catch (err) {
//     console.error('[UPSTOX] Quote error:', err.response?.data?.message || err.message);
//     return {};
//   }
// }

// /**
//  * Get Nifty 50 quote
//  */
// async function getNiftyQuote() {
//   const niftyKey = process.env.PIL_NIFTY_INSTRUMENT_KEY || 'NSE_INDEX|Nifty 50';
//   const quotes = await getMarketQuotes(niftyKey);
//   const niftyData = Object.values(quotes)[0];
//   if (!niftyData) throw new Error('Could not fetch Nifty 50 data');
//   return niftyData;
// }

// /**
//  * Get option chain
//  */
// async function getOptionChain(instrumentKey, expiryDate) {
//   const headers = await getHeaders();
//   try {
//     const res = await axios.get(`${UPSTOX_BASE}/option/chain`, {
//       headers,
//       params: { instrument_key: instrumentKey, expiry_date: expiryDate },
//       timeout: 15000
//     });

//     if (res.data?.status !== 'success' || !res.data?.data) return { strikes: [] };

//     return {
//       strikes: res.data.data.map(item => ({
//         strikePrice: item.strike_price,
//         callOI: item.call_options?.market_data?.oi || 0,
//         putOI: item.put_options?.market_data?.oi || 0,
//         callIV: item.call_options?.option_greeks?.iv || 0,
//         putIV: item.put_options?.option_greeks?.iv || 0,
//         callPrevOI: item.call_options?.market_data?.prev_oi || 0,
//         putPrevOI: item.put_options?.market_data?.prev_oi || 0,
//         callLTP: item.call_options?.market_data?.ltp || 0,
//         putLTP: item.put_options?.market_data?.ltp || 0
//       }))
//     };
//   } catch (err) {
//     console.error(`[UPSTOX] Option chain error ${instrumentKey}:`, err.response?.data?.message || err.message);
//     return { strikes: [] };
//   }
// }

// /**
//  * Search instruments via local ISIN map (Upstox search API is deprecated/404)
//  */
// function searchInstruments(query) {
//   const { getInstrumentMap } = require('../utils/instrument-resolver');
//   const map = getInstrumentMap();
//   const q = query.toUpperCase().trim();
//   const results = [];

//   for (const [symbol, key] of Object.entries(map)) {
//     if (symbol.includes(q)) {
//       results.push({ trading_symbol: symbol, instrument_key: key, exchange: 'NSE' });
//       if (results.length >= 10) break;
//     }
//   }
//   return results;
// }

// module.exports = {
//   getHistoricalCandles,
//   getIntradayCandles,
//   getMarketQuotes,
//   getNiftyQuote,
//   getOptionChain,
//   searchInstruments
// };





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
  candles
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

    // historical nifty unavailable
    finalP3 = scoreP3(
      stockChange,
      0,
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
        candles
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
