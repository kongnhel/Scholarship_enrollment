// Feature switches.
//
// ENROLLMENT_ENABLED turns the whole online-enrollment + tuition-payment module on or off.
// It is currently false because the scholarship application flow is the active focus; all
// of the enrollment/payment code (routes, views, Bakong KHQR integration) is kept intact
// and comes straight back by flipping this single flag to true — no other change needed.
const ENROLLMENT_ENABLED = false;

module.exports = { ENROLLMENT_ENABLED };
