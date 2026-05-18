require('dotenv').config();
const mongoose = require('mongoose');
const Stock = require('./backend/models/Stock');
const FuturesKeyBuilder = require('./backend/utils/FuturesKeyBuilder');
const dbConfig = require('./backend/config/db');

async function updateStocks() {
  console.log("Connecting to DB...");
  await dbConfig();

  const stocks = await Stock.find({});
  const symbols = stocks.map(s => s.symbol);
  
  console.log(`Building Futures Map for ${symbols.length} symbols...`);
  const futuresMap = await FuturesKeyBuilder.getFuturesMap(symbols);

  let updated = 0;
  for (const stock of stocks) {
    const foData = futuresMap[stock.symbol];
    if (foData && foData.isFo) {
      stock.instrumentKeyFO = foData.key;
      stock.foExpiry = foData.expiry;
      await stock.save();
      updated++;
      console.log(`[+] Updated ${stock.symbol} -> FO Key: ${foData.key}, Expiry: ${foData.expiry}`);
    } else {
      console.log(`[-] ${stock.symbol} has no active futures. Defaulting to EQ data.`);
      stock.instrumentKeyFO = stock.instrumentKeyEQ;
      stock.foExpiry = null;
      await stock.save();
    }
  }

  console.log(`\nSuccessfully updated F&O data for ${updated}/${stocks.length} stocks.`);
  mongoose.disconnect();
  process.exit(0);
}

updateStocks();
