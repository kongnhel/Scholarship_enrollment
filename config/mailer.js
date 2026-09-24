const nodemailer = require('nodemailer');

const sendEmail = async (to, subject, html) => {
  // Try Resend API first (works on Render — no SMTP needed)
  if (process.env.RESEND_API_KEY) {
    console.log('Email: Using Resend API');
    try {
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      const { data, error } = await resend.emails.send({
        from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
        to,
        subject,
        html
      });
      if (error) {
        console.error('Resend email error:', error.message);
        // Fall through to SMTP
      } else {
        return true;
      }
    } catch (error) {
      console.error('Resend email error:', error.message);
      // Fall through to SMTP
    }
  }

  // Fallback to SMTP (works locally)
  try {
    const transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || undefined,
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT) || 465,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000
    });
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to,
      subject,
      html
    });
    return true;
  } catch (error) {
    console.error('SMTP email error:', error.message);
    return false;
  }
};

module.exports = { sendEmail };
