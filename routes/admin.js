const express = require('express');
const router = express.Router();
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');

function t(req, km, en) {
  return req.session.lang === 'km' ? km : en;
}
const { sendEmail } = require('../config/mailer');

router.use(isAuthenticated, isAdmin);

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
        res.redirect('/');
    }
});

router.get('/applications', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;
        const { search, status, major, category, province, gender, dateFrom, dateTo } = req.query;
        let query = `SELECT a.*, m.name_kh as major_name_kh, m.name_en as major_name_en,
            c.name_kh as category_name_kh, c.name_en as category_name_en,
            p.name_kh as province_name_kh, p.name_en as province_name_en,
            u.english_name as student_name
            FROM applications a
            LEFT JOIN majors m ON a.major_first_choice_id = m.id
            LEFT JOIN scholarship_categories c ON a.scholarship_category_id = c.id
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
             u.english_name as student_name, u.khmer_name as student_khmer_name, u.email as user_email
             FROM applications a
             LEFT JOIN majors m ON a.major_first_choice_id = m.id
             LEFT JOIN majors m2 ON a.major_second_choice_id = m2.id
             LEFT JOIN scholarship_categories c ON a.scholarship_category_id = c.id
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

router.post('/applications/:id/under-review', async (req, res) => {
    try {
        const [current] = await req.db.query('SELECT a.status, a.user_id, u.email, u.khmer_name FROM applications a JOIN users u ON a.user_id = u.id WHERE a.id = ?', [req.params.id]);
        await req.db.query("UPDATE applications SET status = 'under_review' WHERE id = ?", [req.params.id]);
        await req.db.query(
            'INSERT INTO application_status_history (application_id, old_status, new_status, changed_by, notes) VALUES (?, ?, ?, ?, ?)',
            [req.params.id, current[0]?.status, 'under_review', req.session.user.id, 'Application under review']
        );
        if (current[0]?.user_id) {
            await req.db.query(
                'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)',
                [current[0].user_id, 'Application Under Review', 'Your application is now under review.', 'status']
            );
            await sendEmail(
                current[0].email,
                'Application Under Review - Scholarship Program',
                '<p>Dear <strong>' + (current[0].khmer_name || 'Student') + '</strong>,</p><p>Your scholarship application is now under review. We will notify you once a decision has been made.</p><br><p>Best regards,<br>Scholarship Committee</p>'
            );
        }
        req.flash('success', t(req, 'ពាក្យសុំត្រូវបានកំណត់ជាកំពុងពិនិត្យ', 'Application marked as under review'));
        res.redirect('/admin/applications/' + req.params.id);
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/applications/' + req.params.id);
    }
});

router.post('/applications/:id/approve', async (req, res) => {
    try {
        const { admin_remark, exam_date, exam_time, exam_venue } = req.body;
        const [current] = await req.db.query('SELECT a.status, a.user_id, u.email, u.khmer_name FROM applications a JOIN users u ON a.user_id = u.id WHERE a.id = ?', [req.params.id]);
        await req.db.query("UPDATE applications SET status = 'approved', admin_remark = ?, exam_date = ?, exam_time = ?, exam_venue = ? WHERE id = ?", [admin_remark, exam_date || null, exam_time || null, exam_venue || null, req.params.id]);
        await req.db.query(
            'INSERT INTO application_status_history (application_id, old_status, new_status, changed_by, notes) VALUES (?, ?, ?, ?, ?)',
            [req.params.id, current[0]?.status, 'approved', req.session.user.id, admin_remark]
        );
        if (current[0]?.user_id) {
            let notificationMessage = 'Congratulations! Your application has been approved.';
            if (exam_date || exam_time || exam_venue) {
                notificationMessage += '\n\nExam Details:';
                if (exam_date) notificationMessage += '\nDate: ' + exam_date;
                if (exam_time) notificationMessage += '\nTime: ' + exam_time;
                if (exam_venue) notificationMessage += '\nVenue: ' + exam_venue;
            }
            await req.db.query(
                'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)',
                [current[0].user_id, 'Application Approved', notificationMessage, 'approval']
            );
            let examHtml = '';
            if (exam_date || exam_time || exam_venue) {
                examHtml = '<h3>Exam Details</h3><table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;margin-top:10px">';
                if (exam_date) examHtml += '<tr><td><strong>Date</strong></td><td>' + exam_date + '</td></tr>';
                if (exam_time) examHtml += '<tr><td><strong>Time</strong></td><td>' + exam_time + '</td></tr>';
                if (exam_venue) examHtml += '<tr><td><strong>Venue</strong></td><td>' + exam_venue + '</td></tr>';
                examHtml += '</table>';
            }
            await sendEmail(
                current[0].email,
                'Application Approved - Scholarship Program',
                '<p>Dear <strong>' + (current[0].khmer_name || 'Student') + '</strong>,</p><p>Congratulations! Your scholarship application has been approved.</p>' + examHtml + '<br><p>Best regards,<br>Scholarship Committee</p>'
            );
        }
        req.flash('success', t(req, 'ពាក្យសុំត្រូវបានអនុម័តដោយជោគជ័យ', 'Application approved successfully'));
        res.redirect('/admin/applications/' + req.params.id);
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/applications/' + req.params.id);
    }
});

router.post('/applications/:id/reject', async (req, res) => {
    try {
        const { admin_remark } = req.body;
        const [current] = await req.db.query('SELECT a.status, a.user_id, u.email, u.khmer_name FROM applications a JOIN users u ON a.user_id = u.id WHERE a.id = ?', [req.params.id]);
        await req.db.query("UPDATE applications SET status = 'rejected', admin_remark = ? WHERE id = ?", [admin_remark, req.params.id]);
        await req.db.query(
            'INSERT INTO application_status_history (application_id, old_status, new_status, changed_by, notes) VALUES (?, ?, ?, ?, ?)',
            [req.params.id, current[0]?.status, 'rejected', req.session.user.id, admin_remark]
        );
        if (current[0]?.user_id) {
            await req.db.query(
                'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)',
                [current[0].user_id, 'Application Rejected', 'Your application has been rejected. Reason: ' + (admin_remark || 'No reason provided'), 'rejection']
            );
            await sendEmail(
                current[0].email,
                'Application Rejected - Scholarship Program',
                '<p>Dear <strong>' + (current[0].khmer_name || 'Student') + '</strong>,</p><p>We regret to inform you that your scholarship application has been rejected.</p><p><strong>Reason:</strong> ' + (admin_remark || 'No reason provided') + '</p><br><p>Best regards,<br>Scholarship Committee</p>'
            );
        }
        req.flash('success', t(req, 'ពាក្យសុំត្រូវបានបដិសេធ', 'Application rejected'));
        res.redirect('/admin/applications/' + req.params.id);
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/applications/' + req.params.id);
    }
});

router.post('/applications/:id/correction', async (req, res) => {
    try {
        const { correction_notes } = req.body;
        const [current] = await req.db.query('SELECT a.status, a.user_id, u.email, u.khmer_name FROM applications a JOIN users u ON a.user_id = u.id WHERE a.id = ?', [req.params.id]);
        await req.db.query("UPDATE applications SET status = 'correction_requested', correction_notes = ? WHERE id = ?", [correction_notes, req.params.id]);
        await req.db.query(
            'INSERT INTO application_status_history (application_id, old_status, new_status, changed_by, notes) VALUES (?, ?, ?, ?, ?)',
            [req.params.id, current[0]?.status, 'correction_requested', req.session.user.id, correction_notes]
        );
        if (current[0]?.user_id) {
            await req.db.query(
                'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)',
                [current[0].user_id, 'Correction Requested', 'Your application requires corrections. Please review the notes and resubmit. Notes: ' + (correction_notes || 'No specific notes'), 'correction']
            );
            await sendEmail(
                current[0].email,
                'Correction Requested - Scholarship Application',
                '<p>Dear <strong>' + (current[0].khmer_name || 'Student') + '</strong>,</p><p>Your scholarship application requires corrections. Please log in and review the notes below, then resubmit your application.</p><p><strong>Correction Notes:</strong> ' + (correction_notes || 'No specific notes') + '</p><br><p>Best regards,<br>Scholarship Committee</p>'
            );
        }
        req.flash('success', t(req, 'បានស្នើសុំការកែប្រែ', 'Correction requested'));
        res.redirect('/admin/applications/' + req.params.id);
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/applications/' + req.params.id);
    }
});

router.get('/majors', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;
        const { search } = req.query;

        let query = 'SELECT * FROM majors WHERE 1=1';
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

        res.render('admin/majors', { title: 'Manage Majors', majors, currentPage: page, totalPages, totalRecords, filters: req.query });
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/dashboard');
    }
});

router.post('/majors', async (req, res) => {
    try {
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

router.post('/majors/:id/edit', async (req, res) => {
    try {
        const { name_kh, name_en, faculty_kh, faculty_en } = req.body;
        await req.db.query('UPDATE majors SET name_kh = ?, name_en = ?, faculty_kh = ?, faculty_en = ? WHERE id = ?', [name_kh, name_en, faculty_kh, faculty_en, req.params.id]);
        req.flash('success', t(req, 'បានកែប្រែជំនាញដោយជោគជ័យ', 'Major updated successfully'));
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
        req.flash('success', t(req, 'បានកែប្រែស្ថានភាពជំនាញ', 'Major status updated'));
        res.redirect('/admin/majors');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/majors');
    }
});

router.post('/majors/:id/delete', async (req, res) => {
    try {
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

        res.render('admin/provinces', { title: 'Manage Provinces', provinces, currentPage: page, totalPages, totalRecords, filters: req.query });
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/dashboard');
    }
});

router.post('/provinces', async (req, res) => {
    try {
        const { name_kh, name_en } = req.body;
        await req.db.query('INSERT INTO provinces (name_kh, name_en) VALUES (?, ?)', [name_kh, name_en]);
        req.flash('success', t(req, 'បានបន្ថែមខេត្តដោយជោគជ័យ', 'Province added successfully'));
        res.redirect('/admin/provinces');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/provinces');
    }
});

router.post('/provinces/:id/edit', async (req, res) => {
    try {
        const { name_kh, name_en } = req.body;
        await req.db.query('UPDATE provinces SET name_kh = ?, name_en = ? WHERE id = ?', [name_kh, name_en, req.params.id]);
        req.flash('success', t(req, 'បានកែប្រែខេត្តដោយជោគជ័យ', 'Province updated successfully'));
        res.redirect('/admin/provinces');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/provinces');
    }
});

router.post('/provinces/:id/delete', async (req, res) => {
    try {
        await req.db.query('DELETE FROM provinces WHERE id = ?', [req.params.id]);
        req.flash('success', t(req, 'បានលុបខេត្តដោយជោគជ័យ', 'Province deleted successfully'));
        res.redirect('/admin/provinces');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មិនអាចលុបខេត្តដែលកំពុងប្រើប្រាស់បានទេ', 'Cannot delete province that is being used'));
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

        res.render('admin/users', {
            title: 'Manage Users',
            users,
            currentPage: page,
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

router.post('/users/:id/reset-password', async (req, res) => {
    try {
        const bcrypt = require('bcryptjs');
        const crypto = require('crypto');
        const newPassword = crypto.randomBytes(8).toString('hex');
        const hashedPassword = await bcrypt.hash(newPassword, 12);
        await req.db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.params.id]);
        req.flash('success', t(req, 'ពាក្យសម្ងាត់បានកំណត់ឡើងវិញ។ ពាក្យសម្ងាត់ថ្មី៖ ' + newPassword, 'Password has been reset. New password: ' + newPassword));
        res.redirect('/admin/users');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/users');
    }
});

router.post('/users/:id/delete', async (req, res) => {
    try {
        const [user] = await req.db.query('SELECT role FROM users WHERE id = ?', [req.params.id]);
        if (user[0] && user[0].role === 'admin') {
            req.flash('error', t(req, 'មិនអាចលុបអ្នកគ្រប់គ្រងបានទេ', 'Cannot delete admin user'));
            return res.redirect('/admin/users');
        }
        await req.db.query('DELETE FROM users WHERE id = ?', [req.params.id]);
        req.flash('success', t(req, 'បានលុបអ្នកប្រើប្រាស់ដោយជោគជ័យ', 'User deleted successfully'));
        res.redirect('/admin/users');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/users');
    }
});

router.get('/reports', async (req, res) => {
    try {
        const [total] = await req.db.query('SELECT COUNT(*) as count FROM applications');
        const [byMajor] = await req.db.query(
            `SELECT m.name_kh, m.name_en, COUNT(a.id) as count
             FROM applications a LEFT JOIN majors m ON a.major_first_choice_id = m.id
             GROUP BY a.major_first_choice_id`
        );
        const [byCategory] = await req.db.query(
            `SELECT c.name_kh, c.name_en, COUNT(a.id) as count
             FROM applications a LEFT JOIN scholarship_categories c ON a.scholarship_category_id = c.id
             GROUP BY a.scholarship_category_id`
        );
        const [byProvince] = await req.db.query(
            `SELECT p.name_kh, p.name_en, COUNT(a.id) as count
             FROM applications a LEFT JOIN provinces p ON a.school_province_id = p.id
             GROUP BY a.school_province_id`
        );
        const [byGender] = await req.db.query('SELECT gender, COUNT(*) as count FROM applications GROUP BY gender');
        const [byStatus] = await req.db.query('SELECT status, COUNT(*) as count FROM applications GROUP BY status');
        res.render('admin/reports', {
            title: 'Reports',
            total: total[0].count,
            byMajor,
            byCategory,
            byProvince,
            byGender,
            byStatus
        });
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/dashboard');
    }
});

router.get('/reports/export/excel', async (req, res) => {
    try {
        const [applications] = await req.db.query(
            `SELECT a.id, a.english_first_name, a.english_last_name, a.khmer_first_name, a.khmer_last_name,
             a.gender, a.email, a.phone, m.name_en as major, c.name_en as category, a.status, a.submitted_at
             FROM applications a
             LEFT JOIN majors m ON a.major_first_choice_id = m.id
             LEFT JOIN scholarship_categories c ON a.scholarship_category_id = c.id
             ORDER BY a.submitted_at DESC`
        );
        const data = applications.map(a => ({
            ID: a.id,
            'English First Name': a.english_first_name,
            'English Last Name': a.english_last_name,
            'Khmer First Name': a.khmer_first_name,
            'Khmer Last Name': a.khmer_last_name,
            Gender: a.gender,
            Email: a.email,
            Phone: a.phone,
            Major: a.major || '',
            Category: a.category || '',
            Status: a.status,
            'Submitted Date': a.submitted_at
        }));
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, 'Applications');
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

router.get('/reports/export/pdf', async (req, res) => {
    try {
        const [applications] = await req.db.query(
            `SELECT a.id, a.english_first_name, a.english_last_name, a.gender,
             m.name_en as major, c.name_en as category, a.status, a.submitted_at
             FROM applications a
             LEFT JOIN majors m ON a.major_first_choice_id = m.id
             LEFT JOIN scholarship_categories c ON a.scholarship_category_id = c.id
             ORDER BY a.submitted_at DESC`
        );
        const [stats] = await req.db.query('SELECT status, COUNT(*) as count FROM applications GROUP BY status');
        const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
        res.setHeader('Content-Disposition', 'inline; filename=applications.pdf');
        res.setHeader('Content-Type', 'application/pdf');
        doc.pipe(res);
        doc.fontSize(20).text('Scholarship Applications Report', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Total Applications: ${applications.length}`);
        doc.moveDown(0.5);
        stats.forEach(s => {
            doc.text(`${s.status}: ${s.count}`);
        });
        doc.moveDown();
        doc.fontSize(14).text('Application List', { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(8);
        const headers = ['ID', 'Name', 'Major', 'Category', 'Status', 'Date'];
        const colWidths = [30, 150, 120, 100, 80, 100];
        let y = doc.y;
        let x = 30;
        headers.forEach((h, i) => {
            doc.font('Helvetica-Bold').text(h, x, y, { width: colWidths[i], align: 'left' });
            x += colWidths[i];
        });
        doc.moveDown(0.5);
        y = doc.y;
        applications.forEach(a => {
            if (y > 500) {
                doc.addPage();
                y = 30;
            }
            x = 30;
            const rowData = [a.id, `${a.english_first_name} ${a.english_last_name}`, a.major || '', a.category || '', a.status, new Date(a.submitted_at).toLocaleDateString()];
            doc.font('Helvetica');
            rowData.forEach((d, i) => {
                doc.text(String(d).substring(0, 25), x, y, { width: colWidths[i], align: 'left' });
                x += colWidths[i];
            });
            y += 15;
        });
        doc.end();
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការនាំចេញ', 'Export error'));
        res.redirect('/admin/reports');
    }
});

router.post('/notifications/send', async (req, res) => {
    try {
        const { exam_date, exam_time, exam_venue, message } = req.body;
        const [approved] = await req.db.query("SELECT user_id FROM applications WHERE status = 'approved'");
        let notificationMessage = 'Exam Notification Details:\n';
        if (exam_date) notificationMessage += 'Date: ' + exam_date + '\n';
        if (exam_time) notificationMessage += 'Time: ' + exam_time + '\n';
        if (exam_venue) notificationMessage += 'Venue: ' + exam_venue + '\n';
        if (message) notificationMessage += '\n' + message;
        for (const app of approved) {
            if (app.user_id) {
                await req.db.query('INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)', [app.user_id, 'Exam Schedule Notification', notificationMessage, 'exam_notification']);
            }
        }
        req.flash('success', t(req, `បានផ្ញើសារជូនដំណឹងដល់ ${approved.length} អ្នកដាក់ពាក្យដែលបានអនុម័ត`, `Notification sent to ${approved.length} approved applicants`));
        res.redirect('/admin/dashboard');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/dashboard');
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

router.post('/settings', async (req, res) => {
    try {
        const { enrollment_open, enrollment_start, enrollment_end, scholarship_open, scholarship_start, scholarship_end } = req.body;

        const [rows] = await req.db.query('SELECT setting_key, setting_value FROM settings');
        const current = {};
        rows.forEach(row => { current[row.setting_key] = row.setting_value; });

        const enrollOpen = enrollment_open !== undefined
            ? (Array.isArray(enrollment_open) ? enrollment_open[enrollment_open.length - 1] : enrollment_open)
            : current.enrollment_open || '0';
        const scholOpen = scholarship_open !== undefined
            ? (Array.isArray(scholarship_open) ? scholarship_open[scholarship_open.length - 1] : scholarship_open)
            : current.scholarship_open || '0';

        await req.db.query('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [enrollOpen, 'enrollment_open']);
        await req.db.query('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [enrollment_start !== undefined ? enrollment_start : (current.enrollment_start || ''), 'enrollment_start']);
        await req.db.query('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [enrollment_end !== undefined ? enrollment_end : (current.enrollment_end || ''), 'enrollment_end']);
        await req.db.query('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [scholOpen, 'scholarship_open']);
        await req.db.query('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [scholarship_start !== undefined ? scholarship_start : (current.scholarship_start || ''), 'scholarship_start']);
        await req.db.query('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [scholarship_end !== undefined ? scholarship_end : (current.scholarship_end || ''), 'scholarship_end']);

        req.flash('success', t(req, 'បានកែប្រែការកំណត់ដោយជោគជ័យ', 'Settings updated successfully'));
        res.redirect('/admin/settings');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/settings');
    }
});

// ─── Scholarship Types CRUD ────────────────────────────────────────────────────

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

        res.render('admin/scholarship-types', {
            title: 'Manage Scholarship Types',
            types,
            currentPage: page,
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

router.post('/scholarship-types', async (req, res) => {
    try {
        const { name_kh, name_en, coverage_percentage, duration_years, provider_name, description } = req.body;
        await req.db.query(
            'INSERT INTO scholarship_types (name_kh, name_en, coverage_percentage, duration_years, provider_name, description) VALUES (?, ?, ?, ?, ?, ?)',
            [name_kh, name_en || '', parseInt(coverage_percentage) || 0, parseInt(duration_years) || 1, provider_name, description || '']
        );
        req.flash('success', t(req, 'បានបន្ថែមប្រភេទអាហារូបករណ៍ដោយជោគជ័យ', 'Scholarship type added successfully'));
        res.redirect('/admin/scholarship-types');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/scholarship-types');
    }
});

router.post('/scholarship-types/:id/edit', async (req, res) => {
    try {
        const { name_kh, name_en, coverage_percentage, duration_years, provider_name, description } = req.body;
        await req.db.query(
            'UPDATE scholarship_types SET name_kh = ?, name_en = ?, coverage_percentage = ?, duration_years = ?, provider_name = ?, description = ? WHERE id = ?',
            [name_kh, name_en || '', parseInt(coverage_percentage) || 0, parseInt(duration_years) || 1, provider_name, description || '', req.params.id]
        );
        req.flash('success', t(req, 'បានកែប្រែប្រភេទអាហារូបករណ៍ដោយជោគជ័យ', 'Scholarship type updated successfully'));
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
        req.flash('success', t(req, 'បានកែប្រែស្ថានភាពប្រភេទអាហារូបករណ៍', 'Scholarship type status updated'));
        res.redirect('/admin/scholarship-types');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/admin/scholarship-types');
    }
});

router.post('/scholarship-types/:id/delete', async (req, res) => {
    try {
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
            totalPages,
            totalRecords,
            filters: req.query
        });
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការផ្ទុកប្រភេទថ្លៃ', 'Error loading fee types'));
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
        req.flash('success', t(req, 'បានបន្ថែមប្រភេទថ្លៃដោយជោគជ័យ', 'Fee type added successfully'));
        res.redirect('/admin/fee-types');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការបន្ថែមប្រភេទថ្លៃ', 'Error adding fee type'));
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
        req.flash('success', t(req, 'បានកែប្រែប្រភេទថ្លៃដោយជោគជ័យ', 'Fee type updated successfully'));
        res.redirect('/admin/fee-types');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការកែប្រែប្រភេទថ្លៃ', 'Error updating fee type'));
        res.redirect('/admin/fee-types');
    }
});

router.post('/fee-types/:id/toggle', async (req, res) => {
    try {
        await req.db.query('UPDATE fee_types SET is_active = NOT is_active WHERE id = ?', [req.params.id]);
        req.flash('success', t(req, 'បានកែប្រែស្ថានភាពប្រភេទថ្លៃ', 'Fee type status updated'));
        res.redirect('/admin/fee-types');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការកែប្រែប្រភេទថ្លៃ', 'Error updating fee type'));
        res.redirect('/admin/fee-types');
    }
});

router.post('/fee-types/:id/delete', async (req, res) => {
    try {
        await req.db.query('DELETE FROM fee_types WHERE id = ?', [req.params.id]);
        req.flash('success', t(req, 'បានលុបប្រភេទថ្លៃដោយជោគជ័យ', 'Fee type deleted successfully'));
        res.redirect('/admin/fee-types');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មិនអាចលុបប្រភេទថ្លៃដែលកំពុងប្រើប្រាស់បានទេ', 'Cannot delete fee type that is being used'));
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
            totalPages,
            totalRecords,
            filters: req.query
        });
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការផ្ទុកការចុះឈ្មោះ', 'Error loading enrollments'));
        res.redirect('/admin/dashboard');
    }
});

router.get('/enrollments/:id', async (req, res) => {
    try {
        const [rows] = await req.db.query(`
            SELECT e.*, u.username, u.email, u.khmer_name, u.english_name, u.phone, u.profile_pic,
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
            req.flash('error', t(req, 'រកមិនឃើញការចុះឈ្មោះ', 'Enrollment not found'));
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
        req.flash('error', t(req, 'មានកំហុសក្នុងការផ្ទុកការចុះឈ្មោះ', 'Error loading enrollment'));
        res.redirect('/admin/enrollments');
    }
});

router.post('/enrollments/:id/approve', async (req, res) => {
    try {
        await req.db.query(
            "UPDATE enrollments SET status = 'approved', admin_notes = ? WHERE id = ?",
            [req.body.notes || '', req.params.id]
        );
        req.flash('success', t(req, 'ការចុះឈ្មោះត្រូវបានអនុម័ត', 'Enrollment approved'));
        res.redirect('/admin/enrollments');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការអនុម័តការចុះឈ្មោះ', 'Error approving enrollment'));
        res.redirect('/admin/enrollments');
    }
});

router.post('/enrollments/:id/reject', async (req, res) => {
    try {
        await req.db.query(
            "UPDATE enrollments SET status = 'rejected', admin_notes = ? WHERE id = ?",
            [req.body.notes || '', req.params.id]
        );
        req.flash('success', t(req, 'ការចុះឈ្មោះត្រូវបានបដិសេធ', 'Enrollment rejected'));
        res.redirect('/admin/enrollments');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការបដិសេ�ការចុះឈ្មោះ', 'Error rejecting enrollment'));
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
            e.academic_year, e.semester
            FROM payments p
            JOIN users u ON p.user_id = u.id
            JOIN fee_types ft ON p.fee_type_id = ft.id
            JOIN enrollments e ON p.enrollment_id = e.id
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
            totalPages,
            totalRecords,
            filters: req.query
        });
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការផ្ទុកការទូទាត់', 'Error loading payments'));
        res.redirect('/admin/dashboard');
    }
});

router.post('/payments/:id/verify', async (req, res) => {
    try {
        await req.db.query(
            "UPDATE payments SET status = 'verified', verified_by = ?, verified_at = NOW(), admin_notes = ? WHERE id = ?",
            [req.session.user.id, req.body.notes || '', req.params.id]
        );
        req.flash('success', t(req, 'ការទូទាត់ត្រូវបានផ្ទៀងផ្ទាត់', 'Payment verified'));
        res.redirect('/admin/payments');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការផ្ទៀងផ្ទាត់ការទូទាត់', 'Error verifying payment'));
        res.redirect('/admin/payments');
    }
});

router.post('/payments/:id/reject', async (req, res) => {
    try {
        await req.db.query(
            "UPDATE payments SET status = 'rejected', verified_by = ?, verified_at = NOW(), admin_notes = ? WHERE id = ?",
            [req.session.user.id, req.body.notes || '', req.params.id]
        );
        req.flash('success', t(req, 'ការទូទាត់ត្រូវបានបដិសេធ', 'Payment rejected'));
        res.redirect('/admin/payments');
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការបដិសេ�ការទូទាត់', 'Error rejecting payment'));
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
        req.flash('error', t(req, 'មានកំហុសក្នុងការផ្ទុកថ្លៃសិក្សា', 'Error loading major tuition'));
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
        req.flash('success', t(req, 'បានបន្ថែមថ្លៃសិក្សាដោយជោគជ័យ', 'Major tuition added successfully'));
        res.redirect('/admin/major-tuition');
    } catch (err) {
        console.error('Add major tuition error:', err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការបន្ថែមថ្លៃសិក្សា', 'Error adding major tuition'));
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
        req.flash('success', t(req, 'បានកែប្រែថ្លៃសិក្សាដោយជោគជ័យ', 'Major tuition updated successfully'));
        res.redirect('/admin/major-tuition');
    } catch (err) {
        console.error('Edit major tuition error:', err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការកែប្រែថ្លៃសិក្សា', 'Error updating major tuition'));
        res.redirect('/admin/major-tuition');
    }
});

router.post('/major-tuition/:id/toggle', async (req, res) => {
    try {
        await req.db.query('UPDATE major_tuition SET is_active = NOT is_active WHERE id = ?', [req.params.id]);
        req.flash('success', t(req, 'បានកែប្រែស្ថានភាពថ្លៃសិក្សា', 'Major tuition status updated'));
        res.redirect('/admin/major-tuition');
    } catch (err) {
        console.error('Toggle major tuition error:', err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការកែប្រែស្ថានភាព', 'Error updating status'));
        res.redirect('/admin/major-tuition');
    }
});

router.post('/major-tuition/:id/delete', async (req, res) => {
    try {
        await req.db.query('DELETE FROM major_tuition WHERE id = ?', [req.params.id]);
        req.flash('success', t(req, 'បានលុបថ្លៃសិក្សាដោយជោគជ័យ', 'Major tuition deleted successfully'));
        res.redirect('/admin/major-tuition');
    } catch (err) {
        console.error('Delete major tuition error:', err);
        req.flash('error', t(req, 'មានកំហុសក្នុងការលុបថ្លៃសិក្សា', 'Error deleting major tuition'));
        res.redirect('/admin/major-tuition');
    }
});

module.exports = router;
