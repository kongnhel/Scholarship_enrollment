// Feature switches.
//
// ENROLLMENT_ENABLED turns the whole online-enrollment + tuition-payment module on or off.
// It is true: the scholarship application flow and the enrollment/payment module are both
// live. The module is gated only here - 9 student routes read it through the three
// enrollmentPaused* middleware variants - so this single flag is still the only switch.
// Set it back to false to close enrollment and payments together without touching code.
const ENROLLMENT_ENABLED = true;

module.exports = { ENROLLMENT_ENABLED };
