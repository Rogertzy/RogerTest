const mongoose = require('mongoose');
const express = require('express');
const app = express();

// Middleware
app.use(express.static('public'));
app.use(express.json());

// MongoDB connection
const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/rfid_library';
mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// Models
const EPC = require('./models/epcSchema');
const UserBorrow = require('./models/userBorrowSchema');
const BookBuy = require('./models/bookBuySchema');

// Reader configuration by IP (match bridge.js)
const readers = {
    shelfReaders: ['192.168.1.101', '192.168.1.102', '192.168.1.103'],
    returnBoxReaders: ['192.168.1.201', '192.168.1.202', '192.168.1.203']
};

// In-memory storage for detected EPCs
const detectedEpcs = {
    shelf: new Map(), // { epc: timestamp }
    returnBox: new Map() // { epc: timestamp }
};

const DETECTION_TIMEOUT = 5000;

// Process shelf detection
async function processShelfDetection(epc) {
    try {
        const epcRecord = await EPC.findOne({ epc });
        if (!epcRecord) {
            console.log(`EPC '${epc}' not found in EPC schema for shelf detection.`);
            return;
        }
        if (epcRecord.status === 'in return box') {
            await EPC.findOneAndUpdate({ epc }, { $set: { status: 'in library' } }, { new: true });
            await UserBorrow.findOneAndUpdate(
                { 'copies.epc': epc },
                { $set: { 'copies.$.status': 'in library', 'copies.$.availability': true, 'copies.$.borrowStatus': false } }
            );
            await BookBuy.findOneAndUpdate(
                { 'copies.epc': epc },
                { $set: { 'copies.$.availability': true, 'copies.$.status': 'in library', 'copies.$.borrowStatus': false } }
            );
            console.log(`EPC '${epc}' status changed from 'in return box' to 'in library' on shelf.`);
        }
    } catch (error) {
        console.error('Error processing shelf detection:', error);
    }
}

// Process return box detection
async function processReturn(epc) {
    try {
        const epcRecord = await EPC.findOneAndUpdate(
            { epc },
            { $set: { status: 'in return box' } },
            { new: true }
        );
        if (!epcRecord) {
            console.log(`EPC '${epc}' not found in EPC schema for return.`);
            return;
        }
        await UserBorrow.findOneAndUpdate(
            { 'copies.epc': epc },
            { $set: { 'copies.$.status': 'in return box', 'copies.$.availability': true, 'copies.$.borrowStatus': false } }
        );
        await BookBuy.findOneAndUpdate(
            { 'copies.epc': epc },
            { $set: { 'copies.$.availability': true, 'copies.$.status': 'in return box', 'copies.$.borrowStatus': false } }
        );
        console.log(`EPC '${epc}' returned to return box.`);
    } catch (error) {
        console.error('Error processing return:', error);
    }
}

// RFID update endpoint
app.post('/api/rfid-update', async (req, res) => {
    const { readerIp, epc, type } = req.body;
    if (!readerIp || !epc || !type) {
        return res.status(400).json({ error: 'Missing readerIp, epc, or type' });
    }

    const isShelfReader = readers.shelfReaders.includes(readerIp);
    const isReturnBoxReader = readers.returnBoxReaders.includes(readerIp);

    if (!isShelfReader && !isReturnBoxReader) {
        console.log(`Unknown reader IP: ${readerIp}`);
        return res.status(400).json({ error: 'Unknown reader IP' });
    }

    if (type === 'shelf' && isShelfReader) {
        await processShelfDetection(epc);
        detectedEpcs.shelf.set(epc, Date.now());
        console.log(`EPC '${epc}' detected by shelf reader ${readerIp}`);
    } else if (type === 'return box' && isReturnBoxReader) {
        await processReturn(epc);
        detectedEpcs.returnBox.set(epc, Date.now());
        console.log(`EPC '${epc}' detected by return box reader ${readerIp}`);
    } else {
        return res.status(400).json({ error: 'Reader IP and type mismatch' });
    }

    res.status(200).json({ message: 'EPC processed' });
});

// API to get RFID reader status
app.get('/api/rfid-readers', async (req, res) => {
    try {
        const shelfEpcs = Array.from(detectedEpcs.shelf.keys());
        const returnBoxEpcs = Array.from(detectedEpcs.returnBox.keys());

        const shelfDetails = await EPC.find({ epc: { $in: shelfEpcs } })
            .select('epc title author status industryIdentifier timestamp');
        const returnBoxDetails = await EPC.find({ epc: { $in: returnBoxEpcs } })
            .select('epc title author status industryIdentifier timestamp');

        const formatEpcs = (epcs) => epcs.map(record => ({
            epc: record.epc,
            title: record.title,
            author: record.author.join(', '),
            status: record.status,
            industryIdentifier: record.industryIdentifier ? record.industryIdentifier.join(', ') : 'N/A',
            timestamp: record.timestamp
        }));

        const response = [
            {
                port: 'shelf',
                status: shelfEpcs.length > 0 ? 'active' : 'inactive',
                clients: 1,
                epcs: formatEpcs(shelfDetails),
                type: 'shelf'
            },
            {
                port: 'returnBox',
                status: returnBoxEpcs.length > 0 ? 'active' : 'inactive',
                clients: 1,
                epcs: formatEpcs(returnBoxDetails),
                type: 'return box'
            }
        ];

        res.json(response);
    } catch (error) {
        console.error('Error fetching RFID reader status:', error);
        res.status(500).json({ error: 'Failed to fetch RFID reader status' });
    }
});

// API to add EPC records (for testing)
app.post('/api/epc', async (req, res) => {
    try {
        const newEpc = new EPC(req.body);
        await newEpc.save();
        res.status(201).json(newEpc);
    } catch (error) {
        console.error('Error adding EPC:', error);
        res.status(500).json({ error: 'Failed to add EPC' });
    }
});

// Cleanup detected EPCs
function startRfidCleanup() {
    setInterval(() => {
        const now = Date.now();
        for (const [epc, lastSeen] of detectedEpcs.shelf) {
            if (now - lastSeen > DETECTION_TIMEOUT) {
                detectedEpcs.shelf.delete(epc);
                console.log(`EPC ${epc} removed from shelf (no longer detected)`);
            }
        }
        for (const [epc, lastSeen] of detectedEpcs.returnBox) {
            if (now - lastSeen > DETECTION_TIMEOUT) {
                detectedEpcs.returnBox.delete(epc);
                console.log(`EPC ${epc} removed from return box (no longer detected)`);
            }
        }
    }, 1000);
}

startRfidCleanup();

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});