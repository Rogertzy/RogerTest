const express = require('express');
const mongoose = require('mongoose');
const app = express();
const { Epc, Shelf, ReturnBox } = require('./models/epcSchema'); // Adjust path if different

// Middleware
app.use(express.static('public')); // Serve rfid_status.html and return_box_status.html
app.use(express.json());

// MongoDB Connection
const mongoUri = process.env.MONGO_URI || 'mongodb+srv://Admin:admin@library.8bgvj.mongodb.net/bookManagement?retryWrites=true&w=majority&appName=Library';
mongoose
  .connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 20000,
    connectTimeoutMS: 30000,
  })
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Ensure MongoDB connection is ready before handling requests
const ensureDbConnected = (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  next();
};

// In-memory storage for real-time EPC tracking
const detectedEpcs = {
  shelf: new Map(), // { epc: { timestamp, readerIp } }
  returnBox: new Map(), // { epc: { timestamp, readerIp } }
};

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
        existingEpc.timestamp = Date.now();
        existingEpc.logs.push({ message: logMessage, timestamp: Date.now() });
        await existingEpc.save();
        console.log(`EPC '${epc}' status changed to 'in library'`);
      } else {
        existingEpc.logs.push({ message: logMessage, timestamp: Date.now() });
        await existingEpc.save();
      }
    } else {
      const newEpc = new Epc({
        epc,
        status: 'in library',
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
        existingEpc.timestamp = Date.now();
        existingEpc.logs.push({ message: logMessage, timestamp: Date.now() });
        await existingEpc.save();
        console.log(`EPC '${epc}' status changed to 'in return box'`);
      } else {
        existingEpc.logs.push({ message: logMessage, timestamp: Date.now() });
        await existingEpc.save();
      }
    } else {
      const newEpc = new Epc({
        epc,
        status: 'in return box',
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
      else await processReturn(epc, readerIp);
      store.set(epc, { timestamp: Date.now(), readerIp });
    } else {
      console.log(`EPC '${epc}' no longer detected by ${type} reader ${readerIp}`);
      store.delete(epc);
      const existingEpc = await Epc.findOne({ epc });
      if (existingEpc && existingEpc.status !== 'unknown') {
        const logMessage = `${new Date().toLocaleTimeString()} - EPC '${epc}' no longer detected by ${type} reader ${readerIp}`;
        existingEpc.status = 'unknown';
        existingEpc.timestamp = Date.now();
        existingEpc.logs.push({ message: logMessage, timestamp: Date.now() });
        await existingEpc.save();
        console.log(`EPC '${epc}' status changed to 'unknown'`);
      }
    }
    res.status(200).json({ message: 'EPC processed' });
  } catch (error) {
    console.error('Error processing EPC:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
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

    const response = [
      {
        port: 'shelf',
        status: shelfEpcs.length > 0 ? 'active' : 'inactive',
        clients: shelves.length,
        epcs: shelfEpcs,
        type: 'shelf',
        readers: shelves.map((shelf) => ({ readerIp: shelf.readerIp, name: shelf.name })),
      },
      {
        port: 'returnBox',
        status: returnBoxEpcs.length > 0 ? 'active' : 'inactive',
        clients: returnBoxes.length,
        epcs: returnBoxEpcs,
        type: 'return box',
        readers: returnBoxes.map((box) => ({ readerIp: box.readerIp, name: box.name })),
      },
    ];
    res.json(response);
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
    const shelf = new Shelf({ name, readerIp });
    await shelf.save();
    res.status(201).json(shelf);
  } catch (error) {
    console.error('Error adding shelf:', error.message);
    res.status(500).json({ error: 'Failed to add shelf' });
  }
});

app.put('/api/shelves/:readerIp', ensureDbConnected, async (req, res) => {
  const { readerIp } = req.params;
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  try {
    const shelf = await Shelf.findOneAndUpdate({ readerIp }, { name }, { new: true });
    if (!shelf) {
      return res.status(404).json({ error: 'Shelf not found' });
    }
    res.json(shelf);
  } catch (error) {
    console.error('Error updating shelf:', error.message);
    res.status(500).json({ error: 'Failed to update shelf' });
  }
});

app.delete('/api/shelves/:readerIp', ensureDbConnected, async (req, res) => {
  const { readerIp } = req.params;
  try {
    const shelf = await Shelf.findOneAndDelete({ readerIp });
    if (!shelf) {
      return res.status(404).json({ error: 'Shelf not found' });
    }
    res.json({ message: 'Shelf deleted' });
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
    const returnBox = new ReturnBox({ name, readerIp });
    await returnBox.save();
    res.status(201).json(returnBox);
  } catch (error) {
    console.error('Error adding return box:', error.message);
    res.status(500).json({ error: 'Failed to add return box' });
  }
});

app.put('/api/return-boxes/:readerIp', ensureDbConnected, async (req, res) => {
  const { readerIp } = req.params;
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  try {
    const returnBox = await ReturnBox.findOneAndUpdate({ readerIp }, { name }, { new: true });
    if (!returnBox) {
      return res.status(404).json({ error: 'Return box not found' });
    }
    res.json(returnBox);
  } catch (error) {
    console.error('Error updating return box:', error.message);
    res.status(500).json({ error: 'Failed to update return box' });
  }
});

app.delete('/api/return-boxes/:readerIp', ensureDbConnected, async (req, res) => {
  const { readerIp } = req.params;
  try {
    const returnBox = await ReturnBox.findOneAndDelete({ readerIp });
    if (!returnBox) {
      return res.status(404).json({ error: 'Return box not found' });
    }
    res.json({ message: 'Return box deleted' });
  } catch (error) {
    console.error('Error deleting return box:', error.message);
    res.status(500).json({ error: 'Failed to delete return box' });
  }
});

// API to manually add EPC (for testing)
app.post('/api/epc', ensureDbConnected, async (req, res) => {
  const { epc, title, author, status, industryIdentifier } = req.body;
  if (!epc || !status) return res.status(400).json({ error: 'EPC and status are required' });

  try {
    const newEpc = new Epc({
      epc,
      title: title || 'Unknown Title',
      author: author || ['Unknown Author'],
      status,
      industryIdentifier: industryIdentifier || ['N/A'],
      timestamp: Date.now(),
      logs: [{ message: `${new Date().toLocaleTimeString()} - EPC '${epc}' manually added with status '${status}'`, timestamp: Date.now() }],
    });
    await newEpc.save();
    console.log(`Manually added EPC '${epc}' with status '${status}'`);
    res.status(201).json(newEpc);
  } catch (error) {
    console.error('Error adding EPC:', error.message);
    res.status(500).json({ error: 'Failed to add EPC' });
  }
});

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});