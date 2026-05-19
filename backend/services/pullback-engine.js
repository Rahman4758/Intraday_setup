'use strict';

/**
 * Professional Pullback Detector — v2
 *
 * Fixes applied vs v1:
 *  1. findImpulseSwingLow  — now returns the LOWEST pivot before sessionHighIdx
 *  2. Session high         — strict > (no double-top drift); keeps earliest occurrence
 *  3. pullbackLow          — sliced to current candle only, not beyond
 *  4. ATR                  — Wilder's smoothed method, not simple average
 *  5. Pivot strength       — 3 bars each side (was 2 — too noisy on 5m)
 *  6. Trend validation     — EMA21 position + slope, and HH/HL swing structure
 *  7. Pullback character   — candle body ratio + declining-range check
 *  8. scoreFibDepth        — removed; quality lives in detectPullbackZone output only
 */

// ─────────────────────────────────────────────────────────────
// CONFIG  (tune per instrument / timeframe here, not inline)
// ─────────────────────────────────────────────────────────────

const CONFIG = {
  MIN_CANDLES:           20,   // minimum history required
  PIVOT_STRENGTH:         3,   // bars each side for swing detection
  EMA_PERIOD:            21,
  EMA_SLOPE_WINDOW:       3,   // bars to measure EMA slope over
  ATR_PERIOD:            14,
  ATR_MULTIPLE_MAX:       4,   // pullback volatility ceiling
  RETRACEMENT_MIN:       20,   // % — below = not a real pullback
  RETRACEMENT_MAX:       75,   // % — above = likely reversal
  FIB_GOLDEN_MIN:        38,   // % — golden zone start
  FIB_GOLDEN_MAX:        62,   // % — golden zone end
  FIB_SHALLOW_MIN:       23,   // % — shallow trend continuation zone
  BODY_RATIO_MAX:        0.6,  // pullback candles should be smallish bodies
  MIN_BASE_FOR_AMPLIFIER: 4,
  RR_MIN:               1.5,
};

// ─────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * True Range for a single candle.
 * Handles the no-previous-candle edge case gracefully.
 */
function _trueRange(current, previous) {
  if (!previous) return current.high - current.low;
  return Math.max(
    current.high - current.low,
    Math.abs(current.high - previous.close),
    Math.abs(current.low  - previous.close),
  );
}

/**
 * Wilder's smoothed ATR.
 * Seeds with a simple average for the first period, then applies
 * exponential smoothing: ATR = (prevATR × (n-1) + TR) / n
 */
function calculateATR(candles, period = CONFIG.ATR_PERIOD) {
  if (!candles || candles.length < period + 1) return 0;

  // seed
  let atr = 0;
  for (let i = 1; i <= period; i++) {
    atr += _trueRange(candles[i], candles[i - 1]);
  }
  atr /= period;

  // smooth forward
  for (let i = period + 1; i < candles.length; i++) {
    atr = (atr * (period - 1) + _trueRange(candles[i], candles[i - 1])) / period;
  }

  return atr;
}

/**
 * Proper EMA using exponential smoothing seeded with SMA.
 * Returns a value-aligned array (null before the seed period completes).
 */
function _calculateEMAArray(candles, period) {
  if (!candles || candles.length < period) return [];
  const k      = 2 / (period + 1);
  const result = new Array(candles.length).fill(null);

  let seed = 0;
  for (let i = 0; i < period; i++) seed += candles[i].close;
  result[period - 1] = seed / period;

  for (let i = period; i < candles.length; i++) {
    result[i] = candles[i].close * k + result[i - 1] * (1 - k);
  }
  return result;
}

/**
 * Returns all confirmed pivot highs and pivot lows using N-bar lookback.
 * Strict comparison — equal neighbours do not qualify.
 */
function _findSwingPoints(candles, strength = CONFIG.PIVOT_STRENGTH) {
  const highs = [];
  const lows  = [];

  for (let i = strength; i < candles.length - strength; i++) {
    let isHigh = true;
    let isLow  = true;

    for (let j = i - strength; j <= i + strength; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low  <= candles[i].low ) isLow  = false;
    }

    if (isHigh) highs.push({ idx: i, value: candles[i].high });
    if (isLow ) lows .push({ idx: i, value: candles[i].low  });
  }

  return { highs, lows };
}

// ─────────────────────────────────────────────────────────────
// TREND VALIDATION
// ─────────────────────────────────────────────────────────────

/**
 * EMA position + slope check.
 * Pass: current close > EMA(period) AND EMA is sloping up.
 */
function _validateTrendByEMA(candles) {
  const ema     = _calculateEMAArray(candles, CONFIG.EMA_PERIOD);
  const lastIdx = candles.length - 1;
  const currEMA = ema[lastIdx];
  if (currEMA == null) return { valid: false, reason: `Insufficient data for EMA${CONFIG.EMA_PERIOD}`, ema: null };

  const price        = candles[lastIdx].close;
  const priceAbove   = price > currEMA;
  const pastEMA      = ema[lastIdx - CONFIG.EMA_SLOPE_WINDOW];
  const slopingUp    = pastEMA != null && currEMA > pastEMA;
  const valid        = priceAbove && slopingUp;

  return {
    valid,
    ema:       parseFloat(currEMA.toFixed(2)),
    priceAbove,
    slopingUp,
    reason: valid
      ? `Price (${price.toFixed(2)}) above EMA${CONFIG.EMA_PERIOD} (${currEMA.toFixed(2)}), slope up`
      : !priceAbove
        ? `Price below EMA${CONFIG.EMA_PERIOD} — no uptrend`
        : `EMA${CONFIG.EMA_PERIOD} slope flat or down`,
  };
}

/**
 * Higher-highs / higher-lows structure check.
 * Requires at least 2 confirmed pivot highs AND 2 pivot lows, both rising.
 */
function _validateTrendByStructure(candles) {
  const { highs, lows } = _findSwingPoints(candles);
  const MIN = 2;

  if (highs.length < MIN || lows.length < MIN) {
    return {
      valid:  false,
      reason: `Not enough swing points (${highs.length} highs, ${lows.length} lows — need ${MIN} each)`,
    };
  }

  const [h0, h1] = highs.slice(-2);
  const [l0, l1] = lows.slice(-2);
  const isHH     = h1.value > h0.value;
  const isHL     = l1.value > l0.value;
  const valid    = isHH && isHL;
  const weak     = !valid && (isHH || isHL);

  return {
    valid,
    weak,
    isHH,
    isHL,
    lastHighs: [h0, h1],
    lastLows:  [l0, l1],
    reason: valid
      ? `HH (${h0.value}→${h1.value}) + HL (${l0.value}→${l1.value})`
      : weak
        ? `Partial: ${isHH ? 'HH ✓' : 'LH ✗'} / ${isHL ? 'HL ✓' : 'LL ✗'}`
        : 'Lower highs + lower lows — downtrend',
  };
}

/**
 * Combined trend gate.
 * STRONG  — both EMA and structure confirm
 * WEAK    — one confirms (trade with reduced size / tighter stop)
 * INVALID — neither confirms, skip entirely
 */
function validateTrend(candles) {
  const ema       = _validateTrendByEMA(candles);
  const structure = _validateTrendByStructure(candles);
  const both      = ema.valid && structure.valid;
  const either    = ema.valid || structure.valid;

  return {
    valid:      either,
    confidence: both ? 'STRONG' : either ? 'WEAK' : 'INVALID',
    ema,
    structure,
    reason: both
      ? `${ema.reason} | ${structure.reason}`
      : either
        ? `Partial trend: EMA ${ema.valid ? '✓' : '✗'} / Structure ${structure.valid ? '✓' : '✗'}`
        : 'No trend confirmation',
  };
}

// ─────────────────────────────────────────────────────────────
// SWING LOW  (fixed)
// ─────────────────────────────────────────────────────────────

/**
 * Returns the LOWEST confirmed pivot low that appears BEFORE sessionHighIdx.
 * v1 bug: loop kept overwriting with the latest pivot, not the lowest.
 */
function findImpulseSwingLow(candles, sessionHighIdx) {
  let swingLow = Infinity;
  const strength = CONFIG.PIVOT_STRENGTH;

  for (let i = strength; i < sessionHighIdx - strength; i++) {
    let isPivotLow = true;
    for (let j = i - strength; j <= i + strength; j++) {
      if (j === i) continue;
      if (candles[j].low <= candles[i].low) { isPivotLow = false; break; }
    }
    if (isPivotLow && candles[i].low < swingLow) {
      swingLow = candles[i].low;
    }
  }

  // fallback to first candle's low if no pivot found
  return swingLow === Infinity ? candles[0].low : swingLow;
}

// ─────────────────────────────────────────────────────────────
// PULLBACK CHARACTER  (new)
// ─────────────────────────────────────────────────────────────

/**
 * Distinguishes a healthy pullback from a reversal:
 *   - Pullback candles should have small bodies (indecision / digestion)
 *   - Average range of pullback candles should be below average impulse range
 *
 * @param {Array}  allCandles
 * @param {number} sessionHighIdx
 * @param {number} currentIdx      - index of the current candle (last confirmed)
 */
function assessPullbackCharacter(allCandles, sessionHighIdx, currentIdx) {
  const pullbackCandles = allCandles.slice(sessionHighIdx, currentIdx + 1);
  if (pullbackCandles.length === 0) return { healthy: false, reason: 'No pullback candles' };

  const avgBodyRatio = pullbackCandles.reduce((sum, c) => {
    const body  = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    return sum + (range > 0 ? body / range : 0);
  }, 0) / pullbackCandles.length;

  // impulse candles: everything before the session high
  const impulseCandles = allCandles.slice(0, sessionHighIdx + 1);
  const avgImpulseRange = impulseCandles.reduce((s, c) => s + (c.high - c.low), 0) / impulseCandles.length;
  const avgPullbackRange = pullbackCandles.reduce((s, c) => s + (c.high - c.low), 0) / pullbackCandles.length;

  const smallBodies      = avgBodyRatio  < CONFIG.BODY_RATIO_MAX;
  const decliningRange   = avgPullbackRange < avgImpulseRange;
  const healthy          = smallBodies && decliningRange;

  return {
    healthy,
    avgBodyRatio:    parseFloat(avgBodyRatio.toFixed(3)),
    avgImpulseRange: parseFloat(avgImpulseRange.toFixed(2)),
    avgPullbackRange:parseFloat(avgPullbackRange.toFixed(2)),
    smallBodies,
    decliningRange,
    reason: healthy
      ? `Small bodies (${(avgBodyRatio * 100).toFixed(0)}%) + declining range — healthy pullback`
      : !smallBodies
        ? `Large candle bodies (${(avgBodyRatio * 100).toFixed(0)}%) — may be impulsive reversal`
        : `Pullback range ≥ impulse range — avoid`,
  };
}

// ─────────────────────────────────────────────────────────────
// MAIN DETECTOR
// ─────────────────────────────────────────────────────────────

/**
 * detectPullbackZone — full analysis of a 5-minute candle array.
 *
 * Returns an object with:
 *   inPullback        {boolean}
 *   reason            {string}
 *   retracementPct    {number}
 *   pullbackQuality   {'IDEAL_FIB'|'SHALLOW'|'DEEP'|'NORMAL'}
 *   trendConfidence   {'STRONG'|'WEAK'|'INVALID'}
 *   character         {object}   pullback health assessment
 *   sessionHigh       {number}
 *   impulseLow        {number}
 *   currentPrice      {number}
 *   pullbackLow       {number}
 *   atr               {number}
 *   atrMultiple       {number}
 *   impulseRange      {number}
 *   trend             {object}   full trend validation detail
 */
function detectPullbackZone(candles5m) {
  // ── Guard ────────────────────────────────────
  if (!candles5m || candles5m.length < CONFIG.MIN_CANDLES) {
    return { inPullback: false, reason: `Need ≥${CONFIG.MIN_CANDLES} candles (got ${candles5m?.length ?? 0})`, retracementPct: 0 };
  }

  // ── Trend gate ───────────────────────────────
  const trend = validateTrend(candles5m);
  if (!trend.valid) {
    return { inPullback: false, reason: `Trend invalid — ${trend.reason}`, retracementPct: 0, trend };
  }

  // ── Session high (earliest occurrence of strict max) ─
  let sessionHigh    = -Infinity;
  let sessionHighIdx = -1;

  for (let i = 0; i < candles5m.length; i++) {
    if (candles5m[i].high > sessionHigh) {       // strict > keeps the earliest high
      sessionHigh    = candles5m[i].high;
      sessionHighIdx = i;
    }
  }

  // Need enough candles before the high to form an impulse
  if (sessionHighIdx < CONFIG.PIVOT_STRENGTH * 2) {
    return { inPullback: false, reason: 'Session high too early — no impulse leg', retracementPct: 0, trend };
  }

  // Need at least a few candles after the high for a pullback to exist
  const currentIdx = candles5m.length - 1;
  if (currentIdx <= sessionHighIdx) {
    return { inPullback: false, reason: 'No candles after session high yet', retracementPct: 0, trend };
  }

  // ── Impulse swing low ────────────────────────
  const impulseLow   = findImpulseSwingLow(candles5m, sessionHighIdx);
  const currentPrice = candles5m[currentIdx].close;
  const impulseRange = sessionHigh - impulseLow;

  if (impulseRange <= 0) {
    return { inPullback: false, reason: 'Invalid impulse range (high ≤ low)', retracementPct: 0, trend };
  }

  // ── Fib retracement ──────────────────────────
  const retracementPct = ((sessionHigh - currentPrice) / impulseRange) * 100;

  // ── ATR (Wilder) ──────────────────────────────
  const atr          = calculateATR(candles5m);
  const pullbackPts  = sessionHigh - currentPrice;
  const atrMultiple  = atr > 0 ? pullbackPts / atr : 0;

  // ── Pullback low (current candle only, not beyond) ──
  const pullbackLow = Math.min(
    ...candles5m.slice(sessionHighIdx, currentIdx + 1).map(c => c.low),
  );

  // ── Depth guards ─────────────────────────────
  if (retracementPct < CONFIG.RETRACEMENT_MIN) {
    return _result(false, `Too shallow (${retracementPct.toFixed(1)}% < ${CONFIG.RETRACEMENT_MIN}%)`,
      { retracementPct, impulseLow, sessionHigh, pullbackLow, atr, atrMultiple, impulseRange, trend });
  }

  if (retracementPct > CONFIG.RETRACEMENT_MAX) {
    return _result(false, `Too deep (${retracementPct.toFixed(1)}% > ${CONFIG.RETRACEMENT_MAX}%) — likely reversal`,
      { retracementPct, impulseLow, sessionHigh, pullbackLow, atr, atrMultiple, impulseRange, trend });
  }

  if (atrMultiple > CONFIG.ATR_MULTIPLE_MAX) {
    return _result(false, `Volatility too high (${atrMultiple.toFixed(1)}× ATR)`,
      { retracementPct, impulseLow, sessionHigh, pullbackLow, atr, atrMultiple, impulseRange, trend });
  }

  // ── Pullback character ────────────────────────
  const character = assessPullbackCharacter(candles5m, sessionHighIdx, currentIdx);

  // ── Fib quality ───────────────────────────────
  let pullbackQuality;
  if      (retracementPct >= CONFIG.FIB_GOLDEN_MIN && retracementPct <= CONFIG.FIB_GOLDEN_MAX) pullbackQuality = 'IDEAL_FIB';
  else if (retracementPct >= CONFIG.FIB_SHALLOW_MIN && retracementPct < CONFIG.FIB_GOLDEN_MIN) pullbackQuality = 'SHALLOW';
  else if (retracementPct > CONFIG.FIB_GOLDEN_MAX)                                             pullbackQuality = 'DEEP';
  else                                                                                          pullbackQuality = 'NORMAL';

  return _result(true, `Valid pullback — ${retracementPct.toFixed(1)}% retracement, ${trend.confidence} trend, ${character.healthy ? 'healthy character' : 'weak character'}`, {
    retracementPct,
    pullbackQuality,
    impulseLow,
    sessionHigh,
    currentPrice,
    pullbackLow,
    atr,
    atrMultiple,
    impulseRange,
    trend,
    trendConfidence: trend.confidence,
    character,
  });
}

/** Shapes the return object consistently, rounds all floats. */
function _result(inPullback, reason, data) {
  const round = v => typeof v === 'number' ? parseFloat(v.toFixed(2)) : v;
  const out = { inPullback, reason };
  for (const [k, v] of Object.entries(data)) {
    out[k] = round(v);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// RISK / REWARD VALIDATOR  (unchanged — was already correct)
// ─────────────────────────────────────────────────────────────

function validateRiskReward(entryPrice, stopLoss, target) {
  const risk   = entryPrice - stopLoss;
  const reward = target - entryPrice;

  if (risk <= 0) return { valid: false, rr: 0, reason: 'Stop loss must be below entry' };

  const rr = parseFloat((reward / risk).toFixed(2));
  return rr >= CONFIG.RR_MIN
    ? { valid: true,  rr, reason: `Good RR (${rr}:1)` }
    : { valid: false, rr, reason: `Poor RR (${rr}:1 — need ≥${CONFIG.RR_MIN})` };
}

// ─────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────

module.exports = {
  detectPullbackZone,
  validateTrend,
  validateRiskReward,
  calculateATR,
  findImpulseSwingLow,
  assessPullbackCharacter,
  CONFIG,
};

// ─────────────────────────────────────────────────────────────
// SMOKE TESTS  —  node pullback_detector.js
// ─────────────────────────────────────────────────────────────

if (require.main === module) {
  function c(close, hi, lo) {
    return { open: close - 0.2, high: hi, low: lo, close };
  }

  // ── Realistic uptrend with three HH/HL legs then a healthy pullback ──
  const good = [
    c(100,101,99), c(101,102,100), c(99,101,98),  c(102,103,100),
    c(100,102,99), c(103,104,101), c(101,103,100), c(104,105,102),
    c(105,106,104), c(107,108,105), c(109,110,107), c(111,112,109),
    c(110,112,109), c(108,110,107), c(107,109,106),
    c(110,111,108), c(112,113,110), c(114,115,112), c(116,117,114), c(118,119,116),
    c(116,118,115), c(114,116,113), c(113,115,112),
    c(116,117,114), c(118,119,116), c(120,121,118), c(122,123,120),
    c(124,125,122), c(126,127,124),
    c(124,126,123), c(122,124,121), c(121,123,120),
  ];

  // ── Downtrend — should be blocked at trend gate ──
  const down = Array.from({ length: 35 }, (_, i) => c(140 - i, 141 - i, 139 - i));

  // ── Uptrend but reversal character (large-body red candles after high) ──
  const reversal = [
    ...good.slice(0, 29),
    c(118, 127, 114),   // big red body
    c(112, 119, 110),   // big red body
    c(108, 113, 106),   // big red body
  ];

  const cases = [
    { label: 'Clean uptrend + healthy pullback',   candles: good },
    { label: 'Downtrend (blocked at trend gate)',  candles: down },
    { label: 'Reversal character after high',      candles: reversal },
  ];

  cases.forEach(({ label, candles }) => {
    const r = detectPullbackZone(candles);
    console.log(`\n── ${label}`);
    console.log(`   inPullback     : ${r.inPullback}`);
    console.log(`   reason         : ${r.reason}`);
    if (r.inPullback) {
      console.log(`   quality        : ${r.pullbackQuality}`);
      console.log(`   retracement    : ${r.retracementPct}%`);
      console.log(`   trendConfidence: ${r.trendConfidence}`);
      console.log(`   character      : ${r.character?.healthy ? 'healthy' : 'weak'} — ${r.character?.reason}`);
      console.log(`   ATR multiple   : ${r.atrMultiple}×`);
    }
  });

  // ── RR check ──
  console.log('\n── RR validation');
  console.log('  2:1 trade  :', validateRiskReward(120, 118, 124));
  console.log('  1:1 trade  :', validateRiskReward(120, 118, 122));
  console.log('  bad stop   :', validateRiskReward(120, 121, 124));
}
