require('dotenv').config();
const { runFullScan } = require('./backend/services/streak-tracker');
const dbConfig = require('./backend/config/db');
const mongoose = require('mongoose');

async function testScan() {
    await dbConfig();
    console.log("RUNNING FULL EOD SCAN...");
    
    try {
        const scanResult = await runFullScan({
            isExpiryWeek: false,
            isPostResults: false,
            isMonday: false,
            isFiiBuying: false
        });
        
        console.log(`\nScan Complete! Evaluated ${scanResult.results.length} stocks.`);
        console.log("\n--- TOP 10 HIGH PROBABILITY SETUPS ---");
        const top = scanResult.results.slice(0, 10);
        top.forEach((res, i) => {
            console.log(`${i+1}. ${res.symbol.padEnd(12)} | Score: ${res.finalScore}/15 | Band: ${res.band}`);
            console.log(`   Pillars: P1(OI):${res.pillars.P1.score} P2:${res.pillars.P2.score} P3:${res.pillars.P3.score} P4:${res.pillars.P4.score} P5:${res.pillars.P5.score} P6(Opt):${res.pillars.P6.score}`);
            if (res.pillars.P1.score > 0) console.log(`      P1 Reason: ${res.pillars.P1.meta.reason}`);
            if (res.pillars.P6.score > 0) console.log(`      P6 Reason: ${res.pillars.P6.meta.reason}`);
        });
    } catch (err) {
        console.error("Scan Failed:", err);
    }
    
    mongoose.disconnect();
}
testScan();
