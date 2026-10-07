const express = require('express');
const router = express.Router();
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const { verifyCsrf } = require('../middleware/csrf');
const { upload } = require('../middleware/upload');
const { uploadToImageKit, extractFileId, deleteFromImageKit } = require('../utils/imagekit');
const { body, validationResult } = require('express-validator');
const XLSX = require('xlsx');


// Accepts the datetime-local format the settings form submits
// ("2026-09-04T00:00") as well as a MySQL DATETIME, and returns null when the pair is
// usable. An empty value is allowed (the window is then governed only by the open flag).
function validateWindow(start, end) {
    const parse = (v) => {
        const s = String(v === undefined || v === null ? '' : v).trim();
        if (!s) return null;
        const d = new Date(s.replace(' ', 'T'));
        return isNaN(d.getTime()) ? NaN : d.getTime();
    };
    const s = parse(start);
    const e = parse(end);
    if (isNaN(s)) return { km: 'កាលបរិច្ឆេទចាប់ផ្ដើមមិនត្រឹមត្រូវ', en: 'start date is not a valid date' };
    if (isNaN(e)) return { km: 'កាលបរិច្ឆេទបញ្ចប់មិនត្រឹមត្រូវ', en: 'end date is not a valid date' };
    if (s !== null && e !== null && s > e) {
        return { km: 'កាលបរិច្ឆេទចាប់ផ្ដើមត្រូវតែនៅមុនកាលបរិច្ឆេទបញ្ចប់', en: 'start date must be earlier than the end date' };
    }
    return null;
}

// Reference data is heavily referenced and mostly protected by foreign keys, so a raw
// DELETE fails with an opaque "Database error" (or, for columns without an FK such as
// applications.scholarship_type_id, silently leaves applications pointing at a record
// that no longer exists). Count the referencing rows first and name them in the message.
async function usageCounts(db, checks) {
    const out = [];
    for (const [label, sql, params] of checks) {
        const [rows] = await db.query(sql, params);
        const n = Number(rows[0] ? rows[0].c : 0);
        if (n > 0) out.push(label + ' (' + n + ')');
    }
    return out;
}

// Free-text fields an admin types. Length limits keep a stray paste from filling a
// `text` column, and give the user a real error instead of a silent truncation.
const remarkRule = (field, label) => body(field)
    .optional({ checkFalsy: true })
    .isLength({ max: 2000 }).withMessage(label + ' is too long (max 2000 characters)')
    .trim();

const nameRules = (prefix) => [
    body(prefix + '_kh').trim().isLength({ min: 1, max: 191 }).withMessage('Khmer name is required and must be under 191 characters'),
    body(prefix + '_en').trim().isLength({ min: 1, max: 191 }).withMessage('English name is required and must be under 191 characters')
];

// Collects express-validator failures into a single flash instead of letting a bad
// request fall through into a SQL write.
function flashValidationErrors(req, res, backUrl) {
    const errors = validationResult(req);
    if (errors.isEmpty()) return false;
    const list = errors.array().map(e => e.msg).join('. ');
    req.flash('error', req.session.lang === 'km'
        ? 'ទិន្នន័យមិនត្រឹមត្រូវ៖ ' + list
        : 'Invalid input: ' + list);
    res.redirect(backUrl);
    return true;
}

function t(req, km, en) {
  return req.session.lang === 'km' ? km : en;
}
const { sendEmail } = require('../config/mailer');
const { escapeHtml, revokeSessionsForUser, flashAndRedirect } = require('../utils/helpers');

router.use(isAuthenticated, isAdmin);

// ---------------------------------------------------------------------------
// Allowed status transitions.
//
// Without this, any status could move to any other status: re-approving an already
// approved application re-sent the approval email and wrote a bogus
// approved -> approved history row. `correction_requested -> pending` is the student
// resubmitting (routes/student.js), so it must stay allowed.
//
// applications.status enum:
//   pending, under_review, approved, rejected, correction_requested
const APPLICATION_TRANSITIONS = {
    pending: ['under_review', 'approved', 'rejected', 'correction_requested'],
    under_review: ['under_review', 'approved', 'rejected', 'correction_requested'],
    correction_requested: ['pending', 'under_review', 'approved', 'rejected', 'correction_requested'],
    approved: [],
    rejected: []
};

// enrollments.status enum: pending, approved, rejected
const ENROLLMENT_TRANSITIONS = {
    pending: ['approved', 'rejected'],
    approved: [],
    rejected: []
};

// payments.status: pending -> verified | rejected, both terminal. The previous code did
// a bare UPDATE with no existence check, so a bad id reported success, an already
// rejected payment could still be "verified", and repeating it overwrote verified_at.
const PAYMENT_TRANSITIONS = {
    pending: ['verified', 'rejected'],
    verified: [],
    rejected: []
};

function canTransition(map, from, to) {
    if (!from) return false;
    const allowed = map[from];
    if (!allowed) return false;
    return allowed.indexOf(to) !== -1;
}

// Runs `fn` inside a transaction so a group of writes either all land or none do.
// Approving an application touches three tables (status, history, notification); a
// failure half way through previously left the status changed with no notification.
async function withTransaction(db, fn) {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const result = await fn(conn);
        await conn.commit();
        return result;
    } catch (err) {
        try { await conn.rollback(); } catch (e) { /* connection already gone */ }
        throw err;
    } finally {
        conn.release();
    }
}

router.get('/dashboard', async (req, res) => {
    try {
        const [total] = await req.db.query('SELECT COUNT(*) as count FROM applications');
        const [pending] = await req.db.query("SELECT COUNT(*) as count FROM applications WHERE status = 'pending'");
        const [approved] = await req.db.query("SELECT COUNT(*) as count FROM applications WHERE status = 'approved'");
        const [rejected] = await req.db.query("SELECT COUNT(*) as count FROM applications WHERE status = 'rejected'");
        const [underReview] = await req.db.query("SELECT COUNT(*) as count FROM applications WHERE status = 'under_review'");
        const [correction] = await req.db.query("SELECT COUNT(*) as count FROM applications WHERE status = 'correction_requested'");
        const [recent] = await req.db.query(
            `SELECT a.*, m.name_kh as major_name_kh, m.name_en as major_name_en,
             c.name_kh as category_name_kh, c.name_en as category_name_en,
             u.english_name as student_name
             FROM applications a
             LEFT JOIN majors m ON a.major_first_choice_id = m.id
             LEFT JOIN scholarship_categories c ON a.scholarship_category_id = c.id
             LEFT JOIN users u ON a.user_id = u.id
             ORDER BY a.submitted_at DESC LIMIT 10`
        );
        res.render('admin/dashboard', {
            title: 'Admin Dashboard',
            total: total[0].count,
            pending: pending[0].count,
            approved: approved[0].count,
            rejected: rejected[0].count,
            underReview: underReview[0].count,
            correction: correction[0].count,
            recent
        });
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/dashboard');
    }
});

router.get('/applications', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;
        const { search, status, major, category, province, gender, dateFrom, dateTo } = req.query;
        let query = `SELECT a.*, m.name_kh as major_name_kh, m.name_en as major_name_en,
            m2.name_kh as major2_name_kh, m2.name_en as major2_name_en,
            c.name_kh as category_name_kh, c.name_en as category_name_en,
            p.name_kh as province_name_kh, p.name_en as province_name_en,
            st.name_kh as scholarship_name_kh, st.name_en as scholarship_name_en,
            st.leader_name as scholarship_leader,
            u.english_name as student_name
            FROM applications a
            LEFT JOIN majors m ON a.major_first_choice_id = m.id
            LEFT JOIN majors m2 ON a.major_second_choice_id = m2.id
            LEFT JOIN scholarship_categories c ON a.scholarship_category_id = c.id
            LEFT JOIN scholarship_types st ON a.scholarship_type_id = st.id
            LEFT JOIN provinces p ON a.school_province_id = p.id
            LEFT JOIN users u ON a.user_id = u.id WHERE 1=1`;
        let countQuery = 'SELECT COUNT(*) as count FROM applications a WHERE 1=1';
        const params = [];
        const countParams = [];
        if (search) {
            query += ' AND (a.english_first_name LIKE ? OR a.english_last_name LIKE ? OR a.khmer_first_name LIKE ? OR a.khmer_last_name LIKE ?)';
            countQuery += ' AND (a.english_first_name LIKE ? OR a.english_last_name LIKE ? OR a.khmer_first_name LIKE ? OR a.khmer_last_name LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
            countParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
        }
        if (status) {
            query += ' AND a.status = ?';
            countQuery += ' AND a.status = ?';
            params.push(status);
            countParams.push(status);
        }
        if (major) {
            query += ' AND a.major_first_choice_id = ?';
            countQuery += ' AND a.major_first_choice_id = ?';
            params.push(major);
            countParams.push(major);
        }
        if (category) {
            query += ' AND a.scholarship_category_id = ?';
            countQuery += ' AND a.scholarship_category_id = ?';
            params.push(category);
            countParams.push(category);
        }
        if (province) {
            query += ' AND a.school_province_id = ?';
            countQuery += ' AND a.school_province_id = ?';
            params.push(province);
            countParams.push(province);
        }
        if (gender) {
            query += ' AND a.gender = ?';
            countQuery += ' AND a.gender = ?';
            params.push(gender);
            countParams.push(gender);
        }
        if (dateFrom) {
            query += ' AND a.submitted_at >= ?';
            countQuery += ' AND a.submitted_at >= ?';
            params.push(dateFrom);
            countParams.push(dateFrom);
        }
        if (dateTo) {
            query += ' AND a.submitted_at <= ?';
            countQuery += ' AND a.submitted_at <= ?';
            params.push(dateTo);
            countParams.push(dateTo);
        }
        query += ' ORDER BY a.submitted_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        const [applications] = await req.db.query(query, params);
        const [countResult] = await req.db.query(countQuery, countParams);
        const totalRecords = countResult[0].count;
        const totalPages = Math.ceil(totalRecords / limit);
        const [majors] = await req.db.query('SELECT * FROM majors WHERE is_active = 1');
        const [categories] = await req.db.query('SELECT * FROM scholarship_categories WHERE is_active = 1');
        const [provinces] = await req.db.query('SELECT * FROM provinces');
        res.render('admin/applications', {
            title: 'Applications',
            applications,
            majors,
            categories,
            provinces,
            currentPage: page,
            limit,
            totalPages,
            totalRecords,
            filters: req.query
        });
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/dashboard');
    }
});

router.get('/applications/:id', async (req, res) => {
    try {
        const [application] = await req.db.query(
            `SELECT a.*, m.name_kh as major_name_kh, m.name_en as major_name_en,
             m2.name_kh as major2_name_kh, m2.name_en as major2_name_en,
             c.name_kh as category_name_kh, c.name_en as category_name_en,
             p.name_kh as province_name_kh, p.name_en as province_name_en,
             st.name_kh as scholarship_name_kh, st.name_en as scholarship_name_en,
             st.coverage_percentage as scholarship_percentage, st.duration_years as scholarship_duration,
             st.provider_name as scholarship_provider,
             u.english_name as student_name, u.khmer_name as student_khmer_name, u.email as user_email
             FROM applications a
             LEFT JOIN majors m ON a.major_first_choice_id = m.id
             LEFT JOIN majors m2 ON a.major_second_choice_id = m2.id
             LEFT JOIN scholarship_categories c ON a.scholarship_category_id = c.id
             LEFT JOIN scholarship_types st ON a.scholarship_type_id = st.id
             LEFT JOIN provinces p ON a.school_province_id = p.id
             LEFT JOIN users u ON a.user_id = u.id
             WHERE a.id = ?`, [req.params.id]
        );
        if (!application.length) {
            req.flash('error', t(req, 'រកមិនឃើញពាក្យសុំ', 'Application not found'));
            return res.redirect('/admin/applications');
        }
        const [history] = await req.db.query(
            `SELECT sh.*, u.english_name as changed_by_name
             FROM application_status_history sh
             LEFT JOIN users u ON sh.changed_by = u.id
             WHERE sh.application_id = ? ORDER BY sh.created_at DESC`, [req.params.id]
        );
        res.render('admin/application-detail', {
            title: 'Application Detail',
            application: application[0],
            history
        });
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/applications');
    }
});

router.get('/applications/:id/print', async (req, res) => {
    try {
        const [application] = await req.db.query(
            `SELECT a.*, m.name_kh as major_name_kh, m.name_en as major_name_en,
             m2.name_kh as major2_name_kh, m2.name_en as major2_name_en,
             c.name_kh as category_name_kh, c.name_en as category_name_en,
             p.name_kh as province_name_kh, p.name_en as province_name_en,
             st.name_kh as scholarship_name_kh, st.name_en as scholarship_name_en,
             st.coverage_percentage as scholarship_percentage, st.duration_years as scholarship_duration,
             st.provider_name as scholarship_provider,
             st.leader_name as scholarship_leader,
             u.english_name as student_name, u.khmer_name as student_khmer_name, u.email as user_email
             FROM applications a
             LEFT JOIN majors m ON a.major_first_choice_id = m.id
             LEFT JOIN majors m2 ON a.major_second_choice_id = m2.id
             LEFT JOIN scholarship_categories c ON a.scholarship_category_id = c.id
             LEFT JOIN scholarship_types st ON a.scholarship_type_id = st.id
             LEFT JOIN provinces p ON a.school_province_id = p.id
             LEFT JOIN users u ON a.user_id = u.id
             WHERE a.id = ?`, [req.params.id]
        );
        if (!application.length) {
            req.flash('error', t(req, 'រកមិនឃើញពាក្យសុំ', 'Application not found'));
            return res.redirect('/admin/applications');
        }
        res.render('admin/application-print', {
            title: 'Print Application',
            layout: false,
            application: application[0]
        });
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/applications');
    }
});

router.post('/applications/:id/under-review', async (req, res) => {
    const backTo = '/admin/applications/' + req.params.id;
    try {
        const [current] = await req.db.query('SELECT a.status, a.user_id, u.email, u.khmer_name FROM applications a JOIN users u ON a.user_id = u.id WHERE a.id = ?', [req.params.id]);
        if (!current.length) {
            req.flash('error', t(req, 'រកមិនឃើញពាក្យសុំនេះ', 'Application not found'));
            return res.redirect('/admin/applications');
        }
        const row = current[0];
        if (!canTransition(APPLICATION_TRANSITIONS, row.status, 'under_review')) {
            req.flash('error', t(req, 'មិនអាចប្ដូរស្ថានភាពពី ' + row.status + ' ទៅ under review បានទេ', 'Cannot move an application from ' + row.status + ' to under review'));
            return res.redirect(backTo);
        }

        const recipient = row.user_id ? { id: row.user_id, email: row.email, name: row.khmer_name } : null;

        await withTransaction(req.db, async (conn) => {
            await conn.query("UPDATE applications SET status = 'under_review' WHERE id = ?", [req.params.id]);
            await conn.query(
                'INSERT INTO application_status_history (application_id, old_status, new_status, changed_by, notes) VALUES (?, ?, ?, ?, ?)',
                [req.params.id, row.status, 'under_review', req.session.user.id, 'Application under review']
            );
            if (recipient) {
                await conn.query(
                    'INSERT INTO notifications (user_id, title, message, type, link) VALUES (?, ?, ?, ?, ?)',
                    [recipient.id, 'Application Under Review', 'Your application is now under review.', 'status', '/student/application/' + req.params.id]
                );
            }
        });

        // Email is intentionally outside the transaction: SMTP latency must not hold a
        // database transaction open, and a mail failure must not roll back the decision.
        if (recipient) {
            await sendEmail(
                recipient.email,
                'Application Under Review - Scholarship Program',
                '<p>Dear <strong>' + escapeHtml(recipient.name || 'Student') + '</strong>,</p><p>Your scholarship application is now under review. We will notify you once a decision has been made.</p><br><p>Best regards,<br>Scholarship Committee</p>'
            );
        }
        req.flash('success', t(req, 'ពាក្យសុំត្រូវបានសម្គាល់ថាកំពុងពិនិត្យមើល', 'Application marked as under review'));
        res.redirect(backTo);
    } catch (err) {
        console.error('under-review error:', err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect(backTo);
    }
});

router.post('/applications/:id/approve',
    remarkRule('admin_remark', 'Approval remark'), body('exam_venue').optional({checkFalsy:true}).isLength({max:255}).withMessage('Exam venue is too long'),
    async (req, res) => {
    const backTo = '/admin/applications/' + req.params.id;
    try {
        if (flashValidationErrors(req, res, backTo)) return;
        const { admin_remark, exam_date, exam_time, exam_venue } = req.body;
        const [current] = await req.db.query('SELECT a.status, a.user_id, u.email, u.khmer_name FROM applications a JOIN users u ON a.user_id = u.id WHERE a.id = ?', [req.params.id]);
        if (!current.length) {
            req.flash('error', t(req, 'រកមិនឃើញពាក្យសុំនេះ', 'Application not found'));
            return res.redirect('/admin/applications');
        }
        const row = current[0];
        if (!canTransition(APPLICATION_TRANSITIONS, row.status, 'approved')) {
            req.flash('error', t(req, 'មិនអាចអនុម័តពាក្យសុំដែលស្ថានភាពជា ' + row.status + ' បានទេ', 'Cannot approve an application with status ' + row.status));
            return res.redirect(backTo);
        }

        const recipient = row.user_id ? { id: row.user_id, email: row.email, name: row.khmer_name } : null;

        await withTransaction(req.db, async (conn) => {
            await conn.query("UPDATE applications SET status = 'approved', admin_remark = ?, exam_date = ?, exam_time = ?, exam_venue = ? WHERE id = ?", [admin_remark || null, exam_date || null, exam_time || null, exam_venue || null, req.params.id]);
            await conn.query(
                'INSERT INTO application_status_history (application_id, old_status, new_status, changed_by, notes) VALUES (?, ?, ?, ?, ?)',
                [req.params.id, row.status, 'approved', req.session.user.id, admin_remark || null]
            );
            if (recipient) {
                // The base message stays the plain English sentence; the committee's
                // remark and any exam details go in `detail` so the student's page can
                // show a Khmer (or English) template and still surface what was written.
                const detailParts = [];
                if (admin_remark) detailParts.push('Note from the committee: ' + admin_remark);
                if (exam_date || exam_time || exam_venue) {
                    const examLines = ['Exam details:'];
                    if (exam_date) examLines.push('Date: ' + exam_date);
                    if (exam_time) examLines.push('Time: ' + exam_time);
                    if (exam_venue) examLines.push('Venue: ' + exam_venue);
                    detailParts.push(examLines.join('\n'));
                }
                await conn.query(
                    'INSERT INTO notifications (user_id, title, message, type, detail, link) VALUES (?, ?, ?, ?, ?, ?)',
                    [recipient.id, 'Application Approved', 'Congratulations! Your application has been approved.', 'approval', detailParts.length ? detailParts.join('\n\n') : null, '/student/application/' + req.params.id]
                );
            }
        });

        if (recipient) {
            let examHtml = '';
            if (exam_date || exam_time || exam_venue) {
                examHtml = '<h3>Exam Details</h3><table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;margin-top:10px">';
                if (exam_date) examHtml += '<tr><td><strong>Date</strong></td><td>' + escapeHtml(exam_date) + '</td></tr>';
                if (exam_time) examHtml += '<tr><td><strong>Time</strong></td><td>' + escapeHtml(exam_time) + '</td></tr>';
                if (exam_venue) examHtml += '<tr><td><strong>Venue</strong></td><td>' + escapeHtml(exam_venue) + '</td></tr>';
                examHtml += '</table>';
            }
            await sendEmail(
                recipient.email,
                'Application Approved - Scholarship Program',
                '<p>Dear <strong>' + escapeHtml(recipient.name || 'Student') + '</strong>,</p><p>Congratulations! Your scholarship application has been approved.</p>' +
                (admin_remark ? '<p><strong>Note:</strong> ' + escapeHtml(admin_remark) + '</p>' : '') + examHtml +
                '<br><p>Best regards,<br>Scholarship Committee</p>'
            );
        }
        req.flash('success', t(req, 'ពាក្យសុំត្រូវបានអនុម័តដោយជោគជ័យ', 'Application approved successfully'));
        res.redirect(backTo);
    } catch (err) {
        console.error('approve error:', err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect(backTo);
    }
});

router.post('/applications/:id/reject',
    remarkRule('admin_remark', 'Rejection reason'),
    async (req, res) => {
    const backTo = '/admin/applications/' + req.params.id;
    try {
        if (flashValidationErrors(req, res, backTo)) return;
        const { admin_remark } = req.body;
        const [current] = await req.db.query('SELECT a.status, a.user_id, u.email, u.khmer_name FROM applications a JOIN users u ON a.user_id = u.id WHERE a.id = ?', [req.params.id]);
        if (!current.length) {
            req.flash('error', t(req, 'រកមិនឃើញពាក្យសុំនេះ', 'Application not found'));
            return res.redirect('/admin/applications');
        }
        const row = current[0];
        if (!canTransition(APPLICATION_TRANSITIONS, row.status, 'rejected')) {
            req.flash('error', t(req, 'មិនអាចបដិសេធពាក្យសុំដែលស្ថានភាពជា ' + row.status + ' បានទេ', 'Cannot reject an application with status ' + row.status));
            return res.redirect(backTo);
        }

        const reason = admin_remark || 'No reason provided';
        const recipient = row.user_id ? { id: row.user_id, email: row.email, name: row.khmer_name } : null;

        await withTransaction(req.db, async (conn) => {
            await conn.query("UPDATE applications SET status = 'rejected', admin_remark = ? WHERE id = ?", [admin_remark || null, req.params.id]);
            await conn.query(
                'INSERT INTO application_status_history (application_id, old_status, new_status, changed_by, notes) VALUES (?, ?, ?, ?, ?)',
                [req.params.id, row.status, 'rejected', req.session.user.id, reason]
            );
            if (recipient) {
                await conn.query(
                    'INSERT INTO notifications (user_id, title, message, type, detail, link) VALUES (?, ?, ?, ?, ?, ?)',
                    [recipient.id, 'Application Rejected', 'Your application has been rejected.', 'rejection', 'Reason: ' + reason, '/student/application/' + req.params.id]
                );
            }
        });

        if (recipient) {
            await sendEmail(
                recipient.email,
                'Application Rejected - Scholarship Program',
                '<p>Dear <strong>' + escapeHtml(recipient.name || 'Student') + '</strong>,</p><p>We regret to inform you that your scholarship application has been rejected.</p><p><strong>Reason:</strong> ' + escapeHtml(reason) + '</p><br><p>Best regards,<br>Scholarship Committee</p>'
            );
        }
        req.flash('success', t(req, 'ពាក្យសុំត្រូវបានបដិសេធ', 'Application rejected'));
        res.redirect(backTo);
    } catch (err) {
        console.error('reject error:', err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect(backTo);
    }
});

router.post('/applications/:id/correction',
    remarkRule('correction_notes', 'Correction notes'),
    async (req, res) => {
    const backTo = '/admin/applications/' + req.params.id;
    try {
        if (flashValidationErrors(req, res, backTo)) return;
        const { correction_notes } = req.body;
        const [current] = await req.db.query('SELECT a.status, a.user_id, u.email, u.khmer_name FROM applications a JOIN users u ON a.user_id = u.id WHERE a.id = ?', [req.params.id]);
        if (!current.length) {
            req.flash('error', t(req, 'រកមិនឃើញពាក្យសុំនេះ', 'Application not found'));
            return res.redirect('/admin/applications');
        }
        const row = current[0];
        if (!canTransition(APPLICATION_TRANSITIONS, row.status, 'correction_requested')) {
            req.flash('error', t(req, 'មិនអាចស្នើកែតម្រូវលើពាក្យសុំដែលស្ថានភាពជា ' + row.status + ' បានទេ', 'Cannot request corrections on an application with status ' + row.status));
            return res.redirect(backTo);
        }

        const notes = correction_notes || 'No specific notes';
        const recipient = row.user_id ? { id: row.user_id, email: row.email, name: row.khmer_name } : null;

        await withTransaction(req.db, async (conn) => {
            await conn.query("UPDATE applications SET status = 'correction_requested', correction_notes = ? WHERE id = ?", [correction_notes || null, req.params.id]);
            await conn.query(
                'INSERT INTO application_status_history (application_id, old_status, new_status, changed_by, notes) VALUES (?, ?, ?, ?, ?)',
                [req.params.id, row.status, 'correction_requested', req.session.user.id, notes]
            );
            if (recipient) {
                await conn.query(
                    'INSERT INTO notifications (user_id, title, message, type, detail, link) VALUES (?, ?, ?, ?, ?, ?)',
                    [recipient.id, 'Correction Requested', 'Your application requires corrections. Please review the notes and resubmit.', 'correction', 'Notes: ' + notes, '/student/application/' + req.params.id]
                );
            }
        });

        if (recipient) {
            await sendEmail(
                recipient.email,
                'Correction Requested - Scholarship Application',
                '<p>Dear <strong>' + escapeHtml(recipient.name || 'Student') + '</strong>,</p><p>Your scholarship application requires corrections. Please log in and review the notes below, then resubmit your application.</p><p><strong>Correction Notes:</strong> ' + escapeHtml(notes) + '</p><br><p>Best regards,<br>Scholarship Committee</p>'
            );
        }
        req.flash('success', t(req, 'បានស្នើសុំកែតម្រូវ', 'Correction requested'));
        res.redirect(backTo);
    } catch (err) {
        console.error('correction error:', err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect(backTo);
    }
});

router.get('/majors', async (req, res) => {
try {
const page = parseInt(req.query.page) || 1;
const limit = 10;
const offset = (page - 1) * limit;
const { search } = req.query;

// Card is the default because the seven-column table squeezed Khmer names into a narrow
// column on a laptop. `table` stays available for admins who prefer to scan a row at a time.
const view = req.query.view === 'table' ? 'table' : 'card';

let query = 'SELECT m.*, (SELECT COUNT(1) FROM major_tuition mt WHERE mt.major_id = m.id AND mt.is_active = 1) as tuition_rows FROM majors m WHERE 1=1';
    let countQuery = 'SELECT COUNT(*) as count FROM majors WHERE 1=1';
        const params = [];
        const countParams = [];

        if (search) {
            query += ' AND (name_kh LIKE ? OR name_en LIKE ? OR faculty_kh LIKE ? OR faculty_en LIKE ?)';
            countQuery += ' AND (name_kh LIKE ? OR name_en LIKE ? OR faculty_kh LIKE ? OR faculty_en LIKE ?)';
            const s = `%${search}%`;
            params.push(s, s, s, s);
            countParams.push(s, s, s, s);
        }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const [majors] = await req.db.query(query, params);
        const [countResult] = await req.db.query(countQuery, countParams);
        const totalRecords = countResult[0].count;
        const totalPages = Math.ceil(totalRecords / limit);

        res.render('admin/majors', { title: 'Manage Majors', majors, currentPage: page, limit, totalPages, totalRecords, filters: req.query, view });
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/dashboard');
    }
});

router.post('/majors',
    nameRules('name'),
    async (req, res) => {
    try {
        if (flashValidationErrors(req, res, '/admin/majors')) return;
        const { name_kh, name_en, faculty_kh, faculty_en } = req.body;
        await req.db.query('INSERT INTO majors (name_kh, name_en, faculty_kh, faculty_en) VALUES (?, ?, ?, ?)', [name_kh, name_en, faculty_kh, faculty_en]);
        req.flash('success', t(req, 'បានបន្ថែមជំនាញដោយជោគជ័យ', 'Major added successfully'));
        res.redirect('/admin/majors');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/majors');
    }
});

router.post('/majors/:id/edit',
    nameRules('name'),
    async (req, res) => {
    try {
        if (flashValidationErrors(req, res, '/admin/majors')) return;
        const { name_kh, name_en, faculty_kh, faculty_en } = req.body;
        await req.db.query('UPDATE majors SET name_kh = ?, name_en = ?, faculty_kh = ?, faculty_en = ? WHERE id = ?', [name_kh, name_en, faculty_kh, faculty_en, req.params.id]);
        req.flash('success', t(req, 'បានកែសម្រួលជំនាញដោយជោគជ័យ', 'Major updated successfully'));
        res.redirect('/admin/majors');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/majors');
    }
});

router.post('/majors/:id/toggle', async (req, res) => {
    try {
        await req.db.query('UPDATE majors SET is_active = NOT is_active WHERE id = ?', [req.params.id]);
        req.flash('success', t(req, 'បានកែសម្រួលស្ថានភាពជំនាញ', 'Major status updated'));
        res.redirect('/admin/majors');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/majors');
    }
});

router.post('/majors/:id/delete', async (req, res) => {
    try {
        const [rows] = await req.db.query('SELECT id, name_en FROM majors WHERE id = ?', [req.params.id]);
        if (!rows.length) {
            req.flash('error', t(req, 'រកមិនឃើញជំនាញនេះ', 'Major not found'));
            return res.redirect('/admin/majors');
        }
        const inUse = await usageCounts(req.db, [
            ['applications', 'SELECT COUNT(*) c FROM applications WHERE major_first_choice_id = ? OR major_second_choice_id = ?', [req.params.id, req.params.id]],
            ['tuition records', 'SELECT COUNT(*) c FROM major_tuition WHERE major_id = ?', [req.params.id]]
        ]);
        if (inUse.length) {
            req.flash('error', t(req,
                'មិនអាចលុបជំនាញបានទេ ព្រោះវាត្រូវបានប្រើនៅ៖ ' + inUse.join(', '),
                'Cannot delete this major: it is used by ' + inUse.join(', ')));
            return res.redirect('/admin/majors');
        }
        await req.db.query('DELETE FROM majors WHERE id = ?', [req.params.id]);
        req.flash('success', t(req, 'បានលុបជំនាញដោយជោគជ័យ', 'Major deleted successfully'));
        res.redirect('/admin/majors');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការលុបជំនាញ', 'Error deleting major'));
        res.redirect('/admin/majors');
    }
});

router.get('/provinces', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;
        const { search } = req.query;

        let query = 'SELECT * FROM provinces WHERE 1=1';
        let countQuery = 'SELECT COUNT(*) as count FROM provinces WHERE 1=1';
        const params = [];
        const countParams = [];

        if (search) {
            query += ' AND (name_kh LIKE ? OR name_en LIKE ?)';
            countQuery += ' AND (name_kh LIKE ? OR name_en LIKE ?)';
            const s = `%${search}%`;
            params.push(s, s);
            countParams.push(s, s);
        }

        query += ' ORDER BY id ASC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const [provinces] = await req.db.query(query, params);
        const [countResult] = await req.db.query(countQuery, countParams);
        const totalRecords = countResult[0].count;
        const totalPages = Math.ceil(totalRecords / limit);

        res.render('admin/provinces', { title: 'Manage Provinces', provinces, currentPage: page, limit, totalPages, totalRecords, filters: req.query });
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/dashboard');
    }
});

router.post('/provinces',
    nameRules('name'),
    async (req, res) => {
    try {
        if (flashValidationErrors(req, res, '/admin/provinces')) return;
        const { name_kh, name_en } = req.body;
        await req.db.query('INSERT INTO provinces (name_kh, name_en) VALUES (?, ?)', [name_kh, name_en]);
        req.flash('success', t(req, 'ខេត្តត្រូវបានបន្ថែមដោយជោគជ័យ', 'Province added successfully'));
        res.redirect('/admin/provinces');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'ទិន្នន័យមិនត្រឹមត្រូវ', 'Database error'));
        res.redirect('/admin/provinces');
    }
});

router.post('/provinces/:id/edit',
    nameRules('name'),
    async (req, res) => {
    try {
        if (flashValidationErrors(req, res, '/admin/provinces')) return;
        const { name_kh, name_en } = req.body;
        await req.db.query('UPDATE provinces SET name_kh = ?, name_en = ? WHERE id = ?', [name_kh, name_en, req.params.id]);
        req.flash('success', t(req, 'ខេត្តត្រូវបានធ្វើបច្ចុប្បន្នភាពដោយជោគជ័យ', 'Province updated successfully'));
        res.redirect('/admin/provinces');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'ទិន្នន័យមិនត្រឹមត្រូវ', 'Database error'));
        res.redirect('/admin/provinces');
    }
});

router.post('/provinces/:id/delete', async (req, res) => {
    try {
        const [rows] = await req.db.query('SELECT id, name_en FROM provinces WHERE id = ?', [req.params.id]);
        if (!rows.length) {
            req.flash('error', t(req, 'រកមិនឃើញខេត្តនេះ', 'Province not found'));
            return res.redirect('/admin/provinces');
        }
        const inUse = await usageCounts(req.db, [
            ['applications', 'SELECT COUNT(*) c FROM applications WHERE school_province_id = ?', [req.params.id]]
        ]);
        if (inUse.length) {
            req.flash('error', t(req,
                'មិនអាចលុបខេត្តបានទេ ព្រោះវាត្រូវបានប្រើនៅ៖ ' + inUse.join(', '),
                'Cannot delete this province: it is used by ' + inUse.join(', ')));
            return res.redirect('/admin/provinces');
        }
        await req.db.query('DELETE FROM provinces WHERE id = ?', [req.params.id]);
        req.flash('success', t(req, 'ខេត្តត្រូវបានលុបដោយជោគជ័យ', 'Province deleted successfully'));
        res.redirect('/admin/provinces');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មិនអាចលុបខេត្តនោះបានទេ', 'Cannot delete province that is being used'));
        res.redirect('/admin/provinces');
    }
});

router.get('/users', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;
        const { search, role } = req.query;

        let query = 'SELECT id, email, role, khmer_name, english_name, username, phone, created_at FROM users WHERE 1=1';
        let countQuery = 'SELECT COUNT(*) as count FROM users WHERE 1=1';
        const params = [];
        const countParams = [];

        if (search) {
            query += ' AND (khmer_name LIKE ? OR english_name LIKE ? OR username LIKE ? OR email LIKE ? OR phone LIKE ?)';
            countQuery += ' AND (khmer_name LIKE ? OR english_name LIKE ? OR username LIKE ? OR email LIKE ? OR phone LIKE ?)';
            const searchParam = `%${search}%`;
            params.push(searchParam, searchParam, searchParam, searchParam, searchParam);
            countParams.push(searchParam, searchParam, searchParam, searchParam, searchParam);
        }

        if (role) {
            query += ' AND role = ?';
            countQuery += ' AND role = ?';
            params.push(role);
            countParams.push(role);
        }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const [users] = await req.db.query(query, params);
        const [countResult] = await req.db.query(countQuery, countParams);
        const totalRecords = countResult[0].count;
        const totalPages = Math.ceil(totalRecords / limit);

        // Drives the Create User form: the admin role is only offered while a single
        // admin exists, so the UI can explain the rule instead of letting the admin
        // fill in the form and then hit a server-side refusal.
        const [adminCountRows] = await req.db.query("SELECT COUNT(*) c FROM users WHERE role = 'admin'");
        const adminCount = Number(adminCountRows[0].c);

        res.render('admin/users', {
            title: 'Manage Users',
            users,
            currentPage: page,
            limit,
            totalPages,
            totalRecords,
            adminCount,
            filters: req.query
        });
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'ទិន្នន័យមិនត្រឹមត្រូវ', 'Database error'));
        res.redirect('/admin/dashboard');
    }
});

// Roles an admin may hand out. Whitelisted here and never taken from the request
// unchecked: `role` is interpolated into an INSERT, so passing req.body.role straight
// through would let a crafted request pick any value the ENUM accepts.
const ASSIGNABLE_ROLES = ['student', 'committee', 'admin'];

// Creating a second admin is a permanent backdoor, so it is only allowed while the
// system still has a single admin. That caps the system at two administrators by
// design rather than by policy, and a compromised admin cannot silently add more.
const MAX_CREATABLE_ADMINS = 1;

const createUserRules = [
    body('email').trim().isEmail().withMessage('A valid email address is required').bail()
        .isLength({ max: 255 }).withMessage('Email must be 255 characters or fewer').normalizeEmail(),
    body('english_name').trim().isLength({ min: 1, max: 191 }).withMessage('English name is required and must be 191 characters or fewer'),
    body('khmer_name').trim().isLength({ min: 1, max: 191 }).withMessage('Khmer name is required and must be 191 characters or fewer'),
    body('username').optional({ checkFalsy: true }).trim()
        .isLength({ max: 50 }).withMessage('Username must be 50 characters or fewer')
        .matches(/^[A-Za-z0-9_.-]+$/).withMessage('Username may only contain letters, numbers, dot, dash and underscore'),
    body('phone').optional({ checkFalsy: true }).trim()
        .isLength({ max: 20 }).withMessage('Phone must be 20 characters or fewer'),
    body('role').isIn(ASSIGNABLE_ROLES).withMessage('Role must be one of: ' + ASSIGNABLE_ROLES.join(', '))
];

router.post('/users', createUserRules, async (req, res) => {
    try {
        if (flashValidationErrors(req, res, '/admin/users')) return;

        const { email, english_name, khmer_name, username, phone, role } = req.body;
        const wantedRole = ASSIGNABLE_ROLES.indexOf(role) !== -1 ? role : 'student';

        // Guard before any write, and re-read the count rather than trusting the view.
        if (wantedRole === 'admin') {
            const [rows] = await req.db.query("SELECT COUNT(*) c FROM users WHERE role = 'admin'");
            if (Number(rows[0].c) > MAX_CREATABLE_ADMINS) {
                return await flashAndRedirect(req, res, 'error', t(req,
                    'មិនអាចបង្កើតអ្នកគ្រប់គ្រងថ្មីទៀតទេ ព្រោះមានអ្នកគ្រប់គ្រងចំនួនច្រើនរួចហើយ។',
                    'Cannot create another admin: the system already has more than one administrator.'), '/admin/users');
            }
        }

        // Pre-check purely for a readable message. The UNIQUE index on users.email is
        // what actually guarantees uniqueness, so a concurrent insert is still handled
        // by the ER_DUP_ENTRY catch below.
        const [existingEmail] = await req.db.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existingEmail.length) {
            return await flashAndRedirect(req, res, 'error', t(req, 'អ៊ីមែលនេះត្រូវបានបង្កើតរួចហើយ។', 'That email address is already registered.'), '/admin/users');
        }
        if (username) {
            const [existingUsername] = await req.db.query('SELECT id FROM users WHERE username = ?', [username]);
            if (existingUsername.length) {
                return await flashAndRedirect(req, res, 'error', t(req, 'ឈ្មោះអ្នកប្រើនេះត្រូវបានប្រើរួចហើយ។', 'That username is already taken.'), '/admin/users');
            }
        }

        const bcrypt = require('bcryptjs');
        const crypto = require('crypto');
        const newPassword = crypto.randomBytes(8).toString('hex');
        const hashedPassword = await bcrypt.hash(newPassword, 12);

        // is_verified = 1: a created account has no email round-trip to verify against,
        // and OTP delivery is not wired up for accounts an admin provisions directly.
        await req.db.query(
            'INSERT INTO users (email, password, role, khmer_name, english_name, username, phone, is_verified) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
            [email, hashedPassword, wantedRole, khmer_name, english_name, username || null, phone || null]
        );

        // No audit table exists for user changes, so at minimum record who did what.
        console.log(`[user-created] by=${req.session.user.id} email=${email} role=${wantedRole}`);

        // The password is rendered, never flashed: flash data is written into the
        // session store, which would leave the plaintext sitting in the database.
        res.render('admin/reset-password-result', {
            title: 'User Created',
            mode: 'created',
            email,
            role: wantedRole,
            newPassword,
            revokedSessions: 0
        });
    } catch (err) {
        if (err && err.code === 'ER_DUP_ENTRY') {
            return await flashAndRedirect(req, res, 'error', t(req, 'អ៊ីមែលនេះត្រូវបានបង្កើតរួចហើយ។', 'That email address is already registered.'), '/admin/users');
        }
        console.error('Create user error:', err);
        await flashAndRedirect(req, res, 'error', t(req, 'ទិន្នន័យមិនត្រឹមត្រូវ', 'Database error'), '/admin/users');
    }
});

router.post('/users/:id/reset-password', async (req, res) => {
    try {
        const bcrypt = require('bcryptjs');
        const crypto = require('crypto');
        const [rows] = await req.db.query('SELECT id, email, role FROM users WHERE id = ?', [req.params.id]);
        if (!rows.length) {
            req.flash('error', t(req, 'រកមិនឃើញអ្នកប្រើប្រាស់នេះ', 'User not found'));
            return res.redirect('/admin/users');
        }
        const target = rows[0];
        const newPassword = crypto.randomBytes(8).toString('hex');
        const hashedPassword = await bcrypt.hash(newPassword, 12);
        await req.db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, target.id]);

        // Revoke every existing session for this account. Without this, resetting the
        // password of a compromised account leaves the attacker logged in.
        const revoked = await revokeSessionsForUser(req.db, target.id);

        // The generated password is returned once on the redirect target instead of being
        // flashed: flash data is written into the session store, so flashing it would
        // persist the plaintext password in the database.
        res.render('admin/reset-password-result', {
            title: 'Password Reset',
            mode: 'reset',
            email: target.email,
            role: target.role,
            newPassword,
            revokedSessions: revoked
        });
    } catch (err) {
        console.error('reset password error:', err);
        req.flash('error', t(req, 'ទិន្នន័យមិនត្រឹមត្រូវ', 'Database error'));
        res.redirect('/admin/users');
    }
});

router.post('/users/:id/delete', async (req, res) => {
    try {
        const [user] = await req.db.query('SELECT id, email, role FROM users WHERE id = ?', [req.params.id]);
        if (!user.length) {
            req.flash('error', t(req, 'រកមិនឃើញអ្នកប្រើប្រាស់នេះ', 'User not found'));
            return res.redirect('/admin/users');
        }
        if (user[0].role === 'admin') {
            req.flash('error', t(req, 'មិនអាចលុបអ្នកគ្រប់គ្រងបាន', 'Cannot delete admin user'));
            return res.redirect('/admin/users');
        }
        if (Number(req.params.id) === Number(req.session.user.id)) {
            req.flash('error', t(req, 'មិនអាចលុបគណនីផ្ទាល់ខ្លួនបានទេ', 'You cannot delete your own account'));
            return res.redirect('/admin/users');
        }
        // Foreign keys protect applications / enrollments / payments, so a bare DELETE
        // failed with an opaque "Database error". Name the blockers instead.
        // Notifications are deliberately NOT a blocker: they are transient notices, and
        // blocking on them would make any account that ever received a message
        // permanently undeletable. They are removed with the account below.
        const inUse = await usageCounts(req.db, [
            ['applications', 'SELECT COUNT(*) c FROM applications WHERE user_id = ?', [req.params.id]],
            ['enrollments', 'SELECT COUNT(*) c FROM enrollments WHERE user_id = ?', [req.params.id]],
            ['payments', 'SELECT COUNT(*) c FROM payments WHERE user_id = ?', [req.params.id]]
        ]);
        if (inUse.length) {
            req.flash('error', t(req,
                'មិនអាចលុបអ្នកប្រើប្រាស់បានទេ ព្រោះគាត់មានទិន្នន័យ៖ ' + inUse.join(', '),
                'Cannot delete this user: they still have ' + inUse.join(', ')));
            return res.redirect('/admin/users');
        }
        await withTransaction(req.db, async (conn) => {
            await conn.query('DELETE FROM notifications WHERE user_id = ?', [req.params.id]);
            await conn.query('DELETE FROM users WHERE id = ?', [req.params.id]);
        });

        // The session store keeps its own copy of the user object, so deleting the row
        // does not log anyone out: isAuthenticated only checks req.session.user. Without
        // this, a deleted account stays fully logged in until the session expires.
        const revoked = await revokeSessionsForUser(req.db, req.params.id);
        req.flash('success', t(req, 'អ្នកប្រើប្រាស់ត្រូវបានលុបដោយជោគជ័យ', 'User deleted successfully'));
        res.redirect('/admin/users');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'ទិន្នន័យមិនត្រឹមត្រូវ', 'Database error'));
        res.redirect('/admin/users');
    }
});

async function getReportStats(db) {
    const [total] = await db.query('SELECT COUNT(*) as count FROM applications');
    const [byMajor] = await db.query(
        `SELECT m.name_kh, m.name_en, COUNT(a.id) as count
         FROM applications a LEFT JOIN majors m ON a.major_first_choice_id = m.id
         GROUP BY a.major_first_choice_id`
    );
    const [byCategory] = await db.query(
        `SELECT st.name_kh, st.name_en, COUNT(a.id) as count
         FROM applications a LEFT JOIN scholarship_types st ON a.scholarship_type_id = st.id
         WHERE a.scholarship_type_id IS NOT NULL
         GROUP BY a.scholarship_type_id`
    );
    const [byProvince] = await db.query(
        `SELECT p.name_kh, p.name_en, COUNT(a.id) as count
         FROM applications a LEFT JOIN provinces p ON a.school_province_id = p.id
         GROUP BY a.school_province_id`
    );
    const [byGender] = await db.query('SELECT gender, COUNT(*) as count FROM applications GROUP BY gender');
    const [byStatus] = await db.query('SELECT status, COUNT(*) as count FROM applications GROUP BY status');
    return { total: total[0].count, byMajor, byCategory, byProvince, byGender, byStatus };
}

const REPORT_APPLICATIONS_SQL = `SELECT a.*, m.name_kh as major1_name_kh, m.name_en as major1_name_en,
     m2.name_kh as major2_name_kh, m2.name_en as major2_name_en,
     c.name_kh as category_name_kh, c.name_en as category_name_en,
     st.name_kh as scholarship_name_kh, st.name_en as scholarship_name_en,
     st.coverage_percentage, st.duration_years, st.provider_name,
     p.name_kh as province_name_kh, p.name_en as province_name_en,
     u.email as user_email, u.khmer_name as account_khmer_name, u.english_name as account_english_name
     FROM applications a
     LEFT JOIN majors m ON a.major_first_choice_id = m.id
     LEFT JOIN majors m2 ON a.major_second_choice_id = m2.id
     LEFT JOIN scholarship_categories c ON a.scholarship_category_id = c.id
     LEFT JOIN scholarship_types st ON a.scholarship_type_id = st.id
     LEFT JOIN provinces p ON a.school_province_id = p.id
     LEFT JOIN users u ON a.user_id = u.id
     ORDER BY a.submitted_at DESC`;

function fmtDate(v) {
    if (!v) return '';
    const d = new Date(v);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB');
}

function fmtDateTime(v) {
    if (!v) return '';
    const d = new Date(v);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB') + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

router.get('/reports', async (req, res) => {
    try {
        const stats = await getReportStats(req.db);
        res.render('admin/reports', {
            title: 'Reports',
            total: stats.total,
            byMajor: stats.byMajor,
            byCategory: stats.byCategory,
            byProvince: stats.byProvince,
            byGender: stats.byGender,
            byStatus: stats.byStatus
        });
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'ទិន្នន័យមិនត្រឹមត្រូវ', 'Database error'));
        res.redirect('/admin/dashboard');
    }
});

router.get('/reports/export/excel', async (req, res) => {
    try {
        const [applications] = await req.db.query(REPORT_APPLICATIONS_SQL);
        const data = applications.map(a => ({
            ID: a.id,
            Status: a.status,
            'Khmer First Name': a.khmer_first_name || '',
            'Khmer Last Name': a.khmer_last_name || '',
            'English First Name': a.english_first_name || '',
            'English Last Name': a.english_last_name || '',
            Gender: a.gender || '',
            'Date of Birth': fmtDate(a.date_of_birth),
            'Birth Place': a.birth_place || '',
            Nationality: a.nationality || '',
            Email: a.email || a.user_email || '',
            Phone: a.phone || '',
            Telegram: a.telegram || '',
            'Current Address': a.current_address || '',
            Village: a.address_village || '',
            Commune: a.address_commune || '',
            District: a.address_district || '',
            Province: a.address_province || '',
            "Father/Guardian Name": a.parent_name || '',
            'Mother Name': a.mother_name || '',
            Occupation: a.occupation || '',
            'Education Level': a.education_level || '',
            'Parent Phone': a.parent_phone || '',
            'School Name': a.school_name || '',
            'School Province': a.province_name_en || a.province_name_kh || '',
            'Graduation Year': a.graduation_year || '',
            'Major Choice 1': a.major1_name_en || a.major1_name_kh || '',
            'Major Choice 2': a.major2_name_en || a.major2_name_kh || '',
            Category: a.category_name_en || a.category_name_kh || '',
            'Scholarship Program': a.scholarship_name_en || a.scholarship_name_kh || '',
            'Scholarship Provider': a.provider_name || '',
            'Coverage %': a.coverage_percentage != null ? a.coverage_percentage : '',
            'Duration (Years)': a.duration_years != null ? a.duration_years : '',
            'Scholarship Option': a.scholarship_option || '',
            'Study Level': a.study_level || '',
            'Study Period': a.study_period || '',
            'Study Shift': a.study_shift || '',
            'Exam Session': a.exam_session || '',
            'Exam Center': a.exam_center || '',
            'Exam Result': a.exam_result || '',
            'Exam Date': fmtDate(a.exam_date),
            'Exam Time': a.exam_time || '',
            'Exam Venue': a.exam_venue || '',
            'Submitted Date': fmtDateTime(a.submitted_at),
            'Last Updated': fmtDateTime(a.updated_at),
            'Account Name (EN)': a.account_english_name || '',
            'Account Name (KM)': a.account_khmer_name || ''
        }));
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, 'Applications');

        const stats = await getReportStats(req.db);
        const summary = [
            { Section: 'Total', Item: 'All Applications', Count: stats.total },
            ...stats.byStatus.map(s => ({ Section: 'Status', Item: s.status, Count: s.count })),
            ...stats.byGender.map(g => ({ Section: 'Gender', Item: g.gender || 'N/A', Count: g.count })),
            ...stats.byMajor.map(m => ({ Section: 'Major', Item: m.name_en || m.name_kh || 'N/A', Count: m.count })),
            ...stats.byCategory.map(c => ({ Section: 'Scholarship', Item: c.name_en || c.name_kh || 'N/A', Count: c.count })),
            ...stats.byProvince.map(p => ({ Section: 'Province', Item: p.name_en || p.name_kh || 'N/A', Count: p.count }))
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary');

        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Disposition', 'attachment; filename=applications.xlsx');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buf);
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការនាំចេញ', 'Export error'));
        res.redirect('/admin/reports');
    }
});

router.get('/reports/print', async (req, res) => {
    try {
        const stats = await getReportStats(req.db);
        const [applications] = await req.db.query(REPORT_APPLICATIONS_SQL);
        res.render('admin/reports-print', {
            title: 'Print Report',
            layout: false,
            stats,
            applications,
            backHref: '/admin/reports',
            generatedAt: new Date()
        });
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'ទិន្នន័យមិនត្រឹមត្រូវ', 'Database error'));
        res.redirect('/admin/reports');
    }
});

// Staff notifications. These are the inbox for the four student-side events that used to
// arrive silently: a new application, a corrected resubmission, an enrollment and a
// payment. Scoped to the signed-in admin, so one admin marking a row read never affects
// the other.
router.get('/notifications', async (req, res) => {
    try {
        if (flashValidationErrors(req, res, '/admin/dashboard')) return;
        const [notifications] = await req.db.query(
            'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC',
            [req.session.user.id]
        );
        res.render('admin/notifications', { title: 'Notifications', notifications });
    } catch (err) {
        console.error('Admin notifications error:', err);
        req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
        res.redirect('/admin/dashboard');
    }
});

router.post('/notifications/read-all', async (req, res) => {
    try {
        const [result] = await req.db.query(
            'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0',
            [req.session.user.id]
        );
        // Report the real count so a repeat click says "nothing left" instead of claiming
        // work it did not do.
        const marked = result && result.affectedRows ? result.affectedRows : 0;
        if (marked > 0) {
            return await flashAndRedirect(req, res, 'success', t(req,
                'សារជូនដំណឹងចំនួន ' + marked + ' ត្រូវបានសម្គាល់ថាបានអាន។',
                marked + ' notification' + (marked === 1 ? '' : 's') + ' marked as read.'), '/admin/notifications');
        }
        return await flashAndRedirect(req, res, 'warning', t(req,
            'មិនមានសារជូនដំណឹងដែលមិនទាន់អាន។',
            'No unread notifications.'), '/admin/notifications');
    } catch (err) {
        console.error('Admin mark all read error:', err);
        req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
        res.redirect('/admin/dashboard');
    }
});

router.post('/notification/:id/read', async (req, res) => {
    try {
        // The user_id predicate is what stops one admin marking another admin's row read.
        await req.db.query(
            'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
            [req.params.id, req.session.user.id]
        );
        return await flashAndRedirect(req, res, 'success', t(req,
            'សារជូនដំណឹងត្រូវបានសម្គាល់ថាបានអាន។',
            'Notification marked as read.'), '/admin/notifications');
    } catch (err) {
        console.error('Admin mark notification read error:', err);
        req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
        res.redirect('/admin/dashboard');
    }
});

router.post('/notifications/send',
    remarkRule('message', 'Message'),
    async (req, res) => {
    try {
        if (flashValidationErrors(req, res, '/admin/dashboard')) return;
        const { exam_date, exam_time, exam_venue, message } = req.body;
        // DISTINCT matters: a student with two approved applications previously received
        // this broadcast twice.
        const [approved] = await req.db.query("SELECT DISTINCT user_id FROM applications WHERE status = 'approved' AND user_id IS NOT NULL");
        let notificationMessage = 'Exam Notification Details:\n';
        if (exam_date) notificationMessage += 'Date: ' + exam_date + '\n';
        if (exam_time) notificationMessage += 'Time: ' + exam_time + '\n';
        if (exam_venue) notificationMessage += 'Venue: ' + exam_venue + '\n';
        if (message) notificationMessage += '\n' + message;
        if (!notificationMessage.trim() || notificationMessage === 'Exam Notification Details:\n') {
            req.flash('error', t(req, 'សូមបញ្ចូលព័ត៌មានអាចារបស់ការជូនដឆ្ភាក់យ៉ាងតិចម្ដង។', 'Please provide at least one detail or a message before sending.'));
            return res.redirect('/admin/dashboard');
        }
        // All-or-nothing: a partial broadcast would leave some students notified and
        // others not, with no way to tell afterwards.
        await withTransaction(req.db, async (conn) => {
            for (const app of approved) {
                await conn.query('INSERT INTO notifications (user_id, title, message, type, detail, link) VALUES (?, ?, ?, ?, ?, ?)',
                    [app.user_id, 'Exam Schedule Notification', 'New exam schedule information.', 'exam_notification', notificationMessage, '/student/status']);
            }
        });
        req.flash('success', t(req, `បានផ្ញើសារជូនដឆ្ភាក់ដល់ ${approved.length} អ្នកដាក់ពាក់សុំដែលបានអនុម័ត`, `Notification sent to ${approved.length} approved applicants`));
        res.redirect('/admin/dashboard');
    } catch (err) {
        console.error('broadcast notification error:', err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/dashboard');
    }
});

// Public contact details shown in the footer, editable by an admin.
//
// Only these four keys can be written, and each value is validated before it is stored: the
// website and the email end up inside href attributes on every page, so an unvalidated value
// would let an admin inject a javascript: link sitewide. The phone becomes a tel: link and
// the address is plain text.
const CONTACT_FIELDS = [
  { key: 'contact_website', max: 255 },
  { key: 'contact_email', max: 255 },
  { key: 'contact_phone', max: 60 },
  { key: 'contact_address', max: 255 }
];

function sanitizeContactValues(raw) {
  const out = {};
  const errors = [];

  const website = String(raw.contact_website || '').trim();
  if (website) {
    // Only http(s). Anything else (javascript:, data:, vbscript:) would render as a live
    // link on every page of the site.
    if (!/^https?:\/\/[^\s]+$/i.test(website)) {
      errors.push('website must start with http:// or https://');
    } else if (website.length > 255) {
      errors.push('website is too long (max 255 characters)');
    } else {
      out.contact_website = website;
    }
  } else {
    out.contact_website = '';
  }

  const email = String(raw.contact_email || '').trim();
  if (email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push('email is not a valid address');
    } else if (email.length > 255) {
      errors.push('email is too long (max 255 characters)');
    } else {
      out.contact_email = email;
    }
  } else {
    out.contact_email = '';
  }

  const phone = String(raw.contact_phone || '').trim();
  if (phone) {
    // Digits, spaces and the usual punctuation only. This is rendered into a tel: link.
    if (!/^[+\d][\d\s().-]{0,58}[\d)]$/.test(phone)) {
      errors.push('phone may only contain digits, spaces and + - ( ) .');
    } else {
      out.contact_phone = phone;
    }
  } else {
    out.contact_phone = '';
  }

  const address = String(raw.contact_address || '').trim();
  if (address) {
    if (address.length > 255) {
      errors.push('address is too long (max 255 characters)');
    } else {
      out.contact_address = address;
    }
  } else {
    out.contact_address = '';
  }

  return { values: out, errors };
}

// Banks available for tuition payment.
//
// The site previously had one hard-coded QR. Each bank is now a row, and payments record
// which one was used, so a student can pay through whichever bank suits them and the admin
// can still reconcile against the right account.
//
// A bank is never hard-deleted if payments reference it: the column is ON DELETE SET NULL
// in spirit, and DELETE here is implemented as a deactivation instead, so historical
// payments keep pointing at something real and the student's payment history still renders.
const BANK_UPLOAD = upload.single('qr_file');

function readBankForm(body) {
  const nameEn = String(body.name_en || '').trim();
  const nameKh = String(body.name_kh || '').trim();
  const errors = [];

  // At least one name is required, otherwise the bank shows up on the student page as a
  // nameless option.
  if (!nameEn && !nameKh) errors.push('a bank name is required (English or Khmer)');
  if (nameEn.length > 120 || nameKh.length > 120) errors.push('bank name is too long (max 120 characters)');

  const accountName = String(body.account_name || '').trim();
  if (accountName.length > 160) errors.push('account name is too long (max 160 characters)');

  const accountNumber = String(body.account_number || '').trim();
  // Rendered as text in the student page, but a pasted value could carry markup, so it is
  // restricted rather than escaped and trusted.
  if (accountNumber && !/^[\w\s.-]{1,80}$/.test(accountNumber)) {
    errors.push('account number may only contain letters, digits, spaces and . _ -');
  }

  const instructions = String(body.instructions || '').trim();
  if (instructions.length > 2000) errors.push('instructions are too long (max 2000 characters)');

  const sortOrder = parseInt(body.sort_order, 10);
  if (body.sort_order !== undefined && body.sort_order !== '' && !Number.isFinite(sortOrder)) {
    errors.push('sort order must be a number');
  }

  return {
    errors,
    values: {
      name_kh: nameKh || nameEn,
      name_en: nameEn || nameKh,
      account_name: accountName || null,
      account_number: accountNumber || null,
      instructions: instructions || null,
      sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
      is_active: body.is_active === '1' || body.is_active === 'on' || body.is_active === 'true' ? 1 : 0
    }
  };
}

router.get('/payment-banks', async (req, res) => {
    try {
        const [banks] = await req.db.query(
            'SELECT * FROM payment_banks ORDER BY sort_order ASC, id ASC');
        const [usage] = await req.db.query(
            'SELECT bank_id, COUNT(*) n FROM payments WHERE bank_id IS NOT NULL GROUP BY bank_id');
        const usedBy = {};
        usage.forEach(u => { usedBy[u.bank_id] = u.n; });
        res.render('admin/payment-banks', { title: 'Payment Banks', banks, usedBy });
    } catch (err) {
        console.error('Payment banks error:', err);
        req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
        res.redirect('/admin/dashboard');
    }
});

router.post('/payment-banks', BANK_UPLOAD, verifyCsrf, async (req, res) => {
    try {
        const { values, errors } = readBankForm(req.body);
        if (errors.length) {
            req.flash('error', t(req, 'ទិន្នន័យមិនត្រឹមត្រូវ៖ ', 'Invalid input: ') + errors.join('. '));
            return res.redirect('/admin/payment-banks');
        }

        let qrPath = null;
        if (req.file) {
            const uploaded = await uploadToImageKit(req.file, 'payment');
            qrPath = uploaded.url;
        }
        // A bank with no QR cannot be paid into, so it is refused rather than added and
        // then shown to students as an empty card.
        if (!qrPath) {
            req.flash('error', t(req, 'សូមបញ្ចូលរូបភាព QR។', 'Please upload a QR image for the bank.'));
            return res.redirect('/admin/payment-banks');
        }

        await req.db.query(
            `INSERT INTO payment_banks
               (name_kh, name_en, account_name, account_number, qr_path, instructions, is_active, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [values.name_kh, values.name_en, values.account_name, values.account_number,
             qrPath, values.instructions, values.is_active, values.sort_order]);

        req.flash('success', t(req, 'ធនាគារត្រូវបានបញ្ចូល។', 'Bank added.'));
        res.redirect('/admin/payment-banks');
    } catch (err) {
        console.error('Payment bank create error:', err);
        req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
        res.redirect('/admin/payment-banks');
    }
});

router.post('/payment-banks/:id', BANK_UPLOAD, verifyCsrf, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) {
            req.flash('error', t(req, 'មិនឃើញធនាគារ។', 'Bank not found.'));
            return res.redirect('/admin/payment-banks');
        }

        const [existing] = await req.db.query('SELECT * FROM payment_banks WHERE id = ?', [id]);
        if (!existing.length) {
            req.flash('error', t(req, 'មិនឃើញធនាគារ។', 'Bank not found.'));
            return res.redirect('/admin/payment-banks');
        }
        const current = existing[0];

        const { values, errors } = readBankForm(req.body);
        if (errors.length) {
            req.flash('error', t(req, 'ទិន្នន័យមិនត្រឹមត្រូវ៖ ', 'Invalid input: ') + errors.join('. '));
            return res.redirect('/admin/payment-banks');
        }

        let qrPath = current.qr_path;
        if (req.file) {
            const uploaded = await uploadToImageKit(req.file, 'payment');
            qrPath = uploaded.url;
        }

        await req.db.query(
            `UPDATE payment_banks
             SET name_kh = ?, name_en = ?, account_name = ?, account_number = ?,
                 qr_path = ?, instructions = ?, is_active = ?, sort_order = ?
             WHERE id = ?`,
            [values.name_kh, values.name_en, values.account_name, values.account_number,
             qrPath, values.instructions, values.is_active, values.sort_order, id]);

        req.flash('success', t(req, 'ព័ត៌មានធនាគារត្រូវបានរក្សាទុក។', 'Bank updated.'));
        res.redirect('/admin/payment-banks');
    } catch (err) {
        console.error('Payment bank update error:', err);
        req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
        res.redirect('/admin/payment-banks');
    }
});

router.post('/payment-banks/:id/toggle', verifyCsrf, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const [existing] = await req.db.query('SELECT is_active FROM payment_banks WHERE id = ?', [id]);
        if (!existing.length) {
            req.flash('error', t(req, 'មិនឃើញធនាគារ។', 'Bank not found.'));
            return res.redirect('/admin/payment-banks');
        }
        await req.db.query('UPDATE payment_banks SET is_active = 1 - is_active WHERE id = ?', [id]);
        req.flash('success', t(req, 'ស្ថានភាពធនាគារត្រូវបានប្តូរ។', 'Bank status updated.'));
        res.redirect('/admin/payment-banks');
    } catch (err) {
        console.error('Payment bank toggle error:', err);
        req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
        res.redirect('/admin/payment-banks');
    }
});

router.post('/payment-banks/:id/delete', verifyCsrf, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const [existing] = await req.db.query('SELECT id FROM payment_banks WHERE id = ?', [id]);
        if (!existing.length) {
            req.flash('error', t(req, 'មិនឃើញធនាគារ។', 'Bank not found.'));
            return res.redirect('/admin/payment-banks');
        }

        const [used] = await req.db.query('SELECT COUNT(*) n FROM payments WHERE bank_id = ?', [id]);
        if (Number(used[0].n) > 0) {
            // Deleting would leave those payments pointing at a bank that no longer exists,
            // and the student's payment history would render a blank. Deactivate instead,
            // which hides it from new payments while keeping history intact.
            await req.db.query('UPDATE payment_banks SET is_active = 0 WHERE id = ?', [id]);
            req.flash('warning', t(req,
                'ធនាគារនេះមានការទូទាត់ ' + used[0].n + ' ដង។ វាត្រូវបានបិទជំនួសការលុប។',
                'This bank has ' + used[0].n + ' payment(s), so it was deactivated instead of deleted.'));
            return res.redirect('/admin/payment-banks');
        }

        await req.db.query('DELETE FROM payment_banks WHERE id = ?', [id]);
        req.flash('success', t(req, 'ធនាគារត្រូវបានលុប។', 'Bank deleted.'));
        res.redirect('/admin/payment-banks');
    } catch (err) {
        console.error('Payment bank delete error:', err);
        req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
        res.redirect('/admin/payment-banks');
    }
});

router.get('/contact', async (req, res) => {
    try {
        const [rows] = await req.db.query(
            "SELECT setting_key, setting_value FROM settings WHERE setting_key LIKE 'contact\\_%'");
        const contact = {};
        rows.forEach(r => { contact[r.setting_key.replace(/^contact_/, '')] = r.setting_value; });
        res.render('admin/contact', { title: 'Contact Information', contact });
    } catch (err) {
        console.error('Contact page error:', err);
        req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
        res.redirect('/admin/dashboard');
    }
});

router.post('/contact', verifyCsrf, async (req, res) => {
    try {
        const { values, errors } = sanitizeContactValues(req.body);

        if (errors.length) {
            // Report every problem at once rather than saving the fields that happened to
            // validate, which left the footer half-updated with no way to tell what stuck.
            req.flash('error', t(req, 'ទិន្នន័យមិនត្រឹមត្រូវ៖ ', 'Invalid input: ') + errors.join('. '));
            return res.redirect('/admin/contact');
        }

        // All-or-nothing: four fields that belong to one visible block.
        await withTransaction(req.db, async (conn) => {
            for (const field of CONTACT_FIELDS) {
                await conn.query(
                    'UPDATE settings SET setting_value = ? WHERE setting_key = ?',
                    [values[field.key], field.key]);
            }
        });

        req.flash('success', t(req, 'ព័ត៌មានទំនាក់ទំនងត្រូវបានរក្សាទុក។', 'Contact information updated.'));
        res.redirect('/admin/contact');
    } catch (err) {
        console.error('Contact update error:', err);
        req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
        res.redirect('/admin/contact');
    }
});

router.get('/settings', async (req, res) => {
    try {
        const [rows] = await req.db.query('SELECT * FROM settings');
        const settings = {};
        rows.forEach(row => { settings[row.setting_key] = row.setting_value; });
        res.render('admin/settings', { title: 'System Settings', settings });
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/dashboard');
    }
});

router.post('/settings', verifyCsrf, async (req, res) => {
    try {
        const { registration_open, registration_start, registration_end, enrollment_open, enrollment_start, enrollment_end, scholarship_open, scholarship_start, scholarship_end, form_type } = req.body;

        const [rows] = await req.db.query('SELECT setting_key, setting_value FROM settings');
        const current = {};
        rows.forEach(row => { current[row.setting_key] = row.setting_value; });

// The QR upload that used to live here was removed: students now read
    // payment_banks.qr_path, so writing `payment_qr_path` here saved a value nothing read.
    // QRs are managed per bank at /admin/payment-banks instead.

        const regOpen = registration_open !== undefined
            ? (Array.isArray(registration_open) ? registration_open[registration_open.length - 1] : registration_open)
            : current.registration_open || '0';
        const enrollOpen = enrollment_open !== undefined
            ? (Array.isArray(enrollment_open) ? enrollment_open[enrollment_open.length - 1] : enrollment_open)
            : current.enrollment_open || '0';
        const scholOpen = scholarship_open !== undefined
            ? (Array.isArray(scholarship_open) ? scholarship_open[scholarship_open.length - 1] : scholarship_open)
            : current.scholarship_open || '0';
        // Validate each window before writing anything. A malformed or reversed date
        // would otherwise leave the application window permanently open or closed with
        // no obvious cause.
        const windows = [
            ['registration', registration_start !== undefined ? registration_start : current.registration_start, registration_end !== undefined ? registration_end : current.registration_end],
            ['enrollment', enrollment_start !== undefined ? enrollment_start : current.enrollment_start, enrollment_end !== undefined ? enrollment_end : current.enrollment_end],
            ['scholarship', scholarship_start !== undefined ? scholarship_start : current.scholarship_start, scholarship_end !== undefined ? scholarship_end : current.scholarship_end]
        ];
        for (const [label, start, end] of windows) {
            const problem = validateWindow(start, end);
            if (problem) {
                req.flash('error', t(req,
                    'កាលបរិច្ឆេទមិនត្រឹមត្រូវសម្រាប់ ' + label + '៖ ' + problem.km,
                    'Invalid ' + label + ' dates: ' + problem.en));
                return res.redirect('/admin/settings');
            }
        }

        // Nine independent UPDATEs: previously a failure part way through left the
        // settings half saved with no indication of which half.
        await withTransaction(req.db, async (conn) => {
            await conn.query('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [regOpen, 'registration_open']);
            await conn.query('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [registration_start !== undefined ? registration_start : (current.registration_start || ''), 'registration_start']);
            await conn.query('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [registration_end !== undefined ? registration_end : (current.registration_end || ''), 'registration_end']);
            await conn.query('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [enrollOpen, 'enrollment_open']);
            await conn.query('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [enrollment_start !== undefined ? enrollment_start : (current.enrollment_start || ''), 'enrollment_start']);
            await conn.query('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [enrollment_end !== undefined ? enrollment_end : (current.enrollment_end || ''), 'enrollment_end']);
            await conn.query('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [scholOpen, 'scholarship_open']);
            await conn.query('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [scholarship_start !== undefined ? scholarship_start : (current.scholarship_start || ''), 'scholarship_start']);
            await conn.query('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [scholarship_end !== undefined ? scholarship_end : (current.scholarship_end || ''), 'scholarship_end']);
        });

        req.flash('success', t(req, 'បានកែសម្រួលការកំណត់ដោយជោគជ័យ', 'Settings updated successfully'));
        res.redirect('/admin/settings');
    } catch (err) {
        console.error('Settings update error:', err);
        if (err.message && err.message.includes('ImageKit')) {
            req.flash('error', t(req, 'មានកំហុសក្នុងការបញ្ចូលរូបភាព។ សូមពិនិត្យមើល ImageKit configuration។', 'Image upload failed. Please check ImageKit configuration.'));
        } else {
            req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        }
        res.redirect('/admin/settings');
    }
});

// â”€â”€â”€ Scholarship Types CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// tier_options is a JSON list of combos {p: percent, y: years, s: seats}, e.g.
// [{"p":100,"y":4,"s":5},{"p":50,"y":4,"s":5},{"p":50,"y":2,"s":5}]
function parseTierInput(raw) {
    const list = [];
    try {
        const parsed = JSON.parse(String(raw == null ? '' : raw));
        if (Array.isArray(parsed)) {
            parsed.forEach(t => {
                const p = Number(t && t.p), y = Number(t && t.y), s = Number(t && t.s);
                if (p >= 1 && p <= 100) list.push({ p, y: (y >= 1 && y <= 10) ? y : null, s: (s >= 1 && s <= 999) ? s : null });
            });
        }
    } catch (e) { /* non-JSON input ignored */ }
    const uniq = [];
    list.forEach(t => { if (!uniq.some(u => u.p === t.p && u.y === t.y)) uniq.push(t); });
    return uniq.length ? JSON.stringify(uniq.slice(0, 12)) : '';
}

function parseMajorIds(raw) {
    const arr = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    const ids = arr.map(v => parseInt(v, 10)).filter(n => Number.isInteger(n) && n > 0);
    const uniq = [];
    ids.forEach(n => { if (uniq.indexOf(n) === -1) uniq.push(n); });
    return uniq.slice(0, 30).join(',');
}

router.get('/scholarship-types', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;
        const { search, status } = req.query;

        let query = 'SELECT * FROM scholarship_types WHERE 1=1';
        let countQuery = 'SELECT COUNT(*) as count FROM scholarship_types WHERE 1=1';
        const params = [];
        const countParams = [];

        if (search) {
            const s = '%' + search + '%';
            query += ' AND (name_kh LIKE ? OR name_en LIKE ? OR provider_name LIKE ?)';
            countQuery += ' AND (name_kh LIKE ? OR name_en LIKE ? OR provider_name LIKE ?)';
            params.push(s, s, s);
            countParams.push(s, s, s);
        }
        if (status === 'active') {
            query += ' AND is_active = 1';
            countQuery += ' AND is_active = 1';
        } else if (status === 'inactive') {
            query += ' AND is_active = 0';
            countQuery += ' AND is_active = 0';
        }

        const [countResult] = await req.db.query(countQuery, countParams);
        const totalRecords = countResult[0].count;
        const totalPages = Math.ceil(totalRecords / limit);

        query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        const [types] = await req.db.query(query, params);

        const [majorsList] = await req.db.query('SELECT id, name_kh, name_en FROM majors WHERE is_active = 1 ORDER BY name_kh ASC');

        res.render('admin/scholarship-types', {
            title: 'Manage Scholarship Types',
            types,
            majorsList,
            currentPage: page,
            limit,
            totalPages,
            totalRecords,
            filters: req.query
        });
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/dashboard');
    }
});

// Coverage % and duration are no longer entered separately in the form:
// they are derived from the tier combos (highest %, longest years).
function deriveCoverageDuration(tierOptions, fallbackCov, fallbackDur) {
    let tiers = [];
    try { const parsed = JSON.parse(tierOptions); if (Array.isArray(parsed)) tiers = parsed; } catch (e) { /* ignore */ }
    if (!tiers.length) return { coverage: fallbackCov, duration: fallbackDur };
    const ps = tiers.map(t => Number(t && t.p)).filter(n => n >= 1 && n <= 100);
    const ys = tiers.map(t => Number(t && t.y)).filter(n => n >= 1 && n <= 10);
    return {
        coverage: ps.length ? Math.max(...ps) : fallbackCov,
        duration: ys.length ? Math.max(...ys) : fallbackDur
    };
}

router.post('/scholarship-types', upload.single('poster_file'), verifyCsrf, async (req, res) => {
    try {
        const { name_kh, name_en, provider_name, leader_name, description } = req.body;
        let posterPath = null;
        if (req.file) {
            const uploaded = await uploadToImageKit(req.file, 'poster');
            posterPath = uploaded.url;
        }
        const tierOptions = parseTierInput(req.body.tier_options);
        const derived = deriveCoverageDuration(tierOptions, 0, 1);
        await req.db.query(
            'INSERT INTO scholarship_types (name_kh, name_en, coverage_percentage, duration_years, provider_name, leader_name, description, poster_path, tier_options, major_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [name_kh, name_en || '', derived.coverage, derived.duration, provider_name || '', leader_name || null, description || '', posterPath, tierOptions, parseMajorIds(req.body.major_ids)]
        );
        req.flash('success', t(req, 'បានបន្ថែមប្រភេទអាហារូបករណ៍ដោយជោគជ័យ', 'Scholarship type added successfully'));
        res.redirect('/admin/scholarship-types');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/scholarship-types');
    }
});

router.post('/scholarship-types/:id/edit', upload.single('poster_file'), verifyCsrf, async (req, res) => {
    try {
        const { name_kh, name_en, provider_name, leader_name, description, current_poster_path } = req.body;
        let posterPath = current_poster_path || null;
        if (req.file) {
            const uploaded = await uploadToImageKit(req.file, 'poster');
            posterPath = uploaded.url;
            const oldFileId = extractFileId(current_poster_path);
            if (oldFileId) deleteFromImageKit(oldFileId);
        }
        const tierOptions = parseTierInput(req.body.tier_options);
        const [existingRows] = await req.db.query('SELECT coverage_percentage, duration_years FROM scholarship_types WHERE id = ?', [req.params.id]);
        const derived = deriveCoverageDuration(
            tierOptions,
            existingRows.length ? existingRows[0].coverage_percentage : 0,
            existingRows.length ? existingRows[0].duration_years : 1
        );
        await req.db.query(
            'UPDATE scholarship_types SET name_kh = ?, name_en = ?, coverage_percentage = ?, duration_years = ?, provider_name = ?, leader_name = ?, description = ?, poster_path = ?, tier_options = ?, major_ids = ? WHERE id = ?',
            [name_kh, name_en || '', derived.coverage, derived.duration, provider_name || '', leader_name || null, description || '', posterPath, tierOptions, parseMajorIds(req.body.major_ids), req.params.id]
        );
        req.flash('success', t(req, 'បានកែសម្រួលប្រភេទអាហារូបករណ៍ដោយជោគជ័យ', 'Scholarship type updated successfully'));
        res.redirect('/admin/scholarship-types');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/scholarship-types');
    }
});

router.post('/scholarship-types/:id/toggle', async (req, res) => {
    try {
        await req.db.query('UPDATE scholarship_types SET is_active = NOT is_active WHERE id = ?', [req.params.id]);
        req.flash('success', t(req, 'បានកែសម្រួលស្ថានភាពប្រភេទអាហារូបករណ៍', 'Scholarship type status updated'));
        res.redirect('/admin/scholarship-types');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/scholarship-types');
    }
});

router.post('/scholarship-types/:id/delete', async (req, res) => {
    try {
        const [rows] = await req.db.query('SELECT id, name_en FROM scholarship_types WHERE id = ?', [req.params.id]);
        if (!rows.length) {
            req.flash('error', t(req, 'រកមិនឃើញកម្មវិធីអាហារូបករណ៍នេះ', 'Scholarship program not found'));
            return res.redirect('/admin/scholarship-types');
        }
        // applications.scholarship_type_id has no foreign key, so without this check the
        // delete would succeed and silently orphan existing applications.
        const inUse = await usageCounts(req.db, [
            ['applications', 'SELECT COUNT(*) c FROM applications WHERE scholarship_type_id = ?', [req.params.id]],
            ['enrollments', 'SELECT COUNT(*) c FROM enrollments WHERE scholarship_category_id = ?', [req.params.id]]
        ]);
        if (inUse.length) {
            req.flash('error', t(req,
                'មិនអាចលុបកម្មវិធីនេះបានទេ ព្រោះវាត្រូវបានប្រើនៅ៖ ' + inUse.join(', '),
                'Cannot delete this scholarship program: it is used by ' + inUse.join(', ') + '. Deactivate it instead.'));
            return res.redirect('/admin/scholarship-types');
        }
        await req.db.query('DELETE FROM scholarship_types WHERE id = ?', [req.params.id]);
        req.flash('success', t(req, 'បានលុបប្រភេទអាហារូបករណ៍ដោយជោគជ័យ', 'Scholarship type deleted successfully'));
        res.redirect('/admin/scholarship-types');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មិនអាចលុបប្រភេទអាហារូបករណ៍ដែលកំពុងប្រើប្រាស់បានទេ', 'Cannot delete scholarship type that is being used'));
        res.redirect('/admin/scholarship-types');
    }
});

// ==================== FEE TYPES CRUD ====================

router.get('/fee-types', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;
        const { search, status } = req.query;

        let query = 'SELECT * FROM fee_types WHERE 1=1';
        let countQuery = 'SELECT COUNT(*) as count FROM fee_types WHERE 1=1';
        const params = [];
        const countParams = [];

        if (search) {
            const s = '%' + search + '%';
            query += ' AND (name_kh LIKE ? OR name_en LIKE ? OR description LIKE ?)';
            countQuery += ' AND (name_kh LIKE ? OR name_en LIKE ? OR description LIKE ?)';
            params.push(s, s, s);
            countParams.push(s, s, s);
        }
        if (status === 'active') {
            query += ' AND is_active = 1';
            countQuery += ' AND is_active = 1';
        } else if (status === 'inactive') {
            query += ' AND is_active = 0';
            countQuery += ' AND is_active = 0';
        }

        const [countResult] = await req.db.query(countQuery, countParams);
        const totalRecords = countResult[0].count;
        const totalPages = Math.ceil(totalRecords / limit);

        query += ' ORDER BY id ASC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        const [feeTypes] = await req.db.query(query, params);

        res.render('admin/fee-types', {
            title: 'Manage Fee Types',
            feeTypes,
            currentPage: page,
            limit,
            totalPages,
            totalRecords,
            filters: req.query
        });
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការផ្ទុកប្រភេទថ្លៃសេវា', 'Error loading fee types'));
        res.redirect('/admin/dashboard');
    }
});

router.post('/fee-types', async (req, res) => {
    try {
        const { name_kh, name_en, amount, description } = req.body;
        await req.db.query(
            'INSERT INTO fee_types (name_kh, name_en, amount, description) VALUES (?, ?, ?, ?)',
            [name_kh, name_en || '', parseFloat(amount) || 0, description || '']
        );
        req.flash('success', t(req, 'បានបន្ថែមប្រភេទថ្លៃសេវាដោយជោគជ័យ', 'Fee type added successfully'));
        res.redirect('/admin/fee-types');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការបន្ថែមប្រភេទថ្លៃសេវា', 'Error adding fee type'));
        res.redirect('/admin/fee-types');
    }
});

router.post('/fee-types/:id/edit', async (req, res) => {
    try {
        const { name_kh, name_en, amount, description } = req.body;
        await req.db.query(
            'UPDATE fee_types SET name_kh = ?, name_en = ?, amount = ?, description = ? WHERE id = ?',
            [name_kh, name_en || '', parseFloat(amount) || 0, description || '', req.params.id]
        );
        req.flash('success', t(req, 'បានកែសម្រួលប្រភេទថ្លៃសេវាដោយជោគជ័យ', 'Fee type updated successfully'));
        res.redirect('/admin/fee-types');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការកែសម្រួលប្រភេទថ្លៃសេវា', 'Error updating fee type'));
        res.redirect('/admin/fee-types');
    }
});

router.post('/fee-types/:id/toggle', async (req, res) => {
    try {
        await req.db.query('UPDATE fee_types SET is_active = NOT is_active WHERE id = ?', [req.params.id]);
        req.flash('success', t(req, 'បានកែសម្រួលស្ថានភាពប្រភេទថ្លៃសេវា', 'Fee type status updated'));
        res.redirect('/admin/fee-types');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការកែសម្រួលប្រភេទថ្លៃសេវា', 'Error updating fee type'));
        res.redirect('/admin/fee-types');
    }
});

router.post('/fee-types/:id/delete', async (req, res) => {
    try {
        const [rows] = await req.db.query('SELECT id, name_en FROM fee_types WHERE id = ?', [req.params.id]);
        if (!rows.length) {
            req.flash('error', t(req, 'រកមិនឃើញប្រភេទថ្លៃនេះ', 'Fee type not found'));
            return res.redirect('/admin/fee-types');
        }
        const inUse = await usageCounts(req.db, [
            ['payments', 'SELECT COUNT(*) c FROM payments WHERE fee_type_id = ?', [req.params.id]]
        ]);
        if (inUse.length) {
            req.flash('error', t(req,
                'មិនអាចលុបប្រភេទថ្លៃនេះបានទេ ព្រោះវាត្រូវបានប្រើនៅ៖ ' + inUse.join(', '),
                'Cannot delete this fee type: it is used by ' + inUse.join(', ')));
            return res.redirect('/admin/fee-types');
        }
        await req.db.query('DELETE FROM fee_types WHERE id = ?', [req.params.id]);
        req.flash('success', t(req, 'បានលុបប្រភេទថ្លៃសេវាដោយជោគជ័យ', 'Fee type deleted successfully'));
        res.redirect('/admin/fee-types');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មិនអាចលុបប្រភេទថ្លៃសេវាដែលកំពុងប្រើប្រាស់បានទេ', 'Cannot delete fee type that is being used'));
        res.redirect('/admin/fee-types');
    }
});

// ==================== ENROLLMENTS MANAGEMENT ====================

router.get('/enrollments', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;
        const { search, status, semester } = req.query;

        let query = `SELECT e.*, u.username, u.email, u.khmer_name, u.english_name, u.profile_pic,
            (SELECT COUNT(*) FROM payments WHERE enrollment_id = e.id AND status = 'verified') as verified_payments,
            (SELECT SUM(amount) FROM payments WHERE enrollment_id = e.id AND status = 'verified') as total_paid
            FROM enrollments e
            JOIN users u ON e.user_id = u.id
            WHERE 1=1`;
        let countQuery = `SELECT COUNT(*) as count FROM enrollments e JOIN users u ON e.user_id = u.id WHERE 1=1`;
        const params = [];
        const countParams = [];

        if (search) {
            const s = '%' + search + '%';
            const searchClause = ' AND (u.username LIKE ? OR u.email LIKE ? OR u.khmer_name LIKE ? OR u.english_name LIKE ?)';
            query += searchClause;
            countQuery += searchClause;
            params.push(s, s, s, s);
            countParams.push(s, s, s, s);
        }
        if (status) {
            query += ' AND e.status = ?';
            countQuery += ' AND e.status = ?';
            params.push(status);
            countParams.push(status);
        }
        if (semester) {
            query += ' AND e.semester = ?';
            countQuery += ' AND e.semester = ?';
            params.push(semester);
            countParams.push(semester);
        }

        const [countResult] = await req.db.query(countQuery, countParams);
        const totalRecords = countResult[0].count;
        const totalPages = Math.ceil(totalRecords / limit);

        query += ' ORDER BY e.enrolled_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        const [enrollments] = await req.db.query(query, params);

        const [stats] = await req.db.query(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) as approved,
                SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) as rejected
            FROM enrollments
        `);

        res.render('admin/enrollments', {
            title: 'Manage Enrollments',
            enrollments,
            stats: stats[0],
            currentPage: page,
            limit,
            totalPages,
            totalRecords,
            filters: req.query
        });
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការផ្ទុកព័ត៌មានចុះឈ្មោះ', 'Error loading enrollments'));
        res.redirect('/admin/dashboard');
    }
});

router.get('/enrollments/:id', async (req, res) => {
    try {
        const [rows] = await req.db.query(`
            SELECT e.*, u.username, u.email, u.khmer_name, u.english_name, u.phone as user_phone, u.profile_pic,
                m.name_kh as major_name_kh, m.name_en as major_name_en,
                sc.name_kh as category_name_kh, sc.name_en as category_name_en,
                st.name_kh as scholarship_name_kh, st.name_en as scholarship_name_en, st.coverage_percentage as scholarship_percentage,
                (SELECT SUM(amount) FROM payments WHERE enrollment_id = e.id AND status = 'verified') as total_paid
            FROM enrollments e
            JOIN users u ON e.user_id = u.id
            LEFT JOIN applications a ON e.application_id = a.id
            LEFT JOIN majors m ON a.major_first_choice_id = m.id
            LEFT JOIN scholarship_categories sc ON a.scholarship_category_id = sc.id
            LEFT JOIN scholarship_types st ON a.scholarship_type_id = st.id
            WHERE e.id = ?
        `, [req.params.id]);

        if (rows.length === 0) {
            req.flash('error', t(req, 'រកមិនឃើញព័ត៌មានចុះឈ្មោះ', 'Enrollment not found'));
            return res.redirect('/admin/enrollments');
        }

        const [payments] = await req.db.query(
            "SELECT p.*, ft.name_kh as fee_name_kh, ft.name_en as fee_name_en FROM payments p JOIN fee_types ft ON p.fee_type_id = ft.id WHERE p.enrollment_id = ? ORDER BY p.created_at DESC",
            [req.params.id]
        );

        res.render('admin/enrollment-detail', {
            title: 'Enrollment Detail',
            enrollment: rows[0],
            payments
        });
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការផ្ទុកព័ត៌មានចុះឈ្មោះ', 'Error loading enrollment'));
        res.redirect('/admin/enrollments');
    }
});

router.get('/enrollments/:id/print', async (req, res) => {
    try {
        if (flashValidationErrors(req, res, '/admin/dashboard')) return;
        if (flashValidationErrors(req, res, '/admin/provinces')) return;
        if (flashValidationErrors(req, res, '/admin/provinces')) return;
        if (flashValidationErrors(req, res, '/admin/majors')) return;
        if (flashValidationErrors(req, res, '/admin/majors')) return;
        if (flashValidationErrors(req, res, '/admin/applications/' + req.params.id)) return;
        if (flashValidationErrors(req, res, '/admin/applications/' + req.params.id)) return;
        if (flashValidationErrors(req, res, '/admin/applications/' + req.params.id)) return;
        // The reference print carries fields the enrollment row does not own (national ID,
        // nationality, exam date, study level/period/shift). Those live on the linked
        // scholarship application, which is the source of truth for them, so join it in
        // rather than re-collecting them on the enrollment form.
        const [rows] = await req.db.query(`
            SELECT e.*,
                a.national_id AS app_national_id,
                a.nationality AS app_nationality,
                a.exam_date AS app_exam_date,
                a.study_level AS app_study_level,
                a.study_period AS app_study_period,
                a.study_shift AS app_study_shift
            FROM enrollments e
            LEFT JOIN applications a ON a.id = e.application_id
            WHERE e.id = ?`, [req.params.id]);
        if (rows.length === 0) {
            req.flash('error', t(req, 'រកមិនឃើញព័ត៌មានចុះឈ្មោះ', 'Enrollment not found'));
            return res.redirect('/admin/enrollments');
        }
        const enrollment = rows[0];

        // Student number and registration number are printed by the reference but were
        // never collected by the form, so they are derived here and never trusted from
        // the client. The registration number is stable and human readable; the student
        // number is simply the enrollment id.
        const regYear = String(enrollment.academic_year || new Date().getFullYear()).slice(0, 4);
        const registrationNumber = 'NMU-' + regYear + '-' + String(enrollment.id).padStart(3, '0');
        const studentId = String(enrollment.id);

        // Flatten the application-owned values so the template can read them directly,
        // preferring the application and falling back to the enrollment/user copy.
        const application = {
            national_id: enrollment.app_national_id || null,
            nationality: enrollment.app_nationality || null,
            exam_date: enrollment.app_exam_date || null,
            study_level: enrollment.app_study_level || null,
            study_period: enrollment.app_study_period || null,
            study_shift: enrollment.app_study_shift || null
        };
        let major = null;
        if (enrollment.major_choice_id) {
            const [m] = await req.db.query('SELECT name_kh, name_en FROM majors WHERE id = ?', [enrollment.major_choice_id]);
            if (m.length > 0) major = m[0];
        } else if (enrollment.major_choice) {
            const [m] = await req.db.query('SELECT name_kh, name_en FROM majors WHERE name_kh = ? OR name_en = ? LIMIT 1', [enrollment.major_choice, enrollment.major_choice]);
            if (m.length > 0) major = m[0];
        }
        // Explicit columns: `SELECT *` pulled the password hash, OTP code and reset
        // token into the template scope of a printable letter.
        const [users] = await req.db.query(
            'SELECT id, email, khmer_name, english_name, national_id, gender, date_of_birth, place_of_birth, address, phone, profile_pic, username FROM users WHERE id = ?',
            [enrollment.user_id]
        );
        res.render('student/enroll-print', {
            title: 'Print Enrollment Letter',
            layout: false,
            enrollment,
            major,
            userData: users[0] || null,
            application,
            registrationNumber,
            studentId
        });
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការផ្ទុកព័ត៌មានចុះឈ្មោះ', 'Error loading enrollment'));
        res.redirect('/admin/enrollments');
    }
});

router.post('/enrollments/:id/approve',
    remarkRule('notes', 'Notes'),
    async (req, res) => {
    try {
        if (flashValidationErrors(req, res, '/admin/enrollments')) return;
        const [current] = await req.db.query(
            'SELECT e.status, e.user_id, u.email, u.khmer_name FROM enrollments e JOIN users u ON e.user_id = u.id WHERE e.id = ?',
            [req.params.id]
        );
        if (!current.length) {
            req.flash('error', t(req, 'រកមិនឃើញព័ត៌មានចុះឈ្មោះនេះ', 'Enrollment not found'));
            return res.redirect('/admin/enrollments');
        }
        const row = current[0];
        if (!canTransition(ENROLLMENT_TRANSITIONS, row.status, 'approved')) {
            req.flash('error', t(req, 'មិនអាចអនុម័តព័ត៌មានដែលស្ថានភាពជា ' + row.status + ' បានទេ', 'Cannot approve an enrollment with status ' + row.status));
            return res.redirect('/admin/enrollments');
        }
        const recipient = row.user_id ? { id: row.user_id, email: row.email, name: row.khmer_name } : null;

        await withTransaction(req.db, async (conn) => {
            await conn.query(
                "UPDATE enrollments SET status = 'approved', admin_notes = ? WHERE id = ?",
                [req.body.notes || '', req.params.id]
            );
            if (recipient) {
                await conn.query(
                    'INSERT INTO notifications (user_id, title, message, type, detail, link) VALUES (?, ?, ?, ?, ?, ?)',
                    [recipient.id, 'Enrollment Approved', 'Your enrollment has been approved.', 'enrollment_approval', req.body.notes ? 'Notes: ' + req.body.notes : null, '/student/enroll']
                );
            }
        });

        if (recipient) {
            await sendEmail(
                recipient.email,
                'Enrollment Approved - Scholarship Program',
                '<p>Dear <strong>' + escapeHtml(recipient.name || 'Student') + '</strong>,</p><p>Your enrollment has been approved.</p>' + (req.body.notes ? '<p><strong>Notes:</strong> ' + escapeHtml(req.body.notes) + '</p>' : '') + '<br><p>Best regards,<br>Scholarship Committee</p>'
            );
        }
        req.flash('success', t(req, 'ព័ត៌មានចុះឈ្មោះត្រូវបានអនុម័ត', 'Enrollment approved'));
        res.redirect('/admin/enrollments');
    } catch (err) {
        console.error('approve enrollment error:', err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការអនុម័តព័ត៌មានចុះឈ្មោះ', 'Error approving enrollment'));
        res.redirect('/admin/enrollments');
    }
});

router.post('/enrollments/:id/reject',
    remarkRule('notes', 'Reason'),
    async (req, res) => {
    try {
        if (flashValidationErrors(req, res, '/admin/enrollments')) return;
        const [current] = await req.db.query(
            'SELECT e.status, e.user_id, u.email, u.khmer_name FROM enrollments e JOIN users u ON e.user_id = u.id WHERE e.id = ?',
            [req.params.id]
        );
        if (!current.length) {
            req.flash('error', t(req, 'រកមិនឃើញព័ត៌មានចុះឈ្មោះនេះ', 'Enrollment not found'));
            return res.redirect('/admin/enrollments');
        }
        const row = current[0];
        if (!canTransition(ENROLLMENT_TRANSITIONS, row.status, 'rejected')) {
            req.flash('error', t(req, 'មិនអាចបដិសេធព័ត៌មានដែលស្ថានភាពជា ' + row.status + ' បានទេ', 'Cannot reject an enrollment with status ' + row.status));
            return res.redirect('/admin/enrollments');
        }
        const reason = req.body.notes || 'No reason provided';
        const recipient = row.user_id ? { id: row.user_id, email: row.email, name: row.khmer_name } : null;

        await withTransaction(req.db, async (conn) => {
            await conn.query(
                "UPDATE enrollments SET status = 'rejected', admin_notes = ? WHERE id = ?",
                [req.body.notes || '', req.params.id]
            );
            if (recipient) {
                await conn.query(
                    'INSERT INTO notifications (user_id, title, message, type, detail, link) VALUES (?, ?, ?, ?, ?, ?)',
                    [recipient.id, 'Enrollment Rejected', 'Your enrollment has been rejected.', 'enrollment_rejection', 'Reason: ' + reason, '/student/enroll']
                );
            }
        });

        if (recipient) {
            await sendEmail(
                recipient.email,
                'Enrollment Rejected - Scholarship Program',
                '<p>Dear <strong>' + escapeHtml(recipient.name || 'Student') + '</strong>,</p><p>We regret to inform you that your enrollment has been rejected.</p><p><strong>Reason:</strong> ' + escapeHtml(reason) + '</p><br><p>Best regards,<br>Scholarship Committee</p>'
            );
        }
        req.flash('success', t(req, 'ព័ត៌មានចុះឈ្មោះត្រូវបានបដិសេធ', 'Enrollment rejected'));
        res.redirect('/admin/enrollments');
    } catch (err) {
        console.error('reject enrollment error:', err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការបដិសេព័ត៌មានចុះឈ្មោះ', 'Error rejecting enrollment'));
        res.redirect('/admin/enrollments');
    }
});

// ==================== PAYMENTS MANAGEMENT ====================

router.get('/payments', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;
        const { search, status } = req.query;

        let query = `SELECT p.*, u.username, u.khmer_name, u.english_name, u.profile_pic, u.email, ft.name_kh as fee_name_kh, ft.name_en as fee_name_en,
            e.academic_year, e.semester,
            bk.name_kh as bank_name_kh, bk.name_en as bank_name_en, bk.account_number as bank_account_number
            FROM payments p
            JOIN users u ON p.user_id = u.id
            JOIN fee_types ft ON p.fee_type_id = ft.id
            JOIN enrollments e ON p.enrollment_id = e.id
            LEFT JOIN payment_banks bk ON bk.id = p.bank_id
            WHERE 1=1`;
        let countQuery = `SELECT COUNT(*) as count FROM payments p
            JOIN users u ON p.user_id = u.id
            JOIN fee_types ft ON p.fee_type_id = ft.id
            JOIN enrollments e ON p.enrollment_id = e.id WHERE 1=1`;
        const params = [];
        const countParams = [];

        if (search) {
            const s = '%' + search + '%';
            const searchClause = ' AND (u.username LIKE ? OR u.khmer_name LIKE ? OR u.english_name LIKE ? OR p.transaction_ref LIKE ? OR ft.name_kh LIKE ?)';
            query += searchClause;
            countQuery += searchClause;
            params.push(s, s, s, s, s);
            countParams.push(s, s, s, s, s);
        }
        if (status) {
            query += ' AND p.status = ?';
            countQuery += ' AND p.status = ?';
            params.push(status);
            countParams.push(status);
        }

        const [countResult] = await req.db.query(countQuery, countParams);
        const totalRecords = countResult[0].count;
        const totalPages = Math.ceil(totalRecords / limit);

        query += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        const [payments] = await req.db.query(query, params);

        const [stats] = await req.db.query(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status='verified' THEN 1 ELSE 0 END) as verified,
                SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) as rejected,
                SUM(CASE WHEN status='verified' THEN amount ELSE 0 END) as total_verified
            FROM payments
        `);

        res.render('admin/payments', {
            title: 'Manage Payments',
            payments,
            stats: stats[0],
            currentPage: page,
            limit,
            totalPages,
            totalRecords,
            filters: req.query
        });
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការផ្ទុកព័ត៌មានការទូទាត់', 'Error loading payments'));
        res.redirect('/admin/dashboard');
    }
});

router.post('/payments/:id/verify',
    remarkRule('notes', 'Notes'),
    async (req, res) => {
    try {
        if (flashValidationErrors(req, res, '/admin/payments')) return;
        const [rows] = await req.db.query(
            'SELECT p.id, p.status, p.user_id, u.email, u.khmer_name FROM payments p JOIN users u ON u.id = p.user_id WHERE p.id = ?',
            [req.params.id]
        );
        if (!rows.length) {
            req.flash('error', t(req, 'រកមិនឃើញការទូទាត់នេះ', 'Payment not found'));
            return res.redirect('/admin/payments');
        }
        const row = rows[0];
        if (!canTransition(PAYMENT_TRANSITIONS, row.status, 'verified')) {
            req.flash('error', t(req, 'មិនអាចផ្ទៀងផ្ទាត់ការទូទាត់ដែលស្ថានភាពជា ' + row.status + ' បានទេ', 'Cannot verify a payment with status ' + row.status));
            return res.redirect('/admin/payments');
        }
        await withTransaction(req.db, async (conn) => {
            await conn.query(
                "UPDATE payments SET status = 'verified', verified_by = ?, verified_at = NOW(), admin_notes = ? WHERE id = ?",
                [req.session.user.id, req.body.notes || '', req.params.id]
            );
            await conn.query(
                'INSERT INTO notifications (user_id, title, message, type, detail, link) VALUES (?, ?, ?, ?, ?, ?)',
                [row.user_id, 'Payment Verified', 'Your payment has been verified.', 'payment_verified', req.body.notes ? 'Notes: ' + req.body.notes : null, '/student/payments']
            );
        });
        await sendEmail(
            row.email,
            'Payment Verified - Scholarship Program',
            '<p>Dear <strong>' + escapeHtml(row.khmer_name || 'Student') + '</strong>,</p><p>Your payment has been verified.</p><br><p>Best regards,<br>Scholarship Committee</p>'
        );
        req.flash('success', t(req, 'ព័ត៌មានការទូទាត់ត្រូវបានផ្ទៀងផ្ទាត់', 'Payment verified'));
        res.redirect('/admin/payments');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការផ្ទៀងផ្ទាត់ការទូទាត់', 'Error verifying payment'));
        res.redirect('/admin/payments');
    }
});

router.post('/payments/:id/reject',
    remarkRule('notes', 'Reason'),
    async (req, res) => {
    try {
        if (flashValidationErrors(req, res, '/admin/payments')) return;
        const [rows] = await req.db.query(
            'SELECT p.id, p.status, p.user_id, u.email, u.khmer_name FROM payments p JOIN users u ON u.id = p.user_id WHERE p.id = ?',
            [req.params.id]
        );
        if (!rows.length) {
            req.flash('error', t(req, 'រកមិនឃើញការទូទាត់នេះ', 'Payment not found'));
            return res.redirect('/admin/payments');
        }
        const row = rows[0];
        if (!canTransition(PAYMENT_TRANSITIONS, row.status, 'rejected')) {
            req.flash('error', t(req, 'មិនអាចបដិសេធការទូទាត់ដែលស្ថានភាពជា ' + row.status + ' បានទេ', 'Cannot reject a payment with status ' + row.status));
            return res.redirect('/admin/payments');
        }
        const paymentReason = req.body.notes || 'No reason provided';
        await withTransaction(req.db, async (conn) => {
            await conn.query(
                "UPDATE payments SET status = 'rejected', verified_by = ?, verified_at = NOW(), admin_notes = ? WHERE id = ?",
                [req.session.user.id, req.body.notes || '', req.params.id]
            );
            await conn.query(
                'INSERT INTO notifications (user_id, title, message, type, detail, link) VALUES (?, ?, ?, ?, ?, ?)',
                [row.user_id, 'Payment Rejected', 'Your payment has been rejected.', 'payment_rejected', 'Reason: ' + paymentReason, '/student/payments']
            );
        });
        await sendEmail(
            row.email,
            'Payment Rejected - Scholarship Program',
            '<p>Dear <strong>' + escapeHtml(row.khmer_name || 'Student') + '</strong>,</p><p>We regret to inform you that your payment has been rejected.</p><p><strong>Reason:</strong> ' + escapeHtml(paymentReason) + '</p><br><p>Best regards,<br>Scholarship Committee</p>'
        );
        req.flash('success', t(req, 'ព័ត៌មានការទូទាត់ត្រូវបានបដិសេធ', 'Payment rejected'));
        res.redirect('/admin/payments');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការបដិសេការទូទាត់', 'Error rejecting payment'));
        res.redirect('/admin/payments');
    }
});

// ==================== MAJOR TUITION MANAGEMENT ====================

router.get('/major-tuition', async (req, res) => {
    try {
        const [tuitionList] = await req.db.query(
            `SELECT mt.*, m.name_kh as major_name_kh, m.name_en as major_name_en, m.faculty_kh, m.faculty_en
             FROM major_tuition mt
             JOIN majors m ON mt.major_id = m.id
             ORDER BY m.name_kh ASC, mt.academic_year DESC`
        );
        const [majors] = await req.db.query('SELECT * FROM majors WHERE is_active = 1 ORDER BY name_kh ASC');
        const [academicYears] = await req.db.query('SELECT DISTINCT academic_year FROM major_tuition ORDER BY academic_year DESC');
        res.render('admin/major-tuition', {
            title: 'Major Tuition',
            tuitionList,
            majors,
            academicYears: academicYears.map(r => r.academic_year)
        });
    } catch (err) {
        console.error('Major tuition page error:', err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការផ្ទុកថ្លៃសិក្សាជំនាញ', 'Error loading major tuition'));
        res.redirect('/admin/dashboard');
    }
});

router.post('/major-tuition', async (req, res) => {
    try {
        const { major_id, academic_year, tuition_per_year } = req.body;
        const [existing] = await req.db.query(
            'SELECT id FROM major_tuition WHERE major_id = ? AND academic_year = ?',
            [major_id, academic_year]
        );
        if (existing.length > 0) {
            req.flash('error', t(req, 'ថ្លៃសិក្សាសម្រាប់ជំនាញនិងឆ្នាំនេះមានរួចហើយ', 'Tuition for this major and year already exists'));
            return res.redirect('/admin/major-tuition');
        }
        await req.db.query(
            'INSERT INTO major_tuition (major_id, academic_year, tuition_per_year) VALUES (?, ?, ?)',
            [major_id, academic_year, parseFloat(tuition_per_year) || 0]
        );
        req.flash('success', t(req, 'បានបន្ថែមថ្លៃសិក្សាជំនាញដោយជោគជ័យ', 'Major tuition added successfully'));
        res.redirect('/admin/major-tuition');
    } catch (err) {
        console.error('Add major tuition error:', err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការបន្ថែមថ្លៃសិក្សាជំនាញ', 'Error adding major tuition'));
        res.redirect('/admin/major-tuition');
    }
});

router.post('/major-tuition/:id/edit', async (req, res) => {
    try {
        const { tuition_per_year } = req.body;
        await req.db.query(
            'UPDATE major_tuition SET tuition_per_year = ? WHERE id = ?',
            [parseFloat(tuition_per_year) || 0, req.params.id]
        );
        req.flash('success', t(req, 'បានកែសម្រួលថ្លៃសិក្សាជំនាញដោយជោគជ័យ', 'Major tuition updated successfully'));
        res.redirect('/admin/major-tuition');
    } catch (err) {
        console.error('Edit major tuition error:', err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការកែសម្រួលថ្លៃសិក្សាជំនាញ', 'Error updating major tuition'));
        res.redirect('/admin/major-tuition');
    }
});

router.post('/major-tuition/:id/toggle', async (req, res) => {
    try {
        await req.db.query('UPDATE major_tuition SET is_active = NOT is_active WHERE id = ?', [req.params.id]);
        req.flash('success', t(req, 'បានកែសម្រួលស្ថានភាពថ្លៃសិក្សាជំនាញ', 'Major tuition status updated'));
        res.redirect('/admin/major-tuition');
    } catch (err) {
        console.error('Toggle major tuition error:', err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការកែសម្រួលស្ថានភាព', 'Error updating status'));
        res.redirect('/admin/major-tuition');
    }
});

router.post('/major-tuition/:id/delete', async (req, res) => {
    try {
        const [rows] = await req.db.query('SELECT id, major_id, academic_year FROM major_tuition WHERE id = ?', [req.params.id]);
        if (!rows.length) {
            req.flash('error', t(req, 'រកមិនឃើញកំណត់ថ្លៃសិក្សានេះ', 'Tuition record not found'));
            return res.redirect('/admin/major-tuition');
        }
        // major_tuition is a leaf table: nothing references it, so existence is all that
        // needs checking before the delete.
        await req.db.query('DELETE FROM major_tuition WHERE id = ?', [req.params.id]);
        req.flash('success', t(req, 'បានលុបថ្លៃសិក្សាជំនាញដោយជោគជ័យ', 'Major tuition deleted successfully'));
        res.redirect('/admin/major-tuition');
    } catch (err) {
        console.error('Delete major tuition error:', err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការលុបថ្លៃសិក្សាជំនាញ', 'Error deleting major tuition'));
        res.redirect('/admin/major-tuition');
    }
});

module.exports = router;
