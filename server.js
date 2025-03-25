const express = require('express');
const mongoose = require('mongoose');
const app = express();
const Epc = require('./models/epcSchema'); // Adjust path if different

// Middleware
app.use(express.static('public')); // Serve rfid_status.html and return_box_status.html
app.use(express.json());

// MongoDB Connection
const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/rfid_library';
mongoose.connect(mongoUri)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// In-memory storage for real-time EPC tracking
const detectedEpcs = {
    shelf: new Map(), // { epc: { timestamp, readerIp } }
    returnBox: new Map() // { epc: { timestamp, readerIp } }
};

// Reader IP configuration (example IPs; update as needed)
const readers = {
    shelfReaders: ['192.168.1.101', '192.168.1.102', '192.168.1.103'],
    returnBoxReaders: ['192.168.1.201', '192.168.1.202', '192.168.1.203']
};

// Process EPC detection for shelves
async function processShelfDetection(epc) {
    try {
        const existingEpc = await Epc.findOne({ epc });
        if (existingEpc) {
            if (existingEpc.status !== 'in library') {
                existingEpc.status = 'in library';
                existingEpc.timestamp = Date.now();
                await existingEpc.save();
                console.log(`EPC '${epc}' status changed to 'in library'`);
            }
        } else {
            const newEpc = new Epc({
                epc,
                status: 'in library',
                timestamp: Date.now()
            });
            await newEpc.save();
            console.log(`New EPC '${epc}' added to shelf`);
        }
    } catch (error) {
        console.error(`Error processing shelf EPC '${epc}':`, error.message);
    }
}

// Process EPC detection for return boxes
async function processReturn(epc) {
    try {
        const existingEpc = await Epc.findOne({ epc });
        if (existingEpc) {
            if (existingEpc.status !== 'in return box') {
                existingEpc.status = 'in return box';
                existingEpc.timestamp = Date.now();
                await existingEpc.save();
                console.log(`EPC '${epc}' status changed to 'in return box'`);
            }
        } else {
            const newEpc = new Epc({
                epc,
                status: 'in return box',
                timestamp: Date.now()
            });
            await newEpc.save();
            console.log(`New EPC '${epc}' added to return box`);
        }
    } catch (error) {
        console.error(`Error processing return box EPC '${epc}':`, error.message);
    }
}

// API to update EPC status from bridge
app.post('/api/rfid-update', async (req, res) => {
    const { readerIp, epc, type, detected = true } = req.body;
    if (!readerIp || !epc || !type) {
        return res.status(400).json({ error: 'Missing required fields: readerIp, epc, type' });
    }

    const isShelfReader = readers.shelfReaders.includes(readerIp);
    const isReturnBoxReader = readers.returnBoxReaders.includes(readerIp);
    if (!isShelfReader && !isReturnBoxReader) {
        return res.status(400).json({ error: `Unknown reader IP: ${readerIp}` });
    }

    const store = type === 'shelf' ? detectedEpcs.shelf : detectedEpcs.returnBox;
    if (detected) {
        console.log(`EPC '${epc}' detected by ${type} reader ${readerIp}`);
        if (type === 'shelf') await processShelfDetection(epc);
        else await processReturn(epc);
        store.set(epc, { timestamp: Date.now(), readerIp });
    } else {
        console.log(`EPC '${epc}' no longer detected by ${type} reader ${readerIp}`);
        store.delete(epc);
        // Optionally update MongoDB status to 'unknown' or leave as is
        const existingEpc = await Epc.findOne({ epc });
        if (existingEpc && existingEpc.status !== 'unknown') {
            existingEpc.status = 'unknown';
            existingEpc.timestamp = Date.now();
            await existingEpc.save();
            console.log(`EPC '${epc}' status changed to 'unknown'`);
        }
    }
    res.status(200).json({ message: 'EPC processed' });
});

// API to get current reader status
app.get('/api/rfid-readers', async (req, res) => {
    try {
        const allEpcs = await Epc.find({}).lean();
        const shelfEpcs = Array.from(detectedEpcs.shelf.entries()).map(([epc, { timestamp, readerIp }]) => {
            const dbEpc = allEpcs.find(e => e.epc === epc) || {};
            return { epc, timestamp, readerIp, ...dbEpc };
        });
        const returnBoxEpcs = Array.from(detectedEpcs.returnBox.entries()).map(([epc, { timestamp, readerIp }]) => {
            const dbEpc = allEpcs.find(e => e.epc === epc) || {};
            return { epc, timestamp, readerIp, ...dbEpc };
        });

        const response = [
            {
                port: 'shelf',
                status: shelfEpcs.length > 0 ? 'active' : 'inactive',
                clients: readers.shelfReaders.length,
                epcs: shelfEpcs,
                type: 'shelf'
            },
            {
                port: 'returnBox',
                status: returnBoxEpcs.length > 0 ? 'active' : 'inactive',
                clients: readers.returnBoxReaders.length,
                epcs: returnBoxEpcs,
                type: 'return box'
            }
        ];
        res.json(response);
    } catch (error) {
        console.error('Error fetching readers:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API to manually add EPC (for testing)
app.post('/api/epc', async (req, res) => {
    const { epc, title, author, status, industryIdentifier } = req.body;
    if (!epc || !status) return res.status(400).json({ error: 'EPC and status are required' });

    try {
        const newEpc = new Epc({
            epc,
            title: title || 'Unknown Title',
            author: author || ['Unknown Author'],
            status,
            industryIdentifier: industryIdentifier || ['N/A'],
            timestamp: Date.now()
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