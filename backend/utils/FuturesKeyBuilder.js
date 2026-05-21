const axios = require('axios');
const zlib = require('zlib');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Cache path for the built futures map (refresh daily) - saved in OS temp dir to prevent triggering node --watch in development
const CACHE_PATH = path.join(os.tmpdir(), 'antigravity_futures_key_map.json');

/**
 * Known symbol remaps: NSE EQ symbol → F&O CSV symbol prefix
 */
const SYMBOL_OVERRIDES = {
    'TATAMOTORS': 'TMPV',
    'TATAHMMOTORS': 'TATAMOTORS',
    'LARSEN': 'LT',
    'TATASTLLP': 'TATASTEEL'
};

/**
 * Stocks confirmed NOT eligible for F&O — will be flagged as equity-only
 */
const NON_FO_STOCKS = new Set(['TATACHEM', 'LTIM']);

class FuturesKeyBuilder {
    async getFuturesMap(symbols) {
        if (fs.existsSync(CACHE_PATH)) {
            try {
                const cached = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
                const cacheDate = cached._date;
                const today = new Date().toISOString().split('T')[0];
                if (cacheDate === today) {
                    console.log('[FuturesKeyBuilder] Using cached futures map from today');
                    return cached.map;
                }
            } catch (e) {
                console.warn('[FuturesKeyBuilder] Cache parse failed, rebuilding...');
            }
        }

        return this.buildAndCache(symbols);
    }

    async buildAndCache(symbols) {
        console.log('[FuturesKeyBuilder] Downloading instrument list...');

        const res = await axios.get(
            'https://assets.upstox.com/market-quote/instruments/exchange/complete.csv.gz',
            { responseType: 'arraybuffer', timeout: 60000 }
        );
        const csv = zlib.gunzipSync(res.data).toString();
        const lines = csv.split('\n');
        const today = new Date().toISOString().split('T')[0];

        const map = {};

        for (const sym of symbols) {
            if (NON_FO_STOCKS.has(sym)) {
                map[sym] = { key: null, expiry: null, tradingSymbol: null, isFo: false };
                continue;
            }

            const foPrefix = SYMBOL_OVERRIDES[sym] || sym;
            const symLines = lines.filter(l => l.includes('FUTSTK') && l.includes('"' + foPrefix + '26'));

            const parsed = symLines
                .map(l => {
                    const parts = l.replace(/"/g, '').split(',');
                    return {
                        key: parts[0],
                        token: parts[1],
                        tradingSymbol: parts[2],
                        expiry: parts[5]
                    };
                })
                .filter(p => p.expiry && p.expiry >= today);

            parsed.sort((a, b) => new Date(a.expiry) - new Date(b.expiry));

            if (parsed[0]) {
                map[sym] = {
                    key: parsed[0].key,
                    expiry: parsed[0].expiry,
                    tradingSymbol: parsed[0].tradingSymbol,
                    isFo: true
                };
            } else {
                map[sym] = { key: null, expiry: null, tradingSymbol: null, isFo: false };
            }
        }

        // Ensure data dir exists
        const dir = path.dirname(CACHE_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        fs.writeFileSync(CACHE_PATH, JSON.stringify({ _date: today, map }, null, 2));
        console.log(`[FuturesKeyBuilder] Built map for ${Object.keys(map).length} symbols`);

        return map;
    }
}

module.exports = new FuturesKeyBuilder();
