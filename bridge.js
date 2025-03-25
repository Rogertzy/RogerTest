const net = require('net');
const axios = require('axios');

// Reader configuration by IP (update with your RFID machine IPs)
const readers = {
    shelfReaders: ['192.168.1.101', '192.168.1.102', '192.168.1.103'], // Bookshelf IPs
    returnBoxReaders: ['192.168.1.201', '192.168.1.202', '192.168.1.203'] // Return box IPs
};

// TCP server configuration
const PORT = 5000; // Single port for all RFID machines to connect to locally
const HOST = '0.0.0.0'; // Listen on all interfaces

// Extract EPC from RFID data (matches your original logic)
function extractMiddleSegment(hexString) {
    if (typeof hexString !== 'string' || hexString.length < 20) {
        return null;
    }
    return hexString.substring(8, 20);
}

// Create TCP server
const server = net.createServer((socket) => {
    const readerIp = socket.remoteAddress.replace('::ffff:', ''); // Remove IPv6 prefix if present
    console.log(`RFID client connected from ${readerIp}`);

    socket.on('data', async (data) => {
        const hexData = data.toString('hex').toUpperCase();
        const epc = extractMiddleSegment(hexData);
        if (epc) {
            const isShelfReader = readers.shelfReaders.includes(readerIp);
            const isReturnBoxReader = readers.returnBoxReaders.includes(readerIp);

            if (!isShelfReader && !isReturnBoxReader) {
                console.log(`Unknown reader IP: ${readerIp}`);
                return;
            }

            const readerType = isShelfReader ? 'shelf' : 'return box';
            console.log(`EPC '${epc}' detected by ${readerType} reader ${readerIp}`);

            // Send to Render
            try {
                await axios.post('https://rfid-library.onrender.com/api/rfid-update', {
                    readerIp,
                    epc,
                    type: readerType
                }, {
                    headers: { 'Content-Type': 'application/json' }
                });
                console.log(`EPC '${epc}' forwarded to Render from ${readerIp}`);
            } catch (error) {
                console.error(`Error forwarding EPC '${epc}' to Render:`, error.message);
            }
        }
    });

    socket.on('end', () => {
        console.log(`RFID client disconnected from ${readerIp}`);
    });

    socket.on('error', (err) => {
        console.error(`Socket error from ${readerIp}:`, err.message);
    });
});

server.listen(PORT, HOST, () => {
    console.log(`TCP bridge listening on ${HOST}:${PORT}`);
});

server.on('error', (err) => {
    console.error('TCP server error:', err.message);
});