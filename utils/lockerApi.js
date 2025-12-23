const net = require('net');

/**
 * Base URL for the locker hardware API
 */
const LOCKER_HOST = '192.168.0.105';
const LOCKER_PORT = 80;

/**
 * Open a specific locker using raw TCP socket
 * @param {number} lockerNumber - The locker number (1-8)
 * @returns {Promise} - Response from the locker hardware
 */
const openLocker = async (lockerNumber) => {
  try {
    if (lockerNumber < 1 || lockerNumber > 8) {
      throw new Error('Invalid locker number. Must be between 1 and 8.');
    }
    
    // Based on the hardware response, we need to add a leading zero for opening
    const path = `/0${lockerNumber}`;
    
    console.log(`Opening locker using raw TCP socket: ${LOCKER_HOST}:${LOCKER_PORT}${path}`);
    
    // Use raw TCP socket to communicate with the HTTP/0.9 locker hardware
    const responseText = await openLockerRaw(LOCKER_HOST, path);
    
    console.log(`Raw response for opening locker ${lockerNumber}:`, responseText);
    console.log(`Raw response type for opening:`, typeof responseText);
    console.log(`Raw response buffer for opening:`, Buffer.from(responseText).toString('hex'));
    
    // Check if the response contains success indicators
    // Based on the hardware response image, successful responses might contain specific text patterns
    const success = !responseText.includes('Error') && !responseText.includes('Failed') && 
                  (responseText.includes(`Locker ${lockerNumber}`) || responseText.includes('Press Any one key'));
    
    return { 
      success: success, 
      status: success ? 'open' : 'failed',
      data: responseText,
      rawResponse: responseText,
      message: success ? 'Locker opened successfully' : 'Failed to open locker: ' + responseText
    };
  } catch (error) {
    console.error(`Error opening locker ${lockerNumber}:`, error);
    return { 
      success: false, 
      status: 'error',
      rawResponse: null,
      message: `Failed to open locker: ${error.message}` 
    };
  }
};

/**
 * Helper function to open locker using raw TCP socket
 * @param {string} ip - The IP address of the locker hardware
 * @param {string} path - The path to request (e.g., '/03')
 * @returns {Promise<string>} - Raw response from the locker hardware
 */
function openLockerRaw(ip, path) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let responseData = '';
    const timeout = 18000; // 5 second timeout
    
    // Set a timeout to prevent hanging connections
    const timeoutId = setTimeout(() => {
      client.destroy();
      reject(new Error('Connection timed out'));
    }, timeout);
    
    client.connect(LOCKER_PORT, ip, () => {
      console.log(`Connected to ${ip}:${LOCKER_PORT}, sending: GET ${path}\r\n`);
      client.write(`GET ${path}\r\n`);
    });
    
    client.on('data', (data) => {
      const chunk = data.toString();
      responseData += chunk;
      console.log(`Received data chunk: ${chunk}`);
      console.log(`Received data chunk (hex): ${data.toString('hex')}`);
      console.log(`Received data chunk (buffer): ${JSON.stringify(data)}`);
      
      // Check if this chunk contains a status indicator
      if (chunk.includes('Status=Open_') || chunk.includes('Status=Close_')) {
        console.log('Status indicator found in response');
        statusFound = true;
        
        // If we found a status, we can resolve early after a short delay
        // to allow for any additional data
        setTimeout(() => {
          if (!client.destroyed) {
            console.log('Resolving early with status data');
            clearTimeout(timeoutId);
            client.destroy();
            resolve(responseData.trim());
          }
        }, 500); // Wait 500ms for any additional data
      }
    });
    
    client.on('end', () => {
      clearTimeout(timeoutId);
      console.log('Connection closed normally');
      resolve(responseData.trim());
    });
    
    client.on('error', (err) => {
      clearTimeout(timeoutId);
      console.error('Socket error:', err);
      reject(err);
    });
    
    client.on('close', (hadError) => {
      clearTimeout(timeoutId);
      console.log(`Connection closed ${hadError ? 'with error' : 'normally'}`);
      if (responseData) {
        resolve(responseData.trim());
      }
    });
  });
}

/**
 * Get status of a specific locker using raw TCP socket
 * @param {number} lockerNumber - The locker number (1-8)
 * @returns {Promise} - Response from the locker hardware with status
 */
const getLockerStatus = async (lockerNumber) => {
  try {
    if (lockerNumber < 1 || lockerNumber > 8) {
      throw new Error('Invalid locker number. Must be between 1 and 8.');
    }
    
    const path = `/S${lockerNumber}`;
    console.log(`Fetching locker status using raw TCP socket: ${LOCKER_HOST}:${LOCKER_PORT}${path}`);
    
    // Use raw TCP socket to communicate with the HTTP/0.9 locker hardware
    const responseText = await getLockerStatusRaw(LOCKER_HOST, path);
    
    console.log(`Raw response for locker ${lockerNumber}:`, responseText);
    console.log(`Raw response type:`, typeof responseText);
    console.log(`Raw response buffer:`, Buffer.from(responseText).toString('hex'));
    
    // Parse the status from the response
    let status;
    let rawStatus = null;
    
    // Look for Status=Open_X or Status=Close_X pattern
    const statusRegex = /Status=(Open|Close)_\d+/g;
    const matches = responseText.match(statusRegex);
    
    if (matches && matches.length > 0) {
      // Use the last match as it's likely the most recent status
      const lastMatch = matches[matches.length - 1];
      rawStatus = lastMatch;
      
      if (lastMatch.includes('Open_')) {
        status = 'open';
      } else if (lastMatch.includes('Close_')) {
        status = 'closed';
      }
    } else if (responseText.includes(`Time_Out_${lockerNumber}`)) {
      status = 'timeout';
      rawStatus = `Time_Out_${lockerNumber}`;
    } else {
      // If we can't determine the status but got a response, assume closed
      status = 'unknown';
    }
    
    console.log(`Determined status for locker ${lockerNumber}:`, status);
    console.log(`Raw status text:`, rawStatus);
    return { success: true, status, rawStatus, rawResponse: responseText };
  } catch (error) {
    console.error(`Error getting status for locker ${lockerNumber}:`, error);
    return { 
      success: false, 
      status: 'unknown', 
      rawResponse: null,
      message: `Error getting locker status: ${error.message}` 
    };
  }
};

/**
 * Helper function to get locker status using raw TCP socket
 * @param {string} ip - The IP address of the locker hardware
 * @param {string} path - The path to request (e.g., '/S3')
 * @returns {Promise<string>} - Raw response from the locker hardware
 */
function getLockerStatusRaw(ip, path) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let responseData = '';
    const timeout = 3000; // Reduced to 3 second timeout
    let statusFound = false;
    
    // Set a timeout to prevent hanging connections
    const timeoutId = setTimeout(() => {
      // If we already found a status in the response, resolve with what we have
      if (statusFound && responseData) {
        console.log('Timeout occurred but status was found, resolving with partial data');
        clearTimeout(timeoutId);
        client.destroy();
        resolve(responseData.trim());
      } else {
        client.destroy();
        reject(new Error('Connection timed out'));
      }
    }, timeout);
    
    client.connect(LOCKER_PORT, ip, () => {
      console.log(`Connected to ${ip}:${LOCKER_PORT}, sending: GET ${path}\r\n`);
      client.write(`GET ${path}\r\n`);
    });
    
    client.on('data', (data) => {
      const chunk = data.toString();
      responseData += chunk;
      console.log(`Received data chunk: ${chunk}`);
      console.log(`Received data chunk (hex): ${data.toString('hex')}`);
      console.log(`Received data chunk (buffer): ${JSON.stringify(data)}`);
      
      // Check if this chunk contains a status indicator
      if (chunk.includes('Status=Open_') || chunk.includes('Status=Close_')) {
        console.log('Status indicator found in response');
        statusFound = true;
        
        // If we found a status, we can resolve early after a short delay
        // to allow for any additional data
        setTimeout(() => {
          if (!client.destroyed) {
            console.log('Resolving early with status data');
            clearTimeout(timeoutId);
            client.destroy();
            resolve(responseData.trim());
          }
        }, 500); // Wait 500ms for any additional data
      }
    });
    
    client.on('end', () => {
      clearTimeout(timeoutId);
      console.log('Connection closed normally');
      resolve(responseData.trim());
    });
    
    client.on('error', (err) => {
      clearTimeout(timeoutId);
      console.error('Socket error:', err);
      reject(err);
    });
    
    client.on('close', (hadError) => {
      clearTimeout(timeoutId);
      console.log(`Connection closed ${hadError ? 'with error' : 'normally'}`);
      if (responseData) {
        resolve(responseData.trim());
      }
    });
  });
}

module.exports = { openLocker, getLockerStatus };


// I need you to help me host a website, frontend react, backend express and node, db is in mysql and i want to host it all free without even providing my credit card details or anything and accessible anywhere