const mongoose = require('mongoose');

const signalDetailSchema = new mongoose.Schema({
  score: { type: Number, default: 0 },
  flag: { type: String, default: '' },
  reason: { type: String, default: '' }
}, { _id: false });

const entryZoneSchema = new mongoose.Schema({
  entryPrice: { type: Number, default: 0 },
  stopLoss:   { type: Number, default: 0 },
  target1:    { type: Number, default: 0 },
  target2:    { type: Number, default: 0 },
  riskPoints: { type: Number, default: 0 }
}, { _id: false });

const pullbackScanSchema = new mongoose.Schema({
  symbol:     { type: String, required: true, uppercase: true, trim: true },
  date:       { type: String, required: true },  // YYYY-MM-DD
  scannedAt:  { type: Date,   default: Date.now },

  // PQS result
  pqs:        { type: Number, default: 0 },
  grade:      { type: String, default: 'WEAK' },
  band:       { type: String, default: 'WEAK' },
  color:      { type: String, default: '#4a5568' },
  action:     { type: String, default: '' },
  reason:     { type: String, default: '' },
  positionFactor: { type: Number, default: 0 },

  // Trend state
  trendIntact: { type: Boolean, default: false },
  inPullback:  { type: Boolean, default: false },
  pilScore:    { type: Number, default: 0 },   // From last EOD PIL scan

  // Prerequisite checks
  prereqChecks: {
    aboveVWAP:        { type: Boolean, default: false },
    ema20SlopingUp:   { type: Boolean, default: false },
    hhhlVisible:      { type: Boolean, default: false },
    rsiWas55:         { type: Boolean, default: false },
    openAbovePrevClose: { type: Boolean, default: false },
    niftyAligned:     { type: Boolean, default: false }
  },

  // 8 Signals
  signals: {
    S1_vol:    { type: signalDetailSchema, default: () => ({}) },
    S2_oi:     { type: signalDetailSchema, default: () => ({}) },
    S3_rsi:    { type: signalDetailSchema, default: () => ({}) },
    S4_level:  { type: signalDetailSchema, default: () => ({}) },
    S5_fib:    { type: signalDetailSchema, default: () => ({}) },
    S6_bounce: { type: signalDetailSchema, default: () => ({}) },
    S7_hl:     { type: signalDetailSchema, default: () => ({}) },
    S8_ema:    { type: signalDetailSchema, default: () => ({}) }
  },

  // Market data snapshot
  currentPrice:     { type: Number, default: 0 },
  vwap:             { type: Number, default: 0 },
  ema20:            { type: Number, default: 0 },
  ema9:             { type: Number, default: 0 },
  sessionHigh:      { type: Number, default: 0 },
  pullbackLow:      { type: Number, default: 0 },
  pullbackDepthPct: { type: Number, default: 0 },
  currentRSI:       { type: Number, default: 0 },
  sessionAvgVol:    { type: Number, default: 0 },

  // Entry zone
  entryZone: { type: entryZoneSchema, default: () => ({}) }

}, { timestamps: true });

// Index: latest scan per symbol per day — allow multiple scans per day (live refresh)
pullbackScanSchema.index({ symbol: 1, date: 1, scannedAt: -1 });
pullbackScanSchema.index({ date: 1, pqs: -1 });

module.exports = mongoose.model('PullbackScan', pullbackScanSchema);
