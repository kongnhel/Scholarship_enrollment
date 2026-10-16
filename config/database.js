const mysql = require('mysql2/promise');
const fs = require('fs');
require('dotenv').config();

// TLS for the database.
//
// `rejectUnauthorized: false` encrypts the connection but does not verify who is on the
// other end, so any host on the network path can present any certificate and read the
// traffic. That matters more than usual here: the session store lives in THIS SAME DATABASE,
// and a `sessions` row contains the session id, the CSRF token and the user's role. Anyone
// who can decrypt this link can read a live session and replay its id as a cookie --
// administrator access, with no password.
//
// So when DB_SSL=true we now verify the server certificate if a CA has been supplied, and
// refuse to start in production without one rather than silently trusting everyone. Local
// development against a DB with no TLS keeps the old permissive behaviour, which is fine
// because nothing traverses a network to reach localhost.
//
// The CA bundle comes from the provider: Aiven -> Connect -> SSL -> ca.crt.
//   DB_SSL=true
//   DB_SSL_CA=/absolute/path/to/ca.crt
let ssl;

if (process.env.DB_SSL === 'true') {
  const isProduction = process.env.NODE_ENV === 'production';
  const caPath = process.env.DB_SSL_CA;

  if (caPath) {
    ssl = {
      ca: fs.readFileSync(caPath),
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2'
    };
    // Some providers also issue a client certificate. Supply both or neither.
    if (process.env.DB_SSL_CERT && process.env.DB_SSL_KEY) {
      ssl.cert = fs.readFileSync(process.env.DB_SSL_CERT);
      ssl.key = fs.readFileSync(process.env.DB_SSL_KEY);
    }
  } else if (isProduction) {
    throw new Error(
      'DB_SSL=true but DB_SSL_CA is not set. Refusing to start: without a CA the database ' +
      'connection would accept any certificate, which exposes the sessions table. ' +
      'Download the provider CA (Aiven: Connect -> SSL -> ca.crt) and set DB_SSL_CA.'
    );
  } else {
    // Development only. Loud, because this is the setting that quietly carried the risk.
    console.warn(
      'WARNING: DB_SSL=true with no DB_SSL_CA, so the server certificate is not verified. ' +
      'This is acceptable only for a database reached over localhost.'
    );
    ssl = { rejectUnauthorized: false };
  }
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'scholarship_system',
  charset: 'utf8mb4',
  ssl,
  waitForConnections: true,
  connectionLimit: 10,
  // 0 means "wait forever". Every route shares this one pool of 10, including the session
  // store on every single request, so a burst queues rather than failing fast and latency
  // grows without limit. A bounded queue turns saturation into a visible 503 instead.
  queueLimit: 100
});

module.exports = pool;