/**
 * RSI(14) Calculator — Wilder's Smoothing Method
 *
 * Standard RSI formula:
 *   RSI = 100 - (100 / (1 + RS))
 *   RS = Average Gain / Average Loss
 *
 * Wilder's smoothing:
 *   First avg = simple average of first `period` values
 *   Subsequent = ((prevAvg * (period - 1)) + current) / period
 */

/**
 * Calculate RSI from an array of closing prices (oldest first)
 * @param {number[]} closes - Array of closing prices, oldest first, minimum length = period + 1
 * @param {number} period - RSI period, default 14
 * @returns {{ rsi: number, avgGain: number, avgLoss: number } | null}
 */
function calculateRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) {
    return null;
  }

  // Calculate price changes
  const changes = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  // Separate gains and losses
  const gains = changes.map(c => (c > 0 ? c : 0));
  const losses = changes.map(c => (c < 0 ? Math.abs(c) : 0));

  // First average (simple) over the initial `period` values
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder's smoothing for remaining values
  for (let i = period; i < changes.length; i++) {
    avgGain = ((avgGain * (period - 1)) + gains[i]) / period;
    avgLoss = ((avgLoss * (period - 1)) + losses[i]) / period;
  }

  // Calculate RSI
  if (avgLoss === 0) {
    return { rsi: 100, avgGain, avgLoss };
  }

  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  return {
    rsi: Math.round(rsi * 100) / 100,
    avgGain: Math.round(avgGain * 10000) / 10000,
    avgLoss: Math.round(avgLoss * 10000) / 10000
  };
}

module.exports = { calculateRSI };
