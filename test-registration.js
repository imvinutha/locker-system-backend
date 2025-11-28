// Test script for registration functionality
require('dotenv').config();
const axios = require('axios');

// Test user data
const testUser = {
  name: 'Test User',
  email: 'testuser' + Date.now() + '@example.com', // Unique email
  phone: '+1' + Math.floor(1000000000 + Math.random() * 9000000000), // Random phone
  password: 'password123',
  role: 'user'
};

const testEmployee = {
  name: 'Test Employee',
  email: 'testemployee' + Date.now() + '@example.com', // Unique email
  phone: '+1' + Math.floor(1000000000 + Math.random() * 9000000000), // Random phone
  password: 'password123',
  role: 'employee',
  employeeId: 'EMP' + Date.now() // Unique employee ID
};

async function testRegistration() {
  console.log('\n===== TESTING USER REGISTRATION =====');
  console.log('Test data:', { ...testUser, password: '***HIDDEN***' });
  
  try {
    const userResponse = await axios.post('http://localhost:5000/api/auth/register', testUser);
    console.log('\n✅ USER REGISTRATION SUCCESSFUL');
    console.log('Response:', userResponse.data);
  } catch (error) {
    console.log('\n❌ USER REGISTRATION FAILED');
    console.log('Error message:', error.message);
    console.log('Response data:', error.response?.data);
    console.log('Response status:', error.response?.status);
    console.log('Full error:', error);
  }

  console.log('\n===== TESTING EMPLOYEE REGISTRATION =====');
  console.log('Test data:', { ...testEmployee, password: '***HIDDEN***' });
  
  try {
    const employeeResponse = await axios.post('http://localhost:5000/api/auth/register', testEmployee);
    console.log('\n✅ EMPLOYEE REGISTRATION SUCCESSFUL');
    console.log('Response:', employeeResponse.data);
  } catch (error) {
    console.log('\n❌ EMPLOYEE REGISTRATION FAILED');
    console.log('Error message:', error.message);
    console.log('Response data:', error.response?.data);
    console.log('Response status:', error.response?.status);
    console.log('Full error:', error);
  }
}

testRegistration().catch(err => {
  console.error('Test script error:', err);
});