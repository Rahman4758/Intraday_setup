/**
 * API Client — All backend communication
 */
const API = {
  base: '/api',

  async _fetch(path, opts = {}) {
    try {
      const res = await fetch(`${this.base}${path}`, {
        headers: { 'Content-Type': 'application/json', ...opts.headers },
        ...opts
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    } catch (err) {
      console.error(`[API] ${path}:`, err.message);
      throw err;
    }
  },

  // Auth
  async checkAuth() { return this._fetch('/auth/status'); },
  async getLoginURL() { return this._fetch('/auth/login'); },

  // Stocks
  async getStocks() { return this._fetch('/stocks'); },
  async addStock(symbol, sector = 'Unknown') {
    return this._fetch('/stocks', { method: 'POST', body: JSON.stringify({ symbol, sector }) });
  },
  async removeStock(symbol) {
    return this._fetch(`/stocks/${symbol}`, { method: 'DELETE' });
  },
  async searchStocks(q) { return this._fetch(`/stocks/search?q=${encodeURIComponent(q)}`); },

  // PIL
  async runScan(amplifiers = {}) {
    return this._fetch('/pil/scan', {
      method: 'POST',
      body: JSON.stringify({ ...amplifiers, forceScan: true })
    });
  },
  async getScore(symbol) { return this._fetch(`/pil/score/${symbol}`); },
  async getHistory(symbol, days = 7) { return this._fetch(`/pil/history/${symbol}?days=${days}`); },
  async getPriority() { return this._fetch('/pil/priority'); },
  async setAmplifiers(ctx) {
    return this._fetch('/pil/amplifiers', { method: 'POST', body: JSON.stringify(ctx) });
  },
  async getAmplifiers() { return this._fetch('/pil/amplifiers'); },

  // Data
  async getQuote(symbol) { return this._fetch(`/data/quote/${symbol}`); },
  async getNifty() { return this._fetch('/data/nifty'); },

  // Health
  async health() { return this._fetch('/health'); }
};
