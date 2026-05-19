function calculateRSI(
   closes,
   period = 14
) {

   // VALIDATION
   if (
      !Array.isArray(closes) ||
      closes.length < period + 1
   ) {
      return null;
   }

   if (
      typeof period !== 'number' ||
      period <= 0
   ) {
      return null;
   }

   // INVALID VALUES
   if (
      closes.some(
         c =>
            typeof c !== 'number' ||
            Number.isNaN(c)
      )
   ) {
      return null;
   }

   let avgGain = 0;
   let avgLoss = 0;

   // INITIAL AVERAGE
   for (let i = 1; i <= period; i++) {

      const change =
         closes[i] - closes[i - 1];

      if (change > 0) {

         avgGain += change;

      } else {

         avgLoss += Math.abs(change);
      }
   }

   avgGain /= period;
   avgLoss /= period;

   // WILDER SMOOTHING
   for (
      let i = period + 1;
      i < closes.length;
      i++
   ) {

      const change =
         closes[i] - closes[i - 1];

      const gain =
         change > 0 ? change : 0;

      const loss =
         change < 0
            ? Math.abs(change)
            : 0;

      avgGain =
         (
            (
               avgGain *
               (period - 1)
            ) + gain
         ) / period;

      avgLoss =
         (
            (
               avgLoss *
               (period - 1)
            ) + loss
         ) / period;
   }

   // FLAT MARKET
   if (
      avgGain === 0 &&
      avgLoss === 0
   ) {

      return {
         rsi: 50,
         avgGain,
         avgLoss
      };
   }

   // ONLY GAINS
   if (avgLoss === 0) {

      return {
         rsi: 100,
         avgGain,
         avgLoss
      };
   }

   const rs =
      avgGain / avgLoss;

   const rsi =
      100 - (
         100 / (1 + rs)
      );

   return {

      rsi,

      avgGain,

      avgLoss
   };
}

module.exports = { calculateRSI };
