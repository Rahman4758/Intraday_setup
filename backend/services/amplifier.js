/**
 * Amplifier Engine — Time & Context Multipliers
 * Only applies when baseScore >= 4
 */

function applyAmplifiers(baseScore, context = {}) {
  if (baseScore < 4) {
    return { finalScore: baseScore, multiplier: 1, bonusPoints: 0, amplifiersApplied: [], reason: 'Base score < 4, no amplifiers' };
  }

  let bonus = 0;
  const applied = [];

  // Post-Results Day 2-5: +1
  if (context.postResultsDayNum >= 2 && context.postResultsDayNum <= 5) {
    bonus += 1;
    applied.push(`Post-Results Day ${context.postResultsDayNum}`);
  }

  // Monday Open: +1
  const isMonday = context.isMonday !== undefined ? context.isMonday : (new Date().getDay() === 1);
  if (isMonday) {
    bonus += 1;
    applied.push('Monday Open');
  }

  // FII Sector Buy Streak >= 3 days: +1
  if (context.fiiBuyStreak >= 3) {
    bonus += 1;
    applied.push(`FII Buy Streak ${context.fiiBuyStreak}d`);
  }

  // Sector Outperforming Nifty: +1
  if (context.isSectorOutperforming) {
    bonus += 1;
    applied.push('Sector Outperformance');
  }

  let subtotal = baseScore + bonus;
  let multiplier = 1;

  // F&O Expiry Week: x1.3
  if (context.isExpiryWeek) {
    multiplier = 1.3;
    applied.push('F&O Expiry Week x1.3');
  }

  const finalScore = Math.round(subtotal * multiplier);

  return { finalScore, multiplier, bonusPoints: bonus, amplifiersApplied: applied, reason: applied.length ? applied.join(' + ') : 'No amplifiers active' };
}

module.exports = { applyAmplifiers };
