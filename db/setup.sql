-- Drop database if exists and create new one
DROP DATABASE IF EXISTS locker_system_DB;
CREATE DATABASE locker_system_DB;
USE locker_system_DB;

-- Users table
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL UNIQUE,
  phone VARCHAR(20) NOT NULL,
  password VARCHAR(255) NOT NULL,
  role ENUM('user', 'employee', 'admin') NOT NULL DEFAULT 'user',
  is_verified BOOLEAN DEFAULT FALSE,
  employee_id VARCHAR(50) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- OTP table
CREATE TABLE otps (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  otp VARCHAR(6) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Lockers table
CREATE TABLE lockers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  locker_number INT NOT NULL UNIQUE,
  status ENUM('empty', 'occupied') NOT NULL DEFAULT 'empty',
  is_open BOOLEAN DEFAULT FALSE,
  current_user_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (current_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Transactions table
CREATE TABLE transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  locker_id INT NOT NULL,
  start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  end_time TIMESTAMP NULL,
  amount DECIMAL(10, 2) NULL,
  status ENUM('active', 'completed', 'cancelled') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (locker_id) REFERENCES lockers(id) ON DELETE CASCADE
);

-- Access codes linked to bookings
CREATE TABLE locker_access_codes (
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
);

-- Locker open events table
CREATE TABLE locker_open_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  locker_id INT NOT NULL,
  opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (locker_id) REFERENCES lockers(id) ON DELETE CASCADE
);

-- Insert admin user
INSERT INTO users (name, email, phone, password, role, is_verified) 
VALUES ('Admin', 'admin@example.com', '+1234567890', '$2a$10$ixlPY3AAd4ty1l6E2IsXR.pZ3ckdjZhzqvpbFeE3fmTtk5blNo/c6', 'admin', TRUE);

-- Insert initial lockers (8 lockers)
INSERT INTO lockers (locker_number, status, is_open) VALUES 
(1, 'empty', FALSE),
(2, 'empty', FALSE),
(3, 'empty', FALSE),
(4, 'empty', FALSE),
(5, 'empty', FALSE),
(6, 'empty', FALSE),
(7, 'empty', FALSE),
(8, 'empty', FALSE);