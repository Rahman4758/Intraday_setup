const fs = require('fs');
const path = require('path');

// Load ISIN-based instrument map (symbol → NSE_EQ|ISIN)
let instrumentMap = {};
try {
  const mapPath = path.join(__dirname, '..', 'data', 'upstox_instruments.json');
  if (fs.existsSync(mapPath)) {
    instrumentMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    console.log(`[RESOLVER] Loaded ${Object.keys(instrumentMap).length} instrument mappings`);
  } else {
    console.warn('[RESOLVER] upstox_instruments.json not found — add/remove stocks will need manual instrument keys');
  }
} catch (e) {
  console.error('[RESOLVER] Failed to load instrument map:', e.message);
}

/**
 * Resolve a stock symbol to Upstox instrument keys
 * Uses the same ISIN map as the Stock-Trading-code project
 */
function resolveInstrumentKeys(symbol) {
  const upper = symbol.toUpperCase().trim();
  const eqKey = instrumentMap[upper];

  if (eqKey) {
    return { eq: eqKey, fo: eqKey }; // F&O key will need futures-specific resolution
  }

  // Fallback — won't work for most API calls but won't crash
  console.warn(`[RESOLVER] No ISIN mapping for ${upper} — using fallback`);
  return { eq: `NSE_EQ|${upper}`, fo: `NSE_EQ|${upper}` };
}

/**
 * Check if a symbol exists in the instrument map
 */
function isKnownSymbol(symbol) {
  return !!instrumentMap[symbol.toUpperCase().trim()];
}

/**
 * Get the full instrument map
 */
function getInstrumentMap() {
  return instrumentMap;
}

module.exports = { resolveInstrumentKeys, isKnownSymbol, getInstrumentMap };
