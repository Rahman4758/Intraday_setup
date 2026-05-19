const express = require('express');

const router = express.Router();

const TradeJournal = require('../models/TradeJournal');

// -----------------------------------
// GET ALL TRADES
// Supports:
// ?page=1
// ?limit=20
// ?symbol=RELIANCE
// ?strategy=pullback
// -----------------------------------
router.get('/', async (req, res) => {

    try {

        const page =
            parseInt(req.query.page) || 1;

        const limit =
            parseInt(req.query.limit) || 20;

        const skip =
            (page - 1) * limit;

        const filters = {};

        // Filter by symbol
        if (req.query.symbol) {

            filters.symbol =
                req.query.symbol
                    .toUpperCase()
                    .trim();
        }

        // Filter by strategy
        if (req.query.strategy) {

            filters.strategy =
                req.query.strategy
                    .trim();
        }

        // Filter by date range
        if (req.query.startDate || req.query.endDate) {

            filters.createdAt = {};

            if (req.query.startDate) {

                filters.createdAt.$gte =
                    new Date(req.query.startDate);
            }

            if (req.query.endDate) {

                filters.createdAt.$lte =
                    new Date(req.query.endDate);
            }
        }

        const trades =
            await TradeJournal.find(filters)

                .sort({
                    createdAt: -1
                })

                .skip(skip)

                .limit(limit);

        const total =
            await TradeJournal.countDocuments(filters);

        return res.json({

            status: 'success',

            pagination: {

                page,

                limit,

                total,

                totalPages:
                    Math.ceil(total / limit)
            },

            data: trades
        });

    } catch (error) {

        console.error(
            '[TRADE JOURNAL] Fetch error:',
            error
        );

        return res.status(500).json({

            status: 'error',

            message: error.message
        });
    }
});

// -----------------------------------
// GET ANALYTICS
// -----------------------------------
router.get('/analytics', async (req, res) => {

    try {

        const analytics =
            await TradeJournal.aggregate([

                {
                    $group: {

                        _id: null,

                        totalTrades: {
                            $sum: 1
                        },

                        winningTrades: {

                            $sum: {

                                $cond: [
                                    { $gt: ['$pnlAmount', 0] },
                                    1,
                                    0
                                ]
                            }
                        },

                        losingTrades: {

                            $sum: {

                                $cond: [
                                    { $lt: ['$pnlAmount', 0] },
                                    1,
                                    0
                                ]
                            }
                        },

                        totalPnLAmount: {
                            $sum: '$pnlAmount'
                        },

                        maxProfit: {
                            $max: '$pnlAmount'
                        },

                        maxLoss: {
                            $min: '$pnlAmount'
                        },

                        grossProfit: {

                            $sum: {

                                $cond: [

                                    { $gt: ['$pnlAmount', 0] },

                                    '$pnlAmount',

                                    0
                                ]
                            }
                        },

                        grossLoss: {

                            $sum: {

                                $cond: [

                                    { $lt: ['$pnlAmount', 0] },

                                    '$pnlAmount',

                                    0
                                ]
                            }
                        },

                        avgProfit: {
                            $avg: '$pnlAmount'
                        }
                    }
                }
            ]);

        const data = analytics[0] || {};

        const totalTrades =
            data.totalTrades || 0;

        const winningTrades =
            data.winningTrades || 0;

        const losingTrades =
            data.losingTrades || 0;

        // WIN RATE
        const winRate =
            totalTrades > 0

                ? (
                    (winningTrades / totalTrades) * 100
                ).toFixed(1)

                : 0;

        // LOSS RATE
        const lossRate =
            totalTrades > 0

                ? (
                    (losingTrades / totalTrades) * 100
                ).toFixed(1)

                : 0;

        // PROFIT FACTOR
        const profitFactor =
            data.grossLoss

                ? (
                    data.grossProfit /
                    Math.abs(data.grossLoss)
                ).toFixed(2)

                : 0;

        // EXPECTANCY
        const expectancy =
            totalTrades > 0

                ? (
                    data.totalPnLAmount /
                    totalTrades
                ).toFixed(2)

                : 0;

        return res.json({

            status: 'success',

            data: {

                totalTrades,

                winningTrades,

                losingTrades,

                winRate,

                lossRate,

                totalPnLAmount:
                    (data.totalPnLAmount || 0).toFixed(2),

                maxProfit:
                    (data.maxProfit || 0).toFixed(2),

                maxLoss:
                    (data.maxLoss || 0).toFixed(2),

                avgProfit:
                    (data.avgProfit || 0).toFixed(2),

                grossProfit:
                    (data.grossProfit || 0).toFixed(2),

                grossLoss:
                    (data.grossLoss || 0).toFixed(2),

                profitFactor,

                expectancy
            }
        });

    } catch (error) {

        console.error(
            '[TRADE JOURNAL] Analytics error:',
            error
        );

        return res.status(500).json({

            status: 'error',

            message: error.message
        });
    }
});

// -----------------------------------
// GET STRATEGY ANALYTICS
// -----------------------------------
router.get('/analytics/strategy', async (req, res) => {

    try {

        const analytics =
            await TradeJournal.aggregate([

                {
                    $group: {

                        _id: '$strategy',

                        totalTrades: {
                            $sum: 1
                        },

                        totalPnL: {
                            $sum: '$pnlAmount'
                        },

                        winningTrades: {

                            $sum: {

                                $cond: [
                                    { $gt: ['$pnlAmount', 0] },
                                    1,
                                    0
                                ]
                            }
                        }
                    }
                },

                {
                    $sort: {
                        totalPnL: -1
                    }
                }
            ]);

        return res.json({

            status: 'success',

            data: analytics
        });

    } catch (error) {

        console.error(
            '[TRADE JOURNAL] Strategy analytics error:',
            error
        );

        return res.status(500).json({

            status: 'error',

            message: error.message
        });
    }
});

module.exports = router;
