// models/returnBoxSchema.js
const mongoose = require('mongoose');

const returnBoxSchema = new mongoose.Schema({
    readerIp: { type: String, required: true, unique: true },
    name: { type: String, required: true, default: 'Unnamed Return Box' }, // Added name field
    status: { type: String, default: 'inactive' },
    lastSeen: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ReturnBox', returnBoxSchema);