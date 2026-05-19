'use strict';

/**
 * Amplifier Engine — Time & Context Multipliers (v2)
 *
 * Changes from v1:
 *  - Direction-aware: all amplifiers respect context.direction ('long' | 'short')
 *  - Post-results decay: exponential decay across days 2-5 instead of flat +1
 *  - FII streak: scaled bonus (not binary), capped at +2
 *  - Sector outperformance: magnitude-weighted by % delta, not a binary flag
 *  - Monday Open: only fires when global cues are confirmed positive/negative
 *  - F&O Expiry: volatility warning (dampens longs, slight boost for short scalps)
 *  - India VIX dampener: reduces final score under elevated volatility
 *  - Hard score cap at 10 so downstream position sizers work correctly
 *  - IST-pinned Monday check (no more UTC server false positives)
 */

const CONFIG = {
  MIN_BASE_SCORE:        4,
  MAX_FINAL_SCORE:       10,

  // Post-results: bonus by day number (index = day, 0 = no bonus)
  POST_RESULTS_DECAY:    [0, 0, 1.0, 0.7, 0.5, 0.25],

  // FII buy/sell streak
  FII_STREAK_THRESHOLD:  3,
  FII_STREAK_BASE_BONUS: 1.0,
  FII_STREAK_INCREMENT:  0.15,   // per day beyond threshold
  FII_STREAK_MAX_BONUS:  2.0,

  // Sector outperformance thresholds (in %) → bonus points
  SECTOR_OUTPERF_TIERS:  [
    { minPct: 2.0, bonus: 1.00 },
    { minPct: 1.0, bonus: 0.50 },
    { minPct: 0.5, bonus: 0.25 },
  ],

  // India VIX → score dampener multiplier
  VIX_TIERS: [
    { minVix: 25, multiplier: 0.60 },
    { minVix: 20, multiplier: 0.75 },
    { minVix: 16, multiplier: 0.90 },
    { minVix:  0, multiplier: 1.00 },
  ],

  // F&O expiry multipliers per direction
  EXPIRY_LONG_MULTIPLIER:  0.90,  // caution: pinning + reversals hurt longs
  EXPIRY_SHORT_MULTIPLIER: 1.10,  // expiry reversals favour short scalps

  // Monday global-cues bonus magnitude
  MONDAY_BONUS: 1.0,
};

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Returns bonus points for post-results days with exponential decay.
 * Day 2 = 1.0, Day 3 = 0.7, Day 4 = 0.5, Day 5 = 0.25, else 0.
 */
function _postResultsBonus(dayNum) {
  const decay = CONFIG.POST_RESULTS_DECAY;
  if (dayNum < 2 || dayNum >= decay.length) return 0;
  return decay[dayNum];
}

/**
 * Returns a scaled FII streak bonus.
 * Streaks below threshold = 0. Beyond threshold each extra day adds INCREMENT,
 * capped at MAX_BONUS. Negative streaks (sell) return a negative value for
 * short-direction amplification.
 */
function _fiiStreakBonus(streak, direction) {
  const absStreak = Math.abs(streak);
  if (absStreak < CONFIG.FII_STREAK_THRESHOLD) return 0;

  const raw = CONFIG.FII_STREAK_BASE_BONUS +
    (absStreak - CONFIG.FII_STREAK_THRESHOLD) * CONFIG.FII_STREAK_INCREMENT;
  const bonus = Math.min(raw, CONFIG.FII_STREAK_MAX_BONUS);

  // FII sell streak amplifies shorts; buy streak amplifies longs
  const isBuy = streak > 0;
  if ((isBuy && direction === 'long') || (!isBuy && direction === 'short')) {
    return +bonus.toFixed(2);
  }
  return 0; // misaligned streak doesn't help
}

/**
 * Returns a bonus based on how much the sector is outperforming (or
 * underperforming for shorts) relative to Nifty, in percentage points.
 */
function _sectorOutperfBonus(outperfPct, direction) {
  // For shorts, sector underperformance is the signal
  const signedPct = direction === 'short' ? -outperfPct : outperfPct;
  if (signedPct <= 0) return 0;

  for (const tier of CONFIG.SECTOR_OUTPERF_TIERS) {
    if (signedPct >= tier.minPct) return tier.bonus;
  }
  return 0;
}

/**
 * Returns VIX dampener multiplier. Higher VIX = lower multiplier.
 * Sorted descending so first match wins.
 */
function _vixDampener(indiaVix) {
  for (const tier of CONFIG.VIX_TIERS) {
    if (indiaVix >= tier.minVix) return tier.multiplier;
  }
  return 1;
}

/**
 * Returns a F&O expiry multiplier. Longs get cautionary reduction;
 * short scalps get a slight boost since expiry reversals favour them.
 * Returns 1 if not expiry week.
 */
function _expiryMultiplier(isExpiryWeek, direction) {
  if (!isExpiryWeek) return 1;
  return direction === 'short'
    ? CONFIG.EXPIRY_SHORT_MULTIPLIER
    : CONFIG.EXPIRY_LONG_MULTIPLIER;
}

/**
 * Returns true if today is Monday in IST (UTC+5:30), regardless of
 * server timezone. Pass context.currentUtcMs to override (useful for testing).
 */
function _isMondayIST(currentUtcMs) {
  const utcMs   = currentUtcMs ?? Date.now();
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const istDate  = new Date(utcMs + IST_OFFSET_MS);
  return istDate.getUTCDay() === 1;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * @param {number} baseScore   - Raw signal score before amplification
 * @param {object} context
 * @param {string}  context.direction            - 'long' | 'short' (required)
 * @param {number}  [context.postResultsDayNum]  - Days since earnings release (1-indexed)
 * @param {boolean} [context.isMondayGlobalCuesPositive]  - Monday + SGX/Dow positive
 * @param {boolean} [context.isMondayGlobalCuesNegative]  - Monday + SGX/Dow negative
 * @param {number}  [context.fiiStreakDays]       - +N = buy streak, -N = sell streak
 * @param {number}  [context.sectorOutperfPct]    - Sector vs Nifty delta in %
 * @param {boolean} [context.isExpiryWeek]        - F&O expiry week flag
 * @param {number}  [context.indiaVix]            - Current India VIX reading
 * @param {number}  [context.currentUtcMs]        - Override for testing (epoch ms)
 * @returns {object} AmplifierResult
 */
function applyAmplifiers(baseScore, context = {}) {
  const direction = context.direction ?? 'long';

  if (baseScore < CONFIG.MIN_BASE_SCORE) {
    return {
      finalScore:        baseScore,
      multiplier:        1,
      bonusPoints:       0,
      amplifiersApplied: [],
      reason: `Base score ${baseScore} < ${CONFIG.MIN_BASE_SCORE} — no amplifiers`,
    };
  }

  let bonus = 0;
  const applied = [];

  // 1. Post-results decay bonus
  const prBonus = _postResultsBonus(context.postResultsDayNum);
  if (prBonus > 0) {
    bonus += prBonus;
    applied.push(`Post-results day ${context.postResultsDayNum} (+${prBonus.toFixed(2)})`);
  }

  // 2. Monday Open — direction-aware, requires confirmed global cues
  const isMonday = _isMondayIST(context.currentUtcMs);
  if (isMonday) {
    if (direction === 'long'  && context.isMondayGlobalCuesPositive) {
      bonus += CONFIG.MONDAY_BONUS;
      applied.push('Monday open — global cues positive (+1.00)');
    } else if (direction === 'short' && context.isMondayGlobalCuesNegative) {
      bonus += CONFIG.MONDAY_BONUS;
      applied.push('Monday open — global cues negative, short (+1.00)');
    }
  }

  // 3. FII streak — scaled, direction-aligned
  const fiiBonus = _fiiStreakBonus(context.fiiStreakDays ?? 0, direction);
  if (fiiBonus > 0) {
    const streakLabel = Math.abs(context.fiiStreakDays);
    applied.push(`FII ${direction === 'long' ? 'buy' : 'sell'} streak ${streakLabel}d (+${fiiBonus.toFixed(2)})`);
    bonus += fiiBonus;
  }

  // 4. Sector outperformance — magnitude-weighted
  const secBonus = _sectorOutperfBonus(context.sectorOutperfPct ?? 0, direction);
  if (secBonus > 0) {
    const pct = (context.sectorOutperfPct ?? 0).toFixed(2);
    applied.push(`Sector outperf ${direction === 'short' ? 'under' : 'over'}perf ${pct}% (+${secBonus.toFixed(2)})`);
    bonus += secBonus;
  }

  // 5. VIX dampener (multiplicative, applied to subtotal)
  const vixMult = _vixDampener(context.indiaVix ?? 0);
  if (vixMult < 1) {
    applied.push(`India VIX ${context.indiaVix} dampener (×${vixMult.toFixed(2)})`);
  }

  // 6. F&O Expiry (multiplicative, direction-aware)
  const expiryMult = _expiryMultiplier(context.isExpiryWeek, direction);
  if (expiryMult !== 1) {
    const label = expiryMult < 1 ? 'caution' : 'short scalp';
    applied.push(`F&O expiry week — ${label} (×${expiryMult.toFixed(2)})`);
  }

  const combined    = expiryMult * vixMult;
  const rawFinal    = (baseScore + bonus) * combined;
  const finalScore  = Math.min(Math.round(rawFinal), CONFIG.MAX_FINAL_SCORE);

  return {
    finalScore,
    multiplier:        +combined.toFixed(3),
    bonusPoints:       +bonus.toFixed(2),
    amplifiersApplied: applied,
    reason:            applied.length ? applied.join(' | ') : 'No amplifiers active',
    debug: {
      baseScore,
      bonus:       +bonus.toFixed(2),
      subtotal:    +(baseScore + bonus).toFixed(2),
      vixMult,
      expiryMult,
      combined:    +combined.toFixed(3),
      rawFinal:    +rawFinal.toFixed(2),
      direction,
    },
  };
}

module.exports = { applyAmplifiers, CONFIG };

// ---------------------------------------------------------------------------
// Quick smoke tests (node amplifier_engine.js)
// ---------------------------------------------------------------------------
if (require.main === module) {
  const cases = [
    {
      label: 'Low base — no amplifiers',
      score: 3,
      ctx: { direction: 'long', indiaVix: 14 },
    },
    {
      label: 'Long — strong post-results day 2, FII buy 5d, expiry week',
      score: 7,
      ctx: {
        direction: 'long',
        postResultsDayNum: 2,
        fiiStreakDays: 5,
        sectorOutperfPct: 1.8,
        isExpiryWeek: true,
        indiaVix: 18,
        isMondayGlobalCuesPositive: false,
        currentUtcMs: new Date('2025-01-07T05:00:00Z').getTime(), // Tuesday IST
      },
    },
    {
      label: 'Short — FII sell 8d, sector weak, high VIX, expiry',
      score: 6,
      ctx: {
        direction: 'short',
        fiiStreakDays: -8,
        sectorOutperfPct: -2.5,  // negative = sector lagging Nifty
        isExpiryWeek: true,
        indiaVix: 22,
        isMondayGlobalCuesNegative: true,
        currentUtcMs: new Date('2025-01-06T03:30:00Z').getTime(), // Monday IST
      },
    },
    {
      label: 'Long — Monday with bad global cues (should NOT fire Monday bonus)',
      score: 5,
      ctx: {
        direction: 'long',
        isMondayGlobalCuesPositive: false,
        isMondayGlobalCuesNegative: true,
        indiaVix: 15,
        currentUtcMs: new Date('2025-01-06T03:30:00Z').getTime(), // Monday IST
      },
    },
    {
      label: 'Long — panic VIX 28, score should be dampened significantly',
      score: 8,
      ctx: {
        direction: 'long',
        fiiStreakDays: 6,
        sectorOutperfPct: 2.1,
        indiaVix: 28,
      },
    },
  ];

  cases.forEach(({ label, score, ctx }) => {
    const r = applyAmplifiers(score, ctx);
    console.log(`\n[${label}]`);
    console.log(`  base=${score} → final=${r.finalScore}  bonus=+${r.bonusPoints}  mult=×${r.multiplier}`);
    console.log(`  applied: ${r.reason}`);
  });
}
