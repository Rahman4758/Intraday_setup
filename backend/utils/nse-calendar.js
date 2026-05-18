/**
 * NSE Calendar Utilities — F&O Expiry, Trading Day checks
 */

function getNextMonthlyExpiry(fromDate = new Date()) {
  const d = new Date(fromDate);
  let year = d.getFullYear();
  let month = d.getMonth();

  // Find last Thursday of current month
  let expiry = getLastThursday(year, month);

  // If past this month's expiry, get next month's
  if (d > expiry) {
    month++;
    if (month > 11) { month = 0; year++; }
    expiry = getLastThursday(year, month);
  }

  return expiry;
}

function getLastThursday(year, month) {
  // Start from last day of month, walk backwards to Thursday
  const lastDay = new Date(year, month + 1, 0);
  const day = lastDay.getDay();
  // Thursday = 4
  const diff = (day >= 4) ? (day - 4) : (day + 3);
  lastDay.setDate(lastDay.getDate() - diff);
  return lastDay;
}

function isExpiryWeek(date = new Date()) {
  const expiry = getNextMonthlyExpiry(date);
  const diffDays = Math.ceil((expiry - date) / (1000 * 60 * 60 * 24));
  return diffDays >= 0 && diffDays <= 5;
}

function isMonday(date = new Date()) {
  return date.getDay() === 1;
}

module.exports = { getNextMonthlyExpiry, isExpiryWeek, isMonday, getLastThursday };
