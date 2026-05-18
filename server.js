require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const connectDB = require('./backend/config/db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'frontend')));

// API Routes
app.use('/api/auth', require('./backend/routes/auth.routes'));
app.use('/api/stocks', require('./backend/routes/stock.routes'));
app.use('/api/pil', require('./backend/routes/pil.routes'));
app.use('/api/data', require('./backend/routes/data.routes'));
app.use('/api/intraday', require('./backend/routes/intraday.routes'));
app.use('/api/journal', require('./backend/routes/journal.routes'));
app.use('/api/pullback', require('./backend/routes/pullback.routes'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', module: 'ANTIGRAVITY PIL v1.0', uptime: process.uptime() });
});

// SPA fallback
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// Start
async function start() {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`\n  ╔══════════════════════════════════════════╗`);
    console.log(`  ║  ANTIGRAVITY PIL v1.0 — EOD Engine       ║`);
    console.log(`  ║  Running on http://localhost:${PORT}          ║`);
    console.log(`  ╚══════════════════════════════════════════╝\n`);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
