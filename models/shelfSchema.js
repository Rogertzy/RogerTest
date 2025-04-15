const mongoose = require('mongoose');

const shelfSchema = new mongoose.Schema({
  readerIp: { type: String, required: true, unique: true },
  name: { type: String, required: true, default: 'Unnamed Shelf' },
});

module.exports = mongoose.model('Shelf', shelfSchema);