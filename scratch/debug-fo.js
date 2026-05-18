require('dotenv').config();
const axios = require('axios');

async function debugFO() {
    const TOKEN = process.env.UPSTOX_ACCESS_TOKEN;
    const headers = { 'Authorization': `Bearer ${TOKEN}`, 'Accept': 'application/json' };
    const keys = 'NSE_FO|66355'; // RELIANCE MAY FUT
    
    try {
        const res = await axios.get(`https://api.upstox.com/v2/market-quote/quotes`, {
            headers,
            params: { instrument_key: keys }
        });
        console.log(JSON.stringify(res.data, null, 2));
    } catch (err) {
        console.error(err.response?.data || err.message);
    }
}
debugFO();
