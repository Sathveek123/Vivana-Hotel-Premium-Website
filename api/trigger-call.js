const { triggerVapiCall } = require('../routes/vapiCall');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method === 'POST') {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        const { guestName, phoneNumber, checkIn, checkOut, roomType, guests, bookingId } = body;

        const result = await triggerVapiCall({ guestName, phoneNumber, checkIn, checkOut, roomType, guests, bookingId });
        return res.status(result.success ? 200 : 500).json(result);
    }

    return res.status(405).json({ message: 'Method not allowed' });
};
