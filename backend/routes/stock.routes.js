const express = require('express');
const router = express.Router();
const Stock = require('../models/Stock');
const StreakState = require('../models/StreakState');
const { resolveInstrumentKeys } = require('../utils/instrument-resolver');

// List all active stocks
router.get('/', async (req, res) => {
  try {
    const stocks = await Stock.find({ isActive: true }).sort({ addedAt: -1 });
    res.json({ stocks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a stock
router.post('/', async (req, res) => {
  try {
    const { symbol, sector } = req.body;
    if (!symbol) return res.status(400).json({ error: 'Symbol required' });

    const upper = symbol.toUpperCase().trim();
    const maxStocks = parseInt(process.env.PIL_MAX_STOCKS) || 10;
    const activeCount = await Stock.countDocuments({ isActive: true });
    if (activeCount >= maxStocks) {
      return res.status(400).json({ error: `Max ${maxStocks} stocks allowed` });
    }

    // Check if already exists
    let stock = await Stock.findOne({ symbol: upper });
    if (stock) {
      if (stock.isActive) return res.status(400).json({ error: 'Stock already in watchlist' });
      stock.isActive = true;
      stock.sector = sector || stock.sector;
      await stock.save();
      return res.json({ stock, message: 'Stock reactivated' });
    }

    // Resolve instrument keys
    let keys = { eq: '', fo: '' };
    try {
      keys = resolveInstrumentKeys(upper);
    } catch (e) {
      console.log(`[STOCK] Could not resolve keys for ${upper}`);
    }

    stock = await Stock.create({
      symbol: upper,
      instrumentKeyEQ: keys.eq,
      instrumentKeyFO: keys.fo,
      sector: sector || 'Unknown'
    });

    // Create streak state
    await StreakState.findOneAndUpdate(
      { symbol: upper },
      { symbol: upper },
      { upsert: true }
    );

    res.status(201).json({ stock });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove a stock (soft delete)
router.delete('/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const stock = await Stock.findOneAndUpdate(
      { symbol },
      { isActive: false },
      { new: true }
    );
    if (!stock) return res.status(404).json({ error: 'Stock not found' });
    res.json({ message: `${symbol} removed`, stock });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search instruments (proxy to Upstox)
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ results: [] });
    const { searchInstruments } = require('../services/upstox-data');
    const results = await searchInstruments(q);
    res.json({ results: results.slice(0, 10) });
  } catch (err) {
    res.json({ results: [] });
  }
});

module.exports = router;
