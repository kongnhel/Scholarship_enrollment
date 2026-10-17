// Where the links inside outgoing emails should point.
//
// This has to be the server that actually holds the token, not simply whatever APP_URL
// happens to say. Those are the same thing in production and very much NOT the same thing
// during testing: registering on localhost writes the token to the development database,
// but an APP_URL of https://register.nmu.edu.kh mails a link to production, which looks in
// its own database, does not find the token, and answers "Invalid or expired verification
// token" -- for a link that was minted a minute earlier.
//
// The confusing part is that the token is not actually expired. It is sitting in the
// development database, valid, with most of its hour left. The message is just the only
// thing a nonexistent token can produce.
//
// So: production trusts APP_URL, and anything else trusts the host the request actually
// arrived on. The request host is client-supplied, which would normally be a
// header-injection concern, but here it only ever goes into a link mailed back to the same
// requester, and only when NODE_ENV is not production. Production never reads it.
const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
  // Kept for anything that needs the configured canonical URL regardless of environment.
  baseUrl: process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`,
  port: process.env.PORT || 3000,

  /**
   * Base URL for links in mail sent to THIS request.
   * @param {import('express').Request} req
   */
  linkBase(req) {
    if (isProduction) return module.exports.baseUrl;
    // req.get('host') rather than req.hostname: it keeps the port, which matters because
    // the dev server is not listening on 80.
    const authority = req && req.get ? req.get('host') : null;
    if (!authority) return `http://localhost:${module.exports.port}`;
    const proto = req && req.protocol ? req.protocol : 'http';
    return `${proto}://${authority}`;
  }
};