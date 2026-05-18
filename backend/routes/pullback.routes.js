const express = require('express');
const router = express.Router();
const PullbackScan = require('../models/PullbackScan');
const PILScore = require('../models/PILScore');
const { runPullbackScan } = require('../utils/pullback-poller');

/**
 * POST /api/pullback/scan
 * Trigger a one-shot scan of all A-List stocks (PIL score >= 7)
 */
router.post('/scan', async (req, res) => {
  try {
    const results = await runPullbackScan();
    res.json({
      success: true,
      count: results.length,
      results,
      scannedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('[PULLBACK] Scan error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/pullback/live
 * Get the latest PQS result for all stocks today, sorted by PQS desc
 * Used by the frontend to poll every 30 seconds
 */
router.get('/live', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Get the latest scan result per symbol for today
    const results = await PullbackScan.aggregate([
      { $match: { date: today } },
      { $sort: { scannedAt: -1 } },
      {
        $group: {
          _id: '$symbol',
          doc: { $first: '$$ROOT' }
        }
      },
      { $replaceRoot: { newRoot: '$doc' } },
      { $sort: { pqs: -1 } }
    ]);

    // Separate into categories for the UI
    const setups = results.filter(r => r.pqs >= 4 && r.inPullback);
    const watching = results.filter(r => r.trendIntact && !r.inPullback);
    const invalid = results.filter(r => !r.trendIntact);

    res.json({
      date: today,
      totalScanned: results.length,
      setups,       // Active pullback setups (PQS >= 4)
      watching,     // Trend intact but not in pullback yet
      invalid,      // Trend not intact — skipped
      lastRefresh: new Date().toISOString()
    });
  } catch (err) {
    console.error('[PULLBACK] Live fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/pullback/stock/:symbol
 * Get the latest PQS detail for a single stock today
 */
router.get('/stock/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const today = new Date().toISOString().split('T')[0];

    const latest = await PullbackScan.findOne({ symbol, date: today })
      .sort({ scannedAt: -1 });

    if (!latest) {
      return res.status(404).json({ error: `No pullback scan found for ${symbol} today` });
    }
    res.json(latest);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/pullback/status
 * Get poller status and today's setup count
 */
router.get('/status', async (req, res) => {
  try {
    const { isPollerRunning } = require('../utils/pullback-poller');
    const today = new Date().toISOString().split('T')[0];
    const setupCount = await PullbackScan.countDocuments({ date: today, pqs: { $gte: 4 }, inPullback: true });
    res.json({
      pollerRunning: isPollerRunning(),
      setupsToday: setupCount,
      date: today
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/pullback/engine/start
 * Manually start the 30-second pullback poller
 */
router.post('/engine/start', (req, res) => {
  const { startPullbackPoller, isPollerRunning } = require('../utils/pullback-poller');
  if (isPollerRunning()) {
    return res.json({ message: 'Pullback poller already running' });
  }
  startPullbackPoller();
  res.json({ message: 'Pullback poller started (30s interval)' });
});

/**
 * POST /api/pullback/engine/stop
 * Manually stop the pullback poller
 */
router.post('/engine/stop', (req, res) => {
  const { stopPullbackPoller } = require('../utils/pullback-poller');
  stopPullbackPoller();
  res.json({ message: 'Pullback poller stopped' });
});

module.exports = router;
