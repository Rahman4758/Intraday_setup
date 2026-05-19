/**
 * CSMC Intraday Engine Configuration
 * Compression → Correction → Momentum Continuation strategy parameters
 */

module.exports = {

  // Max stocks to track intraday (fetched from latest PIL scores)
  MAX_ACTIVE_STOCKS: 20,

  // Nifty % drop threshold below which all non-active trades are aborted (market crash guard)
  NIFTY_ABORT_THRESHOLD: -1.5,

  // Max first-30-minute price range % for compression to be valid (tight range = coiled spring)
  MAX_COMPRESSION_RANGE: 1.0,

  // Minimum RSI at compression time (stock must be in an uptrend)
  MIN_COMPRESSION_RSI: 55,

  // Minimum RSI during pullback phase (stock must stay above this RSI, else abort)
  MIN_PULLBACK_RSI: 55,

  // Minimum pullback % from day high to qualify as a valid correction
  MIN_PULLBACK_PCT: 0.3,

  // Maximum pullback % from day high (beyond this the move is too deep, not a correction)
  MAX_PULLBACK_PCT: 2.0,

  // Pullback % beyond which the trade is aborted as a deep dump
  MAX_INVALID_PULLBACK: 3.0,

  // Minimum RSI required when price breaks above day high to trigger entry
  ENTRY_RSI: 60,

  // Risk amount in INR per trade (1% of 1 Lakh portfolio)
  RISK_AMOUNT: 1000,

  // Maximum shares per position (safety cap)
  MAX_POSITION_SIZE: 500,

  // How often the engine processes a new tick (in milliseconds) — 30 seconds
  POLL_INTERVAL: 30000,
};
