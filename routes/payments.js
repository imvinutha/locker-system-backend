const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');

// Very simple in-memory payment store for demo purposes
// In production, replace with a real PSP integration and persistent storage
const paymentStore = new Map();
const DAILY_FEE = 50; // Rs per 24 hours

function generateId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Create a mock payment and return a QR URL
router.post('/create', auth, async (req, res) => {
  try {
    const { amount, lockerId } = req.body;
    const userId = req.user.id;

    if (!amount || !lockerId) {
      return res.status(400).json({ message: 'amount and lockerId are required' });
    }

    const id = generateId();

    // Build a placeholder UPI deep link and encode as a QR image using Google Chart API
    // Replace the VPA and details when real credentials are provided
    const upiLink = `upi://pay?pa=testvpa@upi&pn=Locker%20System&am=${encodeURIComponent(
      amount
    )}&tn=${encodeURIComponent('Locker Fee')}`;
    const qrUrl = `https://chart.googleapis.com/chart?cht=qr&chs=256x256&chl=${encodeURIComponent(
      upiLink
    )}`;

    const record = {
      id,
      userId,
      lockerId,
      amount,
      status: 'pending',
      createdAt: Date.now(),
      qrUrl,
      upiLink,
    };

    paymentStore.set(id, record);

    // For demo: auto-complete the payment after 8 seconds
    setTimeout(() => {
      const entry = paymentStore.get(id);
      if (entry && entry.status === 'pending') {
        entry.status = 'success';
        paymentStore.set(id, entry);
      }
    }, 8000);

    return res.json({ paymentId: id, qrUrl, status: 'pending' });
  } catch (error) {
    console.error('Create payment error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Check payment status
router.get('/:id/status', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const record = paymentStore.get(id);
    if (!record) {
      return res.status(404).json({ message: 'Payment not found' });
    }
    return res.json({ status: record.status });
  } catch (error) {
    console.error('Get payment status error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

// Compute dues for a user's active transaction on a locker
// GET /api/payments/dues?lockerId=ID
router.get('/dues', auth, async (req, res) => {
  try {
    const { lockerId } = req.query;
    const db = req.db;
    const userId = req.user.id;

    if (!lockerId) {
      return res.status(400).json({ message: 'lockerId is required' });
    }

    // Find active transaction for this user and locker
    const [rows] = await db.query(
      'SELECT * FROM transactions WHERE user_id = ? AND locker_id = ? AND status = "active" ORDER BY created_at DESC LIMIT 1',
      [userId, lockerId]
    );

    if (rows.length === 0) {
      return res.json({ due: 0, dailyFee: DAILY_FEE, hoursUsed: 0 });
    }

    const tx = rows[0];
    const start = new Date(tx.start_time);
    const now = new Date();
    const hoursUsed = Math.max(0, Math.ceil((now - start) / (1000 * 60 * 60)));

    // First 24 hours included in initial fee
    const extraDays = Math.max(0, Math.ceil((hoursUsed - 24) / 24));
    const due = extraDays * DAILY_FEE;

    return res.json({ due, dailyFee: DAILY_FEE, hoursUsed });
  } catch (error) {
    console.error('Get dues error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
});


