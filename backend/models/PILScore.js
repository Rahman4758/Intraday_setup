const mongoose = require('mongoose');

const pillarDetailSchema = new mongoose.Schema({
  score: { type: Number, default: 0 },
  streak: { type: Number, default: 0 },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { _id: false });

const pilScoreSchema = new mongoose.Schema({
  symbol: {
    type: String,
    required: true,
    uppercase: true,
    trim: true
  },
  date: {
    type: String,
    required: true
  },
  pillars: {
    P1: { type: pillarDetailSchema, default: () => ({}) },
    P2: { type: pillarDetailSchema, default: () => ({}) },
    P3: { type: pillarDetailSchema, default: () => ({}) },
    P4: { type: pillarDetailSchema, default: () => ({}) },
    P5: { type: pillarDetailSchema, default: () => ({}) },
    P6: { type: pillarDetailSchema, default: () => ({}) }
  },
  baseScore: {
    type: Number,
    default: 0
  },
  amplifiers: {
    isExpiryWeek: { type: Boolean, default: false },
    postResultsDayNum: { type: Number, default: 0 },
    isMonday: { type: Boolean, default: false },
    fiiBuyStreak: { type: Number, default: 0 },
    multiplier: { type: Number, default: 1 },
    bonusPoints: { type: Number, default: 0 }
  },
  finalScore: {
    type: Number,
    default: 0
  },
  band: {
    type: String,
    enum: ['NOT_READY', 'BUILDING', 'ALERT', 'IGNITION', 'EXPLOSIVE'],
    default: 'NOT_READY'
  },
  action: {
    type: String,
    default: ''
  },
  invalidations: [{
    type: String
  }],
  rawData: {
    open: Number,
    high: Number,
    low: Number,
    close: Number,
    volume: Number,
    oi: Number,
    rsi: Number,
    stockChange: Number,
    niftyChange: Number,
    prevClose: Number
  },
  history: [{
    date: { type: String },
    close: { type: Number },
    oi: { type: Number },
    volume: { type: Number },
    rsi: { type: Number },
    range: { type: Number }
  }]
}, {
  timestamps: true
});

pilScoreSchema.index({ symbol: 1, date: -1 }, { unique: true });
pilScoreSchema.index({ date: -1, finalScore: -1 });

module.exports = mongoose.model('PILScore', pilScoreSchema);
