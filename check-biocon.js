require('dotenv').config();
const mongoose = require('mongoose');
const PILScore = require('./backend/models/PILScore');
const dbConfig = require('./backend/config/db');

async function checkBiocon() {
    await dbConfig();
    const s = await PILScore.findOne({ symbol: 'BIOCON', date: '2026-05-12' });
    console.log(JSON.stringify(s, null, 2));
    mongoose.disconnect();
}
checkBiocon();
