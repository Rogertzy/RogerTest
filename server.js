const express = require('express');
const mongoose = require('mongoose');
const app = express();
const EPC = require('./models/epcSchema');
const Shelf = require('./models/shelfSchema');
const ReturnBox = require('./models/returnBoxSchema');

app.use(express.static('public'));
app.use(express.json());

const mongoUri = process.env.MONGO_URI || 'mongodb+srv://Admin:admin@library.8bgvj.mongodb.net/bookManagement?retryWrites=true&w=majority&appName=Library';
mongoose.connect(mongoUri, {
  serverSelectionTimeoutMS: 20000,
  connectTimeoutMS: 30000,
})
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

  const detectedEPCs = { shelf: new Map(), returnBox: new Map() };
  const connectionStatus = new Map();
  
  async function processShelfDetection(EPC, readerIp) {
    try {
      const existingEPC = await EPC.findOne({ EPC });
      const shelf = await Shelf.findOne({ readerIp });
      if (!shelf) throw new Error(`Shelf with IP ${readerIp} not found`);
      const logMessage = `${new Date().toLocaleTimeString()} - EPC '${EPC}' detected by shelf reader ${readerIp}`;
      if (existingEPC) {
        if (existingEPC.status !== 'in library') {
          existingEPC.status = 'in library';
          existingEPC.readerIp = readerIp;
          existingEPC.timestamp = Date.now();
          existingEPC.logs = existingEPC.logs || [];
          existingEPC.logs.push({ message: logMessage, timestamp: Date.now() });
          await existingEPC.save();
          console.log(`EPC '${EPC}' status changed to 'in library'`);
        } else {
          existingEPC.readerIp = readerIp;
          existingEPC.logs = existingEPC.logs || [];
          existingEPC.logs.push({ message: logMessage, timestamp: Date.now() });
          await existingEPC.save();
        }
      } else {
        const newEPC = new EPC({
          EPC, title: 'Unknown Title', author: ['Unknown Author'], status: 'in library',
          readerIp, timestamp: Date.now(), logs: [{ message: logMessage, timestamp: Date.now() }]
        });
        await newEPC.save();
        console.log(`New EPC '${EPC}' added to shelf`);
      }
    } catch (error) {
      console.error(`Error processing shelf EPC '${EPC}':`, error.message);
      throw error;
    }
  }
  
  async function processReturn(EPC, readerIp) {
    try {
      const existingEPC = await EPC.findOne({ EPC });
      const returnBox = await ReturnBox.findOne({ readerIp });
      if (!returnBox) throw new Error(`Return box with IP ${readerIp} not found`);
      const logMessage = `${new Date().toLocaleTimeString()} - EPC '${EPC}' detected by return box reader ${readerIp}`;
      if (existingEPC) {
        if (existingEPC.status !== 'in return box') {
          existingEPC.status = 'in return box';
          existingEPC.readerIp = readerIp;
          existingEPC.timestamp = Date.now();
          existingEPC.logs = existingEPC.logs || [];
          existingEPC.logs.push({ message: logMessage, timestamp: Date.now() });
          await existingEPC.save();
          console.log(`EPC '${EPC}' status changed to 'in return box'`);
        } else {
          existingEPC.readerIp = readerIp;
          existingEPC.logs = existingEPC.logs || [];
          existingEPC.logs.push({ message: logMessage, timestamp: Date.now() });
          await existingEPC.save();
        }
      } else {
        const newEPC = new EPC({
          EPC, title: 'Unknown Title', author: ['Unknown Author'], status: 'in return box',
          readerIp, timestamp: Date.now(), logs: [{ message: logMessage, timestamp: Date.now() }]
        });
        await newEPC.save();
        console.log(`New EPC '${EPC}' added to return box`);
      }
    } catch (error) {
      console.error(`Error processing return box EPC '${EPC}':`, error.message);
      throw error;
    }
  }
  
  app.post('/api/rfid-update',  async (req, res) => {
    const { readerIp, EPC, type, detected = true } = req.body;
    if (!readerIp || !EPC || !type) return res.status(400).json({ error: 'Missing fields' });
    const store = type === 'shelf' ? detectedEPCs.shelf : detectedEPCs.returnBox;
    try {
      if (detected) {
        console.log(`EPC '${EPC}' detected by ${type} reader ${readerIp}`);
        if (type === 'shelf') await processShelfDetection(EPC, readerIp);
        else if (type === 'return_box') await processReturn(EPC, readerIp);
        store.set(EPC, { timestamp: Date.now(), readerIp });
      } else {
        console.log(`EPC '${EPC}' no longer detected by ${type} reader ${readerIp}`);
        store.delete(EPC);
        const existingEPC = await EPC.findOne({ EPC });
        if (existingEPC && existingEPC.status !== 'borrowed') {
          const logMessage = `${new Date().toLocaleTimeString()} - EPC '${EPC}' no longer detected by ${type} reader ${readerIp}`;
          existingEPC.status = 'borrowed';
          existingEPC.readerIp = null;
          existingEPC.timestamp = Date.now();
          existingEPC.logs = existingEPC.logs || [];
          existingEPC.logs.push({ message: logMessage, timestamp: Date.now() });
          await existingEPC.save();
          console.log(`EPC '${EPC}' status changed to 'borrowed'`);
        }
      }
      res.status(200).json({ message: 'EPC processed' });
    } catch (error) {
      console.error('Error processing EPC:', error.message);
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  });
  
  app.post('/api/connection-status', (req, res) => {
    const { readerIp, connected } = req.body;
    if (!readerIp || typeof connected !== 'boolean') return res.status(400).json({ error: 'Missing fields' });
    connectionStatus.set(readerIp, connected);
    res.status(200).json({ message: 'Connection status updated' });
  });
  
  app.get('/api/rfid-readers',  async (req, res) => {
    try {
      const allEPCs = await EPC.find().lean();
      const shelves = await Shelf.find().lean();
      const returnBoxes = await ReturnBox.find().lean();
  
      const shelfEPCs = Array.from(detectedEPCs.shelf.entries()).map(([EPC, { timestamp, readerIp }]) => {
        const dbEPC = allEPCs.find(e => e.EPC === EPC) || {};
        const shelf = shelves.find(s => s.readerIp === readerIp) || { name: 'Unknown' };
        return { EPC, timestamp, readerIp, shelfName: shelf.name, logs: dbEPC.logs || [], ...dbEPC };
      });
  
      const returnBoxEPCs = Array.from(detectedEPCs.returnBox.entries()).map(([EPC, { timestamp, readerIp }]) => {
        const dbEPC = allEPCs.find(e => e.EPC === EPC) || {};
        const returnBox = returnBoxes.find(r => r.readerIp === readerIp) || { name: 'Unknown' };
        return { EPC, timestamp, readerIp, returnBoxName: returnBox.name, logs: dbEPC.logs || [], ...dbEPC };
      });
  
      const shelfReaders = shelves.map(shelf => {
        const epcsForShelf = shelfEPCs.filter(EPC => EPC.readerIp === shelf.readerIp);
        return {
          readerIp: shelf.readerIp,
          name: shelf.name,
          status: connectionStatus.get(shelf.readerIp) ? 'active' : 'inactive',
          epcs: epcsForShelf,
        };
      });
  
      const returnBoxReaders = returnBoxes.map(box => {
        const epcsForBox = returnBoxEPCs.filter(EPC => EPC.readerIp === box.readerIp);
        return {
          readerIp: box.readerIp,
          name: box.name,
          status: connectionStatus.get(box.readerIp) ? 'active' : 'inactive',
          epcs: epcsForBox,
        };
      });
  
      res.json({
        shelves: shelfReaders,
        returnBoxes: returnBoxReaders,
      });
    } catch (error) {
      console.error('Error fetching readers:', error.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  
  app.post('/api/shelves',  async (req, res) => {
    const { name, readerIp } = req.body;
    if (!name || !readerIp) return res.status(400).json({ error: 'Name and readerIp required' });
    try {
      const existing = await Shelf.findOne({ readerIp });
      if (existing) return res.status(400).json({ error: 'Shelf exists' });
      const shelf = new Shelf({ name, readerIp });
      await shelf.save();
      res.status(201).json(shelf);
    } catch (error) {
      console.error('Error adding shelf:', error.message);
      res.status(500).json({ error: 'Failed to add shelf' });
    }
  });
  
  app.delete('/api/shelves/:readerIp',  async (req, res) => {
    const { readerIp } = req.params;
    try {
      await Shelf.deleteOne({ readerIp });
      connectionStatus.set(readerIp, false);
      res.status(200).json({ message: 'Shelf deleted' });
    } catch (error) {
      console.error('Error deleting shelf:', error.message);
      res.status(500).json({ error: 'Failed to delete shelf' });
    }
  });
  
  app.post('/api/return-boxes',  async (req, res) => {
    const { name, readerIp } = req.body;
    if (!name || !readerIp) return res.status(400).json({ error: 'Name and readerIp required' });
    try {
      const existing = await ReturnBox.findOne({ readerIp });
      if (existing) return res.status(400).json({ error: 'Return box exists' });
      const box = new ReturnBox({ name, readerIp });
      await box.save();
      res.status(201).json(box);
    } catch (error) {
      console.error('Error adding return box:', error.message);
      res.status(500).json({ error: 'Failed to add return box' });
    }
  });
  
  app.delete('/api/return-boxes/:readerIp',  async (req, res) => {
    const { readerIp } = req.params;
    try {
      await ReturnBox.deleteOne({ readerIp });
      connectionStatus.set(readerIp, false);
      res.status(200).json({ message: 'Return box deleted' });
    } catch (error) {
      console.error('Error deleting return box:', error.message);
      res.status(500).json({ error: 'Failed to delete return box' });
    }
  });
  
  app.post('/api/EPC',  async (req, res) => {
    const { EPC, title, author, status, industryIdentifier } = req.body;
    if (!EPC || !title || !author || !status) return res.status(400).json({ error: 'EPC, title, author, status required' });
    if (!['borrowed', 'in return box', 'in library'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    try {
      const existing = await EPC.findOne({ EPC });
      if (existing) return res.status(400).json({ error: 'EPC exists' });
      const newEPC = new EPC({
        EPC, title, author, status, industryIdentifier: industryIdentifier || ['N/A'],
        timestamp: Date.now(), logs: [{ message: `${new Date().toLocaleTimeString()} - EPC '${EPC}' manually added`, timestamp: Date.now() }]
      });
      await newEPC.save();
      console.log(`Added EPC '${EPC}' with status '${status}'`);
      res.status(201).json(newEPC);
    } catch (error) {
      console.error('Error adding EPC:', error.message);
      res.status(500).json({ error: 'Failed to add EPC' });
    }
  });  

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));