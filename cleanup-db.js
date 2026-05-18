require('dotenv').config();
const PILScore = require('./backend/models/PILScore');
const dbConfig = require('./backend/config/db');
const mongoose = require('mongoose');

async function clean() {
    await dbConfig();
    const res = await PILScore.deleteMany({ finalScore: { $lt: 7 } });
    console.log(`Deleted ${res.deletedCount} scores with value less than 7.`);
    mongoose.disconnect();
}
clean();
