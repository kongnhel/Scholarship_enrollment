const multer = require('multer');

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, JPEG, and PNG are allowed.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 }
});

const uploadPhoto = upload.single('photo');
const uploadMultiple = upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'transcript', maxCount: 1 },
  { name: 'nationalId', maxCount: 1 },
  { name: 'additionalDocuments', maxCount: 5 }
]);

const uploadEnrollmentDocs = upload.fields([
  { name: 'doc_transcript_file', maxCount: 1 },
  { name: 'doc_birth_cert_file', maxCount: 1 },
  { name: 'doc_photo_4x6_file', maxCount: 1 },
  { name: 'doc_photo_3x4_file', maxCount: 1 }
]);

module.exports = {
  upload,
  uploadPhoto,
  uploadMultiple,
  uploadEnrollmentDocs
};
