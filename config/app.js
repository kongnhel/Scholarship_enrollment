// Where the links inside outgoing emails should point.
//
// Default is APP_URL, and that default must hold on every deployed environment including
// ones that do not set NODE_ENV. An earlier version of this file branched on
// NODE_ENV === 'production' instead, which was wrong: this deployment never sets NODE_ENV,
// so production was treated as development and started deriving links from the request Host.
// Behind IIS/ARR that Host is the rewritten internal address, so verification emails went out
// pointing at http://127.0.0.1:5000 -- a link that works for nobody who receives it.
//
// Deriving from the Host header is therefore opt-in rather than the fallback, so the unsafe
// behaviour cannot come back by accident. To mail links that point at the machine you are
// testing on, set in your local .env only:
//
//   LINK_BASE_FROM_REQUEST=true
//
// Leave it unset in production and you get APP_URL, exactly as before this file existed.
const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
const port = process.env.PORT || 3000;

// Belt and braces: even with the flag set, a NODE_ENV of production keeps APP_URL. That way a
// copied .env cannot silently redirect live verification mail at a developer's laptop.
const useRequestHost = process.env.LINK_BASE_FROM_REQUEST === 'true'
  && process.env.NODE_ENV !== 'production';

module.exports = {
  // The configured canonical URL. Anything that must use it regardless of environment.
  baseUrl,
  port,

  /**
   * Base URL for links in mail sent to THIS request.
   * Falls back to `baseUrl` in every case except the explicit opt-in above.
   *
   * @param {import('express').Request} [req]
   */
  linkBase(req) {
    if (!useRequestHost) return baseUrl;

    // req.get('host') rather than req.hostname: it keeps the port, which matters because the
    // dev server is not listening on 80.
    const authority = req && req.get ? req.get('host') : null;
    if (!authority) return baseUrl;

    // Behind a TLS-terminating proxy req.protocol can read as http. Only used in the explicit
    // opt-in case, where there is no proxy in front of a developer machine.
    const proto = req && req.protocol ? req.protocol : 'http';
    return `${proto}://${authority}`;
  }
};