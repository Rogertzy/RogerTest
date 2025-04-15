// models/returnBoxSchema.js
const mongoose = require('mongoose');

const returnBoxSchema = new mongoose.Schema({
    readerIp: { type: String, required: true, unique: true },
    status: { type: String, default: 'inactive' },
    lastSeen: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ReturnBox', returnBoxSchema);