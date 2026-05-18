const express = require('express');
const router = express.Router();
const { getMarketQuotes, getOptionChain, getNiftyQuote } = require('../services/upstox-data');
const Stock = require('../models/Stock');
const { getNextMonthlyExpiry } = require('../utils/nse-calendar');

router.get('/quote/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const stock = await Stock.findOne({ symbol, isActive: true });
    if (!stock) return res.status(404).json({ error: 'Stock not in watchlist' });
    const key = stock.instrumentKeyEQ || `NSE_EQ|${symbol}`;
    const quotes = await getMarketQuotes(key);
    res.json({ symbol, quote: Object.values(quotes)[0] || {} });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/option-chain/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const stock = await Stock.findOne({ symbol });
    if (!stock) return res.status(404).json({ error: 'Stock not in watchlist' });
    
    // Default to the stock's F&O expiry date if saved, else calculate next expiry
    const defaultExpiry = stock.foExpiry || getNextMonthlyExpiry().toISOString().split('T')[0];
    const expiry = req.query.expiry || defaultExpiry;
    
    const chain = await getOptionChain(stock.instrumentKeyEQ, expiry);
    res.json({ symbol, expiry, chain });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/nifty', async (req, res) => {
  try {
    const data = await getNiftyQuote();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
