const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { auth, isAdmin, isEmployeeOrAdmin } = require('../middleware/auth');

// Get all users (admin only)
router.get('/', auth, isAdmin, async (req, res) => {
  const db = req.db;

  try {
    const [users] = await db.query(
      'SELECT id, name, email, phone, role, is_verified, employee_id, created_at FROM users'
    );

    res.json({ users });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get user by ID
router.get('/:id', auth, async (req, res) => {
  const { id } = req.params;
  const db = req.db;

  // Only allow users to access their own data unless admin
  if (req.user.role !== 'admin' && req.user.id !== parseInt(id)) {
    return res.status(403).json({ message: 'Access denied' });
  }

  try {
    const [users] = await db.query(
      'SELECT id, name, email, phone, role, is_verified, employee_id, created_at FROM users WHERE id = ?',
      [id]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ user: users[0] });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update user
router.put('/:id', auth, async (req, res) => {
  const { id } = req.params;
  const { name, email, phone, password, role, employeeId } = req.body;
  const db = req.db;

  // Only allow users to update their own data unless admin
  if (req.user.role !== 'admin' && req.user.id !== parseInt(id)) {
    return res.status(403).json({ message: 'Access denied' });
  }

  // Only admin can change roles
  if (role && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Only admin can change roles' });
  }

  try {
    // Check if user exists
    const [users] = await db.query('SELECT * FROM users WHERE id = ?', [id]);

    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Build update query
    let updateQuery = 'UPDATE users SET ';
    const updateValues = [];
    const updateFields = [];

    if (name) {
      updateFields.push('name = ?');
      updateValues.push(name);
    }

    if (email) {
      // Check if email is already taken by another user
      const [existingUsers] = await db.query(
        'SELECT * FROM users WHERE email = ? AND id != ?',
        [email, id]
      );

      if (existingUsers.length > 0) {
        return res.status(400).json({ message: 'Email already in use' });
      }

      updateFields.push('email = ?');
      updateValues.push(email);
    }

    if (phone) {
      // Check if phone is already taken by another user
      const [existingUsers] = await db.query(
        'SELECT * FROM users WHERE phone = ? AND id != ?',
        [phone, id]
      );

      if (existingUsers.length > 0) {
        return res.status(400).json({ message: 'Phone number already in use' });
      }

      updateFields.push('phone = ?');
      updateValues.push(phone);
    }

    if (password) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      updateFields.push('password = ?');
      updateValues.push(hashedPassword);
    }

    if (role && req.user.role === 'admin') {
      updateFields.push('role = ?');
      updateValues.push(role);
    }

    if (employeeId && (req.user.role === 'admin' || users[0].role === 'employee')) {
      updateFields.push('employee_id = ?');
      updateValues.push(employeeId);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    updateQuery += updateFields.join(', ');
    updateQuery += ' WHERE id = ?';
    updateValues.push(id);

    await db.query(updateQuery, updateValues);

    // Get updated user
    const [updatedUsers] = await db.query(
      'SELECT id, name, email, phone, role, is_verified, employee_id, created_at FROM users WHERE id = ?',
      [id]
    );

    res.json({
      message: 'User updated successfully',
      user: updatedUsers[0]
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete user (admin only)
router.delete('/:id', auth, isAdmin, async (req, res) => {
  const { id } = req.params;
  const db = req.db;

  try {
    // Check if user exists
    const [users] = await db.query('SELECT * FROM users WHERE id = ?', [id]);

    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Don't allow deleting the last admin
    if (users[0].role === 'admin') {
      const [admins] = await db.query('SELECT COUNT(*) as count FROM users WHERE role = "admin"');
      if (admins[0].count <= 1) {
        return res.status(400).json({ message: 'Cannot delete the last admin user' });
      }
    }

    // Delete user
    await db.query('DELETE FROM users WHERE id = ?', [id]);

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;