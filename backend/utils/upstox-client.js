// backend/utils/upstox-client.js
'use strict';

/**
 * ANTIGRAVITY Centralised Upstox API Client
 * -----------------------------------------
 * Implements:
 *   1. Token-bucket rate limiter (MAX_TOKENS=30, REFILL_RATE=1/sec)
 *   2. Zero-dependency SimpleCache with custom TTLs
 *
 * ALL modules must import their fetch helpers from here.
 */

// ─── Zero-Dependency Memory Cache ──────────────────────────────────────────
class SimpleCache {
  constructor() {
    this.store = new Map();
  }
  get(key, ttlSeconds) {
    const item = this.store.get(key);
    if (!item) return undefined;
    if (Date.now() - item.timestamp > ttlSeconds * 1000) {
      this.store.delete(key);
      return undefined;
    }
    return item.data;
  }
  set(key, data) {
    this.store.set(key, { data, timestamp: Date.now() });
  }
  del(key) {
    this.store.delete(key);
  }
}

const _cache = new SimpleCache();

const CACHE_TTL = {
  INTRADAY_CANDLES:   35,  // seconds (covers the 30s poll interval perfectly)
  HISTORICAL_CANDLES: 90,  // seconds (covers the 60s poll interval perfectly)
  OPTION_CHAIN:       35,  // seconds (covers the 30s poll interval perfectly)
};

function _cacheKey(type, symbol, extra = '') {
  return `${type}::${symbol}::${extra}`;
}

// ─── Token Bucket Rate Limiter ──────────────────────────────────────────────
const BUCKET_CONFIG = {
  MAX_TOKENS: 30,
  REFILL_RATE: 1,
  REFILL_INTERVAL_MS: 1000,
};

let _tokens = BUCKET_CONFIG.MAX_TOKENS;
let _queue  = [];

setInterval(() => {
  _tokens = Math.min(BUCKET_CONFIG.MAX_TOKENS, _tokens + BUCKET_CONFIG.REFILL_RATE);
  _drainQueue();
}, BUCKET_CONFIG.REFILL_INTERVAL_MS);

function _drainQueue() {
  while (_queue.length > 0 && _tokens > 0) {
    _tokens--;
    const { resolve } = _queue.shift();
    resolve();
  }
}

function acquireToken() {
  if (_tokens > 0) {
    _tokens--;
    return Promise.resolve();
  }
  return new Promise((resolve) => _queue.push({ resolve }));
}

// ─── Public API Wrappers ─────────────────────────────────────────────────────

/**
 * Fetches intraday candles with rate-limiting + shared cache.
 */
async function fetchIntradayCandles(getIntradayCandles, symbol, interval = '1minute') {
  const key = _cacheKey('INTRADAY', symbol, interval);
  const hit = _cache.get(key, CACHE_TTL.INTRADAY_CANDLES);
  if (hit !== undefined) return hit;

  await acquireToken();
  try {
    const data = await getIntradayCandles(symbol, interval);
    const result = Array.isArray(data) ? data : [];
    _cache.set(key, result);
    return result;
  } catch (err) {
    console.error(`[upstox-client] fetchIntradayCandles FAILED for ${symbol}:`, err.message);
    return [];
  }
}

/**
 * Fetches historical (daily) candles with rate-limiting + shared cache.
 */
async function fetchHistoricalCandles(getHistoricalCandles, symbol, days = 60) {
  const key = _cacheKey('HISTORICAL', symbol, days);
  const hit = _cache.get(key, CACHE_TTL.HISTORICAL_CANDLES);
  if (hit !== undefined) return hit;

  await acquireToken();
  try {
    const data = await getHistoricalCandles(symbol, days);
    const result = Array.isArray(data) ? data : [];
    _cache.set(key, result);
    return result;
  } catch (err) {
    console.error(`[upstox-client] fetchHistoricalCandles FAILED for ${symbol}:`, err.message);
    return [];
  }
}

/**
 * Fetches option chain with rate-limiting + shared cache.
 */
async function fetchOptionChain(getOptionChain, symbol, expiry = '') {
  const key = _cacheKey('OPTION_CHAIN', symbol, expiry);
  const hit = _cache.get(key, CACHE_TTL.OPTION_CHAIN);
  if (hit !== undefined) return hit;

  await acquireToken();
  try {
    const data = await getOptionChain(symbol, expiry);
    const result = data ?? null;
    _cache.set(key, result);
    return result;
  } catch (err) {
    console.error(`[upstox-client] fetchOptionChain FAILED for ${symbol}:`, err.message);
    return null;
  }
}

function invalidateSymbol(symbol) {
  const prefixes = ['INTRADAY', 'HISTORICAL', 'OPTION_CHAIN'];
  prefixes.forEach(p => {
    _cache.del(`${p}::${symbol}::1minute`);
    _cache.del(`${p}::${symbol}::5minute`);
    _cache.del(`${p}::${symbol}::60`);
    _cache.del(`${p}::${symbol}::`);
  });
}

module.exports = {
  fetchIntradayCandles,
  fetchHistoricalCandles,
  fetchOptionChain,
  invalidateSymbol,
  acquireToken,
};
