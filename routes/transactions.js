const express = require('express');
const router = express.Router();
const { auth, isAdmin, isEmployeeOrAdmin } = require('../middleware/auth');

// Get all transactions (admin and employee can see all, users can only see their own)
router.get('/', auth, async (req, res) => {
  const db = req.db;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    let query = `
      SELECT t.*, u.name as user_name, u.email as user_email, 
      l.locker_number, l.status as locker_status
      FROM transactions t
      JOIN users u ON t.user_id = u.id
      JOIN lockers l ON t.locker_id = l.id
    `;
    
    const queryParams = [];
    
    // If user role is not admin or employee, only show their transactions
    if (userRole === 'user') {
      query += ' WHERE t.user_id = ?';
      queryParams.push(userId);
    }
    
    query += ' ORDER BY t.created_at DESC';
    
    const [transactions] = await db.query(query, queryParams);
    
    res.json({ transactions });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get transaction by ID
router.get('/:id', auth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;
  const db = req.db;

  try {
    const [transactions] = await db.query(
      `SELECT t.*, u.name as user_name, u.email as user_email, 
      l.locker_number, l.status as locker_status
      FROM transactions t
      JOIN users u ON t.user_id = u.id
      JOIN lockers l ON t.locker_id = l.id
      WHERE t.id = ?`,
      [id]
    );

    if (transactions.length === 0) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    const transaction = transactions[0];

    // Check if user has permission to view this transaction
    if (userRole === 'user' && transaction.user_id !== userId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json({ transaction });
  } catch (error) {
    console.error('Get transaction error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Create a new transaction (usually handled by locker open/close operations)
router.post('/', auth, isEmployeeOrAdmin, async (req, res) => {
  const { userId, lockerId, amount = null } = req.body;
  const db = req.db;

  try {
    // Check if user exists
    const [users] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if locker exists
    const [lockers] = await db.query('SELECT * FROM lockers WHERE id = ?', [lockerId]);
    if (lockers.length === 0) {
      return res.status(404).json({ message: 'Locker not found' });
    }

    // Create transaction
    const [result] = await db.query(
      'INSERT INTO transactions (user_id, locker_id, amount, status) VALUES (?, ?, ?, "active")',
      [userId, lockerId, amount]
    );

    // Update locker status
    await db.query(
      'UPDATE lockers SET current_user_id = ?, status = "occupied" WHERE id = ?',
      [userId, lockerId]
    );

    // Get created transaction
    const [createdTransactions] = await db.query(
      `SELECT t.*, u.name as user_name, u.email as user_email, 
      l.locker_number, l.status as locker_status
      FROM transactions t
      JOIN users u ON t.user_id = u.id
      JOIN lockers l ON t.locker_id = l.id
      WHERE t.id = ?`,
      [result.insertId]
    );

    res.status(201).json({
      message: 'Transaction created successfully',
      transaction: createdTransactions[0]
    });
  } catch (error) {
    console.error('Create transaction error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Complete a transaction (usually handled by locker close operation)
router.put('/:id/complete', auth, isEmployeeOrAdmin, async (req, res) => {
  const { id } = req.params;
  const { amount } = req.body;
  const db = req.db;

  try {
    // Check if transaction exists
    const [transactions] = await db.query(
      'SELECT * FROM transactions WHERE id = ?',
      [id]
    );

    if (transactions.length === 0) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    const transaction = transactions[0];

    // Check if transaction is already completed
    if (transaction.status !== 'active') {
      return res.status(400).json({ message: 'Transaction is already completed or cancelled' });
    }

    // Complete transaction
    await db.query(
      'UPDATE transactions SET end_time = NOW(), amount = ?, status = "completed" WHERE id = ?',
      [amount || 0, id]
    );

    // Release locker
    await db.query(
      'UPDATE lockers SET current_user_id = NULL, status = "empty" WHERE id = ?',
      [transaction.locker_id]
    );

    // Get updated transaction
    const [updatedTransactions] = await db.query(
      `SELECT t.*, u.name as user_name, u.email as user_email, 
      l.locker_number, l.status as locker_status
      FROM transactions t
      JOIN users u ON t.user_id = u.id
      JOIN lockers l ON t.locker_id = l.id
      WHERE t.id = ?`,
      [id]
    );

    res.json({
      message: 'Transaction completed successfully',
      transaction: updatedTransactions[0]
    });
  } catch (error) {
    console.error('Complete transaction error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Cancel a transaction
router.put('/:id/cancel', auth, isEmployeeOrAdmin, async (req, res) => {
  const { id } = req.params;
  const db = req.db;

  try {
    // Check if transaction exists
    const [transactions] = await db.query(
      'SELECT * FROM transactions WHERE id = ?',
      [id]
    );

    if (transactions.length === 0) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    const transaction = transactions[0];

    // Check if transaction is already completed or cancelled
    if (transaction.status !== 'active') {
      return res.status(400).json({ message: 'Transaction is already completed or cancelled' });
    }

    // Cancel transaction
    await db.query(
      'UPDATE transactions SET end_time = NOW(), status = "cancelled" WHERE id = ?',
      [id]
    );

    // Release locker
    await db.query(
      'UPDATE lockers SET current_user_id = NULL, status = "empty" WHERE id = ?',
      [transaction.locker_id]
    );

    // Get updated transaction
    const [updatedTransactions] = await db.query(
      `SELECT t.*, u.name as user_name, u.email as user_email, 
      l.locker_number, l.status as locker_status
      FROM transactions t
      JOIN users u ON t.user_id = u.id
      JOIN lockers l ON t.locker_id = l.id
      WHERE t.id = ?`,
      [id]
    );

    res.json({
      message: 'Transaction cancelled successfully',
      transaction: updatedTransactions[0]
    });
  } catch (error) {
    console.error('Cancel transaction error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;