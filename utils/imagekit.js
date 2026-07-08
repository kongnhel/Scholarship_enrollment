const imagekit = require('../config/imagekit');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const FOLDER_MAP = {
  profile: 'scholarship/profiles',
  enrollment: 'scholarship/enrollments',
  application: 'scholarship/applications',
  payment: 'scholarship/payments'
};

async function uploadToImageKit(file, folderType) {
  const ext = path.extname(file.originalname);
  const fileName = `${uuidv4()}${ext}`;
  const folder = FOLDER_MAP[folderType] || 'scholarship/misc';

  const result = await imagekit.upload({
    file: file.buffer,
    fileName: fileName,
    folder: folder,
    useUniqueFileName: false
  });

  return {
    url: result.url,
    fileId: result.fileId,
    name: result.name
  };
}

async function deleteFromImageKit(fileId) {
  if (!fileId) return;
  try {
    await imagekit.deleteFile(fileId);
  } catch (e) {
    console.error('ImageKit delete error:', e.message);
  }
}

function extractFileId(url) {
  if (!url || !url.includes('imagekit.io')) return null;
  try {
    const parts = url.split('/imagekit.io/');
    if (parts.length < 2) return null;
    const pathPart = parts[1];
    const segments = pathPart.split('/');
    if (segments.length >= 3) {
      return segments.slice(2).join('/');
    }
    return null;
  } catch (e) {
    return null;
  }
}

module.exports = { uploadToImageKit, deleteFromImageKit, extractFileId, FOLDER_MAP };
