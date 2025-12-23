require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const lockerRoutes = require('./routes/lockers');
const transactionRoutes = require('./routes/transactions');
const paymentRoutes = require('./routes/payments');

const app = express();

// ====== CORS CONFIG ======
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://192.168.0.105:3000",
  "https://melodious-gnome-ea7f4b.netlify.app",
  "https://locker-system-frontend-iq9h.onrender.com"
];


app.use(cors({
  origin: function (origin, callback) {
    console.log("Incoming request origin:", origin);

    // Allow mobile apps and curl without origin
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.warn("❌ CORS blocked:", origin);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true
}));

app.use(express.json());

// ====== DB CONNECTION ======
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'Password@123',
  database: process.env.DB_NAME || 'locker_system_DB',
  waitForConnections: true,
  connectionLimit: 10,
});

// ====== Ensure auxiliary tables ======
(async () => {
  try {
    await Promise.all([
      pool.query(`
        CREATE TABLE IF NOT EXISTS otps (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          otp VARCHAR(10) NOT NULL,
          expires_at DATETIME NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB;
      `),
      pool.query(`
        CREATE TABLE IF NOT EXISTS locker_access_codes (
          id INT AUTO_INCREMENT PRIMARY KEY,
          locker_id INT NOT NULL,
          user_id INT NOT NULL,
          transaction_id INT NOT NULL,
          access_code VARCHAR(10) NOT NULL,
          duration_minutes INT NOT NULL,
          amount DECIMAL(10,2) NOT NULL,
          expires_at DATETIME NOT NULL,
          usage_count INT DEFAULT 0,
          last_used_at DATETIME NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (locker_id) REFERENCES lockers(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
          INDEX idx_access_code (access_code)
        ) ENGINE=InnoDB;
      `)
    ]);
    console.log("OTP & locker_access_codes tables ensured.");
  } catch (err) {
    console.error("❌ Auxiliary table creation failed:", err);
  }
})();

// ====== Add DB to req ======
app.use((req, res, next) => {
  req.db = pool;
  next();
});

// ====== ROUTES ======
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/lockers', lockerRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/payments', paymentRoutes);

// ====== TEST ROUTE ======
app.get('/api/test', (req, res) => {
  res.json({
    message: "API is working!",
    ip: req.ip,
  });
});

// ====== GLOBAL ERROR LOGGER ======
app.use((err, req, res, next) => {
  console.error("🔥 SERVER ERROR:");
  console.error("URL:", req.originalUrl);
  console.error("BODY:", req.body);
  console.error("ERROR:", err);

  res.status(500).json({
    message: "Something went wrong",
    error: err.message,
  });
});

// ====== START SERVER ======
const PORT = process.env.PORT || 5000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
  console.log(`📱 Access from another device: http://<YOUR_LOCAL_IP>:${PORT}`);
});

module.exports = app;
