const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB connection
mongoose.connect(process.env.MONGO_URI || 'mongodb+srv://Admin:vInqRmj9bUdN3KSJ@library.8bgvj.mongodb.net/?retryWrites=true&w=majority&appName=Library', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Schema imports
const Shelf = require('./shelfSchema');
const ReturnBox = require('./returnBoxSchema');
const EPC = require('./epcSchema');

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/rfid-readers', async (req, res) => {
    try {
        const shelves = await mongoose.model('Shelf').find();
        const returnBoxes = await mongoose.model('ReturnBox').find();
        const epcs = await mongoose.model('EPC').find();
        const shelvesWithEPCs = shelves.map(shelf => ({
            ...shelf.toObject(),
            epcs: epcs.filter(epc => shelf.epcs && shelf.epcs.includes(epc.EPC)) || [],
            status: shelf.connected ? 'active' : 'inactive'
        }));
        const returnBoxesWithEPCs = returnBoxes.map(box => ({
            ...box.toObject(),
            epcs: epcs.filter(epc => box.epcs && box.epcs.includes(epc.EPC)) || [],
            status: box.connected ? 'active' : 'inactive'
        }));
        res.json({ shelves: shelvesWithEPCs, returnBoxes: returnBoxesWithEPCs });
    } catch (error) {
        console.error('Error fetching RFID readers:', error);
        res.status(500).json({ error: 'Failed to fetch RFID readers' });
    }
});

app.post('/api/rfid-update', async (req, res) => {
    const { readerIp, epc, type, detected } = req.body;
    try {
        let Model;
        if (type === 'shelf') {
            Model = mongoose.model('Shelf');
        } else if (type === 'return_box') {
            Model = mongoose.model('ReturnBox');
        } else {
            return res.status(400).json({ error: 'Invalid type' });
        }
        // Ensure EPC exists in EPC collection
        let epcDoc = await EPC.findOne({ EPC: epc });
        if (!epcDoc && detected) {
            epcDoc = await EPC.create({
                EPC: epc,
                title: "Unknown Book",
                author: ["Unknown Author"],
                status: type === 'shelf' ? "in library" : "in return box"
            });
            console.log(`Created EPC ${epc} with default metadata`);
        }
        const update = detected
            ? { $addToSet: { epcs: epc } }
            : { $pull: { epcs: epc } };
        const result = await Model.updateOne({ readerIp }, update);
        if (result.matchedCount === 0) {
            console.warn(`No ${type} found for readerIp ${readerIp}`);
        }
        res.status(200).json({ message: 'RFID update processed' });
    } catch (error) {
        console.error('RFID update error:', error);
        res.status(500).json({ error: 'Failed to process RFID update' });
    }
});

app.post('/api/shelves', async (req, res) => {
    const { name, readerIp } = req.body;
    try {
        const shelf = await mongoose.model('Shelf').create({ name, readerIp });
        res.status(201).json(shelf);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.delete('/api/shelves/:readerIp', async (req, res) => {
    const { readerIp } = req.params;
    try {
        await mongoose.model('Shelf').deleteOne({ readerIp });
        res.status(204).send();
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/api/return-boxes', async (req, res) => {
    const { name, readerIp } = req.body;
    try {
        const box = await mongoose.model('ReturnBox').create({ name, readerIp });
        res.status(201).json(box);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.delete('/api/return-boxes/:readerIp', async (req, res) => {
    const { readerIp } = req.params;
    try {
        await mongoose.model('ReturnBox').deleteOne({ readerIp });
        res.status(204).send();
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/api/connection-status', async (req, res) => {
    const { readerIp, connected } = req.body;
    try {
        let Model;
        let type;

        const shelf = await mongoose.model('Shelf').findOne({ readerIp });
        if (shelf) {
            Model = mongoose.model('Shelf');
            type = 'shelf';
        } else {
            const returnBox = await mongoose.model('ReturnBox').findOne({ readerIp });
            if (returnBox) {
                Model = mongoose.model('ReturnBox');
                type = 'return_box';
            } else {
                return res.status(404).json({ error: 'Reader IP not found' });
            }
        }

        await Model.updateOne({ readerIp }, { $set: { connected } });
        res.status(200).json({ message: `${type} connection status updated` });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update connection status' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));