const mongoose = require('mongoose');
const dns = require('dns');

// Force DNS fix for Windows SRV issues (proven from Stock-Trading-code)
dns.setServers(['8.8.8.8', '8.8.4.4']);
dns.setDefaultResultOrder('ipv4first');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 15000,
      family: 4
    });
    console.log(`[DB] MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
    return true;
  } catch (err) {
    console.error(`[DB] MongoDB connection error: ${err.message}`);
    console.error('[DB] Server will start but DB endpoints will fail.');
    return false;
  }
};

module.exports = connectDB;
