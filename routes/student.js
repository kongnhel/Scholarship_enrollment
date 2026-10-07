const express = require('express');
const router = express.Router();
const { isAuthenticated, isStudent } = require('../middleware/auth');
const { verifyCsrf } = require('../middleware/csrf');
const { ENROLLMENT_ENABLED } = require('../config/features');
const { uploadMultiple, upload, uploadEnrollmentDocs } = require('../middleware/upload');
const { sendEmail } = require('../config/mailer');
const { uploadToImageKit } = require('../utils/imagekit');
const { escapeHtml, saveSession, flashAndRedirect, safeBackPath, dashboardPathFor } = require('../utils/helpers');
const { notifyAdmins } = require('../utils/notifications');
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
       sc.name_kh as category_name_kh, sc.name_en as category_name_en,
       st.name_kh as scholarship_name_kh, st.name_en as scholarship_name_en,
       st.coverage_percentage, st.duration_years, st.provider_name, st.leader_name
       FROM applications a
       LEFT JOIN majors m ON a.major_first_choice_id = m.id
       LEFT JOIN scholarship_categories sc ON a.scholarship_category_id = sc.id
       LEFT JOIN scholarship_types st ON a.scholarship_type_id = st.id
       WHERE a.user_id = ? ORDER BY a.submitted_at DESC`,
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
    const applicationsUsed = applications.filter(a => a.status !== 'rejected').length;
    res.render('student/dashboard', {
      title: 'Student Dashboard',
      application: applications[0] || null,
      applications,
      applicationsUsed,
      maxApplications: MAX_STUDENT_APPLICATIONS,
      canApply: applicationsUsed < MAX_STUDENT_APPLICATIONS,
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
    res.redirect(dashboardPathFor(req));
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

// a student may hold at most MAX_STUDENT_APPLICATIONS live applications
// (rejected ones do not consume a slot)
const MAX_STUDENT_APPLICATIONS = 2;

function countUsedApplications(req) {
  return req.db.query(
    "SELECT COUNT(*) as count FROM applications WHERE user_id = ? AND status <> 'rejected'",
    [req.session.user.id]
  ).then(([rows]) => Number(rows[0] && rows[0].count) || 0);
}

async function applicationLimitReached(req) {
  return (await countUsedApplications(req)) >= MAX_STUDENT_APPLICATIONS;
}

// programs this student already holds a live (non-rejected) application for
function getUsedTypeIds(req) {
  return req.db.query(
    "SELECT DISTINCT scholarship_type_id FROM applications WHERE user_id = ? AND status <> 'rejected' AND scholarship_type_id IS NOT NULL",
    [req.session.user.id]
  ).then(([rows]) => rows.map(r => Number(r.scholarship_type_id)));
}

function sendLimitReached(req, res) {
  const kmDigits = String(MAX_STUDENT_APPLICATIONS).replace(/[0-9]/g, d => '០១២៣៤៥៦៧៨៩'[Number(d)]);
  req.flash('error', t(req,
    `អ្នកបានដាក់ពាក្យសុំអាហារូបករណ៍បានដល់កន្លិតហើយ (អតិបរមា ${kmDigits} ដីរ)។ រូបត្រូវរង់ចាំលទ្ធផលសិនមុនសិរ។`,
    `You have reached the maximum of ${MAX_STUDENT_APPLICATIONS} scholarship applications. Please wait for a result before applying again.`));
  return res.redirect('/student/dashboard');
}

// Online enrollment + tuition payments are paused while the scholarship flow is the focus
// (see config/features.js). Every route below is kept as-is and reactivates with the flag.
function enrollmentPaused(req, res, next) {
  if (ENROLLMENT_ENABLED) return next();
  req.flash('warning', t(req,
    'ការចុះឈ្មោះចូលរៀនតាមអនឡាញ និងការទូទាត់ថ្លៃសិក្សា មិនទាន់បើកនៅឡើយទេ។',
    'Online enrollment and tuition payments are not available yet.'));
  return res.redirect('/student/dashboard');
}

// same guard for the JSON/AJAX endpoints used by the enrollment + payment pages
function enrollmentPausedJson(req, res, next) {
  if (ENROLLMENT_ENABLED) return next();
  return res.status(503).json({
    success: false,
    error: t(req,
      'ការចុះឈ្មោះចូលរៀនតាមអនឡាញ និងការទូទាត់ថ្លៃសិក្សា មិនទាន់បើកនៅឡើយទេ។',
      'Online enrollment and tuition payments are not available yet.')
  });
}

// same guard for multipart form posts: rejects before any file is written to disk.
// it stays ahead of the upload + CSRF middleware, and verifyCsrf still protects the
// route whenever the feature is switched back on.
function enrollmentPausedUpload(req, res, next) {
  if (ENROLLMENT_ENABLED) return next();
  return enrollmentPausedJson(req, res, next);
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
    if (await applicationLimitReached(req)) return sendLimitReached(req, res);
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
    const usedTypeIds = await getUsedTypeIds(req);
    res.render('student/scholarship-select', {
      title: 'Select Scholarship Program',
      scholarshipTypes,
      posters: getPosterImages(),
      selectedScholarshipId: req.session.scholarshipTypeId || null,
      selectedOption: req.session.scholarshipOption || null,
      usedTypeIds
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
    if (await applicationLimitReached(req)) return sendLimitReached(req, res);
    const scholarshipTypeId = parseInt(req.body.scholarship_type_id, 10);
    const usedIds = await getUsedTypeIds(req);
    if (usedIds.indexOf(scholarshipTypeId) !== -1) {
      req.flash('error', t(req, 'អ្នកបានដាក់ពាក្យសុំសម្រាប់កម្មវិធីអាហារូបករណ៍នេះរួចហើយ។ សូមជ្រើសរើសកម្មវិធីផ្សេង៑។', 'You have already applied for this scholarship program. Please choose another one.'));
      return res.redirect('/student/application/select');
    }
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
    // must be durable before the redirect: /student/application/new reads these back
    await saveSession(req);
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
    if (await applicationLimitReached(req)) return sendLimitReached(req, res);

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

    const usedTypeIds = await getUsedTypeIds(req);
    // stale session pointing at a program the student already applied for
    if (req.session.scholarshipTypeId && usedTypeIds.indexOf(Number(req.session.scholarshipTypeId)) !== -1) {
      delete req.session.scholarshipTypeId;
      delete req.session.scholarshipOption;
      return res.redirect('/student/application/select');
    }

    const [majors] = await req.db.query('SELECT id, name_kh, name_en FROM majors WHERE is_active = 1');
    const [provinces] = await req.db.query('SELECT id, name_kh, name_en FROM provinces');
    const [scholarshipTypes] = await req.db.query(
      'SELECT id, name_kh, name_en, coverage_percentage, duration_years, provider_name, leader_name FROM scholarship_types WHERE is_active = 1 ORDER BY id ASC'
    );
    res.render('student/application-form', {
      title: 'New Application',
      majors,
      provinces,
      scholarshipTypes,
      posters: getPosterImages(),
      selectedScholarshipId: req.session.scholarshipTypeId,
      selectedScholarshipOption: req.session.scholarshipOption || '',
      usedTypeIds
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
    if (await applicationLimitReached(req)) return sendLimitReached(req, res);
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
    if (selTypeId) {
      const usedIds = await getUsedTypeIds(req);
      if (usedIds.indexOf(selTypeId) !== -1) {
        req.flash('error', t(req, 'អ្នកបានដាក់ពាក្យសុំសម្រាប់កម្មវិធីអាហារូបករណ៍នេះរួចហើយ។ សូមជ្រើសរើសកម្មវិធីផ្សេង៑។', 'You have already applied for this scholarship program. Please choose another one.'));
        return res.redirect('/student/application/select');
      }
    }
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
          major_first_choice_id, major_second_choice_id || null, selTypeId || null,
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

  // A new application used to sit unnoticed until an admin happened to open the list.
  await notifyAdmins(req.db, {
    title: 'New application submitted',
    message: (khmer_last_name ? khmer_last_name + ' ' : '') + (khmer_first_name || '') +
      ' submitted a new scholarship application.',
    type: 'new_application',
    link: '/admin/applications/' + result.insertId,
    detail: 'Application #' + result.insertId + ' is waiting for review.'
  });

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

router.get('/application/:id/print', async (req, res) => {
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
       WHERE a.id = ? AND a.user_id = ?`, [req.params.id, req.session.user.id]
    );
    if (!application.length) {
      req.flash('error', t(req, 'រកមិនឃើញពាក្យសុំ', 'Application not found'));
      return res.redirect('/student/dashboard');
    }
    res.render('admin/application-print', {
      title: 'Print Application',
      layout: false,
      application: application[0],
      backHref: '/student/application/' + req.params.id
    });
  } catch (error) {
    console.error('Student print error:', error);
    req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
    res.redirect('/student/dashboard');
  }
});

router.post('/application/:id/correct', uploadMultiple, async (req, res) => {
  try {
    if (!req.body._csrf || req.body._csrf !== req.session.csrfToken) {
      req.flash('error', t(req, 'តិតុក្កត់ CSRF មិនត្រឹមត្រូវ។ សូមព្យាយាមម្តងទៀត។', 'Invalid or missing CSRF token. Please try again.'));
      return res.redirect(safeBackPath(req));
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

  // A correction puts the row back into the review queue, so staff need to know it moved.
  await notifyAdmins(req.db, {
    title: 'Application corrected and resubmitted',
    message: 'A student corrected and resubmitted application #' + req.params.id + '.',
    type: 'application_corrected',
    link: '/admin/applications/' + req.params.id,
    detail: (correction_notes || '').trim() || null
  });

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

    // A student needs to see WHY a row is blank, and the admin's note is the reason in
    // most cases. admin_remark was never selected here, so the page silently dropped it
    // and an approved application with a note rendered as if nothing had been recorded.
    // Also surface the second major choice: applications submitted before the first
    // choice was required have major_first_choice_id NULL but a real second choice, so
    // the Major column showed blank for a student who had in fact picked one.
    const [enriched] = await req.db.query(
      `SELECT a.id, a.admin_remark, a.correction_notes,
       m2.name_kh as major_second_name_kh, m2.name_en as major_second_name_en
       FROM applications a
       LEFT JOIN majors m2 ON a.major_second_choice_id = m2.id
       WHERE a.user_id = ?`,
      [req.session.user.id]
    );
    const extra = {};
    enriched.forEach(r => { extra[r.id] = r; });

    res.render('student/status', {
      title: 'Application Status',
      applications: applications.map(a => {
        const e = extra[a.id] || {};
        return Object.assign({}, a, {
          admin_remark: e.admin_remark || null,
          correction_notes: e.correction_notes || null,
          // Fall back to the second choice so a blank Major column means "none chosen"
          // rather than "we forgot to join the first one".
          major_name_kh: a.major_name_kh || e.major_second_name_kh || null,
          major_name_en: a.major_name_en || e.major_second_name_en || null
        });
      })
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
        const [result] = await req.db.query(
            'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0',
            [req.session.user.id]
        );
        // Without a flash the page just re-renders with the button gone, which reads as
        // "nothing happened" and makes the second click land on the Back link next to it.
        // Report the real count so a repeat click says "nothing left to mark" instead of
        // claiming work it did not do.
        const marked = result && result.affectedRows ? result.affectedRows : 0;
        if (marked > 0) {
            return await flashAndRedirect(req, res, 'success', t(req,
                'សារជូនដំណឹងចំនួន ' + marked + ' ត្រូវបានសម្គាល់ថាបានអានរួចហើយ។',
                marked + ' notification' + (marked === 1 ? '' : 's') + ' marked as read.'), '/student/notifications');
        }
        return await flashAndRedirect(req, res, 'warning', t(req, 'មិនមានសារជូនដំណឹងដែលមិនទាន់បានអានទេ។', 'There were no unread notifications.'), '/student/notifications');
    } catch (error) {
        console.error('Mark all read error:', error);
        req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
        res.redirect(safeBackPath(req, '/student/notifications'));
    }
});

router.post('/notification/:id/read', async (req, res) => {
    try {
        await req.db.query(
            'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
            [req.params.id, req.session.user.id]
        );
        req.flash('success', t(req, 'សារជូនដំណឹងត្រូវបានសម្គាល់ថាបានអានរួចហើយ។', 'Notification marked as read.'));
        try {
            await saveSession(req);
        } catch (err) {
            console.error('Session save before redirect failed:', err.message);
        }
        res.redirect(safeBackPath(req, '/student/notifications'));
    } catch (error) {
        console.error('Mark notification read error:', error);
        req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
        res.redirect(safeBackPath(req, '/student/notifications'));
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

// ---------------------------------------------------------------------------
// Single source of truth for facts the student would otherwise enter TWICE.
//
// The scholarship application and the enrollment form both ask for the same real-world
// details, but stored them under different column names (address_village vs village,
// birth_place vs place_of_birth, exam_result vs overall_grade, ...). A student could
// type one birth place on each form and both printouts would be "correct" while
// disagreeing. The approved application is authoritative, so enrollment renders these
// from it rather than asking again.
//
// Each entry is [applicationColumn, enrollmentColumn]. Label keys let the view render a
// read-only row without hard-coding Khmer per field.
const SHARED_APPLICATION_FIELDS = {
  khmer_name: ['khmer_first_name', 'khmer_first_name', 'khmer_last_name'],
  english_name: ['english_first_name', 'english_first_name', 'english_last_name'],
  gender: ['gender', 'gender'],
  date_of_birth: ['date_of_birth', 'date_of_birth'],
  place_of_birth: ['birth_place', 'place_of_birth'],
  current_address: ['address_village', 'village'],
  commune: ['address_commune', 'commune'],
  district: ['address_district', 'district'],
  province: ['address_province', 'province'],
  phone: ['phone', 'phone'],
  parent_name: ['parent_name', 'parent_name'],
  parent_phone: ['parent_phone', 'parent_phone'],
  mother_name: ['mother_name', 'mother_name'],
  occupation: ['occupation', 'occupation'],
  education_level: ['education_level', 'education_level'],
  exam_session: ['exam_session', 'exam_session'],
  exam_center: ['exam_center', 'exam_center'],
  study_shift: ['study_shift', 'study_shift'],
  overall_grade: ['exam_result', 'overall_grade'],
  high_school: ['school_name', 'high_school'],
  high_school_province: ['school_province_id', 'high_school_province'],
  diploma_year: ['graduation_year', 'diploma_year'],
  study_level: ['study_level', 'education_level_enroll'],
  study_schedule: ['study_period', 'study_schedule']
};

/** Labels for the read-only "from your application" panel, in both languages. */
const SHARED_FIELD_LABELS = {
  khmer_name: ['ឈ្មោះ', 'Name'],
  english_name: ['ឈ្មោះជាភាសាអង់គ្លេស', 'English Name'],
  gender: ['ភេទ', 'Gender'],
  date_of_birth: ['ថ្ងៃខែឆ្នាំកើត', 'Date of Birth'],
  place_of_birth: ['ទីកន្លែងកើត', 'Place of Birth'],
  current_address: ['ភូមិ', 'Village'],
  commune: ['ឃុំ ឬសង្កាត់', 'Commune'],
  district: ['ស្រុក ឬខណ្ឌ', 'District'],
  province: ['ខេត្ត ឬរាជធានី', 'Province'],
  phone: ['លេខទូរស័ព្ទ', 'Phone'],
  parent_name: ['ឈ្មោះឪពុក / ម្តាយ', 'Parent Name'],
  parent_phone: ['លេខទូរស័ព្ទឪពុក / ម្តាយ', 'Parent Phone'],
  mother_name: ['ឈ្មោះម្តាយ', "Mother's Name"],
  occupation: ['មុខរាជ្យ', 'Occupation'],
  education_level: ['កម្រិតអប់រំ', 'Education Level'],
  exam_session: ['វគ្គបុប្អន្ត', 'Exam Session'],
  exam_center: ['មជ្ឈមណ្ឌលបុប្អន្ត', 'Exam Centre'],
  study_shift: ['វឺកវិស័យ', 'Study Shift'],
  overall_grade: ['ពិន្ទុបុប្អន្ត', 'Exam Result'],
  high_school: ['សាលារៀនខ្នែរ', 'School'],
  high_school_province: ['ខេត្តសាលា', 'School Province'],
  diploma_year: ['ឆ្នាំបញ្ចប់', 'Graduation Year'],
  study_level: ['កម្រិតសិក្សា', 'Study Level'],
  study_schedule: ['រយៈពេលសិក្សា', 'Study Period']
};

/**
 * Read one value from an application row, handling the name fields which the application
 * splits into first/last but the enrollment form entered as one combined string.
 */
function applicationValue(app, key) {
  if (!app || !key) return null;
  const spec = SHARED_APPLICATION_FIELDS[key];
  if (!spec) return null;
  const v = app[spec[0]];
  if (spec[2]) {
    // Combined name: join the given-name column (spec[0]) with the surname column
    // (spec[2]). Joining spec[0] with spec[1] instead repeated the given name, because
    // spec[1] is the *enrollment* column and for the two name fields that is also the
    // first name -- "Bopha Bopha".
    return [v, app[spec[2]]].filter(Boolean).join(' ').trim() || null;
  }
  return v === undefined || v === null || v === '' ? null : v;
}

// The scholarship application captures the previous education level as free text
// ("Associate / Bachelor"), while the enrollment form offers a fixed list of four options.
// Both the pre-fill and the submit-time override go through this so the value shown on the
// form, the value written to the row, and the value printed later are the same string.
// Returns null when the text is not recognisable, so the caller can leave the field to the
// student instead of locking an empty control.
function mapEducationLevel(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return null;
  if (/កុម្ភ|primary/.test(t)) return 'primary';
  if (/ទុតិយភូមិ|ឌីប្លូម|lower/.test(t)) return 'lower_secondary';
  if (/វិទ្យាល|បាក់|upper/.test(t)) return 'upper_secondary';
  if (/ឧត្តមសិក្សា|សាកលវិទ្យាល័យ|higher|university/.test(t)) return 'higher_education';
  return null;
}

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

// scholarship_option is stored as "<coverage>/<duration>" e.g. "100/4", "50/4", "50/2",
// "40/4". That is the award the committee actually granted, so it - not anything the
// student clicks - decides the funding type recorded on the enrollment. Letting the
// student pick meant someone granted 50% could record a 100% enrollment and be quoted
// half the tuition they owe.
const SCHOLARSHIP_OPTION_FUNDING = {
  '100/4': 'nmu_scholarship_100',
  '100/2': 'nmu_scholarship_100',
  '50/4': 'nmu_scholarship_50_4y',
  '50/2': 'nmu_scholarship_50_2y',
  '40/4': 'mekong_scholarship_40_4y'
};

/**
 * Resolve the funding type an approved application entitles a student to.
 *
 * Only the percentage awards are derivable: scholarship_option is the coverage/duration
 * the committee granted. A GOVERNMENT scholarship is deliberately not derivable -- it is a
 * different scheme with its own admin fee (FUNDING_ADMIN_FEE), and nothing on the
 * applications row identifies it (scholarship_categories has no MoEYS/provider flag), so
 * inferring one would silently relabel a government enrolment as an NMU award and drop
 * the fee. It therefore stays an explicit choice, still gated on an approved application.
 *
 * Returns null when the application grants no recognisable percentage award.
 */
function fundingTypeForApplication(application) {
  if (!application) return null;
  const opt = String(application.scholarship_option || '').trim();
  const derived = SCHOLARSHIP_OPTION_FUNDING[opt];
  return derived && FUNDING_TYPES.includes(derived) ? derived : null;
}

// Single source of truth for what a student owes.
//
// This arithmetic used to be duplicated: the KHQR-generation route derived the amount
// from major_tuition, while the manual "submit payment proof" route trusted a hidden
// `amount` input that the browser controlled outright. The KHQR route is gone (students
// scan a QR the admin uploaded instead), so this is now the only implementation - which
// is exactly why it must stay the only one, and why the browser's amount is ignored.
async function computeTuitionDue(db, enrollment) {
    const majorId = enrollment.major_choice_id || enrollment.major_choice;
    if (!majorId) return { error: 'No major selected in enrollment' };

    const [tuition] = await db.query(
        'SELECT * FROM major_tuition WHERE major_id = ? AND is_active = 1 ORDER BY academic_year DESC LIMIT 1',
        [majorId]
    );
    if (tuition.length === 0) return { error: 'No tuition set for your major' };

    const yearlyTuition = Number(tuition[0].tuition_per_year);
    let coveragePct = null;
    let owed = yearlyTuition;
    let scholarshipApplied = false;

    if (enrollment.scholarship_category_id) {
        const [scholarship] = await db.query(
            'SELECT * FROM scholarship_types WHERE id = ? AND is_active = 1',
            [enrollment.scholarship_category_id]
        );
        if (scholarship.length > 0) {
            coveragePct = Number(scholarship[0].coverage_percentage);
            const ministryFee = Number(scholarship[0].ministry_fee || 0);
            owed = yearlyTuition - Math.round(yearlyTuition * coveragePct / 100) + ministryFee;
            scholarshipApplied = true;
        }
    }
    if (!scholarshipApplied) {
        coveragePct = fundingCoverage(enrollment.funding_type);
        owed = yearlyTuition - Math.round(yearlyTuition * coveragePct / 100)
            + (FUNDING_ADMIN_FEE[enrollment.funding_type] || 0);
    }
    if (owed < 0) owed = 0;

    return { yearlyTuition, coveragePct, owedYearly: owed, semesterAmount: Math.round(owed / 2) };
}

router.get('/enroll-success', enrollmentPaused, async (req, res) => {
  try {
const [enrollments] = await req.db.query(
        'SELECT * FROM enrollments WHERE user_id = ? ORDER BY id DESC LIMIT 1',
        [req.session.user.id]
      );
      // The bank is chosen on /student/payments, so this page no longer carries a QR.
      res.render('student/enroll-success', { title: 'Enrollment Success', enrollment: enrollments[0] || null });
  } catch (error) {
    console.error('Enroll success error:', error);
    req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
    res.redirect('/student/dashboard');
  }
});

router.get('/enroll', enrollmentPaused, async (req, res) => {
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
    // Two different applications are needed, and they must not be confused:
    //  - `application` drives the form's pre-filled values (newest of any status)
    //  - `approvedApplication` decides what funding the student is entitled to
    // Previously one unfiltered `LIMIT 1` row served both, so a newer *pending*
    // application could supply the form data while the POST recorded the *approved* one
    // as application_id - two different records for one enrollment.
    const [applications] = await req.db.query(
      'SELECT a.*, m.name_kh as major_first_name_kh, m2.name_kh as major_second_name_kh, p.name_kh as province_name_kh FROM applications a LEFT JOIN majors m ON a.major_first_choice_id = m.id LEFT JOIN majors m2 ON a.major_second_choice_id = m2.id LEFT JOIN provinces p ON a.school_province_id = p.id WHERE a.user_id = ? ORDER BY a.submitted_at DESC LIMIT 1',
      [userId]
    );
    const [approvedApplications] = await req.db.query(
      "SELECT a.*, m.name_kh as major_first_name_kh, m2.name_kh as major_second_name_kh, p.name_kh as province_name_kh FROM applications a LEFT JOIN majors m ON a.major_first_choice_id = m.id LEFT JOIN majors m2 ON a.major_second_choice_id = m2.id LEFT JOIN provinces p ON a.school_province_id = p.id WHERE a.user_id = ? AND a.status = 'approved' ORDER BY a.submitted_at DESC LIMIT 1",
      [userId]
    );
    const approvedApplication = approvedApplications[0] || null;
    const entitledFunding = fundingTypeForApplication(approvedApplication);
    // Which tiles to offer. `self_pay` is always available. A government scholarship is
    // an explicit scheme the student selects (the data model cannot derive it from the
    // application), so it is offered whenever an approved application backs the enrolment.
    // The percentage award itself is offered only when that is what was granted.
    const allowedFunding = ['self_pay'];
    if (approvedApplication) {
      if (entitledFunding) allowedFunding.push(entitledFunding);
      if (entitledFunding !== 'gov_scholarship') allowedFunding.push('gov_scholarship');
    }

    // Majors this student has already asked for, to float to the top of the picker.
    // Only APPROVED applications count: a pending or rejected application is not a
    // statement of settled intent, and steering a student back towards the major on a
    // rejected application would be actively unhelpful.
    // Both the first and second choice count, newest application first, and the list is
    // ordered rather than set-derived so the display order is deterministic.
    const [requestedMajors] = await req.db.query(
      `SELECT a.major_first_choice_id, a.major_second_choice_id, a.submitted_at
       FROM applications a
       WHERE a.user_id = ? AND a.status = 'approved'
       ORDER BY a.submitted_at DESC, a.id DESC`,
      [userId]
    );
    const suggestedMajorIds = [];
    requestedMajors.forEach(r => {
      [r.major_first_choice_id, r.major_second_choice_id].forEach(id => {
        if (id && suggestedMajorIds.indexOf(Number(id)) === -1) suggestedMajorIds.push(Number(id));
      });
    });

    // Which majors actually have a price. This mirrors computeTuitionDue() exactly --
    // that lookup takes the newest ACTIVE row for ANY academic year
    // (ORDER BY academic_year DESC LIMIT 1, no year filter). Scoping this to the
    // enrollment year instead would flag every major right now, because 2026-2027 has no
    // tuition rows, and the marker would be noise rather than information.
    const [pricedMajorRows] = await req.db.query(
      'SELECT DISTINCT major_id FROM major_tuition WHERE is_active = 1'
    );
    const pricedMajorIds = pricedMajorRows.map(r => Number(r.major_id));
    // Pre-fill from the approved application when there is one, so the values shown and
    // the record the enrollment will point at are always the same row.
    const application = approvedApplication || applications[0] || null;
    const [existingEnrollment] = await req.db.query(
      "SELECT * FROM enrollments WHERE user_id = ? AND academic_year = ? ORDER BY id DESC LIMIT 1",
      [userId, getEnrollmentYear()]
    );
    // A scholarship funding choice is only offered when it is the one the application
    // actually granted; otherwise the tiles fall back to self_pay only.
    const requestedFunding = FUNDING_TYPES.includes(req.query.funding) ? req.query.funding : null;
    const selectedFunding =
      allowedFunding.indexOf(requestedFunding) !== -1 ? requestedFunding : null;
    const [feeTypes] = await req.db.query('SELECT * FROM fee_types WHERE is_active = 1 ORDER BY id ASC');
    const [payments] = await req.db.query(
      'SELECT p.*, ft.name_kh as fee_name_kh, ft.name_en as fee_name_en FROM payments p JOIN fee_types ft ON p.fee_type_id = ft.id WHERE p.user_id = ? ORDER BY p.created_at DESC',
      [userId]
    );
    // Values to pre-fill the enrollment form from the student's own application.
  //
  // The view used to read `application.<column>` inline, but several of those column names
  // do not exist on `applications`: the form asked for place_of_birth/village/commune/
  // district/province where the table stores birth_place/address_village/
  // address_commune/address_district/address_province, and father_name was gated on a
  // parent_relationship column that was never created. Every one of those silently
  // evaluated to an empty string, so students were asked to retype data they had already
  // submitted. Resolving the mapping once here -- from the same table the POST validates
  // against -- fixes the whole class of mismatch at its source.
  const prefillSource = application || approvedApplication;
  const sharedValues = {};
  if (prefillSource) {
    Object.keys(SHARED_APPLICATION_FIELDS).forEach(key => {
      sharedValues[key] = applicationValue(prefillSource, key);
    });
    // The application stores the school province as an id; the form wants the name.
    sharedValues.high_school_province = prefillSource.province_name_kh || null;
    // applications records ONE parent in parent_name, while the form asks for father and
    // mother separately, and nothing in the table says which is which. Prefer mother_name
    // when it is known, and only fall back to parent_name for the father.
    sharedValues.father_name = prefillSource.parent_name || null;
    sharedValues.mother_name = prefillSource.mother_name || null;
    // The application captures the previous education level as free text while the
    // enrollment form offers a fixed list, so map it onto an option where the text is
    // recognisable and leave it null otherwise (the field then stays unlocked).
    sharedValues.education_level = mapEducationLevel(sharedValues.education_level);
  }

  res.render('student/enroll', {
      title: 'Enrollment',
      userData: users[0] || null,
      application,
      approvedApplication,
      sharedValues,
      entitledFunding,
      hasApprovedScholarship: !!approvedApplication,
      allowedFunding,
      suggestedMajorIds,
      pricedMajorIds,
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

router.get('/enroll/print', enrollmentPaused, async (req, res) => {
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

router.get('/enroll/tuition/:majorId', enrollmentPausedJson, async (req, res) => {
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

router.post('/enroll', enrollmentPausedUpload, uploadEnrollmentDocs, verifyCsrf, async (req, res) => {
  try {
    const userId = req.session.user.id;
    let {
      khmer_name, english_name,
      gender, date_of_birth, place_of_birth,
      village, commune, district, province,
      father_name, mother_name, occupation, education_level,
      exam_session, overall_grade, high_school, high_school_province, exam_center,
      education_level_enroll, major_choice, study_schedule, study_shift,
      doc_transcript, doc_birth_cert, doc_photo_4x6, doc_photo_3x4,
      confirmation
    } = req.body;
    // funding_type arrives from a hidden field, so it is NOT trusted. It is re-derived from
    // the approved application below; the only value the client genuinely owns is
    // 'self_pay', which is always available to everyone.
    const requestedFunding = req.body.funding_type;

    if (!FUNDING_TYPES.includes(requestedFunding)) {
      req.flash('error', t(req, 'សូមជ្រើសរើសប្រភេទអាហារូបករណ៍ ឬបង់ថ្លៃមុនចុះឈ្មោះ', 'Please choose a scholarship or pay-the-fee option first'));
      return res.redirect('/student/enroll');
    }

    // The approved application is the authority for both the link and the funding type.
    // Selecting the full row (not just the id) is what lets funding be derived here.
    const [approvedRows] = await req.db.query(
      "SELECT * FROM applications WHERE user_id = ? AND status = 'approved' ORDER BY submitted_at DESC LIMIT 1",
      [userId]
    );
    const approvedApplication = approvedRows[0] || null;
    const approvedApplicationId = approvedApplication ? approvedApplication.id : null;
    const entitledFunding = fundingTypeForApplication(approvedApplication);

    const isSelfPay = requestedFunding === 'self_pay';
    if (!isSelfPay && !approvedApplicationId) {
      req.flash('error', t(req, 'អ្នកមិនមានពាក្យសុំអាហារូបករណ៍ដែលត្រូវបានអនុម័តនៅឡើយទេ។', 'You have no approved scholarship application.'));
      return res.redirect('/student/enroll');
    }

    // A student may always pay their own way, and a GOVERNMENT scholarship is an explicit
    // scheme with its own admin fee rather than a percentage award, so both are honoured
    // as chosen - the approved-application gate above still applies to the latter. Every
    // other scholarship is derived from the application, so submitting 100/4 in the hidden
    // field while holding a 50/4 award still stores 50/4: an award cannot be upgraded by
    // editing a hidden input.
    const isExplicitScheme = requestedFunding === 'self_pay' || requestedFunding === 'gov_scholarship';
    const funding_type = isExplicitScheme ? requestedFunding : (entitledFunding || 'self_pay');

    // The approved application is authoritative for every fact it already records.
    // The form still POSTs these fields (they are rendered read-only, but a read-only
    // input is still an input), so the submitted values are discarded here rather than
    // trusted -- otherwise removing the `readonly` attribute in devtools would let a
    // student write a different birth place onto the enrollment record.
    // Only fields the application actually has a value for are overridden, so a
    // self-paying student with no application keeps whatever they entered.
    if (approvedApplication) {
      const applyFromApplication = (key, target) => {
        const v = applicationValue(approvedApplication, key);
        return v ? v : target;
      };
      khmer_name = applyFromApplication('khmer_name', khmer_name);
      english_name = applyFromApplication('english_name', english_name);
      gender = applyFromApplication('gender', gender);
      date_of_birth = applyFromApplication('date_of_birth', date_of_birth);
      place_of_birth = applyFromApplication('place_of_birth', place_of_birth);
      village = applyFromApplication('current_address', village);
      commune = applyFromApplication('commune', commune);
      district = applyFromApplication('district', district);
      province = applyFromApplication('province', province);
      mother_name = applyFromApplication('mother_name', mother_name);
      occupation = applyFromApplication('occupation', occupation);
      // Stored as the mapped option, not the application's raw text, so the stored value is one
      // the form can actually show and the print can reproduce.
      education_level = mapEducationLevel(applyFromApplication('education_level', education_level)) || education_level;
      exam_session = applyFromApplication('exam_session', exam_session);
      exam_center = applyFromApplication('exam_center', exam_center);
      study_shift = applyFromApplication('study_shift', study_shift);
      overall_grade = applyFromApplication('overall_grade', overall_grade);
      high_school = applyFromApplication('high_school', high_school);
      high_school_province = applyFromApplication('high_school_province', high_school_province);
      education_level_enroll = applyFromApplication('study_level', education_level_enroll);
      study_schedule = applyFromApplication('study_schedule', study_schedule);
      father_name = applyFromApplication('parent_name', father_name);
    }
    const fundingPaymentMode = funding_type === 'gov_scholarship' ? 'full_pay' : null;

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



    // The application stores the name split into first/last; the enrollment form has one
    // combined box. Previously the combined string went into khmer_first_name with
    // khmer_last_name hard-coded NULL, so every enrollment printout and the admin list
    // showed the surname sitting in the given-name field and left the surname blank.
    // Prefer the application's own split; otherwise split the combined value so the two
    // parts are at least not lost.
    const splitName = (full) => {
      const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) return { first: null, last: null };
      if (parts.length === 1) return { first: parts[0], last: null };
      return { first: parts[0], last: parts.slice(1).join(' ') };
    };
    const khmerNameParts = approvedApplication && approvedApplication.khmer_last_name
      ? { first: approvedApplication.khmer_first_name, last: approvedApplication.khmer_last_name }
      : splitName(khmer_name);
    const englishNameParts = approvedApplication && approvedApplication.english_last_name
      ? { first: approvedApplication.english_first_name, last: approvedApplication.english_last_name }
      : splitName(english_name);

    const [enrollmentInsert] = await req.db.query(
      `INSERT INTO enrollments (
        user_id, academic_year, semester, status, application_id,
        khmer_first_name, khmer_last_name, english_first_name, english_last_name,
        gender, date_of_birth, place_of_birth,
        village, current_address, province, district, commune,
        father_name, mother_name, occupation, education_level,
        exam_session, overall_grade, high_school, high_school_province, exam_center,
        education_level_enroll, major_choice, major_choice_id, funding_type, funding_payment_mode, study_schedule, study_shift,
        documents_checklist, confirmation,
        doc_transcript_path, doc_birth_cert_path, doc_photo_4x6_path, doc_photo_3x4_path
      ) VALUES (?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?)`,
      [
        userId, academic_year, semester, 'pending', approvedApplicationId,
        khmerNameParts.first || null, khmerNameParts.last || null, englishNameParts.first || null, englishNameParts.last || null,
        gender || null, date_of_birth || null, place_of_birth || null,
        village || null, null, province || null, district || null, commune || null,
        father_name || null, mother_name || null, occupation || null, education_level || null,
        exam_session || null, overall_grade || null, high_school || null, high_school_province || null, exam_center || null,
        education_level_enroll || null, majorName, majorId, funding_type, fundingPaymentMode, study_schedule || null, study_shift || null,
        documents.length > 0 ? documents.join(',') : null, confirmation ? 1 : 0,
        doc_transcript_path, doc_birth_cert_path, doc_photo_4x6_path, doc_photo_3x4_path
      ]
    );
      req.flash('success', t(req, 'ការចុះឈ្មោះត្រូវបានដាក់ស្នើដោយជោគជ័យ', 'Enrollment submitted successfully'));

  // The enrollment sits at status 'pending' until staff act on it, so tell them it exists.
  await notifyAdmins(req.db, {
    title: 'New enrollment submitted',
    message: (khmerNameParts.last ? khmerNameParts.last + ' ' : '') + (khmerNameParts.first || '') +
      ' submitted an enrollment for ' + (majorName || 'an undeclared major') + '.',
    type: 'new_enrollment',
    link: '/admin/enrollments/' + enrollmentInsert.insertId,
    detail: 'Enrollment #' + enrollmentInsert.insertId + ' is waiting for approval.'
  });
      res.redirect('/student/enroll-success');
  } catch (error) {
    console.error('Enroll error:', error);
    req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
    res.redirect('/student/enroll');
  }
});

// ==================== PAYMENTS ====================

router.get('/payments', enrollmentPaused, async (req, res) => {
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
// Active banks the student can pay through. Sorted by sort_order so the admin controls the
// order they appear in. A bank is only offered while it is active, so deactivating one
// removes it from the picker without touching historical payments.
const [banks] = await req.db.query(
  'SELECT id, name_kh, name_en, account_name, account_number, qr_path, instructions FROM payment_banks WHERE is_active = 1 ORDER BY sort_order ASC, id ASC');
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
 banks
});
  } catch (error) {
    console.error('Payments page error:', error);
    req.flash('error', t(req, 'មានកំហុស', 'An error occurred'));
    res.redirect('/student/dashboard');
  }
});

router.post('/payments', enrollmentPaused, (req, res) => {
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
            // `amount` is deliberately ignored. The form ships it in a hidden input that
            // the browser controls, so a student could declare any figure they liked -
            // including 1 KHR against a full tuition fee. The amount owed is derived from
            // major_tuition and the scholarship coverage instead.
            const { enrollment_id, transaction_ref } = req.body;

            // Same reasoning for the fee type: payments.fee_type_id is NOT NULL, so it
            // must always resolve to a real row. The submitted value is honoured, but
            // validated against the active list - previously this was taken on trust, and
            // before the server-derived change it was taken on trust AND crashed when
            // absent. A student must be able to pick the kind of payment they are making.
            const [feeTypes] = await req.db.query('SELECT id FROM fee_types WHERE is_active = 1 ORDER BY id ASC');
            if (feeTypes.length === 0) {
                return await flashAndRedirect(req, res, 'error',
                    t(req, 'មិនទាន់មានប្រភេទថ្លៃសិក្សា', 'No active fee type is configured.'), '/student/payments');
            }
            const activeFeeTypeIds = feeTypes.map(f => Number(f.id));
            const chosenFeeTypeId = Number(req.body.fee_type_id);
            const feeTypeId = activeFeeTypeIds.indexOf(chosenFeeTypeId) !== -1
                ? chosenFeeTypeId
                : activeFeeTypeIds[0];

            if (!enrollment_id) {
                return await flashAndRedirect(req, res, 'error',
                    t(req, 'សូមជ្រើសរើសការចុះឈ្មោះ', 'Please choose an enrollment.'), '/student/payments');
            }

            // The select only ever offered the student's own enrollments, but that is a UI
            // constraint, not a control: the id arrived from the browser and was previously
            // inserted unchecked, so a student could file a payment against somebody
            // else's enrollment. Re-read it scoped to this user.
            const [enrollmentRows] = await req.db.query(
                'SELECT * FROM enrollments WHERE id = ? AND user_id = ?',
                [enrollment_id, userId]
            );
            if (enrollmentRows.length === 0) {
                return await flashAndRedirect(req, res, 'error',
                    t(req, 'រកមិនឃើញការចុះឈ្មោះនេះ។', 'Enrollment not found.'), '/student/payments');
            }
            const enrollment = enrollmentRows[0];

            const due = await computeTuitionDue(req.db, enrollment);
            if (due.error) {
                return await flashAndRedirect(req, res, 'error', t(req, 'មានកំហុស', due.error), '/student/payments');
            }

            // Only the two periods the form offers are accepted, and the amount always
            // comes from the calculation above. An unrecognised or missing period falls
            // back to the full year, so omitting it can never be cheaper.
            const payPeriod = req.body.pay_period === 'semester' ? 'semester' : 'year';
            const amount = payPeriod === 'semester' ? due.semesterAmount : due.owedYearly;

            // Nothing stopped the same proof being posted repeatedly, so one enrollment
            // could accumulate an unbounded pile of pending rows. Keyed on amount too, so
            // a genuine second instalment (a different figure) is still allowed through.
            const [pending] = await req.db.query(
                "SELECT id FROM payments WHERE enrollment_id = ? AND user_id = ? AND amount = ? AND status = 'pending'",
                [enrollment_id, userId, amount]
            );
            if (pending.length > 0) {
                return await flashAndRedirect(req, res, 'warning',
                    t(req, 'មានការទូទាត់ដដែលកំពុងរង់ចាំការត្រួតពិនិត្យរួចហើយ។',
                        'A payment of that amount is already awaiting review.'), '/student/payments');
            }

            let proofPath = null;
            if (req.file) {
                const r = await uploadToImageKit(req.file, 'payment');
                proofPath = r.url;
            }

// Which bank the student paid through. Validated against the ACTIVE list rather than
// trusted: a forged id, or a bank the admin deactivated after the page was rendered, must
// not end up recorded on the payment. There is no default -- a student has to actually pick.
const requestedBankId = parseInt(req.body.bank_id, 10);
if (!Number.isInteger(requestedBankId)) {
  return await flashAndRedirect(req, res, 'error', t(req,
    'សូមជ្រើសធនាគារដែលត្រូវបង់ប្រាក់។',
    'Please choose a bank to pay through.'), '/student/payments');
}
const [chosenBank] = await req.db.query(
  'SELECT id, name_en, name_kh FROM payment_banks WHERE id = ? AND is_active = 1', [requestedBankId]);
if (chosenBank.length === 0) {
  return await flashAndRedirect(req, res, 'error', t(req,
    'ធនាគារនេះមិនទាន់អាចប្រើបាន។ សូមជ្រើសធនាគារផ្សេង។',
    'That bank is no longer available. Please choose another.'), '/student/payments');
}

await req.db.query(
    'INSERT INTO payments (enrollment_id, user_id, fee_type_id, amount, payment_method, bank_id, transaction_ref, proof_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [enrollment_id, userId, feeTypeId, amount, 'bank_transfer', requestedBankId, transaction_ref || payPeriod, proofPath]
  );
// A pending payment has to be matched against the QR slip by hand, so staff need it.
  await notifyAdmins(req.db, {
    title: 'New payment submitted',
    message: 'A student submitted a payment of ' + Math.round(amount).toLocaleString('en-US') +
      '៛ against enrollment #' + enrollment_id + '.',
    type: 'new_payment',
    // There is no per-payment admin page; the payments list IS the verification queue.
    link: '/admin/payments',
    detail: (transaction_ref || '').trim() || null
  });

  await flashAndRedirect(req, res, 'success',
    t(req, 'ការទូទាត់ត្រូវបានដាក់ស្នើដោយជោគជ័យ', 'Payment submitted successfully'), '/student/payments');
        } catch (error) {
            console.error('Payment submit error:', error);
            await flashAndRedirect(req, res, 'error', t(req, 'មានកំហុស', 'An error occurred'), '/student/payments');
        }
    });
});

module.exports = router;
