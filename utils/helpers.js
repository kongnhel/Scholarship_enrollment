const { v4: uuidv4 } = require('uuid');

const formatDate = (date) => {
  if (!date) return '';
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
};

const formatDateShort = (date) => {
  if (!date) return '';
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

const getStatusColor = (status) => {
  const colors = {
    pending: 'badge-warning',
    approved: 'badge-success',
    rejected: 'badge-danger',
    under_review: 'badge-info',
    submitted: 'badge-primary'
  };
  return colors[status] || 'badge-secondary';
};

const getStatusText = (status, lang = 'en') => {
  const statuses = {
    pending: { en: 'Pending', km: 'កំពុងរង់ចាំ' },
    approved: { en: 'Approved', km: 'បានយល់ព្រម' },
    rejected: { en: 'Rejected', km: 'បានបដិសេធ' },
    under_review: { en: 'Under Review', km: 'កំពុងពិនិត្យ' },
    submitted: { en: 'Submitted', km: 'បានដាក់ស្នើ' }
  };
  return statuses[status]?.[lang] || statuses[status]?.['en'] || status;
};

const truncate = (str, len = 50) => {
  if (!str) return '';
  if (str.length <= len) return str;
  return str.substring(0, len) + '...';
};

const escapeHtml = (str) => {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const generateToken = () => {
  return uuidv4();
};

// Persist the session to the store BEFORE redirecting to a page that depends on the
// data just written. express-session normally saves on response end, which is
// asynchronous with a database-backed store: without this the follow-up request can
// read the previous version of the session and silently lose what we just stored
// (e.g. the student is redirected to the selection page again, or appears logged out
// straight after logging in). Harmless and instant with the old in-memory store.
const saveSession = (req) => new Promise((resolve, reject) => {
  req.session.save((err) => (err ? reject(err) : resolve()));
});

// Revoke every stored session belonging to a user. The session store keeps its own copy
// of the user object, so changing a password or deleting the account does not end access
// on its own: isAuthenticated only inspects req.session.user. The store has no user
// column, so the ids are recovered by parsing each row's session JSON.
// Returns the number of sessions revoked.
async function revokeSessionsForUser(db, userId) {
  try {
    const [found] = await db.query('SELECT session_id, data FROM sessions');
    const ids = found.filter(s => {
      try {
        const parsed = JSON.parse(s.data);
        return parsed && parsed.user && Number(parsed.user.id) === Number(userId);
      } catch (e) {
        return false;
      }
    }).map(s => s.session_id);
    if (ids.length) {
      await db.query('DELETE FROM sessions WHERE session_id IN (?)', [ids]);
    }
    return ids.length;
    } catch (e) {
      console.error('session revoke failed:', e.message);
      return 0;
    }
  }

  /**
   * Resolve a "go back" destination that can only ever stay on this site.
   *
   * The Referer header is supplied by the client, so echoing it back is an open
   * redirect: an attacker sends a victim to
   *   /student/enroll  (with Referer: https://evil.example)
   * and the post-submit redirect carries them off to the attacker's site for a
   * convincing phishing page.
   *
   * Both `res.redirect('back')` and the previously-used
   * `res.redirect(req.get('referer') || '/')` have this flaw -- 'back' is *defined* as
   * the Referer, so swapping one for the other changes nothing. The Referer is only
   * honoured when it resolves to this host, and only its path+query is returned, so the
   * result is always a relative, same-site URL.
   */
  /**
   * The dashboard belonging to whoever is currently signed in.
   *
   * Error handlers and role guards used to `res.redirect('/')`, which drops a signed-in
   * user on the public marketing page while their session is still alive -- they look
   * logged out even though they are not. Anything that has to send a user somewhere safe
   * should send them to their OWN dashboard instead.
   */
  function dashboardPathFor(req) {
    const role = req && req.session && req.session.user && req.session.user.role;
    if (role === 'admin') return '/admin/dashboard';
    if (role === 'committee') return '/committee/dashboard';
    if (role === 'student') return '/student/dashboard';
    return '/';
  }

  function safeBackPath(req, fallback) {
    const fb = fallback || dashboardPathFor(req);
    if (!req || typeof req.get !== 'function') return fb;
    const ref = req.get('referer');
    if (!ref) return fb;
    let target;
    try {
      // Fixed dummy base so a relative Referer still parses. The security guarantee
      // below does NOT rest on the Host header, which is itself client-supplied: only
      // the path is ever returned, so the browser resolves it against the origin it is
      // already on and cannot be sent to another site.
      target = new URL(ref, 'https://placeholder.invalid');
    } catch (e) {
      return fb;
    }
    const path = `${target.pathname || '/'}${target.search || ''}`;
    // A plain absolute path only. This rejects the protocol-relative "//evil.example"
    // and backslash "/\evil.example" forms, which browsers treat as another origin.
    if (!/^\/[^/\\]/.test(path)) return fb;
    // Correctness, not security: an off-site Referer should land the user on the
    // fallback rather than a same-origin 404. A relative Referer is already safe.
    if (ref.charAt(0) !== '/') {
      const host = req.get('host');
      if (!host || target.host !== host) return fb;
    }
    return path;
  }

// Flash a message and redirect, but only after the session write has landed.
//
// `req.flash()` mutates the session and `res.redirect()` ends the request, so
// express-session persists the session as the response goes out. Against the MySQL
// store that write is asynchronous, so the browser can receive the redirect and issue
// the next GET before the row is stored - and that GET loads a session with no flash in
// it. The alert then silently disappears, which is exactly the "it only shows up when I
// refresh" behaviour. It is intermittent, so it looks random rather than like a race.
const flashAndRedirect = async (req, res, type, message, location) => {
  req.flash(type, message);
  try {
    await saveSession(req);
  } catch (err) {
    // Never lose the redirect: a failed save must not turn into a hung request.
    console.error('Session save before redirect failed:', err.message);
  }
  res.redirect(location);
};

module.exports = {
  formatDate,
  formatDateShort,
  getStatusColor,
  getStatusText,
  truncate,
  escapeHtml,
  generateToken,
  saveSession,
    flashAndRedirect,
revokeSessionsForUser,
      dashboardPathFor,
      safeBackPath
    };
