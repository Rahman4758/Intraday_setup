const express = require('express');
const router = express.Router();
const { getLoginURL, exchangeCode, getAuthStatus } = require('../services/upstox-auth');

router.get('/login', (req, res) => {
  const url = getLoginURL();
  res.json({ loginURL: url });
});

router.get('/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: 'No authorization code' });
    await exchangeCode(code);
    res.redirect('/');
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/status', async (req, res) => {
  const status = await getAuthStatus();
  res.json(status);
});

module.exports = router;
