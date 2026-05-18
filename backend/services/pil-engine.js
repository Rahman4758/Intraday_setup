/**
 * PIL ENGINE — 6-Pillar Scoring Engine
 * Pure scoring logic — no DB, no API, no side effects
 */

function scoreP1(currentOI, previousOI, priceChange, prevStreak) {
  const oiBuilding = currentOI > previousOI;
  const priceFlatOrUp = priceChange >= -0.1;
  const priceDipBuying = priceChange < -0.1 && priceChange >= -0.8;

  if (!oiBuilding || (!priceFlatOrUp && !priceDipBuying)) {
    return { score: 0, streak: 0, reset: true, reason: oiBuilding ? 'OI up but price fell too much' : 'OI fell — P1 reset' };
  }

  const newStreak = prevStreak + 1;
  const reason = priceDipBuying ? `Dip Buying (Conviction Day ${newStreak})` : `OI accumulation Day ${newStreak}`;
  
  return { score: Math.min(newStreak, 3), streak: newStreak, reset: false, reason };
}

function scoreP2(todayRange, yesterdayRange, prevStreak) {
  if (yesterdayRange <= 0) return { score: 0, streak: 0, reset: false, reason: 'No prev range' };
  if (todayRange >= yesterdayRange) return { score: 0, streak: 0, reset: true, reason: 'Range expanded — P2 reset' };
  const ratio = todayRange / yesterdayRange;
  const newStreak = prevStreak + 1;
  return { score: ratio < 0.7 ? 2 : 1, streak: newStreak, reset: false, reason: `Range ${(ratio*100).toFixed(0)}% of yesterday` };
}

function scoreP3(stockChange, niftyChange, prevStreak) {
  if (niftyChange > 0 && stockChange < 0) return { score: 0, streak: 0, reset: true, reason: 'Stock fell on green Nifty — P3 reset' };
  if (niftyChange < -0.3 && stockChange >= -0.1) {
    const s = prevStreak + 1;
    return { score: Math.min(s, 3), streak: s, reset: false, reason: `RS Day ${s}` };
  }
  return { score: Math.min(prevStreak, 3), streak: prevStreak, reset: false, reason: 'Neutral day' };
}

function scoreP4(todayVol, yesterdayVol, avgVol20, isRedCandle, prevStreak, recentCandles = []) {
  if (isRedCandle && todayVol > avgVol20) return { score: 0, streak: 0, reset: true, reason: 'High-vol red candle — P4 reset' };
  
  // Smart Money Footprint: Was there a recent volume spike on a green candle?
  let hasRecentSpike = false;
  if (recentCandles && recentCandles.length > 0) {
    // Check last 5 candles for a green candle with vol > avgVol20
    const lookback = recentCandles.slice(-5);
    hasRecentSpike = lookback.some(c => (c.close > c.open) && (c.volume > avgVol20));
  } else {
    // If we don't have recent candles, assume true to not break old logic, but streak-tracker should pass them
    hasRecentSpike = true;
  }

  if (!hasRecentSpike) {
    return { score: 0, streak: 0, reset: true, reason: 'No recent volume footprint' };
  }

  if (todayVol < avgVol20 * 0.5) return { score: 2, streak: prevStreak + 1, reset: false, reason: 'Desert dry volume' };
  if (todayVol < yesterdayVol && todayVol < avgVol20) return { score: 1, streak: prevStreak + 1, reset: false, reason: 'Volume drying' };
  return { score: 0, streak: 0, reset: true, reason: 'Volume not drying' };
}

function scoreP5(rsi) {
  if (rsi < 58) return { score: 0, fullReset: true, reason: `RSI ${rsi.toFixed(1)} < 58 — FULL RESET` };
  if (rsi >= 60 && rsi <= 67) return { score: 2, fullReset: false, reason: `RSI ${rsi.toFixed(1)} — SWEET ZONE` };
  if (rsi > 67 && rsi <= 72) return { score: 1, fullReset: false, reason: `RSI ${rsi.toFixed(1)} — Acceptable` };
  return { score: 0, fullReset: false, reason: `RSI ${rsi.toFixed(1)} — Out of zone` };
}

function scoreP6(optionData, currentPrice) {
  let score = 0;
  const flags = [];
  const levels = optionData.levels || { support: 'N/A', resistance: 'N/A' };
  
  if (optionData.ivCrush) { score++; flags.push('IV_CRUSH'); }
  if (optionData.putWall) { score++; flags.push('PUT_WALL'); }
  if (optionData.callUnwind) { score++; flags.push('CALL_UNWIND'); }

  // ===== ROOM TO RUN CHECK (Logic by User) =====
  if (levels.resistance && levels.resistance !== 'N/A' && currentPrice) {
    const distToResist = ((levels.resistance - currentPrice) / currentPrice) * 100;
    
    // If distance is less than 1.5%, it's a congested zone (Room to Run logic).
    if (distToResist < 1.5 && distToResist > -0.2) {
      flags.push('CONGESTED_ZONE');
      // Penalize score if room for movement is low
      if (score > 0) score = Math.max(0, score - 1);
    }
  }

  const reason = flags.length ? flags.join(', ') : 'No signals';
  return { score, flags, reason, levels };
}

function computeBaseScore(p1, p2, p3, p4, p5, p6) {
  return p1.score + p2.score + p3.score + p4.score + p5.score + p6.score;
}

function interpretBand(finalScore) {
  if (finalScore <= 3) return { band: 'NOT_READY', status: 'Not Ready', action: 'Remove from watchlist. No setup forming.', color: '#ff4757', priority: 5 };
  if (finalScore <= 5) return { band: 'BUILDING', status: 'Building', action: 'Observation list. Check next EOD.', color: '#ffa502', priority: 4 };
  if (finalScore <= 7) return { band: 'ALERT', status: 'Alert — High Priority', action: 'Prepare CSMC checklist. A-list tomorrow.', color: '#1dd1a1', priority: 3 };
  if (finalScore <= 10) return { band: 'IGNITION', status: 'Ignition Ready', action: 'Max conviction. Execute CSMC from first candle.', color: '#00f5d4', priority: 2 };
  return { band: 'EXPLOSIVE', status: 'Explosive — Rare', action: 'All signals aligned. Highest position sizing.', color: '#ff6348', priority: 1 };
}

function checkInvalidations(data) {
  const inv = [];
  if (data.rsi !== undefined && data.rsi < 58) inv.push('RSI_BELOW_58');
  if (data.prevClose && data.open && ((data.open - data.prevClose) / data.prevClose) * 100 < -1) inv.push('GAP_DOWN_1PCT');
  if (data.niftyChange !== undefined && data.niftyChange < -1) inv.push('NIFTY_CRASH_1PCT');
  return inv;
}

module.exports = { scoreP1, scoreP2, scoreP3, scoreP4, scoreP5, scoreP6, computeBaseScore, interpretBand, checkInvalidations };
