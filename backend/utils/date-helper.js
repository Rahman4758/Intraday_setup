// utils/date-helper.js

function getTodayDate() {
    return new Date().toISOString().split('T')[0];
}

module.exports = {
    getTodayDate
};
