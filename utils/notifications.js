// Role-targeted notifications.
//
// Every notification write used to live inline in routes/admin.js, which meant staff were
// only ever notified BY an admin, never ABOUT a student: a new application, a submitted
// enrollment or a payment landed silently until somebody opened the list. This module is
// the single place that knows how to address a role.
//
// It never throws. A notification is a side effect of a submission that has already
// succeeded, so failing to record one must never roll back or block that submission.

const notifyRole = async (db, role, notification) => {
  const { title, message, type, detail = null } = notification;
  try {
    const [recipients] = await db.query('SELECT id FROM users WHERE role = ?', [role]);
    if (!recipients.length) return 0;

    for (const r of recipients) {
      await db.query(
        'INSERT INTO notifications (user_id, title, message, type, detail) VALUES (?, ?, ?, ?, ?)',
        [r.id, title, message, type, detail]
      );
    }
    return recipients.length;
  } catch (err) {
    console.error('Notification to ' + role + ' failed:', err.message);
    return 0;
  }
};

const notifyAdmins = (db, notification) => notifyRole(db, 'admin', notification);

module.exports = { notifyRole, notifyAdmins };