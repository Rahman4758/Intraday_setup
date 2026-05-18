const mongoose = require('mongoose');

const tradeJournalSchema = new mongoose.Schema({
  symbol: { type: String, required: true },
  date: { type: String, required: true }, // YYYY-MM-DD
  
  // Trade Parameters
  quantity: { type: Number, required: true },
  entryPrice: { type: Number, required: true },
  initialStopLoss: { type: Number },
  entryTime: { type: Date, required: true },
  
  // Exit Details
  exitPrice: { type: Number },
  exitTime: { type: Date },
  exitReason: { type: String }, // 'TARGET_HIT', 'STOP_LOSS_HIT', 'RSI_BROKE_55', etc.
  
  // Performance
  pnlAmount: { type: Number }, // Actual ₹ Profit/Loss
  pnlPercent: { type: Number }, // % Return on capital used

  // Metadata
  compressionRangePct: { type: Number },
  liveRSIAtEntry: { type: Number },
  
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('TradeJournal', tradeJournalSchema);
