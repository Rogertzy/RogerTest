const express = require('express');
const mongoose = require('mongoose');
const app = express();
const { Epc, Shelf, ReturnBox } = require('./models/epcSchema'); // Adjust path if needed

// Middleware
app.use(express.static('public')); // Serve static files like rfid_bookshelf.html
app.use(express.json());

// MongoDB Connection
const mongoUri = process.env.MONGO_URI || 'mongodb+srv://Admin:admin@library.8bgvj.mongodb.net/bookManagement?retryWrites=true&w=majority&appName=Library';
mongoose
  .connect(mongoUri, {
    serverSelectionTimeoutMS: 20000,
    connectTimeoutMS: 30000,
  })
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Ensure DB connection
const ensureDbConnected = (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  next();
};

// In-memory storage for real-time EPC tracking and connection status
const detectedEpcs = {
  shelf: new Map(), // { epc: { timestamp, readerIp } }
  returnBox: new Map(), // { epc: { timestamp, readerIp } }
};
const connectionStatus = new Map(); // { readerIp: boolean }

// Process EPC detection for shelves
async function processShelfDetection(epc, readerIp) {
  try {
    const existingEpc = await Epc.findOne({ epc });
    const shelf = await Shelf.findOne({ readerIp });
    if (!shelf) throw new Error(`Shelf with IP ${readerIp} not found`);

    const logMessage = `${new Date().toLocaleTimeString()} - EPC '${epc}' detected by shelf reader ${readerIp}`;
    if (existingEpc) {
      if (existingEpc.status !== 'in library') {
        existingEpc.status = 'in library';
        existingEpc.readerIp = readerIp;
        existingEpc.timestamp = Date.now();
        existingEpc.logs = existingEpc.logs || [];
        existingEpc.logs.push({ message: logMessage, timestamp: Date.now() });
        await existingEpc.save();
        console.log(`EPC '${epc}' status changed to 'in library'`);
      } else {
        existingEpc.readerIp = readerIp;
        existingEpc.logs = existingEpc.logs || [];
        existingEpc.logs.push({ message: logMessage, timestamp: Date.now() });
        await existingEpc.save();
      }
    } else {
      const newEpc = new Epc({
        epc,
        title: 'Unknown Title',
        author: ['Unknown Author'],
        status: 'in library',
        readerIp,
        timestamp: Date.now(),
        logs: [{ message: logMessage, timestamp: Date.now() }],
      });
      await newEpc.save();
      console.log(`New EPC '${epc}' added to shelf`);
    }
  } catch (error) {
    console.error(`Error processing shelf EPC '${epc}':`, error.message);
    throw error;
  }
}

// Process EPC detection for return boxes
async function processReturn(epc, readerIp) {
  try {
    const existingEpc = await Epc.findOne({ epc });
    const returnBox = await ReturnBox.findOne({ readerIp });
    if (!returnBox) throw new Error(`Return box with IP ${readerIp} not found`);

    const logMessage = `${new Date().toLocaleTimeString()} - EPC '${epc}' detected by return box reader ${readerIp}`;
    if (existingEpc) {
      if (existingEpc.status !== 'in return box') {
        existingEpc.status = 'in return box';
        existingEpc.readerIp = readerIp;
        existingEpc.timestamp = Date.now();
        existingEpc.logs = existingEpc.logs || [];
        existingEpc.logs.push({ message: logMessage, timestamp: Date.now() });
        await existingEpc.save();
        console.log(`EPC '${epc}' status changed to 'in return box'`);
      } else {
        existingEpc.readerIp = readerIp;
        existingEpc.logs = existingEpc.logs || [];
        existingEpc.logs.push({ message: logMessage, timestamp: Date.now() });
        await existingEpc.save();
      }
    } else {
      const newEpc = new Epc({
        epc,
        title: 'Unknown Title',
        author: ['Unknown Author'],
        status: 'in return box',
        readerIp,
        timestamp: Date.now(),
        logs: [{ message: logMessage, timestamp: Date.now() }],
      });
      await newEpc.save();
      console.log(`New EPC '${epc}' added to return box`);
    }
  } catch (error) {
    console.error(`Error processing return box EPC '${epc}':`, error.message);
    throw error;
  }
}

// API to update EPC status from bridge
app.post('/api/rfid-update', ensureDbConnected, async (req, res) => {
  const { readerIp, epc, type, detected = true } = req.body;
  if (!readerIp || !epc || !type) {
    return res.status(400).json({ error: 'Missing required fields: readerIp, epc, type' });
  }

  const store = type === 'shelf' ? detectedEpcs.shelf : detectedEpcs.returnBox;
  try {
    if (detected) {
      console.log(`EPC '${epc}' detected by ${type} reader ${readerIp}`);
      if (type === 'shelf') await processShelfDetection(epc, readerIp);
      else if (type === 'return_box') await processReturn(epc, readerIp);
      else throw new Error(`Invalid type: ${type}`);
      store.set(epc, { timestamp: Date.now(), readerIp });
    } else {
      console.log(`EPC '${epc}' no longer detected by ${type} reader ${readerIp}`);
      store.delete(epc);
      const existingEpc = await Epc.findOne({ epc });
      if (existingEpc && existingEpc.status !== 'borrowed') {
        const logMessage = `${new Date().toLocaleTimeString()} - EPC '${epc}' no longer detected by ${type} reader ${readerIp}`;
        existingEpc.status = 'borrowed';
        existingEpc.readerIp = null;
        existingEpc.timestamp = Date.now();
        existingEpc.logs = existingEpc.logs || [];
        existingEpc.logs.push({ message: logMessage, timestamp: Date.now() });
        await existingEpc.save();
        console.log(`EPC '${epc}' status changed to 'borrowed'`);
      }
    }
    res.status(200).json({ message: 'EPC processed' });
  } catch (error) {
    console.error('Error processing EPC:', error.message);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// API to update connection status
app.post('/api/connection-status', (req, res) => {
  const { readerIp, connected } = req.body;
  if (!readerIp || typeof connected !== 'boolean') {
    return res.status(400).json({ error: 'Missing required fields: readerIp, connected' });
  }
  connectionStatus.set(readerIp, connected);
  res.status(200).json({ message: 'Connection status updated' });
});

// API to get current reader status
app.get('/api/rfid-readers', ensureDbConnected, async (req, res) => {
  try {
    const allEpcs = await Epc.find({}).lean();
    const shelves = await Shelf.find({}).lean();
    const returnBoxes = await ReturnBox.find({}).lean();

    const shelfEpcs = Array.from(detectedEpcs.shelf.entries()).map(([epc, { timestamp, readerIp }]) => {
      const dbEpc = allEpcs.find((e) => e.epc === epc) || {};
      const shelf = shelves.find((s) => s.readerIp === readerIp) || { name: 'Unknown' };
      return { epc, timestamp, readerIp, shelfName: shelf.name, logs: dbEpc.logs || [], ...dbEpc };
    });

    const returnBoxEpcs = Array.from(detectedEpcs.returnBox.entries()).map(([epc, { timestamp, readerIp }]) => {
      const dbEpc = allEpcs.find((e) => e.epc === epc) || {};
      const returnBox = returnBoxes.find((r) => r.readerIp === readerIp) || { name: 'Unknown' };
      return { epc, timestamp, readerIp, returnBoxName: returnBox.name, logs: dbEpc.logs || [], ...dbEpc };
    });

    const shelfReaders = shelves.map(shelf => {
      const epcsForShelf = shelfEpcs.filter(epc => epc.readerIp === shelf.readerIp);
      return {
        readerIp: shelf.readerIp,
        name: shelf.name,
        status: connectionStatus.get(shelf.readerIp) ? 'active' : 'inactive',
        epcs: epcsForShelf,
      };
    });

    const returnBoxReaders = returnBoxes.map(box => {
      const epcsForBox = returnBoxEpcs.filter(epc => epc.readerIp === box.readerIp);
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

// API to manage shelves
app.post('/api/shelves', ensureDbConnected, async (req, res) => {
  const { name, readerIp } = req.body;
  if (!name || !readerIp) {
    return res.status(400).json({ error: 'Name and readerIp are required' });
  }
  try {
    const existingShelf = await Shelf.findOne({ readerIp });
    if (existingShelf) {
      return res.status(400).json({ error: 'Shelf with this readerIp already exists' });
    }
    const shelf = new Shelf({ name, readerIp });
    await shelf.save();
    res.status(201).json(shelf);
  } catch (error) {
    console.error('Error adding shelf:', error.message);
    res.status(500).json({ error: 'Failed to add shelf' });
  }
});

app.delete('/api/shelves/:readerIp', ensureDbConnected, async (req, res) => {
  const { readerIp } = req.params;
  try {
    await Shelf.deleteOne({ readerIp });
    connectionStatus.set(readerIp, false); // Mark as inactive
    res.status(200).json({ message: 'Shelf deleted' });
  } catch (error) {
    console.error('Error deleting shelf:', error.message);
    res.status(500).json({ error: 'Failed to delete shelf' });
  }
});

// API to manage return boxes
app.post('/api/return-boxes', ensureDbConnected, async (req, res) => {
  const { name, readerIp } = req.body;
  if (!name || !readerIp) {
    return res.status(400).json({ error: 'Name and readerIp are required' });
  }
  try {
    const existingReturnBox = await ReturnBox.findOne({ readerIp });
    if (existingReturnBox) {
      return res.status(400).json({ error: 'Return box with this readerIp already exists' });
    }
    const returnBox = new ReturnBox({ name, readerIp });
    await returnBox.save();
    res.status(201).json(returnBox);
  } catch (error) {
    console.error('Error adding return box:', error.message);
    res.status(500).json({ error: 'Failed to add return box' });
  }
});

app.delete('/api/return-boxes/:readerIp', ensureDbConnected, async (req, res) => {
  const { readerIp } = req.params;
  try {
    await ReturnBox.deleteOne({ readerIp });
    connectionStatus.set(readerIp, false); // Mark as inactive
    res.status(200).json({ message: 'Return box deleted' });
  } catch (error) {
    console.error('Error deleting return box:', error.message);
    res.status(500).json({ error: 'Failed to delete return box' });
  }
});

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});