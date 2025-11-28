const axios = require('axios');
require('dotenv').config();

/**
 * Send OTP using MSG91 API
 * @param {string} phoneNumber - E.164 format e.g. +919999999999
 * @param {string} otp - The OTP code
 * @returns {Promise<{success: boolean, message: string}>}
 */
const sendOTP = async (phoneNumber, otp) => {
  try {
    // Always format number as '91XXXXXXXXXX'
    let digits = phoneNumber.replace(/[^\d]/g, '');
    if (digits.startsWith('91')) {
      digits = digits;
    } else if (digits.length === 10) {
      digits = '91' + digits;
    } else if (digits.startsWith('0') && digits.length === 11) {
      digits = '91' + digits.slice(1);
    }
    // Validate
    if (digits.length !== 12 || !/^91\d{10}$/.test(digits)) {
      console.error('MSG91 sendOTP error: invalid phone format after normalization:', digits, phoneNumber);
      return { success: false, message: 'Invalid phone number format for SMS' };
    }
    const apiUrl = 'https://api.msg91.com/api/v5/otp';
    const params = {
      template_id: process.env.MSG91_TEMPLATE_ID,
      mobile: digits,
      authkey: process.env.MSG91_AUTHKEY,
      otp,
      sender: process.env.MSG91_SENDER_ID
    };
    console.log('MSG91 sendOTP debug - sending params:', params);
    const response = await axios.post(apiUrl, {}, { params });
    console.log('MSG91 sendOTP debug - response:', response.data);
    if (response.data && response.data.type === 'success') {
      return { success: true, message: 'OTP sent successfully (MSG91)' };
    } else {
      return { success: false, message: response.data?.message || 'Failed to send OTP via MSG91' };
    }
  } catch (error) {
    console.error('MSG91 sendOTP error:', error.response?.data || error.message);
    return { success: false, message: error.response?.data?.message || error.message };
  }
};

module.exports = { sendOTP };
