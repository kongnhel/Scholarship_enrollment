const express = require('express');
const router = express.Router();
const { isAuthenticated, isCommittee } = require('../middleware/auth');
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');

function t(req, km, en) {
  return req.session.lang === 'km' ? km : en;
}

router.use(isAuthenticated, isCommittee);

router.get('/dashboard', async (req, res) => {
    try {
        const [totalApproved] = await req.db.query("SELECT COUNT(*) as count FROM applications WHERE status = 'approved'");
        const [byMajor] = await req.db.query(
            `SELECT m.name_kh, m.name_en, COUNT(a.id) as count
             FROM applications a LEFT JOIN majors m ON a.major_first_choice_id = m.id
             WHERE a.status = 'approved' GROUP BY a.major_first_choice_id`
        );
        const [recent] = await req.db.query(
            `SELECT a.*, m.name_kh as major_name_kh, m.name_en as major_name_en,
             c.name_kh as category_name_kh, c.name_en as category_name_en,
             u.english_name as student_name
             FROM applications a
             LEFT JOIN majors m ON a.major_first_choice_id = m.id
             LEFT JOIN scholarship_categories c ON a.scholarship_category_id = c.id
             LEFT JOIN users u ON a.user_id = u.id
             WHERE a.status = 'approved' ORDER BY a.submitted_at DESC LIMIT 10`
        );
        res.render('committee/dashboard', {
            title: 'Committee Dashboard',
            totalApproved: totalApproved[0].count,
            byMajor,
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
        const { search, major, category } = req.query;
        let query = `SELECT a.*, m.name_kh as major_name_kh, m.name_en as major_name_en,
            c.name_kh as category_name_kh, c.name_en as category_name_en,
            p.name_kh as province_name_kh, p.name_en as province_name_en,
            u.english_name as student_name
            FROM applications a
            LEFT JOIN majors m ON a.major_first_choice_id = m.id
            LEFT JOIN scholarship_categories c ON a.scholarship_category_id = c.id
            LEFT JOIN provinces p ON a.school_province_id = p.id
            LEFT JOIN users u ON a.user_id = u.id WHERE a.status = 'approved'`;
        let countQuery = "SELECT COUNT(*) as count FROM applications a WHERE a.status = 'approved'";
        const params = [];
        const countParams = [];
        if (search) {
            query += ' AND (a.english_first_name LIKE ? OR a.english_last_name LIKE ? OR a.khmer_first_name LIKE ? OR a.khmer_last_name LIKE ?)';
            countQuery += ' AND (a.english_first_name LIKE ? OR a.english_last_name LIKE ? OR a.khmer_first_name LIKE ? OR a.khmer_last_name LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
            countParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
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
        query += ' ORDER BY a.submitted_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        const [applications] = await req.db.query(query, params);
        const [countResult] = await req.db.query(countQuery, countParams);
        const totalRecords = countResult[0].count;
        const totalPages = Math.ceil(totalRecords / limit);
        const [majors] = await req.db.query('SELECT * FROM majors WHERE is_active = 1');
        const [categories] = await req.db.query('SELECT * FROM scholarship_categories WHERE is_active = 1');
        res.render('committee/applications', {
            title: 'Approved Applications',
            applications,
            majors,
            categories,
            currentPage: page,
            totalPages,
            totalRecords,
            filters: req.query
        });
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/committee/dashboard');
    }
});

router.get('/applications/:id', async (req, res) => {
    try {
        const [application] = await req.db.query(
            `SELECT a.*, m.name_kh as major_name_kh, m.name_en as major_name_en,
             m2.name_kh as major2_name_kh, m2.name_en as major2_name_en,
             c.name_kh as category_name_kh, c.name_en as category_name_en,
             p.name_kh as province_name_kh, p.name_en as province_name_en,
             u.english_name as student_name, u.khmer_name as student_khmer_name
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
            return res.redirect('/committee/applications');
        }
        if (application[0].status !== 'approved') {
            req.flash('error', t(req, 'មានតែពាក្យសុំដែលបានអនុម័តទើបអាចមើលបាន', 'Only approved applications can be viewed'));
            return res.redirect('/committee/applications');
        }
        const [history] = await req.db.query(
            `SELECT sh.*, u.english_name as changed_by_name
             FROM application_status_history sh
             LEFT JOIN users u ON sh.changed_by = u.id
             WHERE sh.application_id = ? ORDER BY sh.created_at DESC`, [req.params.id]
        );
        res.render('committee/application-detail', {
            title: 'Application Detail',
            application: application[0],
            history
        });
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/committee/applications');
    }
});

router.get('/reports', async (req, res) => {
    try {
        const [total] = await req.db.query('SELECT COUNT(*) as count FROM applications');
        const [approvedTotal] = await req.db.query("SELECT COUNT(*) as count FROM applications WHERE status = 'approved'");
        const [byMajor] = await req.db.query(
            `SELECT m.name_kh, m.name_en, COUNT(a.id) as count
             FROM applications a LEFT JOIN majors m ON a.major_first_choice_id = m.id
             WHERE a.status = 'approved' GROUP BY a.major_first_choice_id`
        );
        const [byCategory] = await req.db.query(
            `SELECT c.name_kh, c.name_en, COUNT(a.id) as count
             FROM applications a LEFT JOIN scholarship_categories c ON a.scholarship_category_id = c.id
             WHERE a.status = 'approved' GROUP BY a.scholarship_category_id`
        );
        const [byProvince] = await req.db.query(
            `SELECT p.name_kh as province_kh, p.name_en as province_en, COUNT(a.id) as count
             FROM applications a LEFT JOIN provinces p ON a.school_province_id = p.id
             WHERE a.status = 'approved' GROUP BY a.school_province_id`
        );
        const [byGender] = await req.db.query("SELECT gender, COUNT(*) as count FROM applications WHERE status = 'approved' GROUP BY gender");
        res.render('committee/reports', {
            title: 'Reports',
            total: total[0].count,
            approvedTotal: approvedTotal[0].count,
            byMajor,
            byCategory,
            byProvince,
            byGender
        });
    } catch (err) {
        console.error(err);
        req.flash('error', t(req, 'មានកំហុសមូលដ្ឋានទិន្នន័យ', 'Database error'));
        res.redirect('/committee/dashboard');
    }
});

module.exports = router;
