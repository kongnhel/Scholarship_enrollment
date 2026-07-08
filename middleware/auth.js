const isAuthenticated = (req, res, next) => {
  if (req.session.user) {
    return next();
  }
  req.flash('error', 'Please log in to continue');
  return res.redirect('/auth/login');
};

const isAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  req.flash('error', 'Access denied. Admin privileges required.');
  return res.redirect('/');
};

const isCommittee = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'committee') {
    return next();
  }
  req.flash('error', 'Access denied. Committee privileges required.');
  return res.redirect('/');
};

const isStudent = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'student') {
    return next();
  }
  req.flash('error', 'Access denied. Student privileges required.');
  return res.redirect('/');
};

module.exports = {
  isAuthenticated,
  isAdmin,
  isCommittee,
  isStudent
};
