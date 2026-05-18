const PILScore = require('../models/PILScore');
const IntradayState = require('../models/IntradayState');
const TradeJournal = require('../models/TradeJournal');
const { getMarketQuotes, getOptionChain, getIntradayCandles, getNiftyQuote } = require('./upstox-data');
const { getInstrumentMap } = require('../utils/instrument-resolver');
const { calculateRSI } = require('./rsi-calculator');

let intervalId = null;
let isRunning = false;

// Helpers to build 5-min candles from 1-min candles
function build5MinCandles(oneMinCandles) {
  const fiveMinCandles = [];
  let current5Min = null;

  for (const c of oneMinCandles) {
    // timestamp looks like 2024-03-01T09:15:00+05:30
    const timeStr = c.timestamp.split('T')[1].substring(0, 5); // "09:15"
    const mins = parseInt(timeStr.split(':')[1]);
    const blockStartMins = Math.floor(mins / 5) * 5;
    const blockKey = `${timeStr.split(':')[0]}:${blockStartMins.toString().padStart(2, '0')}`;

    if (!current5Min || current5Min.blockKey !== blockKey) {
      if (current5Min) fiveMinCandles.push(current5Min);
      current5Min = {
        blockKey,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        oi: c.oi,
        isGreen: c.close > c.open,
        isRed: c.close < c.open
      };
    } else {
      current5Min.high = Math.max(current5Min.high, c.high);
      current5Min.low = Math.min(current5Min.low, c.low);
      current5Min.close = c.close;
      current5Min.volume += c.volume;
      current5Min.oi = c.oi; // Latest OI
      current5Min.isGreen = current5Min.close > current5Min.open;
      current5Min.isRed = current5Min.close < current5Min.open;
    }
  }
  if (current5Min) fiveMinCandles.push(current5Min);
  return fiveMinCandles;
}

// Analyze Option Chain for Live S/R
function getLiveLevels(chain, currentPrice) {
  if (!chain || !chain.strikes) return { support: 0, resistance: 0 };
  const supportStrikesAll = chain.strikes.filter(s => s.strikePrice < currentPrice);
  const maxPutStrikeObj = supportStrikesAll.length > 0 ? supportStrikesAll.reduce((prev, curr) => (curr.putOI > prev.putOI) ? curr : prev) : null;
  const majorSupport = maxPutStrikeObj ? maxPutStrikeObj.strikePrice : 0;

  const resistStrikesAll = chain.strikes.filter(s => s.strikePrice > currentPrice);
  const maxCallStrikeObj = resistStrikesAll.length > 0 ? resistStrikesAll.reduce((prev, curr) => (curr.callOI > prev.callOI) ? curr : prev) : null;
  const majorResistance = maxCallStrikeObj ? maxCallStrikeObj.strikePrice : 0;

  return { support: majorSupport, resistance: majorResistance };
}

async function processTick() {
  if (!isRunning) return;
  const today = new Date().toISOString().split('T')[0];

  try {
    // 1. Get all A-list stocks from EOD (Score >= 7)
    // For testing, we use the most recent EOD scan if today's is not present.
    let targetStocks = await PILScore.find({ finalScore: { $gte: 7 } }).sort({ date: -1 }).limit(20);
    // Group by unique symbols to get the latest score for each
    const uniqueSymbols = new Set();
    const aList = [];
    for (const ts of targetStocks) {
      if (!uniqueSymbols.has(ts.symbol)) {
        uniqueSymbols.add(ts.symbol);
        aList.push(ts.symbol);
      }
    }

    if (aList.length === 0) return;

    // Get DB States
    const states = await IntradayState.find({ date: today });
    const stateMap = {};
    states.forEach(s => stateMap[s.symbol] = s);

    // Instrument Keys
    const map = getInstrumentMap();
    const keys = aList.map(s => map[s]).filter(Boolean);

    // 2. Fetch Live Quotes (1 bulk request)
    const quotes = await getMarketQuotes(keys);

    // 3. Process each stock
    for (const symbol of aList) {
      const key = map[symbol];
      if (!key) continue;

      let state = stateMap[symbol];
      if (!state) {
        state = new IntradayState({ symbol, date: today, status: 'WAITING_COMPRESSION' });
        await state.save();
        stateMap[symbol] = state;
      }

      if (['EXITED', 'ABORTED'].includes(state.status)) continue;

      const quote = quotes[key];
      if (!quote) continue;

      state.cmp = quote.ltp;
      state.liveOI = quote.oi;
      state.liveVolume = quote.volume;

      // 4. Fetch live options & candles for active analysis
      const optChain = await getOptionChain(key, ''); // closest expiry
      const levels = getLiveLevels(optChain, state.cmp);
      state.liveSupport = levels.support;
      state.liveResistance = levels.resistance;

      const candles1m = await getIntradayCandles(key);
      const candles5m = build5MinCandles(candles1m);
      const closes5m = candles5m.map(c => c.close);
      
      let liveRSI = 0;
      if (closes5m.length >= 15) {
        const rsiData = calculateRSI(closes5m, 14);
        liveRSI = rsiData ? rsiData.rsi : 0;
        state.liveRSI = liveRSI;
      }

      // Nifty abort check
      const nifty = await getNiftyQuote();
      if (nifty && nifty.changePercent < -0.5 && !['ACTIVE'].includes(state.status)) {
         state.status = 'ABORTED';
         state.invalidationReason = 'NIFTY_CRASH';
         await state.save();
         continue;
      }

      // State Machine Logic
      if (state.status === 'WAITING_COMPRESSION') {
        if (candles5m.length >= 6) { // 30 minutes (6 x 5m candles)
          const first30m = candles5m.slice(0, 6);
          const maxHigh = Math.max(...first30m.map(c => c.high));
          const minLow = Math.min(...first30m.map(c => c.low));
          const rangePct = ((maxHigh - minLow) / minLow) * 100;

          state.dayHigh = maxHigh;
          state.dayLow = minLow;
          state.compressionRangePct = rangePct;

          if (rangePct < 1.5 && liveRSI > 50) {
            state.status = 'COMPRESSION_FORMED';
          } else {
            state.status = 'ABORTED';
            state.invalidationReason = rangePct >= 1.5 ? 'RANGE_TOO_WIDE' : 'RSI_TOO_LOW';
          }
        }
      } 
      else if (state.status === 'COMPRESSION_FORMED') {
        // Look for 0.3% - 0.7% pullback
        const pullbackPct = ((state.dayHigh - state.cmp) / state.dayHigh) * 100;
        if (liveRSI < 55) {
          state.status = 'ABORTED';
          state.invalidationReason = 'RSI_BROKE_55';
        } else if (pullbackPct >= 0.3 && pullbackPct <= 0.7) {
           state.status = 'CORRECTING';
           state.pullbackLow = state.cmp;
        } else if (pullbackPct > 1.0) {
           state.status = 'ABORTED';
           state.invalidationReason = 'DEEP_PULLBACK';
        }
      }
      else if (state.status === 'CORRECTING') {
        if (liveRSI < 55) {
          state.status = 'ABORTED';
          state.invalidationReason = 'RSI_BROKE_55';
        } else {
          // Track lowest point
          if (state.cmp < state.pullbackLow) state.pullbackLow = state.cmp;
          
          // Trigger T4: Bounce confirmation
          if (state.cmp > state.dayHigh && liveRSI > 60) {
            state.status = 'ACTIVE';
            state.entryPrice = state.cmp;
            state.stopLoss = state.pullbackLow * 0.999; // slightly below pullback low
            state.target1 = state.entryPrice * 1.01; // +1%
            state.target2 = state.entryPrice * 1.02; // +2%
            state.tradeStartTime = new Date();

            // Auto Paper Trading Position Sizing: 1 Lakh Portfolio, 1% Risk = 1000 Rs Risk
            const riskAmount = 1000;
            const riskPerShare = state.entryPrice - state.stopLoss;
            state.quantity = Math.floor(riskAmount / riskPerShare);
            if (state.quantity < 1) state.quantity = 1;
          }
        }
      }
      else if (state.status === 'ACTIVE') {
        state.currentPnL = ((state.cmp - state.entryPrice) / state.entryPrice) * 100;
        state.currentPnLAmount = (state.cmp - state.entryPrice) * state.quantity;

        // Trailing Stop & Targets
        if (state.cmp >= state.target1 && state.stopLoss < state.entryPrice) {
          state.stopLoss = state.entryPrice; // SL to breakeven
        }

        let isExited = false;
        if (state.cmp >= state.target2) {
          state.status = 'EXITED';
          state.invalidationReason = 'TARGET_HIT';
          isExited = true;
        } else if (state.cmp <= state.stopLoss) {
          state.status = 'EXITED';
          state.invalidationReason = 'STOP_LOSS_HIT';
          isExited = true;
        } else if (liveRSI < 55) {
          state.status = 'EXITED';
          state.invalidationReason = 'MOMENTUM_LOST_RSI_55';
          isExited = true;
        } else if (state.liveResistance && state.cmp >= state.liveResistance) {
          state.status = 'EXITED';
          state.invalidationReason = 'HIT_LIVE_RESISTANCE';
          isExited = true;
        }

        if (isExited) {
          state.tradeEndTime = new Date();
          
          // Log to TradeJournal
          const journalEntry = new TradeJournal({
            symbol: state.symbol,
            date: state.date,
            quantity: state.quantity,
            entryPrice: state.entryPrice,
            initialStopLoss: state.pullbackLow * 0.999,
            entryTime: state.tradeStartTime,
            exitPrice: state.cmp,
            exitTime: state.tradeEndTime,
            exitReason: state.invalidationReason,
            pnlAmount: state.currentPnLAmount,
            pnlPercent: state.currentPnL,
            compressionRangePct: state.compressionRangePct,
            liveRSIAtEntry: liveRSI // approximate
          });
          await journalEntry.save();
        }
      }

      state.lastUpdated = new Date();
      await state.save();
    }
  } catch (err) {
    console.error('[CSMC] Tick error:', err);
  }
}

function startIntradayEngine() {
  if (isRunning) return;
  isRunning = true;
  console.log('[CSMC] Starting 15-sec Intraday Setup Detection...');
  processTick(); // initial run
  intervalId = setInterval(processTick, 15000);
}

function stopIntradayEngine() {
  if (!isRunning) return;
  isRunning = false;
  clearInterval(intervalId);
  console.log('[CSMC] Stopped Intraday Engine.');
}

module.exports = { startIntradayEngine, stopIntradayEngine };
