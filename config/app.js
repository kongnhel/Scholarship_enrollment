require('dotenv').config();

module.exports = {
  baseUrl: process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`,
  port: process.env.PORT || 3000,
};