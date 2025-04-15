const mongoose = require('mongoose');

const epcSchema = new mongoose.Schema({
  epc: { type: String, required: true, unique: true },
  title: { type: String, default: 'Unknown Title' },
  author: { type: [String], default: ['Unknown Author'] },
  status: { type: String, enum: ['borrowed', 'in library', 'in return box'], default: 'in library' },
  readerIp: { type: String, default: null },
  timestamp: { type: Number, default: Date.now },
  industryIdentifier: { type: [String], default: ['N/A'] }
});

module.exports = mongoose.model('Epc', epcSchema);