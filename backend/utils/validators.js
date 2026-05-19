// utils/validators.js

function isValidSymbol(symbol) {

    // Allow:
    // RELIANCE
    // M&M
    // BAJAJ-AUTO

    return /^[A-Z0-9&-]+$/.test(symbol);
}

module.exports = {
    isValidSymbol
};
