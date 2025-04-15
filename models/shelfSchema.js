const mongoose = require('mongoose');

const shelfSchema = new mongoose.Schema({
    readerIp: { type: String, required: true, unique: true },
    name: { type: String, required: true, default: 'Unnamed Shelf' },
    status: { type: String, default: 'inactive' },
    lastSeen: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Shelf', shelfSchema);