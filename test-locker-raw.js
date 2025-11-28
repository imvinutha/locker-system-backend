/**
 * Test script for raw TCP socket communication with locker hardware
 */
const { openLocker, getLockerStatus } = require('./utils/lockerApi');

// Test locker number
const LOCKER_NUMBER = 3;

async function testLockerCommunication() {
  console.log('=== Testing Raw TCP Socket Locker Communication ===');
  
  try {
    // Test getting locker status
    console.log(`\n1. Getting status for locker ${LOCKER_NUMBER}...`);
    const statusResult = await getLockerStatus(LOCKER_NUMBER);
    console.log('Status result:', JSON.stringify(statusResult, null, 2));
    
    // Wait a moment before opening
    console.log('\nWaiting 2 seconds...');
    await new Promise(resolve => setTimeout(resolve, 20000));
    
    // Test opening locker
    console.log(`\n2. Opening locker ${LOCKER_NUMBER}...`);
    const openResult = await openLocker(LOCKER_NUMBER);
    console.log('Open result:', JSON.stringify(openResult, null, 2));
    
    // Wait a moment before getting status again
    console.log('\nWaiting 2 seconds...');
    await new Promise(resolve => setTimeout(resolve, 20000));
    
    // Test getting locker status again after opening
    console.log(`\n3. Getting status for locker ${LOCKER_NUMBER} after opening...`);
    const statusAfterOpenResult = await getLockerStatus(LOCKER_NUMBER);
    console.log('Status after open result:', JSON.stringify(statusAfterOpenResult, null, 2));
    
    console.log('\n=== Test completed successfully ===');
  } catch (error) {
    console.error('Test failed with error:', error);
  }
}

// Run the test
testLockerCommunication();