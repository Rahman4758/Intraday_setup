const mongoose = require('mongoose');

const intradayStateSchema = new mongoose.Schema({
  symbol: { type: String, required: true },
  date: { type: String, required: true }, // YYYY-MM-DD format
  
  // High-level State Machine
  // WAITING_COMPRESSION -> COMPRESSION_FORMED -> CORRECTING -> BOUNCE_TRIGGERED -> ACTIVE -> EXITED / ABORTED
  status: { type: String, default: 'WAITING_COMPRESSION' },
  invalidationReason: { type: String },

  // Tracking Data (updated every 15 sec)
  cmp: { type: Number },
  liveRSI: { type: Number },
  liveOI: { type: Number },
  liveVolume: { type: Number },
  liveSupport: { type: Number },
  liveResistance: { type: Number },

  // Phase 1: Compression Baseline
  dayOpen: { type: Number },
  dayHigh: { type: Number },
  dayLow: { type: Number },
  compressionRangePct: { type: Number },

  // Phase 2: Triggers
  pullbackLow: { type: Number },
  bouncePrice: { type: Number },

  // Phase 3: Trade Execution
  quantity: { type: Number },
  entryPrice: { type: Number },
  stopLoss: { type: Number },
  target1: { type: Number },
  target2: { type: Number },
  currentPnL: { type: Number }, // Percent
  currentPnLAmount: { type: Number }, // Actual INR
  
  // Metrics
  tradeStartTime: { type: Date },
  tradeEndTime: { type: Date },

  lastUpdated: { type: Date, default: Date.now }
});

// Index for fast querying by date
intradayStateSchema.index({ date: 1, symbol: 1 }, { unique: true });

module.exports = mongoose.model('IntradayState', intradayStateSchema);
