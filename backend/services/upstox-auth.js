const axios = require('axios');

const UPSTOX_BASE = 'https://api.upstox.com/v2';

/**
 * Get valid access token — uses direct token from .env
 * No OAuth flow required when UPSTOX_ACCESS_TOKEN is set
 */
async function getValidToken() {
  const directToken = process.env.UPSTOX_ACCESS_TOKEN;
  if (directToken) {
    return directToken;
  }
  throw new Error('NO_TOKEN — Set UPSTOX_ACCESS_TOKEN in .env');
}

/**
 * Check auth status
 */
async function getAuthStatus() {
  const token = process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) {
    return { authenticated: false, reason: 'No UPSTOX_ACCESS_TOKEN in .env' };
  }

  // Verify token by making a lightweight API call
  try {
    await axios.get(`${UPSTOX_BASE}/user/profile`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
    });
    return { authenticated: true, method: 'direct_token' };
  } catch (err) {
    const status = err.response?.status;
    if (status === 401) {
      return { authenticated: false, reason: 'Token expired or invalid' };
    }
    // Network error but token exists — assume valid
    return { authenticated: true, method: 'direct_token', note: 'Could not verify, assuming valid' };
  }
}

/**
 * Get OAuth login URL (fallback if direct token not set)
 */
function getLoginURL() {
  const params = new URLSearchParams({
    client_id: process.env.UPSTOX_API_KEY,
    redirect_uri: process.env.UPSTOX_REDIRECT_URI,
    response_type: 'code'
  });
  return `${UPSTOX_BASE}/login/authorization/dialog?${params.toString()}`;
}

/**
 * Exchange authorization code for access token (fallback)
 */
async function exchangeCode(code) {
  try {
    const res = await axios.post(`${UPSTOX_BASE}/login/authorization/token`, {
      code,
      client_id: process.env.UPSTOX_API_KEY,
      client_secret: process.env.UPSTOX_API_SECRET,
      redirect_uri: process.env.UPSTOX_REDIRECT_URI,
      grant_type: 'authorization_code'
    }, { headers: { 'Content-Type': 'application/json' } });

    console.log('[AUTH] Token received. Add this to .env as UPSTOX_ACCESS_TOKEN:');
    console.log(res.data.access_token);
    return { accessToken: res.data.access_token };
  } catch (err) {
    console.error('[AUTH] Token exchange failed:', err.response?.data || err.message);
    throw new Error('Failed to exchange authorization code');
  }
}

module.exports = { getLoginURL, exchangeCode, getValidToken, getAuthStatus };
