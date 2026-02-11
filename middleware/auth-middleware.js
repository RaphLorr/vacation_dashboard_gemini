const authService = require('../services/auth-service');

// ============================================
// Authentication Middleware
// ============================================

/**
 * Require authentication for endpoint
 * Returns 401 if no valid session exists
 */
function requireAuth(req, res, next) {
  const sessionId = req.cookies.session_id;

  if (!sessionId) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized - No session cookie'
    });
  }

  const session = authService.validateSession(sessionId);

  if (!session) {
    res.clearCookie('session_id');
    return res.status(401).json({
      success: false,
      error: 'Unauthorized - Invalid or expired session'
    });
  }

  // Attach user info to request
  req.user = session;
  next();
}

/**
 * Optional authentication - attach user if session exists
 * Does not block request if no session
 */
function optionalAuth(req, res, next) {
  const sessionId = req.cookies.session_id;

  if (sessionId) {
    const session = authService.validateSession(sessionId);
    if (session) {
      req.user = session;
    }
  }

  next();
}

// ============================================
// Exports
// ============================================

module.exports = {
  requireAuth,
  optionalAuth
};
