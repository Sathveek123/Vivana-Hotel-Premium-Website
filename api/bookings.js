const { triggerVapiCall } = require('../routes/vapiCall');
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'db', 'data.json');
let inMemoryDb = null;

function readData() {
    try {
        if (inMemoryDb) return inMemoryDb;
        const tmpFile = path.join('/tmp', 'data.json');
        if (fs.existsSync(tmpFile)) {
            inMemoryDb = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
            return inMemoryDb;
        }
        if (fs.existsSync(DB_FILE)) {
            inMemoryDb = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
            return inMemoryDb;
        }
        return { bookings: [], rooms: [], events: [], offers: [], settings: {} };
    } catch (err) {
        return inMemoryDb || { bookings: [], rooms: [], events: [], offers: [], settings: {} };
    }
}

function writeData(data) {
    inMemoryDb = data;
    try {
        const tmpFile = path.join('/tmp', 'data.json');
        fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (err) {
        return true;
    }
}

const ROOM_PRICES = {
    'Deluxe Room': 3499,
    'Premium Room': 4999,
    'Executive Suite': 7499,
    'Family Suite': 9999,
    'Presidential Suite': 14999
};

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method === 'POST') {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        const { guest_name, phone, email, checkin_date, checkout_date, room_type, guests_count, addons, special_requests } = body;

        if (!guest_name || !phone || !checkin_date || !checkout_date || !room_type) {
            return res.status(400).json({ success: false, message: 'Missing required booking fields.' });
        }

        const checkIn = new Date(checkin_date);
        const checkOut = new Date(checkout_date);
        const diffDays = Math.max(1, Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24)));
        const basePrice = ROOM_PRICES[room_type] || 3499;
        const total_amount = basePrice * diffDays;

        const data = readData();
        const reference_id = `VIV-2026-${Math.floor(1000 + Math.random() * 9000)}`;

        const newBooking = {
            id: reference_id,
            guest_name,
            phone,
            email: email || 'N/A',
            checkin_date,
            checkout_date,
            room_type,
            guests_count: guests_count || '2 Adults, 1 Room',
            addons: addons || 'None',
            special_requests: special_requests || 'Standard luxury stay request.',
            total_amount,
            status: 'pending',
            payment_status: 'pending',
            vapi_call_status: 'initiating',
            created_at: new Date().toISOString()
        };

        data.bookings.unshift(newBooking);
        writeData(data);

        // Await Vapi call trigger so Vercel Serverless process does not terminate before API request finishes
        let vapiCallResult = null;
        try {
            vapiCallResult = await triggerVapiCall({
                guestName: guest_name,
                phoneNumber: phone,
                checkIn: checkin_date,
                checkOut: checkout_date,
                roomType: room_type,
                guests: guests_count || '2 Adults',
                bookingId: reference_id
            });
            if (vapiCallResult && vapiCallResult.success) {
                newBooking.vapi_call_status = 'initiated';
                newBooking.vapi_call_id = vapiCallResult.callId;
            } else if (vapiCallResult && vapiCallResult.error) {
                newBooking.vapi_call_status = 'failed';
                newBooking.vapi_transcript = `Call Failed: ${vapiCallResult.error}`;
            }
        } catch (vapiErr) {
            console.error('Vapi call execution error:', vapiErr);
        }


        return res.status(201).json({
            success: true,
            message: 'Reservation created successfully!',
            booking_id: reference_id,
            booking: newBooking
        });
    }

    if (req.method === 'GET') {
        const data = readData();
        return res.json({ success: true, count: data.bookings.length, bookings: data.bookings });
    }

    return res.status(405).json({ message: 'Method not allowed' });
};
