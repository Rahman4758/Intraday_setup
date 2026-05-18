/**
 * ANTIGRAVITY PULLBACK ENGINE
 * Intraday Strong Pullback Capture — 8 Signal PQS Scorer
 * Pure logic only — no DB, no API calls, no side effects
 */

// ═══════════════════════════════════════════════════
// MATH HELPERS
// ═══════════════════════════════════════════════════

function calculateEMA(closes, period) {
  if (closes.length < period) return [];
  const k = 2 / (period + 1);
  const emas = [];
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  emas.push(ema);
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    emas.push(ema);
  }
  return emas;
}

function calculateVWAP(candles) {
  let cumPV = 0, cumVol = 0;
  for (const c of candles) {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumPV += typicalPrice * c.volume;
    cumVol += c.volume;
  }
  return cumVol > 0 ? cumPV / cumVol : 0;
}

function calculateFibLevels(low, high) {
  const range = high - low;
  return {
    fib382: high - range * 0.382,
    fib500: high - range * 0.500,
    fib618: high - range * 0.618
  };
}

function isEMASloping(emas) {
  if (emas.length < 3) return false;
  const last3 = emas.slice(-3);
  return last3[1] > last3[0] && last3[2] > last3[1];
}

/**
 * Detect last N swing lows on 5-min candles
 * A swing low = a candle whose low is lower than the candle before AND after it
 */
function detectSwingLows(candles, count = 3) {
  const lows = [];
  for (let i = 1; i < candles.length - 1; i++) {
    if (candles[i].low < candles[i - 1].low && candles[i].low < candles[i + 1].low) {
      lows.push(candles[i].low);
      if (lows.length >= count + 2) break; // collect a few extra
    }
  }
  return lows.slice(-count); // return most recent N
}

/**
 * Find session high from candles so far
 */
function getSessionHigh(candles) {
  return Math.max(...candles.map(c => c.high));
}

/**
 * Get average volume for the session candles
 */
function getAvgVolume(candles) {
  if (!candles.length) return 0;
  return candles.reduce((sum, c) => sum + c.volume, 0) / candles.length;
}

/**
 * Identify which candles are part of the current pullback
 * (consecutive falling candles from the session high, working backwards)
 */
function getPullbackCandles(candles, sessionHigh) {
  const highIdx = candles.findIndex(c => c.high === sessionHigh);
  if (highIdx < 0) return candles.slice(-3); // fallback
  const afterHigh = candles.slice(highIdx);
  const pullbackCandleList = [];
  for (const c of afterHigh) {
    // Collect candles that are falling or neutral
    if (c.close <= c.open || c.high <= sessionHigh) {
      pullbackCandleList.push(c);
    } else {
      break; // price recovered above session high — pullback over
    }
  }
  return pullbackCandleList.length > 0 ? pullbackCandleList : afterHigh.slice(-3);
}

// ═══════════════════════════════════════════════════
// PREREQUISITE CHECK — Trend must exist before scoring
// ═══════════════════════════════════════════════════

/**
 * Checks if an intraday uptrend exists before allowing pullback scoring.
 * Returns { intact: bool, checks: {}, reason: string }
 */
/**
 * @param {Object[]} candles5m  — 5-min candles for today (session)
 * @param {number}   vwap       — calculated VWAP for the session
 * @param {number}   niftyChangePercent — Nifty % change today
 * @param {number}   peakRSI    — highest RSI seen in today's session
 * @param {number}   prevDayClose — yesterday's daily closing price (from historical API)
 */
function checkPrerequisites(candles5m, vwap, niftyChangePercent, peakRSI, prevDayClose) {
  const currentPrice = candles5m[candles5m.length - 1]?.close || 0;

  // Today's opening price = first 5-min candle's open
  const todayOpen = candles5m[0]?.open || 0;

  // Open above PrevClose check:
  // Gap-down stock (open < prevClose) = weakness from the start → skip
  // If prevDayClose not available (0), we skip this check (default true)
  const openAbovePrevClose = prevDayClose > 0
    ? todayOpen >= prevDayClose * 0.998 // allow 0.2% tolerance for flat opens
    : true;

  // Detect HH-HL structure on 5-min (need at least 6 candles = 30 mins of data)
  let hhhlCount = 0;
  if (candles5m.length >= 6) {
    const highs = candles5m.map(c => c.high);
    for (let i = 2; i < highs.length; i++) {
      if (highs[i] > highs[i - 2]) hhhlCount++;
    }
  }

  // EMA20 slope: last 3 EMA20 values must be rising
  const closes = candles5m.map(c => c.close);
  const ema20s = calculateEMA(closes, 20);
  const ema20Sloping = isEMASloping(ema20s);

  const checks = {
    aboveVWAP: currentPrice > vwap,
    ema20SlopingUp: ema20Sloping,
    hhhlVisible: hhhlCount >= 2,
    rsiWas55: peakRSI >= 55,
    openAbovePrevClose,
    niftyAligned: niftyChangePercent > -0.5
  };

  const passCount = Object.values(checks).filter(Boolean).length;
  // Need at least 4/6 checks — if open check is unavailable, lower threshold to 3/5
  const threshold = prevDayClose > 0 ? 4 : 3;
  const intact = passCount >= threshold;

  return {
    intact,
    passCount,
    checks,
    reason: intact
      ? `Trend intact (${passCount}/6 checks passed)`
      : `Trend NOT intact (${passCount}/6 checks) — no pullback entry`
  };
}

// ═══════════════════════════════════════════════════
// PULLBACK ZONE DETECTOR
// ═══════════════════════════════════════════════════

/**
 * Determines if price is currently in a pullback from session high.
 * Returns { inPullback, pullbackDepthPct, pullbackLow, sessionHigh }
 */
function detectPullbackZone(candles5m) {
  const sessionHigh = getSessionHigh(candles5m);
  const currentPrice = candles5m[candles5m.length - 1]?.close || 0;
  const pullbackDepthPct = sessionHigh > 0
    ? ((sessionHigh - currentPrice) / sessionHigh) * 100
    : 0;

  // A valid pullback is at least 0.3% but not more than 8% from the session high
  const inPullback = pullbackDepthPct >= 0.3 && pullbackDepthPct <= 8.0;

  // Find lowest point after session high
  const highIdx = candles5m.findIndex(c => c.high === sessionHigh);
  const afterHigh = candles5m.slice(Math.max(highIdx, 0));
  const pullbackLow = afterHigh.length > 0
    ? Math.min(...afterHigh.map(c => c.low))
    : currentPrice;

  return { inPullback, pullbackDepthPct, pullbackLow, sessionHigh };
}

// ═══════════════════════════════════════════════════
// 8 SIGNAL SCORERS
// ═══════════════════════════════════════════════════

/** S1: Volume Behavior — volume should DRY UP on pullback candles */
function scoreVolumeBehavior(pullbackCandles, sessionAvgVol) {
  if (!pullbackCandles || pullbackCandles.length < 2) {
    return { score: 0, flag: 'INSUFFICIENT_DATA', reason: 'Need ≥2 pullback candles' };
  }

  const vols = pullbackCandles.map(c => c.volume);

  // Check for high-volume danger candle (> 150% of avg)
  const hasHighVolDanger = vols.some(v => v > sessionAvgVol * 1.5);
  if (hasHighVolDanger) {
    return { score: 0, flag: 'HIGH_VOL_DANGER', reason: 'High-vol pullback candle — aggressive selling detected' };
  }

  // Check if each successive candle has lower volume (drying up)
  let dryingUp = true;
  for (let i = 1; i < vols.length; i++) {
    if (vols[i] >= vols[i - 1]) { dryingUp = false; break; }
  }

  if (dryingUp && vols.length >= 2) {
    return { score: 2, flag: 'VOL_DRY', reason: 'Volume drying up on each pullback candle — sellers exhausting' };
  }

  // Check if volume is below session average on pullback candles
  const avgPullbackVol = vols.reduce((a, b) => a + b, 0) / vols.length;
  if (avgPullbackVol < sessionAvgVol) {
    return { score: 1, flag: 'VOL_LOW', reason: 'Pullback volume below session average — no aggressive selling' };
  }

  return { score: 0, flag: 'VOL_NEUTRAL', reason: 'Volume not confirming pullback quality' };
}

/** S2: OI Behavior — OI should BUILD during the pullback (institutions buying dip) */
function scoreOIBehavior(pullbackCandles) {
  if (!pullbackCandles || pullbackCandles.length < 2) {
    return { score: 1, flag: 'OI_FLAT', reason: 'OI data insufficient — neutral' };
  }

  const ois = pullbackCandles.map(c => c.oi || 0);
  const hasData = ois.some(v => v > 0);
  if (!hasData) {
    return { score: 1, flag: 'OI_FLAT', reason: 'OI data not available — neutral' };
  }

  const firstOI = ois[0];
  const lastOI = ois[ois.length - 1];
  const oiChange = firstOI > 0 ? ((lastOI - firstOI) / firstOI) * 100 : 0;

  if (oiChange > 0.5) {
    return { score: 2, flag: 'OI_BUILD', reason: `OI building +${oiChange.toFixed(1)}% during pullback — institutional accumulation` };
  }
  if (oiChange >= -0.5) {
    return { score: 1, flag: 'OI_FLAT', reason: 'OI stable during pullback — neutral' };
  }

  return { score: 0, flag: 'OI_FALLING', reason: `OI falling ${oiChange.toFixed(1)}% — longs exiting, potential reversal` };
}

/** S3: RSI Floor — RSI should dip to 38–50 and bounce (not break below 38) */
function scoreRSIFloor(currentRSI, minRSIInSession) {
  if (currentRSI < 38) {
    return { score: 0, flag: 'RSI_BROKEN', reason: `RSI ${currentRSI.toFixed(1)} broke below 38 — trend structure damaged` };
  }

  // RSI dipped to floor zone and is now higher (bouncing)
  if (minRSIInSession >= 38 && minRSIInSession <= 50 && currentRSI > minRSIInSession) {
    return { score: 2, flag: 'RSI_FLOOR_BOUNCE', reason: `RSI bounced from ${minRSIInSession.toFixed(1)} floor zone (38–50) — momentum returning` };
  }

  // RSI stayed above 50 — very strong trend, never even dipped to floor
  if (currentRSI >= 50) {
    return { score: 1, flag: 'RSI_HOLD', reason: `RSI ${currentRSI.toFixed(1)} holding above 50 — trend very strong, no floor touch needed` };
  }

  // RSI in pullback zone but not yet bouncing
  if (currentRSI >= 38 && currentRSI < 50) {
    return { score: 1, flag: 'RSI_IN_ZONE', reason: `RSI ${currentRSI.toFixed(1)} in pullback zone — waiting for bounce confirmation` };
  }

  return { score: 0, flag: 'RSI_WEAK', reason: `RSI ${currentRSI.toFixed(1)} out of zone` };
}

/** S4: Key Level Confluence — price near VWAP, EMA, or key level */
function scoreKeyLevel(currentPrice, vwap, ema20, prevDayHigh) {
  const TOLERANCE = 0.003; // 0.3% proximity tolerance
  const levels = [];

  if (vwap > 0 && Math.abs(currentPrice - vwap) / vwap <= TOLERANCE) {
    levels.push('VWAP');
  }
  if (ema20 > 0 && Math.abs(currentPrice - ema20) / ema20 <= TOLERANCE) {
    levels.push('EMA20');
  }
  if (prevDayHigh > 0 && Math.abs(currentPrice - prevDayHigh) / prevDayHigh <= TOLERANCE) {
    levels.push('PDH');
  }

  if (levels.length >= 2) {
    return { score: 2, flag: 'CONFLUENCE', reason: `Price at confluence zone: ${levels.join(' + ')} — high-probability support` };
  }
  if (levels.length === 1) {
    return { score: 1, flag: 'SINGLE_LEVEL', reason: `Price at ${levels[0]} support level` };
  }

  return { score: 0, flag: 'NO_LEVEL', reason: 'Price not near any key support level' };
}

/** S5: Fibonacci Depth — pullback at 38.2%, 50%, or 61.8% retracement */
function scoreFibDepth(pullbackDepthPct) {
  // Fib 50–61.8% = ideal zone
  if (pullbackDepthPct >= 45 && pullbackDepthPct <= 65) {
    return { score: 2, flag: 'FIB_50_61', reason: `Pullback depth ${pullbackDepthPct.toFixed(1)}% — at 50–61.8% Fib zone (ideal entry)` };
  }
  // Fib 38.2% zone
  if (pullbackDepthPct >= 33 && pullbackDepthPct < 45) {
    return { score: 1, flag: 'FIB_38', reason: `Pullback depth ${pullbackDepthPct.toFixed(1)}% — at 38.2% Fib (shallow but valid)` };
  }
  // Too deep — beyond 61.8%
  if (pullbackDepthPct > 65) {
    return { score: 0, flag: 'FIB_DEEP', reason: `Pullback depth ${pullbackDepthPct.toFixed(1)}% — beyond 61.8%, trend may be reversing` };
  }

  return { score: 0, flag: 'FIB_SHALLOW', reason: `Pullback depth ${pullbackDepthPct.toFixed(1)}% — too shallow, not yet a pullback` };
}

/** S6: Bounce Candle — last candle must be green with volume */
function scoreBounceCandle(candles5m, sessionAvgVol) {
  if (!candles5m || candles5m.length < 2) {
    return { score: 0, flag: 'NO_DATA', reason: 'Insufficient candles' };
  }

  const last = candles5m[candles5m.length - 1];
  const isGreen = last.close > last.open;

  if (!isGreen) {
    return { score: 0, flag: 'NO_BOUNCE', reason: 'Last candle is red — still in pullback, wait for bounce' };
  }

  const bodySize = Math.abs(last.close - last.open);
  const range = last.high - last.low;
  const bodyRatio = range > 0 ? bodySize / range : 0;

  // Strong bounce = green candle + volume >= avg + decent body
  if (last.volume >= sessionAvgVol && bodyRatio >= 0.4) {
    return { score: 2, flag: 'STRONG_BOUNCE', reason: `Strong green bounce candle with volume ${(last.volume / sessionAvgVol).toFixed(1)}× avg — buyers confirmed` };
  }

  // Weak bounce = green candle but low volume
  return { score: 1, flag: 'WEAK_BOUNCE', reason: 'Weak green candle at support — low volume bounce, wait for confirmation' };
}

/** S7: Higher Low Structure — new pullback low must be above last swing low */
function scoreHLStructure(candles5m, pullbackLow) {
  const swingLows = detectSwingLows(candles5m, 3);

  if (swingLows.length < 2) {
    return { score: 1, flag: 'HL_UNKNOWN', reason: 'Not enough swing lows to confirm HL structure' };
  }

  const lastConfirmedSwingLow = swingLows[swingLows.length - 2]; // second to last

  if (pullbackLow > lastConfirmedSwingLow) {
    return {
      score: 2,
      flag: 'HL_INTACT',
      reason: `Higher low intact — current pullback low (${pullbackLow.toFixed(1)}) above last swing low (${lastConfirmedSwingLow.toFixed(1)})`
    };
  }

  return {
    score: 0,
    flag: 'HL_BROKEN',
    reason: `Structure broken — pullback low (${pullbackLow.toFixed(1)}) broke last swing low (${lastConfirmedSwingLow.toFixed(1)})`
  };
}

/** S8: EMA Touch — price touching or bouncing from rising 20 EMA */
function scoreEMATouch(currentPrice, ema20, ema9) {
  const TOLERANCE = 0.004; // 0.4%

  const nearEMA20 = ema20 > 0 && Math.abs(currentPrice - ema20) / ema20 <= TOLERANCE;
  const nearEMA9 = ema9 > 0 && Math.abs(currentPrice - ema9) / ema9 <= TOLERANCE;

  if (nearEMA20 || nearEMA9) {
    const which = nearEMA20 ? '20 EMA' : '9 EMA';
    return { score: 1, flag: 'EMA_TOUCH', reason: `Price touching rising ${which} — dynamic support active` };
  }

  return { score: 0, flag: 'NO_EMA_TOUCH', reason: 'Price not at EMA support zone' };
}

/** BONUS: RSI Divergence — price lower low but RSI higher low (RARE +2) */
function scoreRSIDivergence(prevPullbackRSI, currentRSI, prevPullbackLow, currentPullbackLow) {
  if (!prevPullbackRSI || !prevPullbackLow) {
    return { score: 0, flag: 'NO_DIVERGE', reason: 'No previous pullback data for divergence check' };
  }

  const priceLowerLow = currentPullbackLow < prevPullbackLow;
  const rsiHigherLow = currentRSI > prevPullbackRSI;

  if (priceLowerLow && rsiHigherLow) {
    return { score: 2, flag: 'RSI_DIVERGE', reason: `🔥 Bullish divergence: Price made lower low but RSI is higher — RARE, powerful signal` };
  }

  return { score: 0, flag: 'NO_DIVERGE', reason: 'No RSI divergence detected' };
}

// ═══════════════════════════════════════════════════
// PQS AGGREGATOR
// ═══════════════════════════════════════════════════

function computePQS(signals) {
  return Object.values(signals).reduce((sum, s) => sum + (s.score || 0), 0);
}

function interpretPQSBand(pqs) {
  if (pqs <= 3) return {
    grade: 'WEAK', action: 'Skip — risk too high', positionFactor: 0,
    color: '#ff4757', band: 'WEAK'
  };
  if (pqs <= 6) return {
    grade: 'MODERATE', action: 'Enter with caution. Small size. Tight SL.', positionFactor: 0.5,
    color: '#ffa502', band: 'MODERATE'
  };
  if (pqs <= 9) return {
    grade: 'STRONG', action: 'High confidence pullback. Standard entry.', positionFactor: 1.0,
    color: '#1dd1a1', band: 'STRONG'
  };
  if (pqs <= 12) return {
    grade: 'VERY_STRONG', action: 'All signals firing. Increase size.', positionFactor: 1.25,
    color: '#00f5d4', band: 'VERY_STRONG'
  };
  return {
    grade: 'EXCEPTIONAL', action: 'Rare. Maximum conviction. Biggest allowed size.', positionFactor: 1.5,
    color: '#ff6348', band: 'EXCEPTIONAL'
  };
}

/**
 * Calculate entry zone for the pullback trade
 * Entry: 1 tick above bounce candle high
 * SL: Below bounce candle low or pullback low
 * T1: Session high (prior swing high)
 * T2: Entry + (Entry - SL) × 2 (measured move)
 */
function calcEntryZone(candles5m, pullbackLow, sessionHigh) {
  const last = candles5m[candles5m.length - 1];
  if (!last) return { entryPrice: 0, stopLoss: 0, target1: 0, target2: 0 };

  const tick = last.close * 0.001; // 0.1% as tick approximation
  const entryPrice = parseFloat((last.high + tick).toFixed(2));
  const stopLoss = parseFloat((Math.min(last.low, pullbackLow) * 0.999).toFixed(2));
  const target1 = parseFloat(sessionHigh.toFixed(2)); // Previous swing high
  const riskPoints = entryPrice - stopLoss;
  const target2 = parseFloat((entryPrice + riskPoints * 2).toFixed(2));

  return { entryPrice, stopLoss, target1, target2, riskPoints };
}

// ═══════════════════════════════════════════════════
// MAIN SCAN FUNCTION
// ═══════════════════════════════════════════════════

/**
 * Scan a single stock for pullback setup
 * @param {string}   symbol
 * @param {Object[]} candles5m      — 5-min candles (chronological, today's session)
 * @param {number}   niftyChangePct — Nifty % change today
 * @param {number}   prevDayHigh    — Yesterday's high (for S4 key level check)
 * @param {number}   prevDayClose   — Yesterday's close (for open-above-prevClose prereq)
 * @param {number}   currentRSI     — Latest 5-min RSI
 * @param {number}   minRSIToday    — Lowest RSI seen in today's session
 * @returns {Object} Full scan result
 */
function scanStock(symbol, candles5m, niftyChangePct, prevDayHigh, prevDayClose, currentRSI, minRSIToday) {
  if (!candles5m || candles5m.length < 12) {
    return {
      symbol, pqs: 0, grade: 'INSUFFICIENT_DATA',
      reason: `Only ${candles5m?.length || 0} candles — need ≥12`, trendIntact: false
    };
  }

  const closes = candles5m.map(c => c.close);
  const vwap = calculateVWAP(candles5m);
  const sessionAvgVol = getAvgVolume(candles5m);
  const { inPullback, pullbackDepthPct, pullbackLow, sessionHigh } = detectPullbackZone(candles5m);

  // EMA calculations
  const ema20List = calculateEMA(closes, 20);
  const ema9List = calculateEMA(closes, 9);
  const ema20 = ema20List[ema20List.length - 1] || 0;
  const ema9 = ema9List[ema9List.length - 1] || 0;

  // STEP 1: Prerequisite check (trend must exist)
  // peakRSI = highest RSI value seen in the session (not just current)
  const peakRSI = Math.max(currentRSI, minRSIToday || 0);
  const prereq = checkPrerequisites(candles5m, vwap, niftyChangePct, peakRSI, prevDayClose);

  if (!prereq.intact) {
    return {
      symbol, pqs: 0, grade: 'NO_TREND', band: 'WEAK', color: '#4a5568',
      reason: prereq.reason, trendIntact: false,
      prereqChecks: prereq.checks,
      vwap, ema20, ema9, sessionHigh, currentPrice: closes[closes.length - 1]
    };
  }

  // STEP 2: Is there an active pullback?
  if (!inPullback) {
    const currentPrice = closes[closes.length - 1];
    const depthMsg = pullbackDepthPct < 0.3
      ? `Price only ${pullbackDepthPct.toFixed(2)}% from high — no pullback yet`
      : `Price ${pullbackDepthPct.toFixed(2)}% from high — pullback too deep`;

    return {
      symbol, pqs: 0, grade: 'NO_PULLBACK', band: 'WEAK', color: '#4a5568',
      reason: depthMsg, trendIntact: true,
      prereqChecks: prereq.checks,
      currentPrice, vwap, ema20, ema9, sessionHigh, pullbackDepthPct
    };
  }

  // STEP 3: Score all 8 signals
  const pullbackCandles = getPullbackCandles(candles5m, sessionHigh);

  const signals = {
    S1_vol: scoreVolumeBehavior(pullbackCandles, sessionAvgVol),
    S2_oi: scoreOIBehavior(pullbackCandles),
    S3_rsi: scoreRSIFloor(currentRSI, minRSIToday || currentRSI),
    S4_level: scoreKeyLevel(closes[closes.length - 1], vwap, ema20, prevDayHigh),
    S5_fib: scoreFibDepth(pullbackDepthPct),
    S6_bounce: scoreBounceCandle(candles5m, sessionAvgVol),
    S7_hl: scoreHLStructure(candles5m, pullbackLow),
    S8_ema: scoreEMATouch(closes[closes.length - 1], ema20, ema9)
  };

  // STEP 4: Compute PQS
  const pqs = computePQS(signals);
  const interpretation = interpretPQSBand(pqs);
  const entryZone = calcEntryZone(candles5m, pullbackLow, sessionHigh);

  const currentPrice = closes[closes.length - 1];

  return {
    symbol,
    pqs,
    grade: interpretation.grade,
    band: interpretation.band,
    color: interpretation.color,
    action: interpretation.action,
    positionFactor: interpretation.positionFactor,
    trendIntact: true,
    inPullback: true,
    reason: `PQS ${pqs} — ${interpretation.grade}`,
    prereqChecks: prereq.checks,
    signals,
    entryZone,
    currentPrice,
    vwap: parseFloat(vwap.toFixed(2)),
    ema20: parseFloat(ema20.toFixed(2)),
    ema9: parseFloat(ema9.toFixed(2)),
    sessionHigh: parseFloat(sessionHigh.toFixed(2)),
    pullbackLow: parseFloat(pullbackLow.toFixed(2)),
    pullbackDepthPct: parseFloat(pullbackDepthPct.toFixed(2)),
    currentRSI: parseFloat(currentRSI.toFixed(1)),
    sessionAvgVol: Math.round(sessionAvgVol)
  };
}

module.exports = {
  scanStock,
  computePQS,
  interpretPQSBand,
  checkPrerequisites,
  detectPullbackZone,
  calculateVWAP,
  calculateEMA,
  calculateFibLevels,
  // individual scorers (for testing)
  scoreVolumeBehavior,
  scoreOIBehavior,
  scoreRSIFloor,
  scoreKeyLevel,
  scoreFibDepth,
  scoreBounceCandle,
  scoreHLStructure,
  scoreEMATouch,
  scoreRSIDivergence
};
