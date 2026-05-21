const PILScore =
    require('../models/PILScore');

const IntradayState =
    require('../models/IntradayState');

const TradeJournal =
    require('../models/TradeJournal');

const {
    getMarketQuotes,
    getOptionChain,
    getIntradayCandles,
    getNiftyQuote
} = require('./upstox-data');

const {
    fetchIntradayCandles,
    fetchOptionChain
} = require('../utils/upstox-client');

const {
    getInstrumentMap
} = require('../utils/instrument-resolver');

const {
    calculateRSI
} = require('./rsi-calculator');

const {
    getTodayDate
} = require('../utils/date-helper');

const {
    isIntradayMarketOpen
} = require('../utils/market-hours');

const CSMC_CONFIG =
    require('../config/csmc-config');

// -----------------------------------
// ENGINE STATE
// -----------------------------------
let intervalId = null;

let isRunning = false;

let isProcessing = false;

// -----------------------------------
// SIMPLE MEMORY CACHE
// -----------------------------------
const cache = new Map();

const CACHE_TTL = {

    OPTION_CHAIN: 15000,

    CANDLES: 10000,

    NIFTY: 5000
};

// -----------------------------------
// CACHE HELPERS
// -----------------------------------
function getCache(key, ttl) {

    const cached =
        cache.get(key);

    if (!cached) {
        return null;
    }

    const age =
        Date.now() - cached.timestamp;

    if (age > ttl) {

        cache.delete(key);

        return null;
    }

    return cached.data;
}

function setCache(key, data) {

    cache.set(key, {

        data,

        timestamp: Date.now()
    });
}

// -----------------------------------
// BUILD 5M CANDLES
// -----------------------------------
function build5MinCandles(oneMinCandles) {

    const fiveMinCandles = [];

    let current5Min = null;

    for (const c of oneMinCandles) {

        const timeStr =
            c.timestamp
                .split('T')[1]
                .substring(0, 5);

        const mins =
            parseInt(
                timeStr.split(':')[1]
            );

        const blockStartMins =
            Math.floor(mins / 5) * 5;

        const blockKey =
            `${timeStr.split(':')[0]}:${blockStartMins
                .toString()
                .padStart(2, '0')}`;

        if (
            !current5Min ||
            current5Min.blockKey !== blockKey
        ) {

            if (current5Min) {

                fiveMinCandles.push(
                    current5Min
                );
            }

            current5Min = {

                blockKey,

                open: c.open,

                high: c.high,

                low: c.low,

                close: c.close,

                volume: c.volume,

                oi: c.oi,

                isGreen:
                    c.close > c.open,

                isRed:
                    c.close < c.open
            };

        } else {

            current5Min.high =
                Math.max(
                    current5Min.high,
                    c.high
                );

            current5Min.low =
                Math.min(
                    current5Min.low,
                    c.low
                );

            current5Min.close =
                c.close;

            current5Min.volume +=
                c.volume;

            current5Min.oi =
                c.oi;

            current5Min.isGreen =
                current5Min.close >
                current5Min.open;

            current5Min.isRed =
                current5Min.close <
                current5Min.open;
        }
    }

    if (current5Min) {

        fiveMinCandles.push(
            current5Min
        );
    }

    return fiveMinCandles;
}

// -----------------------------------
// LIVE OPTION LEVELS
// -----------------------------------
function getLiveLevels(
    chain,
    currentPrice
) {

    if (
        !chain ||
        !chain.strikes
    ) {

        return {

            support: 0,

            resistance: 0
        };
    }

    const supportStrikes =
        chain.strikes.filter(
            s =>
                s.strikePrice <
                currentPrice
        );

    const maxPut =
        supportStrikes.length > 0

            ? supportStrikes.reduce(
                  (prev, curr) =>
                      curr.putOI >
                      prev.putOI
                          ? curr
                          : prev
              )

            : null;

    const resistanceStrikes =
        chain.strikes.filter(
            s =>
                s.strikePrice >
                currentPrice
        );

    const maxCall =
        resistanceStrikes.length > 0

            ? resistanceStrikes.reduce(
                  (prev, curr) =>
                      curr.callOI >
                      prev.callOI
                          ? curr
                          : prev
              )

            : null;

    return {

        support:
            maxPut?.strikePrice || 0,

        resistance:
            maxCall?.strikePrice || 0
    };
}

// -----------------------------------
// ZERO-DEPENDENCY CONCURRENCY LIMITER
// -----------------------------------
function pLimit(concurrency) {
    let activeCount = 0;
    const queue = [];

    const next = () => {
        activeCount--;
        if (queue.length > 0) {
            queue.shift()();
        }
    };

    return (fn) => new Promise((resolve, reject) => {
        const run = () => {
            activeCount++;
            const promise = Promise.resolve().then(fn);
            resolve(promise);
            promise.then(next, next);
        };

        if (activeCount < concurrency) {
            run();
        } else {
            queue.push(run);
        }
    });
}

// -----------------------------------
// MAIN ENGINE
// -----------------------------------
async function processTick(io = null) {

    // ENGINE OFF
    if (!isRunning) {
        return;
    }

    // PREVENT OVERLAPPING RUNS
    if (isProcessing) {

        console.log(
            '[CSMC] Previous tick still running...'
        );

        return;
    }

    // MARKET CLOSED
    if (!isIntradayMarketOpen()) {

        console.log(
            '[CSMC] Market closed.'
        );

        return;
    }

    isProcessing = true;

    const today =
        getTodayDate();

    try {

        // -----------------------------------
        // FETCH NIFTY ONCE
        // -----------------------------------
        let nifty =
            getCache(
                'nifty',
                CACHE_TTL.NIFTY
            );

        if (!nifty) {

            nifty =
                await getNiftyQuote();

            setCache(
                'nifty',
                nifty
            );
        }

        // -----------------------------------
        // FETCH A-LIST STOCKS
        // -----------------------------------
        const latestScores =
            await PILScore.aggregate([

                {
                    $sort: {
                        date: -1
                    }
                },

                {
                    $group: {

                        _id: '$symbol',

                        latestScore: {
                            $first:
                                '$$ROOT'
                        }
                    }
                },

                {
                    $replaceRoot: {
                        newRoot:
                            '$latestScore'
                    }
                },

                {
                    $match: {

                        finalScore: {
                            $gte: 7
                        }
                    }
                },

                {
                    $limit:
                        CSMC_CONFIG
                            .MAX_ACTIVE_STOCKS
                }
            ]);

        const aList =
            latestScores.map(
                s => s.symbol
            );

        if (aList.length === 0) {

            isProcessing = false;

            return;
        }

        // -----------------------------------
        // EXISTING STATES
        // -----------------------------------
        const states =
            await IntradayState.find({
                date: today
            });

        const stateMap = {};

        states.forEach(state => {

            stateMap[state.symbol] =
                state;
        });

        // -----------------------------------
        // INSTRUMENT MAP
        // -----------------------------------
        const instrumentMap =
            getInstrumentMap();

        const keys =
            aList
                .map(
                    symbol =>
                        instrumentMap[symbol]
                )
                .filter(Boolean);

        // -----------------------------------
        // BULK QUOTES
        // -----------------------------------
        const quotes =
            await getMarketQuotes(keys);

        // -----------------------------------
        // PROCESS STOCKS (Parallelized)
        // -----------------------------------
        const processStock = async (symbol) => {
            try {

                const key =
                    instrumentMap[symbol];

                if (!key) {
                    return;
                }

                let state =
                    stateMap[symbol];

                // CREATE STATE
                if (!state) {

                    state =
                        new IntradayState({

                            symbol,

                            date: today,

                            status:
                                'WAITING_COMPRESSION'
                        });

                    await state.save();

                    stateMap[symbol] =
                        state;
                }

                // SKIP FINISHED
                if (
                    [
                        'EXITED',
                        'ABORTED'
                    ].includes(
                        state.status
                    )
                ) {

                    return;
                }

                const quote =
                    quotes[key];

                if (!quote) {
                    return;
                }

                // LIVE DATA
                state.cmp =
                    quote.ltp;

                state.liveOI =
                    quote.oi;

                state.liveVolume =
                    quote.volume;

                // -----------------------------------
                // OPTION CHAIN CACHE (Centralized)
                // -----------------------------------
                let optionChain =
                    await fetchOptionChain(
                        getOptionChain,
                        key,
                        ''
                    );

                // LIVE LEVELS
                const levels =
                    getLiveLevels(
                        optionChain,
                        state.cmp
                    );

                state.liveSupport =
                    levels.support;

                state.liveResistance =
                    levels.resistance;

                // -----------------------------------
                // CANDLE CACHE (Centralized)
                // -----------------------------------
                let candles1m =
                    await fetchIntradayCandles(
                        getIntradayCandles,
                        key
                    );

                const candles5m =
                    build5MinCandles(
                        candles1m
                    );

                const closes5m =
                    candles5m.map(
                        c => c.close
                    );

                // -----------------------------------
                // RSI
                // -----------------------------------
                let liveRSI = 0;

                if (
                    closes5m.length >= 15
                ) {

                    const rsiData =
                        calculateRSI(
                            closes5m,
                            14
                        );

                    liveRSI =
                        rsiData?.rsi || 0;

                    state.liveRSI =
                        liveRSI;
                }

                // -----------------------------------
                // MARKET ABORT
                // -----------------------------------
                if (

                    nifty?.changePercent <
                    CSMC_CONFIG
                        .NIFTY_ABORT_THRESHOLD &&

                    !['ACTIVE']
                        .includes(
                            state.status
                        )

                ) {

                    state.status =
                        'ABORTED';

                    state.invalidationReason =
                        'NIFTY_CRASH';

                    await state.save();

                    return;
                }

                // -----------------------------------
                // FSM LOGIC
                // -----------------------------------

                // WAITING
                if (
                    state.status ===
                    'WAITING_COMPRESSION'
                ) {

                    if (
                        candles5m.length >=
                        6
                    ) {

                        const first30m =
                            candles5m.slice(
                                0,
                                6
                            );

                        const maxHigh =
                            Math.max(
                                ...first30m.map(
                                    c => c.high
                                )
                            );

                        const minLow =
                            Math.min(
                                ...first30m.map(
                                    c => c.low
                                )
                            );

                        const rangePct =
                            (
                                (
                                    maxHigh -
                                    minLow
                                ) /
                                minLow
                            ) * 100;

                        state.dayHigh =
                            maxHigh;

                        state.dayLow =
                            minLow;

                        state.compressionRangePct =
                            rangePct;

                        if (

                            rangePct <
                                CSMC_CONFIG
                                    .MAX_COMPRESSION_RANGE &&

                            liveRSI >
                                CSMC_CONFIG
                                    .MIN_COMPRESSION_RSI

                        ) {

                            state.status =
                                'COMPRESSION_FORMED';

                        } else {

                            state.status =
                                'ABORTED';

                            state.invalidationReason =
                                rangePct >=
                                CSMC_CONFIG
                                    .MAX_COMPRESSION_RANGE

                                    ? 'RANGE_TOO_WIDE'

                                    : 'RSI_TOO_LOW';
                        }
                    }
                }

                // CORRECTION DETECTION
                else if (
                    state.status ===
                    'COMPRESSION_FORMED'
                ) {

                    const pullbackPct =
                        (
                            (
                                state.dayHigh -
                                state.cmp
                            ) /
                            state.dayHigh
                        ) * 100;

                    if (
                        liveRSI <
                        CSMC_CONFIG
                            .MIN_PULLBACK_RSI
                    ) {

                        state.status =
                            'ABORTED';

                        state.invalidationReason =
                            'RSI_BROKE_55';

                    } else if (

                        pullbackPct >=
                            CSMC_CONFIG
                                .MIN_PULLBACK_PCT &&

                        pullbackPct <=
                            CSMC_CONFIG
                                .MAX_PULLBACK_PCT

                    ) {

                        state.status =
                            'CORRECTING';

                        state.pullbackLow =
                            state.cmp;

                    } else if (

                        pullbackPct >
                        CSMC_CONFIG
                            .MAX_INVALID_PULLBACK

                    ) {

                        state.status =
                            'ABORTED';

                        state.invalidationReason =
                            'DEEP_PULLBACK';
                    }
                }

                // ACTIVE CORRECTION
                else if (
                    state.status ===
                    'CORRECTING'
                ) {

                    if (
                        liveRSI <
                        CSMC_CONFIG
                            .MIN_PULLBACK_RSI
                    ) {

                        state.status =
                            'ABORTED';

                        state.invalidationReason =
                            'RSI_BROKE_55';

                    } else {

                        if (
                            state.cmp <
                            state.pullbackLow
                        ) {

                            state.pullbackLow =
                                state.cmp;
                        }

                        // ENTRY TRIGGER
                        if (

                            state.cmp >
                                state.dayHigh &&

                            liveRSI >
                                CSMC_CONFIG
                                    .ENTRY_RSI

                        ) {

                            state.status =
                                'ACTIVE';

                            state.entryPrice =
                                state.cmp;

                            state.stopLoss =
                                state.pullbackLow *
                                0.999;

                            state.target1 =
                                state.entryPrice *
                                1.01;

                            state.target2 =
                                state.entryPrice *
                                1.02;

                            state.tradeStartTime =
                                new Date();

                            // POSITION SIZING
                            const riskAmount =
                                CSMC_CONFIG
                                    .RISK_AMOUNT;

                            const riskPerShare =
                                state.entryPrice -
                                state.stopLoss;

                            // SAFETY CHECK
                            if (
                                riskPerShare <= 0
                            ) {

                                state.status =
                                    'ABORTED';

                                state.invalidationReason =
                                    'INVALID_RISK';

                                await state.save();

                                return;
                            }

                            state.quantity =
                                Math.floor(
                                    riskAmount /
                                    riskPerShare
                                );

                            // MAX POSITION LIMIT
                            state.quantity =
                                Math.min(

                                    state.quantity,

                                    CSMC_CONFIG
                                        .MAX_POSITION_SIZE
                                );

                            if (
                                state.quantity < 1
                            ) {

                                state.quantity = 1;
                            }
                        }
                    }
                }

                // ACTIVE TRADE
                else if (
                    state.status ===
                    'ACTIVE'
                ) {

                    state.currentPnL =
                        (
                            (
                                state.cmp -
                                state.entryPrice
                            ) /
                            state.entryPrice
                        ) * 100;

                    state.currentPnLAmount =
                        (
                            state.cmp -
                            state.entryPrice
                        ) *
                        state.quantity;

                    // BREAKEVEN STOP
                    if (

                        state.cmp >=
                            state.target1 &&

                        state.stopLoss <
                            state.entryPrice

                    ) {

                        state.stopLoss =
                            state.entryPrice;
                    }

                    let isExited =
                        false;

                    // TARGET
                    if (
                        state.cmp >=
                        state.target2
                    ) {

                        state.status =
                            'EXITED';

                        state.invalidationReason =
                            'TARGET_HIT';

                        isExited = true;
                    }

                    // STOP LOSS
                    else if (
                        state.cmp <=
                        state.stopLoss
                    ) {

                        state.status =
                            'EXITED';

                        state.invalidationReason =
                            'STOP_LOSS_HIT';

                        isExited = true;
                    }

                    // RSI LOSS
                    else if (
                        liveRSI <
                        CSMC_CONFIG
                            .MIN_PULLBACK_RSI
                    ) {

                        state.status =
                            'EXITED';

                        state.invalidationReason =
                            'RSI_BREAKDOWN';

                        isExited = true;
                    }

                    // LIVE RESISTANCE
                    else if (

                        state.liveResistance &&

                        state.cmp >=
                            state.liveResistance

                    ) {

                        state.status =
                            'EXITED';

                        state.invalidationReason =
                            'HIT_RESISTANCE';

                        isExited = true;
                    }

                    // JOURNAL ENTRY
                    if (isExited) {

                        state.tradeEndTime =
                            new Date();

                        await TradeJournal.create({

                            symbol:
                                state.symbol,

                            date:
                                state.date,

                            quantity:
                                state.quantity,

                            entryPrice:
                                state.entryPrice,

                            initialStopLoss:
                                state.pullbackLow *
                                0.999,

                            entryTime:
                                state.tradeStartTime,

                            exitPrice:
                                state.cmp,

                            exitTime:
                                state.tradeEndTime,

                            exitReason:
                                state.invalidationReason,

                            pnlAmount:
                                state.currentPnLAmount,

                            pnlPercent:
                                state.currentPnL,

                            compressionRangePct:
                                state.compressionRangePct,

                            liveRSIAtEntry:
                                liveRSI
                        });
                    }
                }

                state.lastUpdated =
                    new Date();

                await state.save();

                // SOCKET UPDATE
                if (io) {

                    io.emit(
                        'intraday-update',
                        {
                            symbol:
                                state.symbol,

                            status:
                                state.status,

                            cmp:
                                state.cmp,

                            pnl:
                                state.currentPnL,

                            updatedAt:
                                state.lastUpdated
                        }
                    );
                }

            } catch (stockError) {

                console.error(

                    `[CSMC] ${symbol} error:`,

                    stockError
                );
            }
        };

        const limit = pLimit(CSMC_CONFIG.POLL_CONCURRENCY || 4);
        await Promise.all(aList.map(symbol => limit(() => processStock(symbol))));

    } catch (err) {

        console.error(
            '[CSMC] Tick error:',
            err
        );

    } finally {

        isProcessing = false;
    }
}

// -----------------------------------
// START ENGINE
// -----------------------------------
function startIntradayEngine(io = null) {

    if (isRunning) {

        console.log(
            '[CSMC] Engine already running.'
        );

        return;
    }

    isRunning = true;

    console.log(
        '[CSMC] Starting Intraday Engine...'
    );

    processTick(io);

    intervalId =
        setInterval(() => {

            processTick(io);

        }, CSMC_CONFIG.POLL_INTERVAL);
}

// -----------------------------------
// STOP ENGINE
// -----------------------------------
function stopIntradayEngine() {

    if (!isRunning) {
        return;
    }

    isRunning = false;

    clearInterval(intervalId);

    console.log(
        '[CSMC] Intraday Engine stopped.'
    );
}

// -----------------------------------
// STATUS
// -----------------------------------
function isIntradayEngineRunning() {

    return isRunning;
}

module.exports = {

    startIntradayEngine,

    stopIntradayEngine,

    isIntradayEngineRunning
};
