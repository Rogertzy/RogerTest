const mongoose = require('mongoose');

// EPC schema definition
const EPCSchema = new mongoose.Schema({
    epc: { type: String, required: true, unique: true }, // EPC must be unique and required
    title: { type: String, required: true }, // Book title is required
    author: { type: [String], required: true }, // Author is an array of strings and required
    status: { 
        type: String, 
        enum: ['borrowed', 'in return box', 'in library'], // Restrict to these values
        default: 'in return box', // Default status
    }, industryIdentifier: {
        type: [String],
    },
    timestamp: { type: Date, default: Date.now } // Automatically add a timestamp
});

// Export the EPC model
module.exports = mongoose.model('EPC', epcSchema);