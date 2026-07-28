require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { router: vapiRouter, triggerVapiCall } = require('./routes/vapiCall');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'db', 'data.json');

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Register Vapi router
app.use('/api', vapiRouter);

// Helper Functions for Data Persistence
function readData() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            return { bookings: [], rooms: [], events: [], offers: [], settings: {} };
        }
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error reading DB_FILE:', err);
        return { bookings: [], rooms: [], events: [], offers: [], settings: {} };
    }
}

function writeData(data) {
    try {
        const dir = path.dirname(DB_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error('Error writing DB_FILE:', err);
        return false;
    }
}

// Room Pricing Map helper
const ROOM_PRICES = {
    'Deluxe Room': 3499,
    'Premium Room': 4999,
    'Executive Suite': 7499,
    'Family Suite': 9999,
    'Presidential Suite': 14999
};

const ADDON_PRICES = {
    'Airport Shuttle Pickup (+₹600)': 600,
    'Early Check-in at 9:00 AM (+₹800)': 800,
    'Rasa Dinner Package (+₹999/person)': 999
};

// Route: Admin Dashboard alias
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// ==========================================
// API ENDPOINTS
// ==========================================

// 1. POST /api/bookings - Create new booking & trigger Vapi AI call
app.post('/api/bookings', async (req, res) => {
    const { guest_name, phone, email, checkin_date, checkout_date, room_type, guests_count, addons, special_requests } = req.body;

    if (!guest_name || !phone || !checkin_date || !checkout_date || !room_type) {
        return res.status(400).json({ success: false, message: 'Missing required booking fields (guest_name, phone, dates, room_type).' });
    }

    const checkIn = new Date(checkin_date);
    const checkOut = new Date(checkout_date);

    if (checkOut <= checkIn) {
        return res.status(400).json({ success: false, message: 'Check-out date must be after check-in date.' });
    }

    const diffDays = Math.max(1, Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24)));
    const basePrice = ROOM_PRICES[room_type] || 3499;
    const addonPrice = ADDON_PRICES[addons] || 0;
    const total_amount = (basePrice * diffDays) + addonPrice;

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

    // Trigger Outbound Vapi AI Voice Call asynchronously
    triggerVapiCall({
        guestName: guest_name,
        phoneNumber: phone,
        checkIn: checkin_date,
        checkOut: checkout_date,
        roomType: room_type,
        guests: guests_count || '2 Adults',
        bookingId: reference_id
    }).then(vapiResult => {
        console.log(`[BOOKING ENGINE] Vapi Call Trigger Result for ${reference_id}:`, vapiResult);
    }).catch(err => {
        console.error(`[BOOKING ENGINE] Vapi Call Error for ${reference_id}:`, err);
    });

    res.status(201).json({
        success: true,
        message: 'Reservation created successfully! Vapi AI Agent call initiated.',
        booking_id: reference_id,
        booking: newBooking,
        ai_calling: true
    });
});

// 2. GET /api/bookings - Fetch filtered bookings
app.get('/api/bookings', (req, res) => {
    const data = readData();
    let bookings = data.bookings || [];
    const { q, status, room } = req.query;

    if (q) {
        const query = q.toLowerCase();
        bookings = bookings.filter(b => 
            b.guest_name.toLowerCase().includes(query) ||
            b.phone.includes(query) ||
            b.id.toLowerCase().includes(query) ||
            (b.email && b.email.toLowerCase().includes(query))
        );
    }

    if (status && status !== 'all') {
        bookings = bookings.filter(b => b.status === status);
    }

    if (room && room !== 'all') {
        bookings = bookings.filter(b => b.room_type === room);
    }

    res.json({ success: true, count: bookings.length, bookings });
});

// 3. PATCH /api/bookings/:id - Update booking status or notes
app.patch('/api/bookings/:id', (req, res) => {
    const { id } = req.params;
    const { status, payment_status, notes } = req.body;

    const data = readData();
    const booking = data.bookings.find(b => b.id === id);

    if (!booking) {
        return res.status(404).json({ success: false, message: 'Booking reference not found.' });
    }

    if (status) booking.status = status;
    if (payment_status) booking.payment_status = payment_status;
    if (notes !== undefined) booking.staff_notes = notes;

    writeData(data);
    res.json({ success: true, message: `Booking ${id} updated successfully.`, booking });
});

// 4. POST /api/admin/login - Staff Auth
app.post('/api/admin/login', (req, res) => {
    const { email, password } = req.body;
    if ((email === 'admin@hotelvivana.com' || email === 'admin') && password === 'vivana2026') {
        res.json({
            success: true,
            token: 'vivana-auth-session-998822',
            user: { name: 'Vivana Desk Manager', email: 'admin@hotelvivana.com', role: 'Super Admin' }
        });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials. Use admin@hotelvivana.com / vivana2026' });
    }
});

// 5. GET /api/admin/stats - Overview KPIs & Charts Data
app.get('/api/admin/stats', (req, res) => {
    const data = readData();
    const bookings = data.bookings || [];
    const rooms = data.rooms || [];

    const todayStr = new Date().toISOString().split('T')[0];
    const todayCheckIns = bookings.filter(b => b.checkin_date === todayStr).length;
    const todayCheckOuts = bookings.filter(b => b.checkout_date === todayStr).length;

    const totalBookingsMonth = bookings.length;
    const totalRevenueMonth = bookings.reduce((sum, b) => sum + (b.total_amount || 0), 0);
    const pendingReservations = bookings.filter(b => b.status === 'pending').length;
    const avgBookingValue = totalBookingsMonth > 0 ? Math.round(totalRevenueMonth / totalBookingsMonth) : 0;

    const totalCapacity = rooms.reduce((sum, r) => sum + (r.total_rooms || 0), 0);
    const currentlyBooked = rooms.reduce((sum, r) => sum + (r.booked_rooms || 0), 0);
    const occupancyRate = totalCapacity > 0 ? Math.round((currentlyBooked / totalCapacity) * 100) : 68;

    // Room Distribution Data
    const roomBreakdown = {};
    bookings.forEach(b => {
        roomBreakdown[b.room_type] = (roomBreakdown[b.room_type] || 0) + 1;
    });

    res.json({
        success: true,
        kpis: {
            todayCheckIns,
            todayCheckOuts,
            totalBookingsMonth,
            totalRevenueMonth,
            pendingReservations,
            avgBookingValue,
            occupancyRate
        },
        roomBreakdown,
        recentBookings: bookings.slice(0, 10),
        upcomingEvents: (data.events || []).slice(0, 5)
    });
});

// 6. GET /api/guests - Deduplicated Guest Roster
app.get('/api/guests', (req, res) => {
    const data = readData();
    const bookings = data.bookings || [];
    const guestMap = {};

    bookings.forEach(b => {
        const key = b.phone || b.email;
        if (!guestMap[key]) {
            guestMap[key] = {
                guest_name: b.guest_name,
                phone: b.phone,
                email: b.email,
                total_stays: 0,
                total_spent: 0,
                last_stay_date: b.checkin_date,
                tag: 'New'
            };
        }

        guestMap[key].total_stays += 1;
        guestMap[key].total_spent += (b.total_amount || 0);

        if (new Date(b.checkin_date) > new Date(guestMap[key].last_stay_date)) {
            guestMap[key].last_stay_date = b.checkin_date;
        }

        if (guestMap[key].total_stays >= 3) guestMap[key].tag = 'VIP';
        else if (guestMap[key].total_stays >= 2) guestMap[key].tag = 'Regular';
    });

    const guests = Object.values(guestMap);
    res.json({ success: true, count: guests.length, guests });
});

// 7. GET / PATCH /api/inventory - Rooms Inventory
app.get('/api/inventory', (req, res) => {
    const data = readData();
    res.json({ success: true, rooms: data.rooms || [] });
});

app.patch('/api/inventory/:id', (req, res) => {
    const { id } = req.params;
    const { discount_price, status, scarcity_text } = req.body;

    const data = readData();
    const room = data.rooms.find(r => r.id === id);

    if (!room) return res.status(404).json({ success: false, message: 'Room not found.' });

    if (discount_price !== undefined) room.discount_price = Number(discount_price);
    if (status !== undefined) room.status = status;
    if (scarcity_text !== undefined) room.scarcity_text = scarcity_text;

    writeData(data);
    res.json({ success: true, message: `Room ${room.name} inventory updated.`, room });
});

// 8. GET / POST / PATCH /api/offers - Promo Codes
app.get('/api/offers', (req, res) => {
    const data = readData();
    res.json({ success: true, offers: data.offers || [] });
});

app.post('/api/offers', (req, res) => {
    const { code, discount_percent, expiry_date } = req.body;
    if (!code || !discount_percent) {
        return res.status(400).json({ success: false, message: 'Code and discount required.' });
    }

    const data = readData();
    const newOffer = {
        id: `OFF-${Date.now()}`,
        code: code.toUpperCase(),
        discount_percent: Number(discount_percent),
        usage_count: 0,
        expiry_date: expiry_date || '2026-12-31',
        status: 'Active'
    };

    data.offers.unshift(newOffer);
    writeData(data);
    res.status(201).json({ success: true, offer: newOffer });
});

app.patch('/api/offers/:id', (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const data = readData();
    const offer = data.offers.find(o => o.id === id);

    if (!offer) return res.status(404).json({ success: false, message: 'Offer code not found.' });

    if (status) offer.status = status;
    writeData(data);
    res.json({ success: true, offer });
});

// 9. GET / POST /api/settings - Central Hotel Settings
app.get('/api/settings', (req, res) => {
    const data = readData();
    res.json({ success: true, settings: data.settings || {} });
});

app.post('/api/settings', (req, res) => {
    const data = readData();
    data.settings = { ...data.settings, ...req.body };
    writeData(data);
    res.json({ success: true, message: 'Hotel settings updated.', settings: data.settings });
});

// Static File Server
app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(`  HOTEL VIVANA BACKEND API & VAPI VOICE AGENT SERVER  `);
    console.log(`  URL: http://localhost:${PORT}`);
    console.log(`  Admin Panel: http://localhost:${PORT}/admin`);
    console.log(`=================================================`);
});
