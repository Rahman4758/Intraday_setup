const moment = require('moment-timezone'); // We'll need moment-timezone, or we can use native JS

/**
 * Checks if the Indian Equity Market is currently open for Intraday.
 * Mon-Fri, 9:15 AM to 3:30 PM IST.
 */
function isIntradayMarketOpen() {
  const nowStr = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const now = new Date(nowStr);
  
  const day = now.getDay();
  // Sunday = 0, Saturday = 6
  if (day === 0 || day === 6) return false;

  const hours = now.getHours();
  const minutes = now.getMinutes();
  const timeInMinutes = hours * 60 + minutes;

  const marketStart = 9 * 60 + 15; // 9:15 AM
  const marketEnd = 15 * 60 + 30; // 3:30 PM

  return timeInMinutes >= marketStart && timeInMinutes <= marketEnd;
}

/**
 * Checks if it is a valid time to run the EOD scan.
 * Mon-Fri, typically after 3:30 PM.
 */
function isEODScanValid() {
  const nowStr = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const now = new Date(nowStr);
  
  const day = now.getDay();
  if (day === 0 || day === 6) return false;

  const hours = now.getHours();
  const minutes = now.getMinutes();
  const timeInMinutes = hours * 60 + minutes;

  const marketEnd = 15 * 60 + 30; // 3:30 PM
  // Allow running after 3:30 PM on weekdays.
  // We can also allow it to run anytime, but user requested to block "faltu scan".
  // Let's block it if it's before 3:30 PM on a weekday, because the daily candle isn't formed yet.
  return timeInMinutes >= marketEnd;
}

module.exports = {
  isIntradayMarketOpen,
  isEODScanValid
};
