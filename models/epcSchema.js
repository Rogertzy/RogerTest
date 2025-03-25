const mongoose = require('mongoose');

// EPC Schema
const epcSchema = new mongoose.Schema({
  epc: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  author: { type: [String], required: true },
  status: {
    type: String,
    enum: ['borrowed', 'in return box', 'in library'],
    default: 'in return box',
  },
  industryIdentifier: { type: [String] },
  timestamp: { type: Date, default: Date.now },
  readerIp: { type: String }, // Store the reader IP that last detected this EPC
  logs: [{ message: String, timestamp: Date }], // Log history for this EPC
});

const Epc = mongoose.model('EPC', epcSchema);

// Shelf Schema
const shelfSchema = new mongoose.Schema({
  readerIp: { type: String, required: true, unique: true },
  name: { type: String, required: true },
});

const Shelf = mongoose.model('Shelf', shelfSchema);

// Return Box Schema
const returnBoxSchema = new mongoose.Schema({
  readerIp: { type: String, required: true, unique: true },
  name: { type: String, required: true },
});

const ReturnBox = mongoose.model('ReturnBox', returnBoxSchema);

module.exports = { Epc, Shelf, ReturnBox };