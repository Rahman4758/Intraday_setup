require('dotenv').config();

const mongoose = require('mongoose');

const Stock = require('./backend/models/Stock');
const StreakState = require('./backend/models/StreakState');

const { resolveInstrumentKeys } = require('./backend/utils/instrument-resolver');
const { runFullScan } = require('./backend/services/streak-tracker');

const dbConfig = require('./backend/config/db');

// Top Nifty 50 + FNO Heavyweights
const top100 = [
  "RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "INFY", "ITC", "SBIN", "BHARTIARTL", "BAJFINANCE", "LARSEN",
  "KOTAKBANK", "AXISBANK", "HCLTECH", "ASIANPAINT", "MARUTI", "SUNPHARMA", "TITAN", "ULTRACEMCO", "TATASTEEL", "NTPC",
  "BAJAJFINSV", "POWERGRID", "M&M", "TATAMOTORS", "JSWSTEEL", "ADANIENT", "ADANIPORTS", "HINDUNILVR", "NESTLEIND", "WIPRO",
  "ONGC", "GRASIM", "HINDALCO", "TECHM", "CIPLA", "APOLLOHOSP", "DIVISLAB", "DRREDDY", "BAJAJ-AUTO", "BRITANNIA",
  "COALINDIA", "EICHERMOT", "HEROMOTOCO", "INDUSINDBK", "SBILIFE", "TATAHMMOTORS", "UPL", "BPCL", "HDFCLIFE", "SHREECEM",
  "TATASTLLP", "AMBUJACEM", "BANKBARODA", "BOSCHLTD", "CANBK", "CHOLAFIN", "COLPAL", "DABUR", "DLF", "GAIL",
  "GODREJCP", "HAVELLS", "ICICIGI", "ICICIPRULI", "IGL", "INDIGO", "NAUKRI", "JINDALSTEL", "LUPIN", "MARICO",
  "MUTHOOTFIN", "NMDC", "PIIND", "PIDILITIND", "PNB", "TORNTPHARM", "TVSMOTOR", "UNITEDSPR", "VEDL", "ZYDUSLIFE",
  "ACC", "AUROPHARMA", "BANDHANBNK", "BIOCON", "BHEL", "COROMANDEL", "CUMMINSIND", "DIXON", "ESCORTS", "GMRINFRA",
  "HAL", "HINDPETRO", "IDEA", "IDFCFIRSTB", "INDIAMART", "IEX", "JUBLFOOD", "LICHSGFIN", "M&MFIN", "NATIONALUM",
  "PFC", "RECLTD", "SAIL", "TATACHEM", "TATACOMM", "TATAPOWER", "TORNTPOWER", "UBL", "VOLTAS", "ZEEL"
];

async function processStock(symbol) {

    const upper = symbol.toUpperCase().trim();

    try {

        // Check existing stock
        let stock = await Stock.findOne({ symbol: upper });

        // Resolve keys
        let keys;

        try {
            keys = resolveInstrumentKeys(upper);
        } catch (err) {
            console.error(`[KEY ERROR] ${upper}`, err.message);
            return null;
        }

        // Skip if no EQ key
        if (!keys?.eq) {
            console.log(`[SKIPPED] No instrument key for ${upper}`);
            return null;
        }

        // Create new stock
        if (!stock) {

            stock = await Stock.create({
                symbol: upper,
                instrumentKeyEQ: keys.eq,
                instrumentKeyFO: keys.fo || keys.eq,
                sector: 'Nifty/FNO',
                isActive: true
            });

            console.log(`[ADDED] ${upper}`);

        }

        // Reactivate inactive stock
        else if (!stock.isActive) {

            stock.isActive = true;

            stock.instrumentKeyEQ = keys.eq;
            stock.instrumentKeyFO = keys.fo || keys.eq;

            await stock.save();

            console.log(`[REACTIVATED] ${upper}`);
        }

        // Create/update streak state
        await StreakState.findOneAndUpdate(
            { symbol: upper },
            { symbol: upper },
            {
                upsert: true,
                new: true
            }
        );

        return stock;

    } catch (err) {

        console.error(`[FAILED] ${upper}`, err.message);

        return null;
    }
}

async function addAndScan() {

    console.log("\n=================================");
    console.log("STARTING BULK STOCK PROCESS");
    console.log("=================================\n");

    try {

        // Connect DB
        await dbConfig();

        console.log("[DB CONNECTED]\n");

        // Parallel processing
        const results = await Promise.allSettled(
            top100.map(symbol => processStock(symbol))
        );

        // Count successful
        const successful = results.filter(
            r => r.status === 'fulfilled' && r.value
        ).length;

        console.log(`\nProcessed Stocks: ${successful}`);

        const activeCount = await Stock.countDocuments({
            isActive: true
        });

        console.log(`Active Stocks: ${activeCount}`);

        console.log("\n=================================");
        console.log("RUNNING FULL EOD SCAN");
        console.log("=================================\n");

        // Run scanner
        const scanResult = await runFullScan({
            isExpiryWeek: false,
            isPostResults: false,
            isMonday: false,
            isFiiBuying: false
        });

        console.log(
            `Scan Complete! Evaluated ${scanResult.results.length} stocks`
        );

        console.log(
            `Nifty Context Change: ${scanResult.niftyChange}%`
        );

        // Top setups
        console.log("\n========== TOP 10 SETUPS ==========\n");

        const topSetups = scanResult.results.slice(0, 10);

        topSetups.forEach((res, index) => {

            console.log(
                `${index + 1}. ${res.symbol.padEnd(12)} | Score: ${res.finalScore}/15 | Band: ${res.band}`
            );

            console.log(
                `   P1:${res.pillars.P1.score} | ` +
                `P2:${res.pillars.P2.score} | ` +
                `P3:${res.pillars.P3.score} | ` +
                `P4:${res.pillars.P4.score} | ` +
                `P5:${res.pillars.P5.score} | ` +
                `P6:${res.pillars.P6.score}`
            );

            console.log("-----------------------------------");
        });

    } catch (err) {

        console.error("\n[FATAL ERROR]", err);

    } finally {

        // Proper cleanup
        await mongoose.disconnect();

        console.log("\n[DB DISCONNECTED]");
    }
}

addAndScan();
