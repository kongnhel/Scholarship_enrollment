const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'uploads'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

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
  limits: { fileSize: 5 * 1024 * 1024 }
});

const uploadPhoto = upload.single('photo');
const uploadTranscript = upload.single('transcript');
const uploadNationalId = upload.single('nationalId');
const uploadAdditionalDocuments = upload.single('additionalDocuments');

const uploadMultiple = upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'transcript', maxCount: 1 },
  { name: 'nationalId', maxCount: 1 },
  { name: 'additionalDocuments', maxCount: 5 }
]);

module.exports = {
  uploadPhoto,
  uploadMultiple
};
