require('dotenv').config();
const { sendEmail } = require('./config/mailer');

async function testEmail() {
  try {
    console.log('Testing email configuration...');
    const result = await sendEmail('test@example.com', 'Test Email', 'This is a test email from the scholarship system.');
    console.log('Email sent successfully:', result);
  } catch (error) {
    console.error('Email test failed:', error);
  }
}

testEmail();