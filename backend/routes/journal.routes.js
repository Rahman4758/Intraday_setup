const express = require('express');
const router = express.Router();
const TradeJournal = require('../models/TradeJournal');

// Fetch all trades in the journal
router.get('/', async (req, res) => {
  try {
    const trades = await TradeJournal.find().sort({ createdAt: -1 });
    res.json({ status: 'success', data: trades });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Fetch high-level analytics
router.get('/analytics', async (req, res) => {
  try {
    const trades = await TradeJournal.find();
    
    let totalTrades = trades.length;
    let winningTrades = 0;
    let totalPnLAmount = 0;
    let maxProfit = 0;
    let maxLoss = 0;

    trades.forEach(t => {
      totalPnLAmount += (t.pnlAmount || 0);
      if (t.pnlAmount > 0) winningTrades++;
      if (t.pnlAmount > maxProfit) maxProfit = t.pnlAmount;
      if (t.pnlAmount < maxLoss) maxLoss = t.pnlAmount;
    });

    const winRate = totalTrades > 0 ? ((winningTrades / totalTrades) * 100).toFixed(1) : 0;
    
    res.json({
      status: 'success',
      data: {
        totalTrades,
        winningTrades,
        winRate,
        totalPnLAmount: totalPnLAmount.toFixed(2),
        maxProfit: maxProfit.toFixed(2),
        maxLoss: maxLoss.toFixed(2)
      }
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

module.exports = router;
