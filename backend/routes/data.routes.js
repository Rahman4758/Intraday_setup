const express = require('express');

const router = express.Router();

const {
    getMarketQuotes,
    getOptionChain,
    getNiftyQuote
} = require('../services/upstox-data');

const Stock =
    require('../models/Stock');

const {
    getNextMonthlyExpiry
} = require('../utils/nse-calendar');

const {
    isValidSymbol
} = require('../utils/validators');

// -----------------------------------
// SIMPLE IN-MEMORY CACHE
// -----------------------------------
const marketCache = new Map();

// CACHE TTLs
const QUOTE_CACHE_TTL = 3000; // 3 sec
const OPTION_CHAIN_CACHE_TTL = 5000; // 5 sec
const NIFTY_CACHE_TTL = 2000; // 2 sec

// -----------------------------------
// CACHE HELPERS
// -----------------------------------
function getCachedData(key, ttl) {

    const cached =
        marketCache.get(key);

    if (!cached) {
        return null;
    }

    const age =
        Date.now() - cached.timestamp;

    // Expired
    if (age > ttl) {

        marketCache.delete(key);

        return null;
    }

    return {

        ...cached.data,

        cacheMeta: {

            cached: true,

            ageMs: age,

            cachedAt:
                new Date(
                    cached.timestamp
                ).toISOString()
        }
    };
}

function setCacheData(key, data) {

    marketCache.set(key, {

        data,

        timestamp: Date.now()
    });
}

// -----------------------------------
// SINGLE QUOTE
// -----------------------------------
router.get('/quote/:symbol', async (req, res) => {

    try {

        const symbol =
            req.params.symbol
                ?.toUpperCase()
                ?.trim();

        // VALIDATION
        if (
            !symbol ||
            !isValidSymbol(symbol)
        ) {

            return res.status(400).json({

                error:
                    'Invalid symbol'
            });
        }

        // CACHE KEY
        const cacheKey =
            `quote:${symbol}`;

        // CHECK CACHE
        const cached =
            getCachedData(
                cacheKey,
                QUOTE_CACHE_TTL
            );

        if (cached) {

            return res.json(cached);
        }

        // FETCH STOCK
        const stock =
            await Stock.findOne({

                symbol,

                isActive: true
            });

        if (!stock) {

            return res.status(404).json({

                error:
                    'Stock not in watchlist'
            });
        }

        const key =
            stock.instrumentKeyEQ ||
            `NSE_EQ|${symbol}`;

        // FETCH LIVE QUOTE
        const quotes =
            await getMarketQuotes(key);

        const quote =
            quotes[key] || {};

        const response = {

            symbol,

            quote,

            cacheMeta: {

                cached: false,

                fetchedAt:
                    new Date()
                        .toISOString()
            }
        };

        // SAVE CACHE
        setCacheData(
            cacheKey,
            response
        );

        return res.json(response);

    } catch (err) {

        console.error(
            '[MARKET] Quote error:',
            err
        );

        return res.status(500).json({

            error:
                err.message
        });
    }
});

// -----------------------------------
// BATCH QUOTES
// -----------------------------------
router.post('/quotes/batch', async (req, res) => {

    try {

        const {
            symbols
        } = req.body;

        if (
            !Array.isArray(symbols) ||
            symbols.length === 0
        ) {

            return res.status(400).json({

                error:
                    'Symbols array required'
            });
        }

        // LIMIT
        if (symbols.length > 50) {

            return res.status(400).json({

                error:
                    'Maximum 50 symbols allowed'
            });
        }

        const cleanedSymbols =
            symbols.map(s =>
                s.toUpperCase().trim()
            );

        // VALIDATE
        for (const symbol of cleanedSymbols) {

            if (!isValidSymbol(symbol)) {

                return res.status(400).json({

                    error:
                        `Invalid symbol: ${symbol}`
                });
            }
        }

        // CACHE KEY
        const cacheKey =
            `batch:${cleanedSymbols.sort().join(',')}`;

        // CHECK CACHE
        const cached =
            getCachedData(
                cacheKey,
                QUOTE_CACHE_TTL
            );

        if (cached) {

            return res.json(cached);
        }

        // FETCH STOCKS
        const stocks =
            await Stock.find({

                symbol: {
                    $in: cleanedSymbols
                },

                isActive: true
            });

        const instrumentKeys = [];

        const symbolMap = {};

        stocks.forEach(stock => {

            const key =
                stock.instrumentKeyEQ ||
                `NSE_EQ|${stock.symbol}`;

            instrumentKeys.push(key);

            symbolMap[key] =
                stock.symbol;
        });

        if (
            instrumentKeys.length === 0
        ) {

            return res.status(404).json({

                error:
                    'No valid stocks found'
            });
        }

        // FETCH QUOTES
        const quotes =
            await getMarketQuotes(
                instrumentKeys
            );

        const results = [];

        instrumentKeys.forEach(key => {

            if (!quotes[key]) {
                return;
            }

            results.push({

                symbol:
                    symbolMap[key],

                quote:
                    quotes[key]
            });
        });

        const response = {

            status: 'success',

            count:
                results.length,

            data:
                results,

            cacheMeta: {

                cached: false,

                fetchedAt:
                    new Date()
                        .toISOString()
            }
        };

        // SAVE CACHE
        setCacheData(
            cacheKey,
            response
        );

        return res.json(response);

    } catch (err) {

        console.error(
            '[MARKET] Batch error:',
            err
        );

        return res.status(500).json({

            error:
                err.message
        });
    }
});

// -----------------------------------
// OPTION CHAIN
// -----------------------------------
router.get('/option-chain/:symbol', async (req, res) => {

    try {

        const symbol =
            req.params.symbol
                ?.toUpperCase()
                ?.trim();

        if (
            !symbol ||
            !isValidSymbol(symbol)
        ) {

            return res.status(400).json({

                error:
                    'Invalid symbol'
            });
        }

        const stock =
            await Stock.findOne({
                symbol
            });

        if (!stock) {

            return res.status(404).json({

                error:
                    'Stock not in watchlist'
            });
        }

        const defaultExpiry =
            stock.foExpiry ||

            getNextMonthlyExpiry()
                .toISOString()
                .split('T')[0];

        const expiry =
            req.query.expiry ||
            defaultExpiry;

        // CACHE KEY
        const cacheKey =
            `option:${symbol}:${expiry}`;

        const cached =
            getCachedData(
                cacheKey,
                OPTION_CHAIN_CACHE_TTL
            );

        if (cached) {

            return res.json(cached);
        }

        const chain =
            await getOptionChain(
                stock.instrumentKeyEQ,
                expiry
            );

        const response = {

            symbol,

            expiry,

            chain,

            cacheMeta: {

                cached: false,

                fetchedAt:
                    new Date()
                        .toISOString()
            }
        };

        // SAVE CACHE
        setCacheData(
            cacheKey,
            response
        );

        return res.json(response);

    } catch (err) {

        console.error(
            '[MARKET] Option chain error:',
            err
        );

        return res.status(500).json({

            error:
                err.message
        });
    }
});

// -----------------------------------
// NIFTY LIVE
// -----------------------------------
router.get('/nifty', async (req, res) => {

    try {

        const cacheKey = 'nifty';

        const cached =
            getCachedData(
                cacheKey,
                NIFTY_CACHE_TTL
            );

        if (cached) {

            return res.json(cached);
        }

        const data =
            await getNiftyQuote();

        const response = {

            ...data,

            cacheMeta: {

                cached: false,

                fetchedAt:
                    new Date()
                        .toISOString()
            }
        };

        // SAVE CACHE
        setCacheData(
            cacheKey,
            response
        );

        return res.json(response);

    } catch (err) {

        console.error(
            '[MARKET] Nifty error:',
            err
        );

        return res.status(500).json({

            error:
                err.message
        });
    }
});

module.exports = router;
