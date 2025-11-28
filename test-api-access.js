// Simple test script using XMLHttpRequest
const http = require('http');

const options = {
  hostname: '192.168.0.105',
  port: 5000,
  path: '/api/test',
  method: 'GET'
};

console.log('Testing API access...');
const req = http.request(options, (res) => {
  console.log(`Status Code: ${res.statusCode}`);
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('Response data:', data);
    console.log('API is accessible!');
  });
});

req.on('error', (error) => {
  console.error('Error accessing API:', error.message);
});

req.end();