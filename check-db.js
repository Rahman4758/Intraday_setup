require('dotenv').config();
const mongoose = require('mongoose');
const PILScore = require('./backend/models/PILScore');
const dbConfig = require('./backend/config/db');

async function checkData() {
    await dbConfig();
    const today = new Date().toISOString().split('T')[0];
    console.log("Searching for date:", today);
    
    const count = await PILScore.countDocuments({ date: today });
    console.log(`Found ${count} records for ${today}`);

    const latest = await PILScore.find().sort({ date: -1 }).limit(10);
    latest.forEach(s => {
        console.log(`${s.symbol.padEnd(12)} | Date: ${s.date} | Score: ${s.finalScore}`);
    });

    mongoose.disconnect();
}
checkData();
