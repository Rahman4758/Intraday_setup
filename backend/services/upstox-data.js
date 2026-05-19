const axios = require('axios');
const { getValidToken } = require('./upstox-auth');

const UPSTOX_BASE = 'https://api.upstox.com/v2';

async function getHeaders() {
  const token = await getValidToken();
  return { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };
}

/**
 * Get historical daily candles (oldest → newest)
 */
async function getHistoricalCandles(instrumentKey, days = 30) {
  const headers = await getHeaders();
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - Math.ceil(days * 1.6));

  const to = toDate.toISOString().split('T')[0];
  const from = fromDate.toISOString().split('T')[0];
  const encodedKey = encodeURIComponent(instrumentKey);

  try {
    const res = await axios.get(
      `${UPSTOX_BASE}/historical-candle/${encodedKey}/day/${to}/${from}`,
      { headers, timeout: 15000 }
    );

    if (res.data?.status !== 'success' || !res.data?.data?.candles) return [];

    // Candles come newest first — reverse for chronological order
    return res.data.data.candles.reverse().map(c => ({
      date: c[0].split('T')[0],
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5],
      oi: c[6] || 0
    }));
  } catch (err) {
    console.error(`[UPSTOX] Historical error ${instrumentKey}:`, err.response?.data?.message || err.message);
    return [];
  }
}

/**
 * Get intraday 5-minute candles
 */
async function getIntradayCandles(instrumentKey) {
  const headers = await getHeaders();
  const encodedKey = encodeURIComponent(instrumentKey);

  try {
    const res = await axios.get(
      `${UPSTOX_BASE}/historical-candle/intraday/${encodedKey}/1minute`, // fetch 1m to build 5m or fetch 5m direct
      { headers, timeout: 15000 }
    );
    // Upstox intraday endpoint doesn't support 5minute directly on /intraday/. Actually, their docs say: /historical-candle/intraday/{instrumentKey}/1minute
    // Wait, let's use 1minute and return the raw candles.
    if (res.data?.status !== 'success' || !res.data?.data?.candles) return [];

    return res.data.data.candles.reverse().map(c => ({
      timestamp: c[0],
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5],
      oi: c[6] || 0
    }));
  } catch (err) {
    console.error(`[UPSTOX] Intraday error ${instrumentKey}:`, err.response?.data?.message || err.message);
    return [];
  }
}

/**
 * Get live market quotes
 * Handles Upstox response format: keys are "NSE_EQ:SYMBOL" (colon-separated)
 */
async function getMarketQuotes(instrumentKeys) {
  const headers = await getHeaders();
  const keys = Array.isArray(instrumentKeys) ? instrumentKeys.join(',') : instrumentKeys;

  try {
    const res = await axios.get(`${UPSTOX_BASE}/market-quote/quotes`, {
      headers,
      params: { instrument_key: keys },
      timeout: 10000
    });

    if (res.data?.status !== 'success') return {};

    const result = {};
    for (const [key, q] of Object.entries(res.data.data || {})) {
      const ltp = q.last_price || 0;
      const netChange = q.net_change !== undefined ? q.net_change : 0;
      const token = q.instrument_token || key; // Use instrument_token for mapping consistency
      
      const prevClose = (netChange !== 0) ? (ltp - netChange) : (q.ohlc?.close || ltp);
      const changePercent = prevClose > 0 ? (netChange / prevClose) * 100 : 0;

      result[token] = {
        ltp,
        open: q.ohlc?.open || 0,
        high: q.ohlc?.high || 0,
        low: q.ohlc?.low || 0,
        close: prevClose,
        volume: q.volume || 0,
        oi: q.oi || 0,
        prevClose,
        change: netChange,
        changePercent: q.percentage_change !== undefined ? q.percentage_change : changePercent
      };
    }
    return result;
  } catch (err) {
    console.error('[UPSTOX] Quote error:', err.response?.data?.message || err.message);
    return {};
  }
}

/**
 * Get Nifty 50 quote
 */
async function getNiftyQuote() {
  const niftyKey = process.env.PIL_NIFTY_INSTRUMENT_KEY || 'NSE_INDEX|Nifty 50';
  const quotes = await getMarketQuotes(niftyKey);
  const niftyData = Object.values(quotes)[0];
  if (!niftyData) throw new Error('Could not fetch Nifty 50 data');
  return niftyData;
}

/**
 * Get option chain
 */
async function getOptionChain(instrumentKey, expiryDate) {
  const headers = await getHeaders();
  try {
    const res = await axios.get(`${UPSTOX_BASE}/option/chain`, {
      headers,
      params: { instrument_key: instrumentKey, expiry_date: expiryDate },
      timeout: 15000
    });

    if (res.data?.status !== 'success' || !res.data?.data) return { strikes: [] };

    return {
      strikes: res.data.data.map(item => ({
        strikePrice: item.strike_price,
        callOI: item.call_options?.market_data?.oi || 0,
        putOI: item.put_options?.market_data?.oi || 0,
        callIV: item.call_options?.option_greeks?.iv || 0,
        putIV: item.put_options?.option_greeks?.iv || 0,
        callPrevOI: item.call_options?.market_data?.prev_oi || 0,
        putPrevOI: item.put_options?.market_data?.prev_oi || 0,
        callLTP: item.call_options?.market_data?.ltp || 0,
        putLTP: item.put_options?.market_data?.ltp || 0
      }))
    };
  } catch (err) {
    console.error(`[UPSTOX] Option chain error ${instrumentKey}:`, err.response?.data?.message || err.message);
    return { strikes: [] };
  }
}

/**
 * Search instruments via local ISIN map (Upstox search API is deprecated/404)
 */
function searchInstruments(query) {
  const { getInstrumentMap } = require('../utils/instrument-resolver');
  const map = getInstrumentMap();
  const q = query.toUpperCase().trim();
  const results = [];

  for (const [symbol, key] of Object.entries(map)) {
    if (symbol.includes(q)) {
      results.push({ trading_symbol: symbol, instrument_key: key, exchange: 'NSE' });
      if (results.length >= 10) break;
    }
  }
  return results;
}

module.exports = {
  getHistoricalCandles,
  getIntradayCandles,
  getMarketQuotes,
  getNiftyQuote,
  getOptionChain,
  searchInstruments
};





