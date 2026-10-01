const { dashboardPathFor } = require('../utils/helpers');

// A role mismatch used to `res.redirect('/')`. That lands the user on the public
// marketing page while their session is still valid, so it reads as "I got logged out"
// even though nothing was logged out -- and the flash message disappears before it can be
// read. Send them to THEIR OWN dashboard instead: still denied, but somewhere that makes
// sense for them and shows they are still signed in.

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
  return res.redirect(dashboardPathFor(req));
};

const isCommittee = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'committee') {
    return next();
  }
  req.flash('error', 'Access denied. Committee privileges required.');
  return res.redirect(dashboardPathFor(req));
};

const isStudent = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'student') {
    return next();
  }
  req.flash('error', 'Access denied. Student privileges required.');
  return res.redirect(dashboardPathFor(req));
};

module.exports = {
  isAuthenticated,
  isAdmin,
  isCommittee,
  isStudent
};