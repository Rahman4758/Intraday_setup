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

// --- Render Free Tier Auto-Awake Keeper ---
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_URL) {
  console.log(`[Keeper] Render External URL detected: ${RENDER_URL}. Initializing self-pinger...`);
  // Ping every 10 minutes (600,000 ms) to prevent Render from going to sleep (Render sleeps after 15 mins of inactivity)
  setInterval(() => {
    const healthUrl = `${RENDER_URL.replace(/\/$/, '')}/api/health`;
    fetch(healthUrl)
      .then(res => res.json())
      .then(data => console.log(`[Keeper] Self-ping successful (status: ${data.status}) at ${new Date().toISOString()}`))
      .catch(err => console.error(`[Keeper] Self-ping failed:`, err.message));
  }, 10 * 60 * 1000);
} else {
  console.log('[Keeper] Running locally or RENDER_EXTERNAL_URL not set. Self-pinger disabled.');
}

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
