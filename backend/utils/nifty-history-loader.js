// backend/utils/nifty-history-loader.js
'use strict';

/**
 * ANTIGRAVITY Historical Nifty Loader
 * ------------------------------------
 * Fetches Nifty50 daily candles ONCE per scan and exposes a
 * date-keyed map of daily change percentages.
 */

const { fetchHistoricalCandles } = require('./upstox-client');

// The Upstox instrument key for the Nifty 50 index.
const NIFTY_INSTRUMENT_KEY = process.env.PIL_NIFTY_INSTRUMENT_KEY || 'NSE_INDEX|Nifty 50';

/**
 * Builds a Map of { 'YYYY-MM-DD' => niftyChangePct (number) }
 *
 * @param {Function} getHistoricalCandles  — SDK function reference
 * @param {number}   days                 — how many calendar days of history to load
 * @returns {Promise<Map<string, number>>}
 */
async function buildNiftyChangeMap(getHistoricalCandles, days = 90) {
  console.log(`[nifty-loader] Fetching ${days}-day Nifty history for key ${NIFTY_INSTRUMENT_KEY}...`);

  const candles = await fetchHistoricalCandles(
    getHistoricalCandles,
    NIFTY_INSTRUMENT_KEY,
    days
  );

  if (!candles || candles.length === 0) {
    console.error('[nifty-loader] WARNING: Could not fetch Nifty history. P3 will score 0 for all stocks this run.');
    return new Map();
  }

  const niftyMap = new Map();

  for (let i = 1; i < candles.length; i++) {
    const prev  = candles[i - 1];
    const curr  = candles[i];

    // Support both standard candle shapes
    const prevClose = prev.close !== undefined ? prev.close : prev[4];
    const currClose = curr.close !== undefined ? curr.close : curr[4];
    const dateStr   = curr.date !== undefined ? curr.date : curr[0];

    if (prevClose === undefined || currClose === undefined || !dateStr) continue;

    const changePct = ((currClose - prevClose) / prevClose) * 100;
    const dateKey = String(dateStr).substring(0, 10);
    niftyMap.set(dateKey, parseFloat(changePct.toFixed(4)));
  }

  console.log(`[nifty-loader] Nifty map built: ${niftyMap.size} trading days loaded.`);
  return niftyMap;
}

module.exports = { buildNiftyChangeMap };
