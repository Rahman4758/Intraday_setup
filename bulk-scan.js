require('dotenv').config();
const mongoose = require('mongoose');
const Stock = require('./backend/models/Stock');
const StreakState = require('./backend/models/StreakState');
const { resolveInstrumentKeys } = require('./backend/utils/instrument-resolver');
const { runFullScan } = require('./backend/services/streak-tracker');
const dbConfig = require('./backend/config/db');

// Top Nifty 50 + FNO Heavyweights (approx 100)
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

async function addAndScan() {
  console.log("Starting Bulk Add & Scan...");
  await dbConfig(); // Connect to MongoDB

  let added = 0;
  for (const symbol of top100) {
    const upper = symbol.toUpperCase().trim();
    
    // Check if already exists
    let stock = await Stock.findOne({ symbol: upper });
    if (!stock) {
      // Resolve keys
      let keys = { eq: '', fo: '' };
      try {
        keys = resolveInstrumentKeys(upper);
      } catch (e) {}

      if (keys.eq) { // Only add if we have an instrument key mapping
        await Stock.create({
          symbol: upper,
          instrumentKeyEQ: keys.eq,
          instrumentKeyFO: keys.fo || keys.eq,
          sector: 'Nifty/FNO',
          isActive: true
        });

        await StreakState.findOneAndUpdate(
          { symbol: upper },
          { symbol: upper },
          { upsert: true }
        );
        added++;
        console.log(`[+] Added ${upper}`);
      } else {
         console.log(`[!] Could not resolve Upstox key for ${upper}, skipping.`);
      }
    } else if (!stock.isActive) {
      stock.isActive = true;
      await stock.save();
      added++;
      console.log(`[+] Reactivated ${upper}`);
    }
  }

  console.log(`\nAdded/Reactivated ${added} stocks.`);
  console.log("Total tracked stocks:", await Stock.countDocuments({ isActive: true }));
  
  console.log("\n=================================");
  console.log("RUNNING FULL EOD SCAN FOR ALL STOCKS...");
  console.log("=================================");
  
  // Run scan
  try {
      const scanResult = await runFullScan({
          isExpiryWeek: false,
          isPostResults: false,
          isMonday: false,
          isFiiBuying: false
      });
      
      console.log(`\nScan Complete! Evaluated ${scanResult.results.length} stocks.`);
      console.log(`Nifty Change Context: ${scanResult.niftyChange}%`);
      
      // Show top 10
      console.log("\n--- TOP 10 HIGH PROBABILITY SETUPS ---");
      const top = scanResult.results.slice(0, 10);
      top.forEach((res, i) => {
          console.log(`${i+1}. ${res.symbol.padEnd(12)} | Score: ${res.finalScore}/15 | Band: ${res.band}`);
          console.log(`   Pillars: P1:${res.pillars.P1.score} P2:${res.pillars.P2.score} P3:${res.pillars.P3.score} P4:${res.pillars.P4.score} P5:${res.pillars.P5.score} P6:${res.pillars.P6.score}`);
      });
  } catch (err) {
      console.error("Scan Failed:", err);
  }

  mongoose.disconnect();
  process.exit(0);
}

addAndScan();
