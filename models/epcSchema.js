const mongoose = require('mongoose');

// EPC schema definition
const epcSchema = new mongoose.Schema({
    epc: { type: String, required: true, unique: true }, // EPC must be unique and required
    title: { type: String, default: 'Unknown Title', required: true }, // Book title is required
    author: { type: [String], default: ['Unknown Author'], required: true }, // Author is an array of strings and required
    status: { 
        type: String, 
        enum: ['borrowed', 'in return box', 'in library'], // Restrict to these values
        default: 'in library'},
    readerIp: { type: String, default: null },
    timestamp: { type: Date, default: Date.now },
    logs: [{
      message: String,
      timestamp: { type: Number, default: Date.now }
    }], 
    industryIdentifier: { type: [String], default: ['N/A'] },
});

// Export the EPC model
module.exports = mongoose.model('EPC', epcSchema);