const mongoose = require('mongoose');

const amplifierContextSchema = new mongoose.Schema({

    isExpiryWeek: {
        type: Boolean,
        default: false
    },

    postResultsDayNum: {
        type: Number,
        default: 0
    },

    fiiBuyStreak: {
        type: Number,
        default: 0
    },

    isSectorOutperforming: {
        type: Boolean,
        default: false
    }

}, {
    timestamps: true
});

module.exports = mongoose.model(
    'AmplifierContext',
    amplifierContextSchema
);
