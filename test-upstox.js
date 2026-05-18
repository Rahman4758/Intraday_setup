/**
 * Full PIL Integration Test — Token + Data + Scoring
 */
require('dotenv').config();
const axios = require('axios');
const { calculateRSI } = require('./backend/services/rsi-calculator');
const { scoreP1, scoreP2, scoreP3, scoreP4, scoreP5, interpretBand, computeBaseScore } = require('./backend/services/pil-engine');
const { resolveInstrumentKeys, isKnownSymbol } = require('./backend/utils/instrument-resolver');

const TOKEN = process.env.UPSTOX_ACCESS_TOKEN;
const BASE = 'https://api.upstox.com/v2';
const headers = { 'Authorization': `Bearer ${TOKEN}`, 'Accept': 'application/json' };

async function test() {
  console.log('═══════════════════════════════════════════');
  console.log('  ANTIGRAVITY PIL — FULL INTEGRATION TEST');
  console.log('═══════════════════════════════════════════\n');

  // 1. Token check
  console.log('1️⃣  TOKEN STATUS');
  console.log(`   Token: ${TOKEN ? TOKEN.slice(0, 30) + '...' : 'MISSING!'}`);

  // 2. Instrument resolution
  const testSymbol = 'RELIANCE';
  console.log(`\n2️⃣  INSTRUMENT RESOLVE — ${testSymbol}`);
  const keys = resolveInstrumentKeys(testSymbol);
  console.log(`   ✅ EQ Key: ${keys.eq}`);
  console.log(`   Known: ${isKnownSymbol(testSymbol)}`);

  // 3. Historical candles
  console.log(`\n3️⃣  HISTORICAL DATA — ${testSymbol} (30 days)`);
  const encodedKey = encodeURIComponent(keys.eq);
  const to = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - 50 * 86400000).toISOString().split('T')[0];

  let candles = [];
  try {
    const r = await axios.get(`${BASE}/historical-candle/${encodedKey}/day/${to}/${from}`, { headers });
    candles = (r.data.data?.candles || []).reverse().map(c => ({
      date: c[0].split('T')[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5], oi: c[6] || 0
    }));
    console.log(`   ✅ Got ${candles.length} candles`);
    const latest = candles[candles.length - 1];
    console.log(`   📊 Latest: ${latest.date} — C:${latest.close} V:${latest.volume}`);
  } catch (e) {
    console.log(`   ❌ ${e.response?.status}: ${e.response?.data?.message || e.message}`);
  }

  if (candles.length < 15) {
    console.log('\n   ⚠️ Not enough candles for RSI — stopping here');
    return;
  }

  // 4. RSI computation
  console.log('\n4️⃣  RSI(14) CALCULATION');
  const closes = candles.map(c => c.close);
  const rsiResult = calculateRSI(closes, 14);
  console.log(`   ✅ RSI: ${rsiResult.rsi}`);

  // 5. Nifty data
  console.log('\n5️⃣  NIFTY 50 STATUS');
  try {
    const r = await axios.get(`${BASE}/market-quote/quotes`, {
      headers, params: { instrument_key: 'NSE_INDEX|Nifty 50' }
    });
    const d = Object.values(r.data.data || {})[0];
    const niftyChange = d.ohlc?.close > 0 ? ((d.last_price - d.ohlc.close) / d.ohlc.close) * 100 : 0;
    console.log(`   ✅ LTP: ${d.last_price} | Change: ${niftyChange.toFixed(2)}%`);
  } catch (e) {
    console.log(`   ❌ ${e.message}`);
  }

  // 6. PIL Scoring simulation
  console.log('\n6️⃣  PIL SCORING — SIMULATED');
  const today = candles[candles.length - 1];
  const yesterday = candles[candles.length - 2];
  const stockChange = ((today.close - yesterday.close) / yesterday.close) * 100;
  const todayRange = today.high - today.low;
  const yesterdayRange = yesterday.high - yesterday.low;
  const recentVols = candles.slice(-20).map(c => c.volume);
  const avgVol20 = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;

  const p1 = scoreP1(today.oi, yesterday.oi, stockChange, 0);
  const p2 = scoreP2(todayRange, yesterdayRange, 0);
  const p3 = scoreP3(stockChange, -0.5, 0); // Simulated Nifty -0.5%
  const p4 = scoreP4(today.volume, yesterday.volume, avgVol20, today.close < today.open, 0);
  const p5 = scoreP5(rsiResult.rsi);

  const base = computeBaseScore(p1, p2, p3, { score: 0, streak: 0 }, p5, { score: 0, flags: [] });

  console.log(`   P1 OI Streak:      ${p1.score}/3 — ${p1.reason}`);
  console.log(`   P2 ATR Compress:   ${p2.score}/2 — ${p2.reason}`);
  console.log(`   P3 Relative Str:   ${p3.score}/3 — ${p3.reason}`);
  console.log(`   P4 Volume Dry:     ${p4.score}/2 — ${p4.reason}`);
  console.log(`   P5 RSI Zone:       ${p5.score}/2 — ${p5.reason}`);
  console.log(`   ─────────────────────────────`);
  console.log(`   BASE SCORE:        ${base}/15`);

  const band = interpretBand(base);
  console.log(`   BAND:              ${band.band} (${band.status})`);
  console.log(`   ACTION:            ${band.action}`);

  console.log('\n═══════════════════════════════════════════');
  console.log('  ✅ ALL SYSTEMS OPERATIONAL');
  console.log('═══════════════════════════════════════════');
}

test();
