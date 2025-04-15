const mongoose = require('mongoose');

const returnBoxSchema = new mongoose.Schema({
  readerIp: { type: String, required: true, unique: true },
  name: { type: String, required: true, default: 'Unnamed Return Box' },
});

module.exports = mongoose.model('ReturnBox', returnBoxSchema);