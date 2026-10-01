const multer = require('multer');
const path = require('path');

const storage = multer.memoryStorage();

// Only these extensions are ever stored. The extension is matched against the
// allowlist rather than trusted: multer's `file.mimetype` comes straight from the
// client-supplied multipart Content-Type, so checking it proves nothing. A file named
// `photo.jpg'-alert(1)-'` claims image/jpeg just as easily as a real photo, and that
// name used to flow into the database and then into inline JS on the admin page.
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.pdf'];
const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];

const extensionOf = (originalname) => path.extname(String(originalname || '')).toLowerCase();

const fileFilter = (req, file, cb) => {
  const ext = extensionOf(file.originalname);
  if (ALLOWED_EXTENSIONS.indexOf(ext) === -1) {
    return cb(new Error('Invalid file type. Allowed: JPG, PNG, PDF.'), false);
  }
  if (ALLOWED_MIME.indexOf(String(file.mimetype).toLowerCase()) === -1) {
    return cb(new Error('Invalid file type. Allowed: JPG, PNG, PDF.'), false);
  }
  cb(null, true);
};

// Per-request caps. Without these, memoryStorage buffers everything it is sent: the
// application form allows 8 files, so ~40 MB of RAM could be held per request by a
// single authenticated (or cross-site multipart) POST.
//
// `parts` is sized PER FORM, because multer counts every field as well as every file
// and the forms are nowhere near the same size:
//
//   payments / admin single-file forms .......... ~8 parts
//   application form (37 fields + up to 8 files)  ~45 parts
//   enrollment form   (52 fields + 4 files)       56 parts  <-- was 4 away from the
//                                                              old shared cap of 60,
//                                                              so adding one field to
//                                                              that form would have
//                                                              blocked EVERY student
//                                                              from enrolling, with
//                                                              only "too many files"
//                                                              shown to explain it.
//
// The wide cap is deliberately generous so the enrollment form has real headroom, not
// 4 spare parts. fieldSize still bounds any single field, and files:10 still bounds the
// file count, so a hostile POST cannot use the larger part ceiling to hold more files.
const makeUploader = (parts) => multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024,
    files: 10,
    parts,
    fieldSize: 1024 * 1024
  }
});

// Small forms keep the tight cap.
const upload = makeUploader(60);
// The two 40+ field forms get their own uploader.
const uploadWideForm = makeUploader(90);

const uploadPhoto = upload.single('photo');
const uploadMultiple = uploadWideForm.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'photo_3x4', maxCount: 1 },
  { name: 'transcript', maxCount: 1 },
  { name: 'additionalDocuments', maxCount: 5 }
]);

const uploadEnrollmentDocs = uploadWideForm.fields([
  { name: 'doc_transcript_file', maxCount: 1 },
  { name: 'doc_birth_cert_file', maxCount: 1 },
  { name: 'doc_photo_4x6_file', maxCount: 1 },
  { name: 'doc_photo_3x4_file', maxCount: 1 }
]);

module.exports = {
  upload,
  uploadPhoto,
  uploadMultiple,
  uploadEnrollmentDocs,
  ALLOWED_EXTENSIONS
};
