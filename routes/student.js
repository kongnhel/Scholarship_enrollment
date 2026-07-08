const express = require('express');
const router = express.Router();
const { isAuthenticated, isStudent } = require('../middleware/auth');
const { uploadMultiple } = require('../middleware/upload');
const { sendEmail } = require('../config/mailer');
const { generateKHQR, checkTransaction } = require('../config/bakong');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const proofStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (req, file, cb) => cb(null, `proof-${uuidv4()}${path.extname(file.originalname)}`)
});
const proofUpload = multer({
  storage: proofStorage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    cb(null, allowedTypes.includes(file.mimetype));
  },
  limits: { fileSize: 5 * 1024 * 1024 }
}).single('proof');

const enrollPhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (req, file, cb) => cb(null, `enroll-photo-${uuidv4()}${path.extname(file.originalname)}`)
});
const enrollPhotoUpload = multer({
  storage: enrollPhotoStorage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png'];
    cb(null, allowedTypes.includes(file.mimetype));
  },
  limits: { fileSize: 5 * 1024 * 1024 }
}).single('enroll_photo');

router.use(isAuthenticated, isStudent);

router.get('/dashboard', async (req, res) => {
  try {
    const userId = req.session.user.id;
    const [applications] = await req.db.query(
      `SELECT a.*, m.name_kh as major_name_kh, m.name_en as major_name_en,
       sc.name_kh as category_name_kh, sc.name_en as category_name_en
       FROM applications a
       LEFT JOIN majors m ON a.major_first_choice_id = m.id
       LEFT JOIN scholarship_categories sc ON a.scholarship_category_id = sc.id
       WHERE a.user_id = ? ORDER BY a.submitted_at DESC LIMIT 1`,
      [userId]
    );
    const [notifications] = await req.db.query(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
      [userId]
    );
    const [settingsRows] = await req.db.query('SELECT * FROM settings');
    const settings = {};
    settingsRows.forEach(row => { settings[row.setting_key] = row.setting_value; });
    const now = new Date();
    const registrationClosed = settings.registration_open === '0' ||
      (settings.registration_start && new Date(settings.registration_start) > now) ||
      (settings.registration_end && new Date(settings.registration_end) < now);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const enrollStart = settings.enrollment_start ? new Date(settings.enrollment_start) : null;
    const enrollEnd = settings.enrollment_end ? new Date(settings.enrollment_end) : null;
    const enrollStartDay = enrollStart ? new Date(enrollStart.getFullYear(), enrollStart.getMonth(), enrollStart.getDate()) : null;
    const enrollEndDay = enrollEnd ? new Date(enrollEnd.getFullYear(), enrollEnd.getMonth(), enrollEnd.getDate()) : null;
    const enrollmentClosed = settings.enrollment_open === '0' ||
      (enrollStartDay && enrollStartDay > today) ||
      (enrollEndDay && enrollEndDay < today);
    const [enrollments] = await req.db.query(
      'SELECT * FROM enrollments WHERE user_id = ? ORDER BY id DESC LIMIT 1',
      [userId]
    );
    const enrollment = enrollments[0] || null;
    const [payments] = await req.db.query(
      'SELECT p.*, ft.name_kh as fee_name_kh, ft.name_en as fee_name_en FROM payments p JOIN fee_types ft ON p.fee_type_id = ft.id WHERE p.user_id = ? ORDER BY p.created_at DESC',
      [userId]
    );
    const totalPaid = payments.filter(p => p.status === 'verified').reduce((s, p) => s + Number(p.amount), 0);
    res.render('student/dashboard', {
      title: 'Student Dashboard',
      application: applications[0] || null,
      notificationsCount: notifications[0].count,
      registrationClosed,
      enrollmentClosed,
      enrollment,
      payments,
      totalPaid
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    req.flash('error', 'An error occurred while loading dashboard');
    res.redirect('/');
  }
});

router.get('/application/new', async (req, res) => {
  try {
    const [settingsRows] = await req.db.query('SELECT * FROM settings');
    const settings = {};
    settingsRows.forEach(row => { settings[row.setting_key] = row.setting_value; });
    const now = new Date();
    if (settings.registration_open === '0' ||
      (settings.registration_start && new Date(settings.registration_start) > now) ||
      (settings.registration_end && new Date(settings.registration_end) < now)) {
      req.flash('error', 'Registration is currently closed.');
      return res.redirect('/student/dashboard');
    }
    const [majors] = await req.db.query('SELECT id, name_kh, name_en FROM majors WHERE is_active = 1');
    const [provinces] = await req.db.query('SELECT id, name_kh, name_en FROM provinces');
    const [scholarshipTypes] = await req.db.query('SELECT id, name_kh, name_en, coverage_percentage, duration_years, provider_name FROM scholarship_types WHERE is_active = 1');
    res.render('student/application-form', {
      title: 'New Application',
      majors,
      provinces,
      scholarshipTypes
    });
  } catch (error) {
    console.error('New application page error:', error);
    req.flash('error', 'An error occurred');
    res.redirect('/student/dashboard');
  }
});

router.post('/application', uploadMultiple, async (req, res) => {
  try {
    if (!req.body._csrf || req.body._csrf !== req.session.csrfToken) {
      req.flash('error', 'Invalid or missing CSRF token. Please try again.');
      return res.redirect('/student/application/new');
    }
    const [settingsRows] = await req.db.query('SELECT * FROM settings');
    const settings = {};
    settingsRows.forEach(row => { settings[row.setting_key] = row.setting_value; });

    if (settings.registration_open === '0') {
      req.flash('error', 'Registration is currently closed.');
      return res.redirect('/student/dashboard');
    }
    const now = new Date();
    if (settings.registration_start && new Date(settings.registration_start) > now) {
      req.flash('error', 'Registration has not opened yet.');
      return res.redirect('/student/dashboard');
    }
    if (settings.registration_end && new Date(settings.registration_end) < now) {
      req.flash('error', 'Registration deadline has passed.');
      return res.redirect('/student/dashboard');
    }

    const {
      khmer_first_name, khmer_last_name, english_first_name, english_last_name,
      gender, date_of_birth, nationality, nationality_other, national_id, current_address,
      phone, telegram, email,
      parent_name, parent_phone, emergency_contact, emergency_phone,
      school_name, school_province_id, graduation_year, exam_result,
      major_first_choice_id, major_second_choice_id,
      scholarship_type_id
    } = req.body;

    const finalNationality = (nationality === 'Other' && nationality_other) ? nationality_other.trim().substring(0, 50) : (nationality || 'Cambodian');

    const photo = req.files && req.files.photo ? req.files.photo[0].filename : null;
    const transcript = req.files && req.files.transcript ? req.files.transcript[0].filename : null;
    const nationalIdFile = req.files && req.files.nationalId ? req.files.nationalId[0].filename : null;
    const additionalDocuments = req.files && req.files.additionalDocuments
      ? req.files.additionalDocuments.map(f => f.filename).join(',')
      : null;

    const [result] = await req.db.query(
      `INSERT INTO applications (
        user_id, khmer_first_name, khmer_last_name, english_first_name, english_last_name,
        gender, date_of_birth, nationality, national_id, current_address,
        phone, telegram, email,
        parent_name, parent_phone, emergency_contact, emergency_phone,
        school_name, school_province_id, graduation_year, exam_result,
        major_first_choice_id, major_second_choice_id, scholarship_type_id,
        photo_path, transcript_path, national_id_path, additional_documents_path, status, submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
      [
        req.session.user.id, khmer_first_name, khmer_last_name, english_first_name, english_last_name,
        gender, date_of_birth, finalNationality, national_id, current_address,
        phone, telegram, email,
        parent_name, parent_phone, emergency_contact, emergency_phone,
        school_name, school_province_id, graduation_year, exam_result,
        major_first_choice_id, major_second_choice_id || null, scholarship_type_id || null,
        photo, transcript, nationalIdFile, additionalDocuments
      ]
    );

    await req.db.query(
      'INSERT INTO application_status_history (application_id, new_status, changed_by, notes) VALUES (?, ?, ?, ?)',
      [result.insertId, 'pending', req.session.user.id, 'Application submitted']
    );

    await sendEmail(
      req.session.user.email,
      'Application Submitted - Scholarship Program',
      '<p>Dear <strong>' + (req.session.user.khmer_name || 'Student') + '</strong>,</p><p>Your scholarship application has been submitted successfully. We will review your application and notify you of any updates.</p><p>Application ID: <strong>' + result.insertId + '</strong></p><br><p>Best regards,<br>Scholarship Committee</p>'
    );

    req.flash('success', 'Application submitted successfully');
    res.redirect('/student/dashboard');
  } catch (error) {
    console.error('Submit application error:', error);
    req.flash('error', 'An error occurred while submitting application');
    res.redirect('/student/application/new');
  }
});

router.get('/application/:id', async (req, res) => {
  try {
    const [applications] = await req.db.query(
      `SELECT a.*, m1.name_kh as major_first_name_kh, m1.name_en as major_first_name_en,
       m2.name_kh as major_second_name_kh, m2.name_en as major_second_name_en,
       sc.name_kh as category_name_kh, sc.name_en as category_name_en,
       p.name_kh as province_name_kh, p.name_en as province_name_en
       FROM applications a
       LEFT JOIN majors m1 ON a.major_first_choice_id = m1.id
       LEFT JOIN majors m2 ON a.major_second_choice_id = m2.id
       LEFT JOIN scholarship_categories sc ON a.scholarship_category_id = sc.id
       LEFT JOIN provinces p ON a.school_province_id = p.id
       WHERE a.id = ? AND a.user_id = ?`,
      [req.params.id, req.session.user.id]
    );
    if (applications.length === 0) {
      req.flash('error', 'Application not found');
      return res.redirect('/student/dashboard');
    }
    const [history] = await req.db.query(
      `SELECT sh.*, u.english_name as changed_by_name
       FROM application_status_history sh
       LEFT JOIN users u ON sh.changed_by = u.id
       WHERE sh.application_id = ? ORDER BY sh.created_at DESC`,
      [req.params.id]
    );
    res.render('student/application-detail', {
      title: 'Application Detail',
      application: applications[0],
      statusHistory: history
    });
  } catch (error) {
    console.error('Application detail error:', error);
    req.flash('error', 'An error occurred');
    res.redirect('/student/dashboard');
  }
});

router.post('/application/:id/correct', uploadMultiple, async (req, res) => {
  try {
    if (!req.body._csrf || req.body._csrf !== req.session.csrfToken) {
      req.flash('error', 'Invalid or missing CSRF token. Please try again.');
      return res.redirect('back');
    }
    const [existing] = await req.db.query(
      'SELECT * FROM applications WHERE id = ? AND user_id = ? AND status = ?',
      [req.params.id, req.session.user.id, 'correction_requested']
    );
    if (existing.length === 0) {
      req.flash('error', 'Application not found or not eligible for correction');
      return res.redirect('/student/dashboard');
    }

    const {
      khmer_first_name, khmer_last_name, english_first_name, english_last_name,
      gender, date_of_birth, nationality, nationality_other, national_id, current_address,
      phone, telegram, email,
      parent_name, parent_phone, emergency_contact, emergency_phone,
      school_name, school_province_id, graduation_year, exam_result,
      major_first_choice_id, major_second_choice_id, scholarship_category_id,
      correction_notes
    } = req.body;

    const finalNationality2 = (nationality === 'Other' && nationality_other) ? nationality_other.trim().substring(0, 50) : (nationality || 'Cambodian');

    let photo = existing[0].photo_path;
    let transcript = existing[0].transcript_path;
    let nationalIdFile = existing[0].national_id_path;
    let additionalDocuments = existing[0].additional_documents_path;

    if (req.files && req.files.photo) photo = req.files.photo[0].filename;
    if (req.files && req.files.transcript) transcript = req.files.transcript[0].filename;
    if (req.files && req.files.nationalId) nationalIdFile = req.files.nationalId[0].filename;
    if (req.files && req.files.additionalDocuments) {
      additionalDocuments = req.files.additionalDocuments.map(f => f.filename).join(',');
    }

    await req.db.query(
      `UPDATE applications SET
        khmer_first_name = ?, khmer_last_name = ?, english_first_name = ?, english_last_name = ?,
        gender = ?, date_of_birth = ?, nationality = ?, national_id = ?, current_address = ?,
        phone = ?, telegram = ?, email = ?,
        parent_name = ?, parent_phone = ?, emergency_contact = ?, emergency_phone = ?,
        school_name = ?, school_province_id = ?, graduation_year = ?, exam_result = ?,
        major_first_choice_id = ?, major_second_choice_id = ?, scholarship_category_id = ?,
        photo_path = ?, transcript_path = ?, national_id_path = ?, additional_documents_path = ?,
        status = 'pending'
        WHERE id = ? AND user_id = ?`,
      [
        khmer_first_name, khmer_last_name, english_first_name, english_last_name,
        gender, date_of_birth, finalNationality2, national_id, current_address,
        phone, telegram, email,
        parent_name, parent_phone, emergency_contact, emergency_phone,
        school_name, school_province_id, graduation_year, exam_result,
        major_first_choice_id, major_second_choice_id || null, scholarship_category_id,
        photo, transcript, nationalIdFile, additionalDocuments,
        req.params.id, req.session.user.id
      ]
    );

    await req.db.query(
      'INSERT INTO application_status_history (application_id, new_status, changed_by, notes) VALUES (?, ?, ?, ?)',
      [req.params.id, 'pending', req.session.user.id, correction_notes || 'Application corrected and resubmitted']
    );

    req.flash('success', 'Application corrected and resubmitted successfully');
    res.redirect('/student/application/' + req.params.id);
  } catch (error) {
    console.error('Correct application error:', error);
    req.flash('error', 'An error occurred while updating application');
    res.redirect('/student/dashboard');
  }
});

router.get('/status', async (req, res) => {
  try {
    const [applications] = await req.db.query(
      `SELECT a.id, a.status, a.submitted_at, a.updated_at,
       m.name_kh as major_name_kh, m.name_en as major_name_en,
       sc.name_kh as category_name_kh, sc.name_en as category_name_en
       FROM applications a
       LEFT JOIN majors m ON a.major_first_choice_id = m.id
       LEFT JOIN scholarship_categories sc ON a.scholarship_category_id = sc.id
       WHERE a.user_id = ? ORDER BY a.submitted_at DESC`,
      [req.session.user.id]
    );
    res.render('student/status', {
      title: 'Application Status',
      applications
    });
  } catch (error) {
    console.error('Status page error:', error);
    req.flash('error', 'An error occurred');
    res.redirect('/student/dashboard');
  }
});

router.get('/notifications', async (req, res) => {
  try {
    const [notifications] = await req.db.query(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC',
      [req.session.user.id]
    );
    res.render('student/notifications', { title: 'Notifications', notifications });
  } catch (error) {
    console.error('Notifications error:', error);
    req.flash('error', 'An error occurred');
    res.redirect('/student/dashboard');
  }
});

router.post('/notifications/read-all', async (req, res) => {
  try {
    await req.db.query(
      'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0',
      [req.session.user.id]
    );
    res.redirect('/student/notifications');
  } catch (error) {
    console.error('Mark all read error:', error);
    res.redirect('back');
  }
});

router.post('/notification/:id/read', async (req, res) => {
  try {
    await req.db.query(
      'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
      [req.params.id, req.session.user.id]
    );
    res.redirect('back');
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.redirect('back');
  }
});

// ==================== ENROLLMENT ====================

router.get('/enroll', async (req, res) => {
  try {
    const userId = req.session.user.id;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const [enrollSettings] = await req.db.query("SELECT * FROM settings WHERE setting_key IN ('enrollment_open', 'enrollment_start', 'enrollment_end')");
    const eSettings = {};
    enrollSettings.forEach(row => { eSettings[row.setting_key] = row.setting_value; });
    const enrollStart = eSettings.enrollment_start ? new Date(eSettings.enrollment_start) : null;
    const enrollEnd = eSettings.enrollment_end ? new Date(eSettings.enrollment_end) : null;
    const enrollStartDay = enrollStart ? new Date(enrollStart.getFullYear(), enrollStart.getMonth(), enrollStart.getDate()) : null;
    const enrollEndDay = enrollEnd ? new Date(enrollEnd.getFullYear(), enrollEnd.getMonth(), enrollEnd.getDate()) : null;
    const enrollClosed = eSettings.enrollment_open === '0' ||
      (enrollStartDay && enrollStartDay > today) ||
      (enrollEndDay && enrollEndDay < today);
    const [users] = await req.db.query('SELECT * FROM users WHERE id = ?', [userId]);
    const [applications] = await req.db.query(
      'SELECT a.*, m.name_kh as major_first_name_kh, m2.name_kh as major_second_name_kh, p.name_kh as province_name_kh FROM applications a LEFT JOIN majors m ON a.major_first_choice_id = m.id LEFT JOIN majors m2 ON a.major_second_choice_id = m2.id LEFT JOIN provinces p ON a.school_province_id = p.id WHERE a.user_id = ? ORDER BY a.submitted_at DESC LIMIT 1',
      [userId]
    );
    const [existingEnrollment] = await req.db.query(
      "SELECT * FROM enrollments WHERE user_id = ? AND academic_year = '2025-2026' ORDER BY id DESC LIMIT 1",
      [userId]
    );
    const [feeTypes] = await req.db.query('SELECT * FROM fee_types WHERE is_active = 1 ORDER BY id ASC');
    const [payments] = await req.db.query(
      'SELECT p.*, ft.name_kh as fee_name_kh, ft.name_en as fee_name_en FROM payments p JOIN fee_types ft ON p.fee_type_id = ft.id WHERE p.user_id = ? ORDER BY p.created_at DESC',
      [userId]
    );
    res.render('student/enroll', {
      title: 'Enrollment',
      userData: users[0] || null,
      application: applications[0] || null,
      enrollment: existingEnrollment[0] || null,
      feeTypes,
      payments,
      enrollClosed,
      majors: (await req.db.query('SELECT id, name_kh, name_en FROM majors WHERE is_active = 1 ORDER BY name_kh ASC'))[0],
      majorTuition: (await req.db.query('SELECT mt.*, m.name_kh as major_name_kh, m.name_en as major_name_en FROM major_tuition mt JOIN majors m ON mt.major_id = m.id WHERE mt.is_active = 1 AND mt.academic_year = "2025-2026"'))[0],
      scholarshipTypes: (await req.db.query('SELECT id, name_kh, name_en, coverage_percentage, ministry_fee, duration_years, provider_name FROM scholarship_types WHERE is_active = 1 ORDER BY coverage_percentage ASC'))[0]
    });
  } catch (error) {
    console.error('Enroll page error:', error);
    req.flash('error', 'An error occurred');
    res.redirect('/student/dashboard');
  }
});

router.get('/enroll/tuition/:majorId', async (req, res) => {
  try {
    const [tuition] = await req.db.query(
      'SELECT * FROM major_tuition WHERE major_id = ? AND is_active = 1 ORDER BY academic_year DESC LIMIT 1',
      [req.params.majorId]
    );
    if (tuition.length > 0) {
      res.json({ success: true, tuition: tuition[0] });
    } else {
      res.json({ success: false, message: 'No tuition set for this major' });
    }
  } catch (error) {
    console.error('Get tuition error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/enroll', (req, res) => {
  enrollPhotoUpload(req, res, async (err) => {
    try {
      if (err) {
        req.flash('error', err.message || 'Photo upload error');
        return res.redirect('/student/enroll');
      }
      const userId = req.session.user.id;
      const {
        academic_year, semester,
        khmer_first_name, khmer_last_name, english_first_name, english_last_name,
        gender, date_of_birth, place_of_birth, phone,
        current_address, province, district, commune,
        parent_name, parent_phone, parent_relationship,
        previous_school, previous_diploma, diploma_year, major, major_choice,
        bank_name, scholarship_category_id
      } = req.body;

      const [existing] = await req.db.query(
        "SELECT * FROM enrollments WHERE user_id = ? AND academic_year = ? AND semester = ?",
        [userId, academic_year, semester]
      );
      if (existing.length > 0) {
        req.flash('error', 'Already enrolled for this semester');
        return res.redirect('/student/enroll');
      }

      const photoPath = req.file ? req.file.filename : null;

      await req.db.query(
        `INSERT INTO enrollments (
          user_id, academic_year, semester, status,
          khmer_first_name, khmer_last_name, english_first_name, english_last_name,
          gender, date_of_birth, place_of_birth, phone,
          current_address, province, district, commune,
          parent_name, parent_phone, parent_relationship,
          previous_school, previous_diploma, diploma_year, major, major_choice,
          scholarship_category_id, bank_name, photo_path
        ) VALUES (?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?)`,
        [
          userId, academic_year, semester, 'pending',
          khmer_first_name || null, khmer_last_name || null, english_first_name || null, english_last_name || null,
          gender || null, date_of_birth || null, place_of_birth || null, phone || null,
          current_address || null, province || null, district || null, commune || null,
          parent_name || null, parent_phone || null, parent_relationship || null,
          previous_school || null, previous_diploma || null, diploma_year || null, major || null, major_choice || null,
          scholarship_category_id || null, bank_name || null, photoPath
        ]
      );
      req.flash('success', 'Enrollment submitted successfully');
      res.redirect('/student/enroll');
    } catch (error) {
      console.error('Enroll error:', error);
      req.flash('error', 'An error occurred');
      res.redirect('/student/enroll');
    }
  });
});

// ==================== PAYMENTS ====================

router.get('/payments', async (req, res) => {
  try {
    const userId = req.session.user.id;
    const [enrollments] = await req.db.query(
      "SELECT * FROM enrollments WHERE user_id = ? ORDER BY academic_year DESC, semester DESC",
      [userId]
    );
    const [payments] = await req.db.query(
      `SELECT p.*, ft.name_kh as fee_name_kh, ft.name_en as fee_name_en, e.academic_year, e.semester
       FROM payments p
       JOIN fee_types ft ON p.fee_type_id = ft.id
       JOIN enrollments e ON p.enrollment_id = e.id
       WHERE p.user_id = ?
       ORDER BY p.created_at DESC`,
      [userId]
    );
    const [feeTypes] = await req.db.query('SELECT * FROM fee_types WHERE is_active = 1 ORDER BY id ASC');
    const [totalPaid] = await req.db.query(
      "SELECT SUM(amount) as total FROM payments WHERE user_id = ? AND status = 'verified'",
      [userId]
    );
    const [enrollmentForTuition] = await req.db.query(
      `SELECT e.major_choice, e.scholarship_category_id, mt.tuition_per_year, m.name_kh as major_name_kh, m.name_en as major_name_en
       FROM enrollments e
       LEFT JOIN major_tuition mt ON e.major_choice = mt.major_id AND mt.is_active = 1
       LEFT JOIN majors m ON e.major_choice = m.id
       WHERE e.user_id = ? ORDER BY e.id DESC LIMIT 1`,
      [userId]
    );
    let tuition = enrollmentForTuition[0] ? Number(enrollmentForTuition[0].tuition_per_year) || 0 : 0;
    const majorName = enrollmentForTuition[0] ? (enrollmentForTuition[0].major_name_kh || enrollmentForTuition[0].major_name_en || '') : '';
    const scholarshipCategoryId = enrollmentForTuition[0] ? enrollmentForTuition[0].scholarship_category_id : null;
    let scholarshipName = '';
    if (scholarshipCategoryId && tuition > 0) {
      const [sch] = await req.db.query('SELECT * FROM scholarship_types WHERE id = ?', [scholarshipCategoryId]);
      if (sch.length > 0) {
        const coverage = Number(sch[0].coverage_percentage);
        const ministryFee = Number(sch[0].ministry_fee || 0);
        const discount = Math.round(tuition * coverage / 100);
        tuition = tuition - discount + ministryFee;
        if (tuition < 0) tuition = 0;
        scholarshipName = sch[0].name_kh;
      }
    }
    const totalDue = tuition;
    res.render('student/payments', {
      title: 'My Payments',
      enrollments,
      payments,
      feeTypes,
      totalPaid: totalPaid[0].total || 0,
      totalDue,
      yearlyTuition: tuition,
      majorName,
      scholarshipName
    });
  } catch (error) {
    console.error('Payments page error:', error);
    req.flash('error', 'An error occurred');
    res.redirect('/student/dashboard');
  }
});

router.post('/payments/generate-qr', async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { enrollment_id, payment_type } = req.body;

    if (!enrollment_id || !payment_type) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const [enrollment] = await req.db.query(
      'SELECT * FROM enrollments WHERE id = ? AND user_id = ?',
      [enrollment_id, userId]
    );
    if (enrollment.length === 0) {
      return res.status(400).json({ error: 'Invalid enrollment' });
    }

    const majorId = enrollment[0].major_choice;
    if (!majorId) {
      return res.status(400).json({ error: 'No major selected in enrollment' });
    }

    const [tuition] = await req.db.query(
      'SELECT * FROM major_tuition WHERE major_id = ? AND is_active = 1 ORDER BY academic_year DESC LIMIT 1',
      [majorId]
    );
    if (tuition.length === 0) {
      return res.status(400).json({ error: 'No tuition set for your major' });
    }

    const yearlyTuition = Number(tuition[0].tuition_per_year);
    let studentPayYearly = yearlyTuition;

    const scholarshipCategoryId = enrollment[0].scholarship_category_id;
    if (scholarshipCategoryId) {
      const [scholarship] = await req.db.query(
        'SELECT * FROM scholarship_types WHERE id = ? AND is_active = 1',
        [scholarshipCategoryId]
      );
      if (scholarship.length > 0) {
        const coverage = Number(scholarship[0].coverage_percentage);
        const ministryFee = Number(scholarship[0].ministry_fee || 0);
        const discount = Math.round(yearlyTuition * coverage / 100);
        studentPayYearly = yearlyTuition - discount + ministryFee;
        if (studentPayYearly < 0) studentPayYearly = 0;
      }
    }

    const paymentAmount = payment_type === 'semester' ? Math.round(studentPayYearly / 2) : studentPayYearly;

    const [user] = await req.db.query('SELECT * FROM users WHERE id = ?', [userId]);
    const phone = user[0].phone || '';

    const [feeType] = await req.db.query('SELECT id FROM fee_types WHERE is_active = 1 LIMIT 1');
    const feeTypeId = feeType.length > 0 ? feeType[0].id : 1;

    const billNumber = `PAY-${Date.now()}-${userId}`;
    const result = await generateKHQR({
      amount: paymentAmount,
      currency: 'khr',
      billNumber,
      mobileNumber: phone
    });

    await req.db.query(
      `INSERT INTO payments (enrollment_id, user_id, fee_type_id, amount, payment_method, khqr_md5, khqr_string, status, transaction_ref)
       VALUES (?, ?, ?, ?, 'bakong_khqr', ?, ?, 'pending', ?)`,
      [enrollment_id, userId, feeTypeId, paymentAmount, result.md5Hash, result.qrString, payment_type]
    );

    res.json({
      success: true,
      qrImage: result.qrImageBase64,
      md5Hash: result.md5Hash,
      amount: paymentAmount,
      expiryMinutes: 10
    });
  } catch (error) {
    console.error('Generate QR error:', error);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

router.get('/payments/check-transaction/:md5', async (req, res) => {
  try {
    const md5Hash = req.params.md5;
    const result = await checkTransaction(md5Hash);

    if (result.status === 'success') {
      await req.db.query(
        "UPDATE payments SET status = 'verified', verified_at = NOW() WHERE khqr_md5 = ? AND status = 'pending'",
        [md5Hash]
      );
      return res.json({ success: true, status: 'verified' });
    } else if (result.status === 'not_found') {
      return res.json({ success: false, status: 'pending' });
    } else {
      return res.json({ success: false, status: result.status });
    }
  } catch (error) {
    console.error('Check transaction error:', error);
    res.status(500).json({ error: 'Failed to check transaction' });
  }
});

router.post('/payments', (req, res) => {
  proofUpload(req, res, async (err) => {
    try {
      if (err) {
        req.flash('error', err.message || 'File upload error');
        return res.redirect('/student/payments');
      }
      const userId = req.session.user.id;
      const { enrollment_id, fee_type_id, amount, payment_method, transaction_ref } = req.body;
      const proofPath = req.file ? req.file.filename : null;

      await req.db.query(
        'INSERT INTO payments (enrollment_id, user_id, fee_type_id, amount, payment_method, transaction_ref, proof_path) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [enrollment_id, userId, fee_type_id, parseFloat(amount), payment_method || 'bank_transfer', transaction_ref || '', proofPath]
      );
      req.flash('success', 'Payment submitted successfully');
      res.redirect('/student/payments');
    } catch (error) {
      console.error('Payment submit error:', error);
      req.flash('error', 'An error occurred');
      res.redirect('/student/payments');
    }
  });
});

module.exports = router;
