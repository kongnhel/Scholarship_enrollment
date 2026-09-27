// CSRF guard for multipart/form-data routes.
//
// The global CSRF check in server.js runs before any route middleware, so multer has
// not parsed the body yet and `req.body._csrf` is still empty for file uploads. It
// therefore skips multipart requests entirely. This guard performs the same check and
// must be registered AFTER the upload middleware so the parsed body is available:
//
//   router.post('/enroll', uploadEnrollmentDocs, verifyCsrf, async (req, res) => { ... });
const verifyCsrf = (req, res, next) => {
  const token = (req.body && req.body._csrf) || req.headers['x-csrf-token'];
  if (!token || token !== req.session.csrfToken) {
    req.flash('error', 'Invalid or missing CSRF token. Please try again.');
    return res.redirect('back');
  }
  return next();
};

module.exports = { verifyCsrf };
