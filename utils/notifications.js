// Role-targeted notifications.
//
// Every notification write used to live inline in routes/admin.js, which meant staff were
// only ever notified BY an admin, never ABOUT a student: a new application, a submitted
// enrollment or a payment landed silently until somebody opened the list. This module is
// the single place that knows how to address a role.
//
// It never throws. A notification is a side effect of a submission that has already
// succeeded, so failing to record one must never roll back or block that submission.

// A notification link is rendered into an href, so it is restricted to a site-relative
// path. Anything else -- an absolute URL, a protocol-relative "//evil.test", or a
// javascript: payload -- would turn the notification list into an open-redirect and XSS
// vector, so those are dropped rather than stored.
function safeLink(link) {
  if (!link || typeof link !== 'string') return null;
  const s = link.trim();
  if (!s.startsWith('/')) return null;
  // "//host" is protocol-relative and leaves the site.
  if (s.startsWith('//')) return null;
  // A backslash is normalised to "/" by some browsers, so "/\evil.test" is a second
  // protocol-relative spelling.
  if (s.slice(1).startsWith('/') || s.slice(1).startsWith('\\')) return null;
  if (s.length > 500) return null;
  return s;
}

const notifyRole = async (db, role, notification) => {
  const { title, message, type, detail = null } = notification;
  const link = safeLink(notification.link);
  try {
    const [recipients] = await db.query('SELECT id FROM users WHERE role = ?', [role]);
    if (!recipients.length) return 0;

    for (const r of recipients) {
      await db.query(
        'INSERT INTO notifications (user_id, title, message, type, detail, link) VALUES (?, ?, ?, ?, ?, ?)',
        [r.id, title, message, type, detail, link]
      );
    }
    return recipients.length;
  } catch (err) {
    console.error('Notification to ' + role + ' failed:', err.message);
    return 0;
  }
};

const notifyAdmins = (db, notification) => notifyRole(db, 'admin', notification);

module.exports = { notifyRole, notifyAdmins, safeLink };