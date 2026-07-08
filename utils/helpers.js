const { v4: uuidv4 } = require('uuid');

const formatDate = (date) => {
  if (!date) return '';
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
};

const formatDateShort = (date) => {
  if (!date) return '';
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

const getStatusColor = (status) => {
  const colors = {
    pending: 'badge-warning',
    approved: 'badge-success',
    rejected: 'badge-danger',
    under_review: 'badge-info',
    submitted: 'badge-primary'
  };
  return colors[status] || 'badge-secondary';
};

const getStatusText = (status, lang = 'en') => {
  const statuses = {
    pending: { en: 'Pending', km: 'កំពុងរង់ចាំ' },
    approved: { en: 'Approved', km: 'បានយល់ព្រម' },
    rejected: { en: 'Rejected', km: 'បានបដិសេធ' },
    under_review: { en: 'Under Review', km: 'កំពុងពិនិត្យ' },
    submitted: { en: 'Submitted', km: 'បានដាក់ស្នើ' }
  };
  return statuses[status]?.[lang] || statuses[status]?.['en'] || status;
};

const truncate = (str, len = 50) => {
  if (!str) return '';
  if (str.length <= len) return str;
  return str.substring(0, len) + '...';
};

const generateToken = () => {
  return uuidv4();
};

module.exports = {
  formatDate,
  formatDateShort,
  getStatusColor,
  getStatusText,
  truncate,
  generateToken
};
