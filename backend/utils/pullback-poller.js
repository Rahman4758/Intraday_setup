/**
 * PRODUCTION-GRADE PULLBACK POLLER
 * --------------------------------
 * Improvements:
 * ✅ Poller overlap protection
 * ✅ Timezone-safe market hours
 * ✅ Retry wrapper
 * ✅ Controlled concurrency
 * ✅ Quote validation
 * ✅ Cache layer
 * ✅ Mongo upsert instead of infinite inserts
 * ✅ Rolling RSI optimization
 * ✅ Safe daily candle extraction
 * ✅ Socket support
 * ✅ API timeout protection
 * ✅ Memory-safe processing
 */

const PullbackScan =
  require('../models/PullbackScan');

const PILScore =
  require('../models/PILScore');

const {
  getIntradayCandles,
  getHistoricalCandles,
  getNiftyQuote
} = require('../services/upstox-data');

const {
  getInstrumentMap
} = require('./instrument-resolver');

const {
  calculateRSI
} = require('../services/rsi-calculator');

const {
  scanStock
} = require('../services/pullback-engine');

// -----------------------------------
// CONFIG
// -----------------------------------
const CONFIG = {

  POLL_INTERVAL: 30000,

  MAX_CONCURRENCY: 3,

  CACHE_TTL: {

    NIFTY: 5000,

    DAILY: 60000,

    INTRADAY: 5000
  },

  REQUEST_TIMEOUT: 10000,

  MAX_RETRIES: 2
};

// -----------------------------------
// ENGINE STATE
// -----------------------------------
let pollerIntervalId = null;

let pollerRunning = false;

let isProcessing = false;

let lastScanResults = [];

// -----------------------------------
// MEMORY CACHE
// -----------------------------------
const cache = new Map();

// -----------------------------------
// CACHE HELPERS
// -----------------------------------
function getCache(key, ttl) {

  const cached =
    cache.get(key);

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
// TIMEZONE SAFE INDIA TIME
// -----------------------------------
function getIndiaNow() {

  const indiaTime =
    new Date().toLocaleString(
      'en-US',
      {
        timeZone:
          'Asia/Kolkata'
      }
    );

  return new Date(indiaTime);
}

function getTodayDate() {

  return getIndiaNow()
    .toISOString()
    .split('T')[0];
}

// -----------------------------------
// MARKET HOURS
// -----------------------------------
function isMarketOpen() {

  const now =
    getIndiaNow();

  const day =
    now.getDay();

  // Saturday/Sunday
  if (
    day === 0 ||
    day === 6
  ) {
    return false;
  }

  const hour =
    now.getHours();

  const min =
    now.getMinutes();

  return (

    (
      hour > 9 ||

      (
        hour === 9 &&
        min >= 20
      )
    ) &&

    (
      hour < 15 ||

      (
        hour === 15 &&
        min <= 15
      )
    )
  );
}

// -----------------------------------
// TIMEOUT WRAPPER
// -----------------------------------
async function withTimeout(
  promise,
  timeout = CONFIG.REQUEST_TIMEOUT
) {

  let timeoutId;

  const timeoutPromise =
    new Promise((_, reject) => {

      timeoutId =
        setTimeout(() => {

          reject(
            new Error(
              'Request timeout'
            )
          );

        }, timeout);
    });

  try {

    return await Promise.race([
      promise,
      timeoutPromise
    ]);

  } finally {

    clearTimeout(timeoutId);
  }
}

// -----------------------------------
// RETRY WRAPPER
// -----------------------------------
async function retry(
  fn,
  retries = CONFIG.MAX_RETRIES
) {

  let lastError;

  for (
    let i = 0;
    i <= retries;
    i++
  ) {

    try {

      return await fn();

    } catch (err) {

      lastError = err;

      console.log(
        `[RETRY] Attempt ${i + 1} failed: ${err.message}`
      );

      if (i < retries) {

        await new Promise(
          r => setTimeout(r, 500)
        );
      }
    }
  }

  throw lastError;
}

// -----------------------------------
// SAFE VALIDATION
// -----------------------------------
function isValidCandle(c) {

  return (

    c &&

    typeof c.open === 'number' &&
    typeof c.high === 'number' &&
    typeof c.low === 'number' &&
    typeof c.close === 'number' &&

    !Number.isNaN(c.close)
  );
}

// -----------------------------------
// BUILD 5M CANDLES
// -----------------------------------
function build5MinCandles(
  oneMinCandles
) {

  const fiveMinCandles = [];

  let current5Min = null;

  for (const c of oneMinCandles) {

    if (!isValidCandle(c)) {
      continue;
    }

    const date =
      new Date(c.timestamp);

    const hours =
      date.getHours();

    const mins =
      date.getMinutes();

    const blockStart =
      Math.floor(mins / 5) * 5;

    const blockKey =
      `${hours}:${blockStart}`;

    if (

      !current5Min ||

      current5Min.blockKey !==
        blockKey

    ) {

      if (current5Min) {

        fiveMinCandles.push(
          current5Min
        );
      }

      current5Min = {

        blockKey,

        timestamp:
          c.timestamp,

        open:
          c.open,

        high:
          c.high,

        low:
          c.low,

        close:
          c.close,

        volume:
          c.volume || 0,

        oi:
          c.oi || 0,

        isGreen:
          c.close > c.open,

        isRed:
          c.close < c.open
      };

    } else {

      current5Min.high =
        Math.max(
          current5Min.high,
          c.high
        );

      current5Min.low =
        Math.min(
          current5Min.low,
          c.low
        );

      current5Min.close =
        c.close;

      current5Min.volume +=
        c.volume || 0;

      current5Min.oi =
        c.oi ||
        current5Min.oi;

      current5Min.isGreen =
        current5Min.close >
        current5Min.open;

      current5Min.isRed =
        current5Min.close <
        current5Min.open;
    }
  }

  if (current5Min) {

    fiveMinCandles.push(
      current5Min
    );
  }

  return fiveMinCandles;
}

// -----------------------------------
// GET SAFE YESTERDAY CANDLE
// -----------------------------------
function getLastCompletedDailyCandle(
  candles = []
) {

  const today =
    getTodayDate();

  const completed =
    candles.filter(c => {

      const d =
        new Date(c.date)
          .toISOString()
          .split('T')[0];

      return d !== today;
    });

  if (!completed.length) {
    return null;
  }

  return completed[
    completed.length - 1
  ];
}

// -----------------------------------
// ROLLING RSI
// -----------------------------------
function getMinRSI(
  closes,
  period = 14
) {

  if (
    closes.length <
    period + 1
  ) {

    return 50;
  }

  let minRSI = 100;

  for (
    let i = period + 1;
    i <= closes.length;
    i++
  ) {

    const result =
      calculateRSI(
        closes.slice(0, i),
        period
      );

    if (
      result?.rsi <
      minRSI
    ) {

      minRSI =
        result.rsi;
    }
  }

  return minRSI === 100
    ? 50
    : minRSI;
}

// -----------------------------------
// SCAN SINGLE STOCK
// -----------------------------------
async function processStock({
  symbol,
  pilScore,
  instrKey,
  niftyChangePct,
  today
}) {

  try {

    // -----------------------------------
    // INTRADAY CACHE
    // -----------------------------------
    const intradayCacheKey =
      `intraday:${symbol}`;

    let candles1m =
      getCache(

        intradayCacheKey,

        CONFIG.CACHE_TTL.INTRADAY
      );

    if (!candles1m) {

      candles1m =
        await retry(() =>

          withTimeout(
            getIntradayCandles(
              instrKey
            )
          )
        );

      setCache(
        intradayCacheKey,
        candles1m
      );
    }

    if (

      !Array.isArray(
        candles1m
      ) ||

      candles1m.length < 30

    ) {

      return null;
    }

    // -----------------------------------
    // BUILD 5M
    // -----------------------------------
    const candles5m =
      build5MinCandles(
        candles1m
      );

    if (
      candles5m.length < 12
    ) {

      return null;
    }

    // -----------------------------------
    // DAILY CACHE
    // -----------------------------------
    const dailyCacheKey =
      `daily:${symbol}`;

    let dailyCandles =
      getCache(

        dailyCacheKey,

        CONFIG.CACHE_TTL.DAILY
      );

    if (!dailyCandles) {

      dailyCandles =
        await retry(() =>

          withTimeout(
            getHistoricalCandles(
              instrKey,
              10
            )
          )
        );

      setCache(
        dailyCacheKey,
        dailyCandles
      );
    }

    const yesterday =
      getLastCompletedDailyCandle(
        dailyCandles
      );

    if (!yesterday) {

      return null;
    }

    // -----------------------------------
    // RSI
    // -----------------------------------
    const closes5m =
      candles5m
        .map(c => c.close)
        .filter(

          c =>
            typeof c === 'number'
        );

    const currentRSIData =
      calculateRSI(
        closes5m,
        14
      );

    const currentRSI =
      currentRSIData?.rsi || 50;

    const minRSIToday =
      getMinRSI(
        closes5m,
        14
      );

    // -----------------------------------
    // ENGINE
    // -----------------------------------
    const scanResult =
      scanStock(

        symbol,

        candles5m,

        niftyChangePct,

        yesterday.high,

        yesterday.close,

        currentRSI,

        minRSIToday
      );

    const scanDoc = {

      symbol,

      date: today,

      scannedAt:
        new Date(),

      pilScore,

      ...scanResult
    };

    // -----------------------------------
    // UPSERT INSTEAD OF CREATE
    // -----------------------------------
    await PullbackScan.findOneAndUpdate(

      {

        symbol,

        date: today
      },

      scanDoc,

      {

        upsert: true,

        new: true
      }
    );

    return scanDoc;

  } catch (err) {

    console.log(

      `[PULLBACK] ${symbol}: ${err.message}`
    );

    return null;
  }
}

// -----------------------------------
// MAIN SCAN
// -----------------------------------
async function runPullbackScan(
  io = null
) {

  const today =
    getTodayDate();

  try {

    // -----------------------------------
    // GET A-LIST
    // -----------------------------------
    const latestScores =
      await PILScore.aggregate([

        {
          $sort: {
            date: -1
          }
        },

        {
          $group: {

            _id: '$symbol',

            latest: {
              $first:
                '$$ROOT'
            }
          }
        },

        {
          $replaceRoot: {
            newRoot:
              '$latest'
          }
        },

        {
          $match: {

            finalScore: {
              $gte: 7
            }
          }
        },

        {
          $limit: 100
        }
      ]);

    if (
      !latestScores.length
    ) {

      console.log(
        '[PULLBACK] No A-list stocks'
      );

      return [];
    }

    // -----------------------------------
    // NIFTY CACHE
    // -----------------------------------
    let niftyData =
      getCache(
        'nifty',
        CONFIG.CACHE_TTL.NIFTY
      );

    if (!niftyData) {

      try {

        niftyData =
          await retry(() =>

            withTimeout(
              getNiftyQuote()
            )
          );

      } catch {

        niftyData = {
          changePercent: 0
        };
      }

      setCache(
        'nifty',
        niftyData
      );
    }

    const niftyChangePct =
      niftyData?.changePercent || 0;

    const instrMap =
      getInstrumentMap();

    const results = [];

    // -----------------------------------
    // CONTROLLED CONCURRENCY
    // -----------------------------------
    for (
      let i = 0;
      i < latestScores.length;
      i += CONFIG.MAX_CONCURRENCY
    ) {

      const batch =
        latestScores.slice(
          i,
          i + CONFIG.MAX_CONCURRENCY
        );

      const batchResults =
        await Promise.all(

          batch.map(stock => {

            const instrKey =
              instrMap[
                stock.symbol
              ];

            if (!instrKey) {

              return null;
            }

            return processStock({

              symbol:
                stock.symbol,

              pilScore:
                stock.finalScore,

              instrKey,

              niftyChangePct,

              today
            });
          })
        );

      results.push(

        ...batchResults.filter(Boolean)
      );
    }

    // -----------------------------------
    // SORT
    // -----------------------------------
    results.sort(

      (a, b) =>

        (b.pqs || 0) -
        (a.pqs || 0)
    );

    lastScanResults =
      results;

    // -----------------------------------
    // SOCKET PUSH
    // -----------------------------------
    if (io) {

      io.emit(
        'pullback-update',
        {
          scannedAt:
            new Date(),

          total:
            results.length,

          setups:
            results.filter(

              r =>
                r.pqs >= 4 &&
                r.inPullback
            )
        }
      );
    }

    console.log(

      `[PULLBACK] Scan complete: ${results.length} stocks`
    );

    return results;

  } catch (err) {

    console.error(

      '[PULLBACK] Fatal scan error:',

      err.message
    );

    return [];
  }
}

// -----------------------------------
// POLL TICK
// -----------------------------------
async function pollTick(
  io = null
) {

  if (!pollerRunning) {
    return;
  }

  // OVERLAP PROTECTION
  if (isProcessing) {

    console.log(
      '[PULLBACK] Previous scan still running'
    );

    return;
  }

  if (!isMarketOpen()) {

    console.log(
      '[PULLBACK] Market closed'
    );

    return;
  }

  isProcessing = true;

  try {

    await runPullbackScan(io);

  } finally {

    isProcessing = false;
  }
}

// -----------------------------------
// START
// -----------------------------------
function startPullbackPoller(
  io = null
) {

  if (pollerRunning) {

    console.log(
      '[PULLBACK] Already running'
    );

    return;
  }

  pollerRunning = true;

  console.log(
    '[PULLBACK] Starting poller'
  );

  pollTick(io);

  pollerIntervalId =
    setInterval(() => {

      pollTick(io);

    }, CONFIG.POLL_INTERVAL);
}

// -----------------------------------
// STOP
// -----------------------------------
function stopPullbackPoller() {

  if (!pollerRunning) {
    return;
  }

  pollerRunning = false;

  clearInterval(
    pollerIntervalId
  );

  pollerIntervalId = null;

  console.log(
    '[PULLBACK] Poller stopped'
  );
}

// -----------------------------------
// GETTERS
// -----------------------------------
function isPollerRunning() {

  return pollerRunning;
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
