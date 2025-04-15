// models/shelfSchema.js
const mongoose = require('mongoose');

const shelfSchema = new mongoose.Schema({
    readerIp: { type: String, required: true, unique: true },
    status: { type: String, default: 'inactive' },
    lastSeen: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Shelf', shelfSchema);