const { BakongKHQR, khqrData, MerchantInfo } = require('bakong-khqr');
const QRCode = require('qrcode');

const BAKONG_API_URL = process.env.BAKONG_API_URL || 'https://sit-api-bakong.nbc.org.kh';
const BAKONG_API_TOKEN = process.env.BAKONG_API_TOKEN || '';

/**
 * Generate a KHQR code for a payment
 * @param {Object} params
 * @param {number} params.amount - Payment amount
 * @param {string} params.currency - 'khr' or 'usd'
 * @param {string} params.billNumber - Bill/order number
 * @param {string} params.mobileNumber - Student phone number
 * @returns {Promise<{ qrString: string, md5Hash: string, qrImageBase64: string }>}
 */
async function generateKHQR({ amount, currency = 'khr', billNumber, mobileNumber }) {
  const optionalData = {
    currency: currency === 'usd' ? khqrData.currency.usd : khqrData.currency.khr,
    amount: parseFloat(amount),
    billNumber: billNumber || '',
    mobileNumber: mobileNumber || '',
    storeLabel: (process.env.BAKONG_MERCHANT_NAME || 'NMU').substring(0, 25),
    terminalLabel: 'Payment',
    expirationTimestamp: Date.now() + (10 * 60 * 1000),
    merchantCategoryCode: '5999'
  };

  const merchantInfo = new MerchantInfo(
    process.env.BAKONG_ACCOUNT_ID || 'khuon@nbc',
    (process.env.BAKONG_MERCHANT_NAME || 'NMU').substring(0, 25),
    process.env.BAKONG_MERCHANT_CITY || 'PHNOM PENH',
    process.env.BAKONG_MERCHANT_ID || '123456',
    process.env.BAKONG_ACQUIRING_BANK || 'Bakong',
    optionalData
  );

  const khqr = new BakongKHQR();
  const response = khqr.generateMerchant(merchantInfo);

  if (!response.data || !response.data.qr) {
    const errMsg = response.status ? response.status.message : 'Unknown error';
    console.error('KHQR generation failed:', errMsg, response.status);
    throw new Error('Failed to generate KHQR code: ' + errMsg);
  }

  const qrImageBase64 = await QRCode.toDataURL(response.data.qr, {
    width: 300,
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' }
  });

  return {
    qrString: response.data.qr,
    md5Hash: response.data.md5,
    qrImageBase64
  };
}

/**
 * Check transaction status by MD5 hash
 * @param {string} md5Hash - The MD5 hash from generateKHQR
 * @returns {Promise<{ success: boolean, status: string, data: Object|null }>}
 */
async function checkTransaction(md5Hash) {
  try {
    const response = await fetch(`${BAKONG_API_URL}/v1/check_transaction_by_md5`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${BAKONG_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ md5: md5Hash })
    });

    const result = await response.json();

    if (result.responseCode === 0) {
      return { success: true, status: 'success', data: result.data || result };
    } else if (result.responseCode === 25) {
      return { success: false, status: 'not_found', data: null };
    } else {
      return { success: false, status: 'failed', data: result };
    }
  } catch (error) {
    console.error('Bakong transaction check error:', error);
    return { success: false, status: 'error', data: null };
  }
}

module.exports = { generateKHQR, checkTransaction };
