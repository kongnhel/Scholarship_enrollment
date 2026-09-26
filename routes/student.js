const express = require('express');
const router = express.Router();
const { isAuthenticated, isStudent } = require('../middleware/auth');
const { uploadMultiple, upload, uploadEnrollmentDocs } = require('../middleware/upload');
const { sendEmail } = require('../config/mailer');
const { generateKHQR, checkTransaction } = require('../config/bakong');
const { uploadToImageKit } = require('../utils/imagekit');
const { escapeHtml } = require('../utils/helpers');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');

const POSTER_DIR = path.join(__dirname, '..', 'public', 'images', 'scholarship_img');
function getPosterImages() {
  try {
    return fs.readdirSync(POSTER_DIR)
      .filter(f => /\.(jpe?g|png|webp|gif)$/i.test(f))
      .sort()
      .map(f => '/images/scholarship_img/' + encodeURIComponent(f));
  } catch (e) {
    return [];
  }
}

function t(req, km, en) {
  return req.session.lang === 'km' ? km : en;
}

const proofUpload = upload.single('proof');
const enrollPhotoUpload = upload.single('enroll_photo');

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
    req.flash('error', t(req, 'មានកំហុសក្នុងការផ្ទុកតារាងព័ត៌មាន', 'An error occurred while loading dashboard'));
    res.redirect('/');
  }
});

async function isApplicationWindowClosed(req) {
  const [settingsRows] = await req.db.query('SELECT * FROM settings');
  const settings = {};
  settingsRows.forEach(row => { settings[row.setting_key] = row.setting_value; });
  const now = new Date();
  if (settings.registration_open === '0' ||
    (settings.registration_start && new Date(settings.registration_start) > now) ||
    (settings.registration_end && new Date(settings.registration_end) < now)) {
    return 'registration';
  }
  if (settings.scholarship_open === '0' ||
    (settings.scholarship_start && new Date(settings.scholarship_start) > now) ||
    (settings.scholarship_end && new Date(settings.scholarship_end) < now)) {
    return 'scholarship';
  }
  return null;
}

function sendClosed(req, res, reason) {
  req.flash('error', reason === 'scholarship'
    ? t(req, 'ការដាក់ពាក្យអាហារូបករណ៍បច្ចុប្បន្នបិទ។', 'Scholarship applications are currently closed.')
    : t(req, 'ការចុះឈ្មោះបច្ចុប្បន្នបិទ។', 'Registration is currently closed.'));
  return res.redirect('/student/dashboard');
}

const DEFAULT_SCHOLARSHIP_OPTIONS = [100, 60, 40];

// tier_options is a JSON list of combos {p: percent, y: years, s: seats}, e.g.
// [{"p":100,"y":4,"s":5},{"p":50,"y":4,"s":5},{"p":50,"y":2,"s":5}].
// Legacy plain lists ("100,60,40") fall back to combos with the program duration.
function parseTierCombos(raw, defaultYears) {
  const defY = Number(defaultYears) >= 1 && Number(defaultYears) <= 10 ? Number(defaultYears) : null;
  let parsed = null;
  try { parsed = JSON.parse(String(raw == null ? '' : raw)); } catch (e) { parsed = null; }
  const out = [];
  if (Array.isArray(parsed)) {
    parsed.forEach(t => {
      const p = Number(t && t.p), y = Number(t && t.y), s = Number(t && t.s);
      if (p >= 1 && p <= 100) {
        out.push({ p, y: (y >= 1 && y <= 10) ? y : defY, s: (s >= 1 && s <= 999) ? s : null });
      }
    });
  } else {
    String(raw == null ? '' : raw).split(/[^0-9]+/).filter(Boolean).map(Number).filter(n => n >= 1 && n <= 100)
      .forEach(p => out.push({ p, y: defY, s: null }));
  }
  if (!out.length) DEFAULT_SCHOLARSHIP_OPTIONS.forEach(p => out.push({ p, y: defY, s: null }));
  const seen = new Set(); const uniq = [];
  out.forEach(t => { const k = t.p + '/' + (t.y || 0); if (!seen.has(k)) { seen.add(k); uniq.push(t); } });
  return uniq.slice(0, 12);
}

function tierValues(tierOptions, durationYears) {
  return parseTierCombos(tierOptions, durationYears).map(t => (t.y ? t.p + '/' + t.y : String(t.p)));
}

function readScholarshipOption(req, validValues) {
  const value = String(req.body.scholarship_option || '').trim();
  if (!value || validValues.indexOf(value) === -1) return null;
  return value;
}

router.get('/application/select', async (req, res) => {
  try {
    const closed = await isApplicationWindowClosed(req);
    if (closed) return sendClosed(req, res, closed);
    const [scholarshipTypes] = await req.db.query(
      'SELECT id, name_kh, name_en, coverage_percentage, duration_years, provider_name, poster_path, leader_name, major_ids, tier_options, description FROM scholarship_types WHERE is_active = 1 ORDER BY id ASC'
    );
    const [majorRows] = await req.db.query('SELECT id, name_kh, name_en FROM majors WHERE is_active = 1');
    const majorMap = {};
    majorRows.forEach(m => { majorMap[m.id] = m; });
    scholarshipTypes.forEach(st => {
      st.major_names = String(st.major_ids || '').split(',').filter(Boolean)
        .map(id => { const m = majorMap[id]; return m ? (res.locals.currentLang === 'km' ? m.name_kh : (m.name_en || m.name_kh)) : ''; })
        .filter(Boolean).join(', ');
    });
    res.render('student/scholarship-select', {
      title: 'Select Scholarship Program',
      scholarshipTypes,
      posters: getPosterImages(),
      selectedScholarshipId: req.session.scholarshipTypeId || null,
      selectedOption: req.session.scholarshipOption || null
    });
  } catch (error) {
    console.error('Scholarship select page error:', error);
    req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
    res.redirect('/student/dashboard');
  }
});

router.post('/application/select', async (req, res) => {
  try {
    if (!req.body._csrf || req.body._csrf !== req.session.csrfToken) {
      req.flash('error', t(req, 'តិតុក្កត់ CSRF មិនត្រឹមត្រូវ។ សូមព្យាយាមម្តងទៀត។', 'Invalid or missing CSRF token. Please try again.'));
      return res.redirect('/student/application/select');
    }
    const closed = await isApplicationWindowClosed(req);
    if (closed) return sendClosed(req, res, closed);
    const scholarshipTypeId = parseInt(req.body.scholarship_type_id, 10);
    const [rows] = await req.db.query('SELECT id, duration_years, tier_options FROM scholarship_types WHERE id = ? AND is_active = 1', [scholarshipTypeId]);
    if (!rows.length) {
      req.flash('error', t(req, 'សូមជ្រើសរើសកម្មវិធីអាហារូបករណ៍មួយដែលត្រឹមត្រូវ។', 'Please select a valid scholarship program.'));
      return res.redirect('/student/application/select');
    }
    const options = tierValues(rows[0].tier_options, rows[0].duration_years);
    const option = readScholarshipOption(req, options);
    if (!option) {
      req.flash('error', t(req, 'សូមជ្រើសរើសកម្រិតអាហារូបករណ៍ជាមុនសិន។', 'Please choose a scholarship level first.'));
      return res.redirect('/student/application/select');
    }
    req.session.scholarshipTypeId = scholarshipTypeId;
    req.session.scholarshipOption = option;
    res.redirect('/student/application/new');
  } catch (error) {
    console.error('Scholarship select error:', error);
    req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
    res.redirect('/student/dashboard');
  }
});

router.get('/application/new', async (req, res) => {
  try {
    const closed = await isApplicationWindowClosed(req);
    if (closed) return sendClosed(req, res, closed);

    if (!req.session.scholarshipTypeId) {
      return res.redirect('/student/application/select');
    }
    const [selectedRows] = await req.db.query(
      'SELECT id FROM scholarship_types WHERE id = ? AND is_active = 1',
      [req.session.scholarshipTypeId]
    );
    if (!selectedRows.length) {
      delete req.session.scholarshipTypeId;
      return res.redirect('/student/application/select');
    }

    const [majors] = await req.db.query('SELECT id, name_kh, name_en FROM majors WHERE is_active = 1');
    const [provinces] = await req.db.query('SELECT id, name_kh, name_en FROM provinces');
    const [scholarshipTypes] = await req.db.query(
      'SELECT id, name_kh, name_en, coverage_percentage, duration_years, provider_name FROM scholarship_types WHERE is_active = 1 ORDER BY id ASC'
    );
    res.render('student/application-form', {
      title: 'New Application',
      majors,
      provinces,
      scholarshipTypes,
      posters: getPosterImages(),
      selectedScholarshipId: req.session.scholarshipTypeId,
      selectedScholarshipOption: req.session.scholarshipOption || ''
    });
  } catch (error) {
    console.error('New application page error:', error);
    req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
    res.redirect('/student/dashboard');
  }
});

router.post('/application', uploadMultiple, async (req, res) => {
  try {
    if (!req.body._csrf || req.body._csrf !== req.session.csrfToken) {
      req.flash('error', t(req, 'តិតុក្កត់ CSRF មិនត្រឹមត្រូវ។ សូមព្យាយាមម្តងទៀត។', 'Invalid or missing CSRF token. Please try again.'));
      return res.redirect('/student/application/new');
    }
    const [settingsRows] = await req.db.query('SELECT * FROM settings');
    const settings = {};
    settingsRows.forEach(row => { settings[row.setting_key] = row.setting_value; });

    if (settings.registration_open === '0') {
      req.flash('error', t(req, 'ការចុះឈ្មោះបច្ចុប្បន្នបិទ។', 'Registration is currently closed.'));
      return res.redirect('/student/dashboard');
    }
    const now = new Date();
    if (settings.registration_start && new Date(settings.registration_start) > now) {
      req.flash('error', t(req, 'ការចុះឈ្មោះមិនទាន់ចាប់ផ្តើមនៅឡើយទេ។', 'Registration has not opened yet.'));
      return res.redirect('/student/dashboard');
    }
    if (settings.registration_end && new Date(settings.registration_end) < now) {
      req.flash('error', t(req, 'ការចុះឈ្មោះបានផុតកំណត់ហើយ។', 'Registration deadline has passed.'));
      return res.redirect('/student/dashboard');
    }
    if (settings.scholarship_open === '0' ||
      (settings.scholarship_start && new Date(settings.scholarship_start) > now) ||
      (settings.scholarship_end && new Date(settings.scholarship_end) < now)) {
      req.flash('error', t(req, 'ការដាក់ពាក្យអាហារូបករណ៍បច្ចុប្បន្នបិទ។', 'Scholarship applications are currently closed.'));
      return res.redirect('/student/dashboard');
    }

    const {
      khmer_first_name, khmer_last_name, english_first_name, english_last_name,
      gender, date_of_birth, birth_place,
      address_village, address_commune, address_district, address_province,
      parent_name, mother_name, occupation, education_level,
      phone, parent_phone,
      exam_session, exam_result, school_name, school_province_id, exam_center,
      study_level, major_first_choice_id, major_second_choice_id,
      scholarship_type_id, study_period, study_shift,
      documents_ready, additional_info, declaration_confirmed
    } = req.body;

    if (!declaration_confirmed) {
      req.flash('error', t(req, 'សូមបញ្ជាក់ព័ត៌មានមុនដាក់ស្នើ។', 'Please confirm the declaration before submitting.'));
      return res.redirect('/student/application/new');
    }
    const documentsReady = Array.isArray(documents_ready) ? documents_ready : (documents_ready ? [documents_ready] : []);
    if (documentsReady.length === 0) {
      req.flash('error', t(req, 'សូមធីកឯកសារយ៉ាងហោចណាស់មួយដែលអ្នកបានត្រៀម។', 'Please check at least one document you have prepared.'));
      return res.redirect('/student/application/new');
    }
    const selTypeId = parseInt(scholarship_type_id, 10) || req.session.scholarshipTypeId;
    let optionChoices = tierValues(null, null);
    if (selTypeId) {
      const [tRows] = await req.db.query('SELECT duration_years, tier_options FROM scholarship_types WHERE id = ? AND is_active = 1', [selTypeId]);
      if (tRows.length) optionChoices = tierValues(tRows[0].tier_options, tRows[0].duration_years);
    }
    let scholarshipOption = readScholarshipOption(req, optionChoices);
    if (!scholarshipOption && req.session.scholarshipOption) {
      const sv = String(req.session.scholarshipOption).trim();
      if (optionChoices.indexOf(sv) !== -1) scholarshipOption = sv;
    }
    if (!scholarshipOption) {
      req.flash('error', t(req, 'សូមជ្រើសរើសកម្រិតអាហារូបករណ៍។', 'Please choose a scholarship level.'));
      return res.redirect('/student/application/select');
    }

    const current_address = [address_village, address_commune, address_district, address_province]
      .filter(Boolean).join(', ');
    const email = (req.session.user && req.session.user.email) || null;

    let photo = null, photo_3x4 = null, transcript = null, additionalDocuments = null;

    if (req.files && req.files.photo && req.files.photo[0]) {
      const r = await uploadToImageKit(req.files.photo[0], 'application');
      photo = r.url;
    }
    if (req.files && req.files.photo_3x4 && req.files.photo_3x4[0]) {
      const r = await uploadToImageKit(req.files.photo_3x4[0], 'application');
      photo_3x4 = r.url;
    }
    if (req.files && req.files.transcript && req.files.transcript[0]) {
      const r = await uploadToImageKit(req.files.transcript[0], 'application');
      transcript = r.url;
    }
    if (req.files && req.files.additionalDocuments) {
      const urls = [];
      for (const f of req.files.additionalDocuments) {
        const r = await uploadToImageKit(f, 'application');
        urls.push(r.url);
      }
      additionalDocuments = urls.join(',');
    }

    const [result] = await req.db.query(
      `INSERT INTO applications (
        user_id, khmer_first_name, khmer_last_name, english_first_name, english_last_name,
        gender, date_of_birth, birth_place, current_address,
        address_village, address_commune, address_district, address_province,
        phone, email,
        parent_name, mother_name, occupation, education_level, parent_phone,
        school_name, exam_session, school_province_id, exam_center, exam_result,
        major_first_choice_id, major_second_choice_id, scholarship_type_id,
        scholarship_option,
        study_level, study_period, study_shift,
        documents_ready, additional_info, declaration_confirmed,
        photo_path, photo_3x4_path, transcript_path, additional_documents_path, status, submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
      [
        req.session.user.id, khmer_first_name, khmer_last_name, english_first_name, english_last_name,
        gender, date_of_birth, birth_place, current_address,
        address_village, address_commune, address_district, address_province,
        phone, email,
        parent_name, mother_name, occupation, education_level, parent_phone,
        school_name, exam_session, school_province_id, exam_center, exam_result,
        major_first_choice_id, major_second_choice_id || null, scholarship_type_id || null,
        scholarshipOption,
        study_level, study_period, study_shift,
        documentsReady.join(','), additional_info || null, 1,
        photo, photo_3x4, transcript, additionalDocuments
      ]
    );

    await req.db.query(
      'INSERT INTO application_status_history (application_id, new_status, changed_by, notes) VALUES (?, ?, ?, ?)',
      [result.insertId, 'pending', req.session.user.id, 'Application submitted']
    );

    await sendEmail(
      req.session.user.email,
      'Application Submitted - Scholarship Program',
      '<p>Dear <strong>' + escapeHtml(req.session.user.khmer_name || 'Student') + '</strong>,</p><p>Your scholarship application has been submitted successfully. We will review your application and notify you of any updates.</p><p>Application ID: <strong>' + result.insertId + '</strong></p><br><p>Best regards,<br>Scholarship Committee</p>'
    );

    req.flash('success', t(req, 'ពាក្យសុំត្រូវបានដាក់ស្នើដោយជោគជ័យ', 'Application submitted successfully'));
    res.redirect('/student/dashboard');
  } catch (error) {
    console.error('Submit application error:', error);
    req.flash('error', t(req, 'មានកំហុសក្នុងការដាក់ពាក្យសុំ', 'An error occurred while submitting application'));
    res.redirect('/student/application/new');
  }
});

router.get('/application/:id', async (req, res) => {
  try {
    const [applications] = await req.db.query(
      `SELECT a.*, m1.name_kh as major_first_name_kh, m1.name_en as major_first_name_en,
       m2.name_kh as major_second_name_kh, m2.name_en as major_second_name_en,
       sc.name_kh as category_name_kh, sc.name_en as category_name_en,
       st.name_kh as scholarship_name_kh, st.name_en as scholarship_name_en,
       st.coverage_percentage as scholarship_percentage, st.duration_years as scholarship_duration,
       st.provider_name as scholarship_provider,
       p.name_kh as province_name_kh, p.name_en as province_name_en
       FROM applications a
       LEFT JOIN majors m1 ON a.major_first_choice_id = m1.id
       LEFT JOIN majors m2 ON a.major_second_choice_id = m2.id
       LEFT JOIN scholarship_categories sc ON a.scholarship_category_id = sc.id
       LEFT JOIN scholarship_types st ON a.scholarship_type_id = st.id
       LEFT JOIN provinces p ON a.school_province_id = p.id
       WHERE a.id = ? AND a.user_id = ?`,
      [req.params.id, req.session.user.id]
    );
    if (applications.length === 0) {
      req.flash('error', t(req, 'រកមិនឃើញពាក្យសុំ', 'Application not found'));
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
    req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
    res.redirect('/student/dashboard');
  }
});

router.post('/application/:id/correct', uploadMultiple, async (req, res) => {
  try {
    if (!req.body._csrf || req.body._csrf !== req.session.csrfToken) {
      req.flash('error', t(req, 'តិតុក្កត់ CSRF មិនត្រឹមត្រូវ។ សូមព្យាយាមម្តងទៀត។', 'Invalid or missing CSRF token. Please try again.'));
      return res.redirect('back');
    }
    const [existing] = await req.db.query(
      'SELECT * FROM applications WHERE id = ? AND user_id = ? AND status = ?',
      [req.params.id, req.session.user.id, 'correction_requested']
    );
    if (existing.length === 0) {
      req.flash('error', t(req, 'រកមិនឃើញពាក្យសុំឬមិនមានសិទ្ធិកែប្រែ', 'Application not found or not eligible for correction'));
      return res.redirect('/student/dashboard');
    }

    const {
      khmer_first_name, khmer_last_name, english_first_name, english_last_name,
      gender, date_of_birth, nationality, nationality_other, current_address,
      phone, telegram, email,
      parent_name, parent_phone, emergency_contact, emergency_phone,
      school_name, school_province_id, graduation_year, exam_result,
      major_first_choice_id, major_second_choice_id, scholarship_category_id,
      correction_notes
    } = req.body;

    const finalNationality2 = (nationality === 'Other' && nationality_other) ? nationality_other.trim().substring(0, 50) : (nationality || 'Cambodian');

    let photo = existing[0].photo_path;
    let transcript = existing[0].transcript_path;
    let additionalDocuments = existing[0].additional_documents_path;

    if (req.files && req.files.photo && req.files.photo[0]) {
      const r = await uploadToImageKit(req.files.photo[0], 'application');
      photo = r.url;
    }
    if (req.files && req.files.transcript && req.files.transcript[0]) {
      const r = await uploadToImageKit(req.files.transcript[0], 'application');
      transcript = r.url;
    }
    if (req.files && req.files.additionalDocuments) {
      const urls = [];
      for (const f of req.files.additionalDocuments) {
        const r = await uploadToImageKit(f, 'application');
        urls.push(r.url);
      }
      additionalDocuments = urls.join(',');
    }

    await req.db.query(
      `UPDATE applications SET
        khmer_first_name = ?, khmer_last_name = ?, english_first_name = ?, english_last_name = ?,
        gender = ?, date_of_birth = ?, nationality = ?, current_address = ?,
        phone = ?, telegram = ?, email = ?,
        parent_name = ?, parent_phone = ?, emergency_contact = ?, emergency_phone = ?,
        school_name = ?, school_province_id = ?, graduation_year = ?, exam_result = ?,
        major_first_choice_id = ?, major_second_choice_id = ?, scholarship_category_id = ?,
        photo_path = ?, transcript_path = ?, additional_documents_path = ?,
        status = 'pending'
        WHERE id = ? AND user_id = ?`,
      [
        khmer_first_name, khmer_last_name, english_first_name, english_last_name,
        gender, date_of_birth, finalNationality2, current_address,
        phone, telegram, email,
        parent_name, parent_phone, emergency_contact, emergency_phone,
        school_name, school_province_id, graduation_year, exam_result,
        major_first_choice_id, major_second_choice_id || null, scholarship_category_id,
        photo, transcript, additionalDocuments,
        req.params.id, req.session.user.id
      ]
    );

    await req.db.query(
      'INSERT INTO application_status_history (application_id, new_status, changed_by, notes) VALUES (?, ?, ?, ?)',
      [req.params.id, 'pending', req.session.user.id, correction_notes || 'Application corrected and resubmitted']
    );

    req.flash('success', t(req, 'ពាក្យសុំត្រូវបានកែប្រែនិងដាក់ឡើងវិញដោយជោគជ័យ', 'Application corrected and resubmitted successfully'));
    res.redirect('/student/application/' + req.params.id);
  } catch (error) {
    console.error('Correct application error:', error);
    req.flash('error', t(req, 'មានកំហុសក្នុងការកែប្រែពាក្យសុំ', 'An error occurred while updating application'));
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
    req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
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
    req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
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

function getCurrentAcademicYear() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  if (month >= 10) {
    return `${year}-${year + 1}`;
  }
  return `${year - 1}-${year}`;
}

function getEnrollmentYear() {
  return '2026-2027';
}

const FUNDING_TYPES = ['gov_scholarship', 'nmu_scholarship_100', 'nmu_scholarship_50_4y', 'nmu_scholarship_50_2y', 'mekong_scholarship_40_4y', 'self_pay'];

const FUNDING_COVERAGE = {
  gov_scholarship: 100,
  nmu_scholarship: 100,
  nmu_scholarship_100: 100,
  nmu_scholarship_50_4y: 50,
  nmu_scholarship_50_2y: 50,
  mekong_scholarship_40_4y: 40
};

const FUNDING_ADMIN_FEE = {
  gov_scholarship: 200000
};

const FUNDING_LABELS_KH = {
  gov_scholarship: 'អាហារូបករណ៍រដ្ឋ (អ.យ.ក)',
  nmu_scholarship: 'អាហារូបករណ៍១០០% របស់សាកលវិទ្យាល័យជាតិមានជ័យ',
  nmu_scholarship_100: 'អាហារូបករណ៍១០០% របស់សាកលវិទ្យាល័យជាតិមានជ័យ',
  nmu_scholarship_50_4y: 'អាហារូបករណ៍៥០% រយៈពេល៤ឆ្នាំ របស់សាកលវិទ្យាល័យជាតិមានជ័យ',
  nmu_scholarship_50_2y: 'អាហារូបករណ៍៥០% រយៈពេល២ឆ្នាំ របស់សាកលវិទ្យាល័យជាតិមានជ័យ',
  mekong_scholarship_40_4y: 'អាហារូបករណ៍៤០% រយៈពេល៤ឆ្នាំ របស់អង្គការកុមារមេគង្គកម្ពុជា',
  self_pay: 'សិក្សាបង់ថ្លៃ'
};

function fundingCoverage(fundingType) {
  return FUNDING_COVERAGE[fundingType] || 0;
}

router.get('/enroll-success', async (req, res) => {
  try {
    const [rows] = await req.db.query("SELECT setting_value FROM settings WHERE setting_key = 'payment_qr_path'");
    const qrPath = rows.length > 0 ? rows[0].setting_value : '/images/qr_acleda_nhelkong.jpg';
    const [enrollments] = await req.db.query(
      'SELECT * FROM enrollments WHERE user_id = ? ORDER BY id DESC LIMIT 1',
      [req.session.user.id]
    );
    res.render('student/enroll-success', { title: 'Enrollment Success', qrPath, enrollment: enrollments[0] || null });
  } catch (error) {
    console.error('Enroll success error:', error);
    req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
    res.redirect('/student/dashboard');
  }
});

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
      "SELECT * FROM enrollments WHERE user_id = ? AND academic_year = ? ORDER BY id DESC LIMIT 1",
      [userId, getEnrollmentYear()]
    );
    const selectedFunding = FUNDING_TYPES.includes(req.query.funding) ? req.query.funding : null;
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
      selectedFunding,
      enrollmentYear: getEnrollmentYear(),
      majors: (await req.db.query('SELECT id, name_kh, name_en FROM majors WHERE is_active = 1 ORDER BY name_kh ASC'))[0],
      majorTuition: (await req.db.query("SELECT mt.*, m.name_kh as major_name_kh, m.name_en as major_name_en FROM major_tuition mt JOIN majors m ON mt.major_id = m.id WHERE mt.is_active = 1 AND mt.academic_year = ?", [getEnrollmentYear()]))[0],
      scholarshipTypes: (await req.db.query('SELECT id, name_kh, name_en, coverage_percentage, ministry_fee, duration_years, provider_name FROM scholarship_types WHERE is_active = 1 ORDER BY coverage_percentage ASC'))[0]
    });
  } catch (error) {
    console.error('Enroll page error:', error);
    req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
    res.redirect('/student/dashboard');
  }
});

router.get('/enroll/print', async (req, res) => {
  try {
    const userId = req.session.user.id;
    const [enrollments] = await req.db.query(
      'SELECT * FROM enrollments WHERE user_id = ? ORDER BY id DESC LIMIT 1',
      [userId]
    );
    if (enrollments.length === 0) {
      req.flash('error', t(req, 'សូមចុះឈ្មោះមុនពេលបោះពុម្ព', 'Please enroll before printing'));
      return res.redirect('/student/enroll');
    }
    const enrollment = enrollments[0];
    let major = null;
    if (enrollment.major_choice_id) {
      const [m] = await req.db.query('SELECT name_kh, name_en FROM majors WHERE id = ?', [enrollment.major_choice_id]);
      if (m.length > 0) major = m[0];
    } else if (enrollment.major_choice) {
      const [m] = await req.db.query('SELECT name_kh, name_en FROM majors WHERE name_kh = ? OR name_en = ? LIMIT 1', [enrollment.major_choice, enrollment.major_choice]);
      if (m.length > 0) major = m[0];
    }
    const [users] = await req.db.query('SELECT * FROM users WHERE id = ?', [userId]);
    res.render('student/enroll-print', {
      title: 'Print Enrollment Letter',
      layout: false,
      enrollment,
      major,
      userData: users[0] || null
    });
  } catch (error) {
    console.error('Enroll print error:', error);
    req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
    res.redirect('/student/enroll');
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

router.post('/enroll', uploadEnrollmentDocs, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const {
      khmer_name, english_name,
      gender, date_of_birth, place_of_birth,
      village, commune, district, province,
      father_name, mother_name, occupation, education_level,
      father_alive, father_job, father_org, father_phone,
      mother_alive, mother_job, mother_org, mother_phone,
      phone, guardian_phone,
      exam_session, overall_grade, high_school, high_school_province, exam_center,
      education_level_enroll, major_choice, study_schedule, study_shift,
      doc_transcript, doc_birth_cert, doc_photo_4x6, doc_photo_3x4,
      additional_info, confirmation
    } = req.body;
    const funding_type = req.body.funding_type;
    const funding_payment_mode = funding_type === 'gov_scholarship' ? 'full_pay' : null;

    if (!FUNDING_TYPES.includes(funding_type)) {
      req.flash('error', t(req, 'សូមជ្រើសរើសប្រភេទអាហារូបករណ៍ ឬបង់ថ្លៃមុនចុះឈ្មោះ', 'Please choose a scholarship or pay-the-fee option first'));
      return res.redirect('/student/enroll');
    }

    const academic_year = getEnrollmentYear();
    const semester = '1';

    const [existing] = await req.db.query(
      "SELECT * FROM enrollments WHERE user_id = ? AND academic_year = ? AND semester = ?",
      [userId, academic_year, semester]
    );
    if (existing.length > 0) {
      req.flash('error', t(req, 'បានចុះឈ្មោះរួចហើយសម្រាប់ឆ្នាំសិក្សានេះ', 'Already enrolled for this semester'));
      return res.redirect('/student/enroll');
    }

    let majorId = null;
    let majorName = null;
    if (major_choice) {
      const [majorById] = await req.db.query('SELECT id, name_kh, name_en FROM majors WHERE id = ?', [major_choice]);
      if (majorById.length > 0) {
        majorId = majorById[0].id;
        majorName = majorById[0].name_kh;
      } else {
        const [majorByName] = await req.db.query('SELECT id, name_kh, name_en FROM majors WHERE name_kh = ? OR name_en = ? LIMIT 1', [major_choice, major_choice]);
        if (majorByName.length > 0) {
          majorId = majorByName[0].id;
          majorName = majorByName[0].name_kh;
        }
      }
    }
    if (!majorId) {
      const backUrl = '/student/enroll?funding=' + encodeURIComponent(funding_type);
      req.flash('error', t(req, 'សូមជ្រើសរើសមុខជំនាញដែលចង់សិក្សា', 'Please select the major you want to study'));
      return res.redirect(backUrl);
    }

    const documents = [];
    let doc_transcript_path = null;
    let doc_birth_cert_path = null;
    let doc_photo_4x6_path = null;
    let doc_photo_3x4_path = null;

    if (doc_transcript) {
      documents.push('transcript');
      if (req.files && req.files.doc_transcript_file && req.files.doc_transcript_file[0]) {
        const r = await uploadToImageKit(req.files.doc_transcript_file[0], 'enrollment');
        doc_transcript_path = r.url;
      }
    }
    if (doc_birth_cert) {
      documents.push('birth_cert');
      if (req.files && req.files.doc_birth_cert_file && req.files.doc_birth_cert_file[0]) {
        const r = await uploadToImageKit(req.files.doc_birth_cert_file[0], 'enrollment');
        doc_birth_cert_path = r.url;
      }
    }
    if (doc_photo_4x6) {
      documents.push('photo_4x6');
      if (req.files && req.files.doc_photo_4x6_file && req.files.doc_photo_4x6_file[0]) {
        const r = await uploadToImageKit(req.files.doc_photo_4x6_file[0], 'enrollment');
        doc_photo_4x6_path = r.url;
      }
    }
    if (doc_photo_3x4) {
      documents.push('photo_3x4');
      if (req.files && req.files.doc_photo_3x4_file && req.files.doc_photo_3x4_file[0]) {
        const r = await uploadToImageKit(req.files.doc_photo_3x4_file[0], 'enrollment');
        doc_photo_3x4_path = r.url;
      }
    }

    const siblings = [];
    for (let i = 1; i <= 3; i++) {
      const sName = String(req.body['sibling_' + i + '_name'] || '').trim();
      const sGender = String(req.body['sibling_' + i + '_gender'] || '').trim();
      const sJob = String(req.body['sibling_' + i + '_job'] || '').trim();
      const sPhone = String(req.body['sibling_' + i + '_phone'] || '').trim();
      if (sName || sGender || sJob || sPhone) {
        siblings.push({ name: sName, gender: sGender, job: sJob, phone: sPhone });
      }
    }
    const siblingsInfo = siblings.length > 0 ? JSON.stringify(siblings) : null;

    const studyHistory = {};
    for (const lv of ['primary', 'lower', 'upper', 'university']) {
      const years = String(req.body['study_' + lv + '_years'] || '').trim();
      const cls = String(req.body['study_' + lv + '_class'] || '').trim();
      const school = String(req.body['study_' + lv + '_school'] || '').trim();
      const diploma = String(req.body['study_' + lv + '_diploma'] || '').trim();
      if (years || cls || school || diploma) {
        studyHistory[lv] = { years, class: cls, school, diploma };
      }
    }
    const studyHistoryVal = Object.keys(studyHistory).length > 0 ? JSON.stringify(studyHistory) : null;

    await req.db.query(
      `INSERT INTO enrollments (
        user_id, academic_year, semester, status,
        khmer_first_name, khmer_last_name, english_first_name, english_last_name,
        gender, date_of_birth, place_of_birth, phone,
        village, current_address, province, district, commune,
        father_name, mother_name, occupation, education_level, guardian_phone,
        father_alive, father_job, father_org, father_phone, mother_alive, mother_job, mother_org, mother_phone, siblings_info, study_history,
        exam_session, overall_grade, high_school, high_school_province, exam_center,
        education_level_enroll, major_choice, major_choice_id, funding_type, funding_payment_mode, study_schedule, study_shift,
        documents_checklist, additional_info, confirmation,
        doc_transcript_path, doc_birth_cert_path, doc_photo_4x6_path, doc_photo_3x4_path
      ) VALUES (?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?)`,
      [
        userId, academic_year, semester, 'pending',
        khmer_name || null, null, english_name || null, null,
        gender || null, date_of_birth || null, place_of_birth || null, phone || null,
        village || null, null, province || null, district || null, commune || null,
        father_name || null, mother_name || null, occupation || null, education_level || null, guardian_phone || null,
        father_alive || null, father_job || null, father_org || null, father_phone || null,
        mother_alive || null, mother_job || null, mother_org || null, mother_phone || null,
        siblingsInfo, studyHistoryVal,
        exam_session || null, overall_grade || null, high_school || null, high_school_province || null, exam_center || null,
        education_level_enroll || null, majorName, majorId, funding_type, funding_payment_mode, study_schedule || null, study_shift || null,
        documents.length > 0 ? documents.join(',') : null, additional_info || null, confirmation ? 1 : 0,
        doc_transcript_path, doc_birth_cert_path, doc_photo_4x6_path, doc_photo_3x4_path
      ]
    );
      req.flash('success', t(req, 'ការចុះឈ្មោះត្រូវបានដាក់ស្នើដោយជោគជ័យ', 'Enrollment submitted successfully'));
      res.redirect('/student/enroll-success');
  } catch (error) {
    console.error('Enroll error:', error);
    req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
    res.redirect('/student/enroll');
  }
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
      `SELECT e.major_choice, e.scholarship_category_id, e.funding_type, mt.tuition_per_year, m.name_kh as major_name_kh, m.name_en as major_name_en
       FROM enrollments e
       LEFT JOIN majors m ON (e.major_choice = m.name_kh OR e.major_choice = m.name_en)
       LEFT JOIN major_tuition mt ON mt.major_id = m.id AND mt.is_active = 1
       WHERE e.user_id = ? ORDER BY e.id DESC LIMIT 1`,
      [userId]
    );
    let tuition = enrollmentForTuition[0] ? Number(enrollmentForTuition[0].tuition_per_year) || 0 : 0;
    const majorName = enrollmentForTuition[0] ? (enrollmentForTuition[0].major_name_kh || enrollmentForTuition[0].major_name_en || '') : '';
    const scholarshipCategoryId = enrollmentForTuition[0] ? enrollmentForTuition[0].scholarship_category_id : null;
    const fundingType = enrollmentForTuition[0] ? enrollmentForTuition[0].funding_type : null;
    let scholarshipName = '';
    let coveragePct = null;
    if (scholarshipCategoryId) {
      const [sch] = await req.db.query('SELECT * FROM scholarship_types WHERE id = ?', [scholarshipCategoryId]);
      if (sch.length > 0) {
        coveragePct = Number(sch[0].coverage_percentage);
        scholarshipName = sch[0].name_kh;
        if (tuition > 0) {
          const ministryFee = Number(sch[0].ministry_fee || 0);
          const discount = Math.round(tuition * coveragePct / 100);
          tuition = tuition - discount + ministryFee;
          if (tuition < 0) tuition = 0;
        }
      }
    } else if (fundingType) {
      coveragePct = fundingCoverage(fundingType);
      if (coveragePct > 0) {
        scholarshipName = FUNDING_LABELS_KH[fundingType] || '';
        if (tuition > 0) {
          const discount = Math.round(tuition * coveragePct / 100);
          tuition = tuition - discount + (FUNDING_ADMIN_FEE[fundingType] || 0);
          if (tuition < 0) tuition = 0;
        }
      }
    }
    const totalDue = tuition;
    const yearlyOnly = coveragePct === 100;
    const [qrRows] = await req.db.query("SELECT setting_value FROM settings WHERE setting_key = 'payment_qr_path'");
    const qrPath = qrRows.length > 0 ? qrRows[0].setting_value : '/images/qr_acleda_nhelkong.jpg';
    res.render('student/payments', {
      title: 'My Payments',
      enrollments,
      payments,
      feeTypes,
      totalPaid: totalPaid[0].total || 0,
      totalDue,
      yearlyTuition: tuition,
      majorName,
      scholarshipName,
      yearlyOnly,
      qrPath
    });
  } catch (error) {
    console.error('Payments page error:', error);
    req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
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

    const majorId = enrollment[0].major_choice_id || enrollment[0].major_choice;
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
    let scholarshipApplied = false;
    let coveragePct = null;
    if (scholarshipCategoryId) {
      const [scholarship] = await req.db.query(
        'SELECT * FROM scholarship_types WHERE id = ? AND is_active = 1',
        [scholarshipCategoryId]
      );
      if (scholarship.length > 0) {
        const coverage = Number(scholarship[0].coverage_percentage);
        coveragePct = coverage;
        const ministryFee = Number(scholarship[0].ministry_fee || 0);
        const discount = Math.round(yearlyTuition * coverage / 100);
        studentPayYearly = yearlyTuition - discount + ministryFee;
        if (studentPayYearly < 0) studentPayYearly = 0;
        scholarshipApplied = true;
      }
    }
    if (!scholarshipApplied) {
      const coverage = fundingCoverage(enrollment[0].funding_type);
      coveragePct = coverage;
      studentPayYearly = yearlyTuition - Math.round(yearlyTuition * coverage / 100) + (FUNDING_ADMIN_FEE[enrollment[0].funding_type] || 0);
      if (studentPayYearly < 0) studentPayYearly = 0;
    }

    const payPeriod = coveragePct === 100 ? 'year' : payment_type;
    const paymentAmount = payPeriod === 'semester' ? Math.round(studentPayYearly / 2) : studentPayYearly;

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
      [enrollment_id, userId, feeTypeId, paymentAmount, result.md5Hash, result.qrString, payPeriod]
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

const transactionCheckLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  message: 'Too many transaction checks, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

router.get('/payments/check-transaction/:md5', transactionCheckLimiter, async (req, res) => {
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
        req.flash('error', t(req, err.message || 'ការជោ្នាយប្ន់លង់ការ', err.message || 'File upload error'));
        return res.redirect('/student/payments');
      }
      if (!req.body._csrf || req.body._csrf !== req.session.csrfToken) {
        req.flash('error', t(req, 'សិទ្ធិមិនត្រឹមត្រូវ', 'Invalid CSRF token'));
        return res.redirect('/student/payments');
      }
      const userId = req.session.user.id;
      const { enrollment_id, fee_type_id, amount, payment_method, transaction_ref } = req.body;
      let proofPath = null;
      if (req.file) {
        const r = await uploadToImageKit(req.file, 'payment');
        proofPath = r.url;
      }

      await req.db.query(
        'INSERT INTO payments (enrollment_id, user_id, fee_type_id, amount, payment_method, transaction_ref, proof_path) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [enrollment_id, userId, fee_type_id, parseFloat(amount), payment_method || 'bank_transfer', transaction_ref || '', proofPath]
      );
      req.flash('success', t(req, 'ការទូទាត់ត្រូវបានដាក់ស្នើដោយជោគជ័យ', 'Payment submitted successfully'));
      res.redirect('/student/payments');
    } catch (error) {
      console.error('Payment submit error:', error);
      req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
      res.redirect('/student/payments');
    }
  });
});

module.exports = router;
