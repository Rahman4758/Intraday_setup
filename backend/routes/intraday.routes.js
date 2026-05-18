const express = require('express');
const router = express.Router();
const IntradayState = require('../models/IntradayState');
const { startIntradayEngine, stopIntradayEngine } = require('../services/csmc-intraday-engine');

// Get today's live intraday radar states
router.get('/live', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const states = await IntradayState.find({ date: today }).sort({ _id: -1 });
    res.json({ status: 'success', data: states });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Control the engine
router.post('/engine/:action', (req, res) => {
  const { action } = req.params;
  const { isIntradayMarketOpen } = require('../utils/market-hours');

  if (action === 'start') {
    if (!isIntradayMarketOpen()) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Market is closed. Intraday Engine can only be started during market hours (Mon-Fri, 9:15 AM - 3:30 PM).' 
      });
    }
    startIntradayEngine();
    res.json({ status: 'success', message: 'Intraday engine started (15s polling)' });
  } else if (action === 'stop') {
    stopIntradayEngine();
    res.json({ status: 'success', message: 'Intraday engine stopped' });
  } else {
    res.status(400).json({ status: 'error', message: 'Invalid action' });
  }
});

module.exports = router;
