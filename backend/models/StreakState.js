const mongoose = require('mongoose');

const streakStateSchema = new mongoose.Schema({
  symbol: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  lastDate: {
    type: String,
    default: ''
  },

  // P1 — OI Streak
  P1_streak: { type: Number, default: 0 },
  P1_lastOI: { type: Number, default: 0 },

  // P2 — ATR Compression
  P2_streak: { type: Number, default: 0 },
  P2_lastRange: { type: Number, default: 0 },

  // P3 — Relative Strength
  P3_streak: { type: Number, default: 0 },

  // P4 — Volume Dry-Up
  P4_streak: { type: Number, default: 0 },
  P4_lastVolume: { type: Number, default: 0 },

  // P5 — RSI
  P5_lastRSI: { type: Number, default: 0 },

  // P6 — Options
  P6_ivDeclineDays: { type: Number, default: 0 },
  P6_lastIV: { type: Number, default: 0 },
  P6_lastPutOI: { type: Number, default: 0 },
  P6_lastCallOI: { type: Number, default: 0 },

  // Full reset flag
  isFullReset: { type: Boolean, default: false }
});

module.exports = mongoose.model('StreakState', streakStateSchema);
