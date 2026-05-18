const mongoose = require('mongoose');

const stockSchema = new mongoose.Schema({
  symbol: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
  },
  instrumentKeyEQ: {
    type: String,
    default: ''
  },
  instrumentKeyFO: {
    type: String,
    default: ''
  },
  foExpiry: {
    type: String,
    default: ''
  },
  sector: {
    type: String,
    default: 'Unknown'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  addedAt: {
    type: Date,
    default: Date.now
  }
});

stockSchema.index({ isActive: 1 });

module.exports = mongoose.model('Stock', stockSchema);
