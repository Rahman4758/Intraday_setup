const express = require('express');
const router = express.Router();

const Stock = require('../models/Stock');
const StreakState = require('../models/StreakState');
const { isValidSymbol } = require('../utils/validators');

const { resolveInstrumentKeys } = require('../utils/instrument-resolver');



// -----------------------------
// GET ALL ACTIVE STOCKS
// -----------------------------
router.get('/', async (req, res) => {

    try {

        const stocks = await Stock.find({
            isActive: true
        }).sort({
            addedAt: -1
        });

        return res.json({
            stocks
        });

    } catch (err) {

        console.error('[STOCK] Fetch error:', err);

        return res.status(500).json({
            error: err.message
        });
    }
});

// -----------------------------
// ADD STOCK
// -----------------------------
router.post('/', async (req, res) => {

    try {

        const io = req.app.get('io');

        const { symbol, sector } = req.body;

        // Validate presence
        if (!symbol) {

            return res.status(400).json({
                error: 'Symbol required'
            });
        }

        // Normalize
        const upper = symbol
            .toUpperCase()
            .trim();

        // Validate format
        if (!isValidSymbol(upper)) {

            return res.status(400).json({
                error: 'Invalid stock symbol format'
            });
        }

        // Max stock limit
        const maxStocks =
            parseInt(process.env.PIL_MAX_STOCKS) || 10;

        const activeCount =
            await Stock.countDocuments({
                isActive: true
            });

        if (activeCount >= maxStocks) {

            return res.status(400).json({
                error: `Max ${maxStocks} stocks allowed`
            });
        }

        // Check existing stock
        let stock = await Stock.findOne({
            symbol: upper
        });

        // Reactivate existing
        if (stock) {

            if (stock.isActive) {

                return res.status(400).json({
                    error: 'Stock already in watchlist'
                });
            }

            stock.isActive = true;

            stock.sector = sector || stock.sector;

            await stock.save();

            // SOCKET UPDATE
            io.emit('watchlist-updated', {
                type: 'reactivated',
                stock
            });

            return res.json({
                stock,
                message: 'Stock reactivated'
            });
        }

        // Resolve keys
        let keys = {
            eq: '',
            fo: ''
        };

        try {

            keys = resolveInstrumentKeys(upper);

        } catch (err) {

            console.error(
                `[STOCK] Key resolution failed for ${upper}:`,
                err.message
            );
        }

        // Create stock safely
        try {

            stock = await Stock.create({

                symbol: upper,

                instrumentKeyEQ: keys.eq || '',

                instrumentKeyFO: keys.fo || '',

                sector: sector || 'Unknown',

                isActive: true
            });

        } catch (err) {

            // Handle duplicate race condition
            if (err.code === 11000) {

                return res.status(400).json({
                    error: 'Stock already exists'
                });
            }

            throw err;
        }

        // Create streak state
        await StreakState.findOneAndUpdate(

            {
                symbol: upper
            },

            {
                symbol: upper
            },

            {
                upsert: true,
                new: true
            }
        );

        // SOCKET UPDATE
        io.emit('watchlist-updated', {
            type: 'added',
            stock
        });

        return res.status(201).json({
            stock
        });

    } catch (err) {

        console.error('[STOCK] Add error:', err);

        return res.status(500).json({
            error: err.message
        });
    }
});

// -----------------------------
// REMOVE STOCK
// -----------------------------
router.delete('/:symbol', async (req, res) => {

    try {

        const io = req.app.get('io');

        const symbol = req.params.symbol
            ?.toUpperCase()
            ?.trim();

        // Validate
        if (!symbol || !isValidSymbol(symbol)) {

            return res.status(400).json({
                error: 'Invalid stock symbol'
            });
        }

        const stock = await Stock.findOneAndUpdate(

            {
                symbol
            },

            {
                isActive: false
            },

            {
                new: true
            }
        );

        if (!stock) {

            return res.status(404).json({
                error: 'Stock not found'
            });
        }

        // SOCKET UPDATE
        io.emit('watchlist-updated', {
            type: 'removed',
            symbol
        });

        return res.json({
            message: `${symbol} removed`,
            stock
        });

    } catch (err) {

        console.error('[STOCK] Remove error:', err);

        return res.status(500).json({
            error: err.message
        });
    }
});

// -----------------------------
// SEARCH INSTRUMENTS
// -----------------------------
router.get('/search', async (req, res) => {

    try {

        const q = req.query.q
            ?.toString()
            ?.trim();

        // Validate query
        if (!q || q.length < 2) {

            return res.json({
                results: []
            });
        }

        const {
            searchInstruments
        } = require('../services/upstox-data');

        const results =
            await searchInstruments(q);

        return res.json({
            results: results.slice(0, 10)
        });

    } catch (err) {

        console.error(
            '[STOCK SEARCH] Search failed:',
            err
        );

        return res.status(500).json({
            error: 'Instrument search failed',
            results: []
        });
    }
});

module.exports = router;
