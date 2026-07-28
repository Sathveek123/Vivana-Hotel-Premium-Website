const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const DB_FILE = path.join(__dirname, '..', 'db', 'data.json');

function helperReadData() {
    try {
        if (!fs.existsSync(DB_FILE)) return { bookings: [] };
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (err) {
        return { bookings: [] };
    }
}

function helperWriteData(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
        console.error('Error writing DB:', err);
    }
}

// Function to trigger call to Vapi
async function triggerVapiCall({ guestName, phoneNumber, checkIn, checkOut, roomType, guests, bookingId }) {
    let formattedPhone = (phoneNumber || '').replace(/[\s\-\(\)]/g, '');
    if (!formattedPhone.startsWith('+')) {
        if (formattedPhone.length === 10) {
            formattedPhone = `+91${formattedPhone}`;
        } else if (formattedPhone.startsWith('91') && formattedPhone.length === 12) {
            formattedPhone = `+${formattedPhone}`;
        } else {
            formattedPhone = `+91${formattedPhone}`;
        }
    }

    const payload = {
        phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
        customer: {
            number: formattedPhone,
            name: guestName || 'Valued Guest'
        },
        assistantId: process.env.VAPI_ASSISTANT_ID,
        assistantOverrides: {
            variableValues: {
                guestName: guestName || 'Valued Guest',
                checkIn: checkIn || 'Today',
                checkOut: checkOut || 'Tomorrow',
                roomType: roomType || 'Deluxe Room',
                guests: guests || '2 Adults'
            }
        }
    };

    console.log(`[VAPI OUTBOUND CALL] Triggering AI agent call to ${formattedPhone} for ${guestName}...`);

    try {
        const response = await axios.post('https://api.vapi.ai/call/phone', payload, {
            headers: {
                Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        const callId = response.data?.id || `VAPI-CALL-${Date.now()}`;
        console.log(`[VAPI OUTBOUND SUCCESS] Call Initiated! Call ID: ${callId}`);

        if (bookingId) {
            const data = helperReadData();
            const booking = data.bookings.find(b => b.id === bookingId);
            if (booking) {
                booking.vapi_call_id = callId;
                booking.vapi_call_status = 'triggered';
                booking.vapi_call_time = new Date().toISOString();
                helperWriteData(data);
            }
        }

        return { success: true, callId, phone: formattedPhone };
    } catch (error) {
        const errDetails = error.response?.data || error.message;
        console.error('[VAPI OUTBOUND ERROR]:', errDetails);
        return { success: false, error: errDetails };
    }
}

// Endpoint: POST /api/trigger-call
router.post('/trigger-call', async (req, res) => {
    const { guestName, phoneNumber, checkIn, checkOut, roomType, guests, bookingId } = req.body;

    if (!phoneNumber) {
        return res.status(400).json({ success: false, error: 'Phone number is required to trigger AI voice call.' });
    }

    const result = await triggerVapiCall({ guestName, phoneNumber, checkIn, checkOut, roomType, guests, bookingId });

    if (result.success) {
        res.status(200).json(result);
    } else {
        res.status(500).json(result);
    }
});

// Endpoint: POST /api/vapi-webhook (Receives Vapi call events & transcripts)
router.post('/vapi-webhook', (req, res) => {
    const event = req.body;
    console.log('[VAPI WEBHOOK EVENT RECEIVED]:', event.message?.type || event.type);

    if (event.message?.type === 'end-of-call-report') {
        const callId = event.message.call?.id;
        const transcript = event.message.transcript || event.message.summary || 'AI Voice conversation completed.';
        const data = helperReadData();
        const booking = data.bookings.find(b => b.vapi_call_id === callId);

        if (booking) {
            booking.vapi_call_status = 'completed';
            booking.vapi_transcript = transcript;
            helperWriteData(data);
        }
    }

    res.status(200).json({ received: true });
});

module.exports = { router, triggerVapiCall };
