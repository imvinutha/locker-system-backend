const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { sendOTP } = require('../utils/twilio');
const { auth, isAdmin } = require('../middleware/auth');

// Generate a random 4-digit OTP
const generateOTP = () => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

// Register a new user
router.post('/register', async (req, res) => {
  console.log('Registration request received:', req.body);
  const { name, email, phone, password, role = 'user', employeeId = null } = req.body;
  const db = req.db;

  try {
    console.log('Processing registration for:', { name, email, phone, role, employeeId });
    
    // Check if user already exists
    console.log('Checking if user exists with email:', email, 'or phone:', phone);
    const [existingUsers] = await db.query(
      'SELECT * FROM users WHERE email = ? OR phone = ?',
      [email, phone]
    );

    console.log('Existing users found:', existingUsers.length);
    if (existingUsers.length > 0) {
      console.log('User already exists:', existingUsers[0]);
      return res.status(400).json({ message: 'User already exists with this email or phone' });
    }

    // Hash password
    console.log('Hashing password...');
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    console.log('Creating new user with role:', role, 'and employeeId:', employeeId);
    const [result] = await db.query(
      'INSERT INTO users (name, email, phone, password, role, employee_id, is_verified) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, email, phone, hashedPassword, role, employeeId, role !== 'user'] // Only users need verification
    );

    const userId = result.insertId;
    console.log('User created with ID:', userId);

    // Generate token
    console.log('Generating JWT token...');
    const token = jwt.sign(
      { id: userId, email, role },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    console.log('Registration successful, sending response');
    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: userId,
        name,
        email,
        phone,
        role,
        isVerified: role !== 'user'
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Login user
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const db = req.db;

  try {
    // Check if user exists
    const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);

    if (users.length === 0) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const user = users[0];

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // For users, generate and send OTP
    if (user.role === 'user') {
      const otp = generateOTP();
      
      // Store OTP in database
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 10); // OTP valid for 10 minutes
      
      await db.query(
        'INSERT INTO otps (user_id, otp, expires_at) VALUES (?, ?, ?)',
        [user.id, otp, expiresAt]
      );
      
      // Send OTP via Twilio
      const otpResult = await sendOTP(user.phone, otp);
      
      return res.json({
        message: 'OTP sent to your phone',
        requiresOTP: true,
        userId: user.id,
        otpSent: otpResult.success
      });
    }

    // For employees and admin, generate token directly
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isVerified: user.is_verified === 1
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Verify OTP
router.post('/verify-otp', async (req, res) => {
  const { userId, otp } = req.body;
  const db = req.db;

  try {
    // Get the latest OTP for this user
    const [otps] = await db.query(
      'SELECT * FROM otps WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
      [userId]
    );

    if (otps.length === 0) {
      return res.status(400).json({ message: 'No OTP found for this user' });
    }

    const latestOtp = otps[0];

    // Check if OTP is expired
    if (new Date() > new Date(latestOtp.expires_at)) {
      return res.status(400).json({ message: 'OTP has expired' });
    }

    // Check if OTP matches
    if (latestOtp.otp !== otp) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    // Get user details
    const [users] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);

    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = users[0];

    // Mark user as verified if not already
    if (!user.is_verified) {
      await db.query('UPDATE users SET is_verified = TRUE WHERE id = ?', [userId]);
    }

    // Delete used OTP
    await db.query('DELETE FROM otps WHERE id = ?', [latestOtp.id]);

    // Generate token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({
      message: 'OTP verified successfully',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isVerified: true
      }
    });
  } catch (error) {
    console.error('OTP verification error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Passwordless: Request OTP by phone
router.post('/otp/request', async (req, res) => {
  const { phone } = req.body;
  const db = req.db;

  if (!phone) {
    return res.status(400).json({ message: 'Phone is required' });
  }

  try {
    // Find or create user by phone
    const [existing] = await db.query('SELECT * FROM users WHERE phone = ?', [phone]);
    let user = existing[0];

    if (!user) {
      // Create minimal user record for phone-only login
      // Generate a random password hash to satisfy NOT NULL constraints if any
      const randomPassword = Math.random().toString(36).slice(-12);
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(randomPassword, salt);

      const syntheticEmail = `${phone}@auto.local`;

      const [result] = await db.query(
        'INSERT INTO users (name, email, phone, password, role, employee_id, is_verified) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [phone, syntheticEmail, phone, hashedPassword, 'user', null, true]
      );

      const [createdRows] = await db.query('SELECT * FROM users WHERE id = ?', [result.insertId]);
      user = createdRows[0];
    }

    // Generate OTP
    const otp = generateOTP();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10);

    await db.query('INSERT INTO otps (user_id, otp, expires_at) VALUES (?, ?, ?)', [user.id, otp, expiresAt]);

    const otpResult = await sendOTP(user.phone, otp);

    return res.json({
      message: 'OTP sent to your phone',
      otpSent: otpResult.success,
      userId: user.id
    });
  } catch (error) {
    console.error('OTP request error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Passwordless: Verify OTP by phone
router.post('/otp/verify', async (req, res) => {
  const { phone, otp } = req.body;
  const db = req.db;

  if (!phone || !otp) {
    return res.status(400).json({ message: 'Phone and OTP are required' });
  }

  try {
    const [users] = await db.query('SELECT * FROM users WHERE phone = ?', [phone]);
    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found for this phone' });
    }

    const user = users[0];

    const [otps] = await db.query(
      'SELECT * FROM otps WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
      [user.id]
    );

    if (otps.length === 0) {
      return res.status(400).json({ message: 'No OTP found for this user' });
    }

    const latestOtp = otps[0];

    if (new Date() > new Date(latestOtp.expires_at)) {
      return res.status(400).json({ message: 'OTP has expired' });
    }

    if (latestOtp.otp !== otp) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    await db.query('DELETE FROM otps WHERE id = ?', [latestOtp.id]);

    // Ensure verified flag
    if (!user.is_verified) {
      await db.query('UPDATE users SET is_verified = TRUE WHERE id = ?', [user.id]);
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    return res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isVerified: true
      }
    });
  } catch (error) {
    console.error('OTP verify error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get current user
router.get('/me', auth, async (req, res) => {
  const db = req.db;

  try {
    const [users] = await db.query(
      'SELECT id, name, email, phone, role, is_verified, employee_id, created_at FROM users WHERE id = ?',
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = users[0];

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        employeeId: user.employee_id,
        isVerified: user.is_verified === 1,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;