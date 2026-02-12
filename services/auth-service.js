const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const wecomService = require('./wecom-service');

// ============================================
// WeChat Work OAuth Integration
// ============================================

/**
 * Exchange OAuth authorization code for user information
 * @param {string} code - Authorization code from WeChat callback
 * @returns {Promise<{userid: string, name: string, department: string}>}
 */
async function exchangeCodeForUser(code) {
  try {
    // Step 1: Get access token (reuse existing wecom-service.js)
    const accessToken = await wecomService.getAccessToken();

    // Step 2: Get userid from authorization code
    const userinfoResponse = await axios.get(
      'https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo',
      {
        params: {
          access_token: accessToken,
          code: code
        }
      }
    );

    if (userinfoResponse.data.errcode !== 0) {
      throw new Error(
        `WeChat OAuth getuserinfo error [${userinfoResponse.data.errcode}]: ${userinfoResponse.data.errmsg}`
      );
    }

    // Log the full response for debugging
    console.log('[AUTH] WeChat getuserinfo response:', JSON.stringify(userinfoResponse.data, null, 2));

    // WeChat returns lowercase 'userid', not 'UserId'
    const userid = userinfoResponse.data.userid || userinfoResponse.data.UserId;

    if (!userid) {
      console.error('[AUTH] Full WeChat response:', userinfoResponse.data);
      throw new Error(`No UserId returned from WeChat OAuth. Response: ${JSON.stringify(userinfoResponse.data)}`);
    }

    // Step 3: Get detailed user information
    const userDetailResponse = await axios.get(
      'https://qyapi.weixin.qq.com/cgi-bin/user/get',
      {
        params: {
          access_token: accessToken,
          userid: userid
        }
      }
    );

    if (userDetailResponse.data.errcode !== 0) {
      throw new Error(
        `WeChat user/get error [${userDetailResponse.data.errcode}]: ${userDetailResponse.data.errmsg}`
      );
    }

    const userData = userDetailResponse.data;

    return {
      userid: userid,
      name: userData.name || userid,
      department: userData.department && userData.department[0]
        ? String(userData.department[0])
        : '未知部门'
    };
  } catch (error) {
    console.error('[AUTH] exchangeCodeForUser error:', error);
    throw error;
  }
}

// ============================================
// Session Management
// ============================================

const SESSIONS_FILE = path.join(__dirname, '..', 'sessions.json');
const SESSION_MAX_AGE_DAYS = parseInt(process.env.SESSION_MAX_AGE_DAYS || '7', 10);

/**
 * Create a new session for a user
 * @param {string} userid - User ID
 * @param {string} name - User display name
 * @param {string} department - User department
 * @returns {string} Session ID
 */
function createSession(userid, name, department) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);

  const sessions = loadSessions();
  sessions[sessionId] = {
    userid,
    name,
    department,
    role: 'normal_user',
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    lastActivity: now.toISOString()
  };
  saveSessions(sessions);

  return sessionId;
}

/**
 * Validate a session and update last activity
 * @param {string} sessionId - Session ID to validate
 * @returns {object|null} Session data if valid, null otherwise
 */
function validateSession(sessionId) {
  if (!sessionId) return null;

  const sessions = loadSessions();
  const session = sessions[sessionId];

  if (!session) return null;

  const now = new Date();
  const expiresAt = new Date(session.expiresAt);

  // Check if session expired
  if (now > expiresAt) {
    delete sessions[sessionId];
    saveSessions(sessions);
    return null;
  }

  // Update last activity timestamp
  session.lastActivity = now.toISOString();
  sessions[sessionId] = session;
  saveSessions(sessions);

  return session;
}

/**
 * Delete a session (logout)
 * @param {string} sessionId - Session ID to delete
 */
function deleteSession(sessionId) {
  if (!sessionId) return;

  const sessions = loadSessions();
  delete sessions[sessionId];
  saveSessions(sessions);
}

// ============================================
// File Persistence
// ============================================

/**
 * Load sessions from JSON file
 * @returns {object} Sessions object
 */
function loadSessions() {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) {
      return {};
    }
    const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('[AUTH] Error loading sessions:', error);
    return {};
  }
}

/**
 * Save sessions to JSON file
 * @param {object} sessions - Sessions object to save
 */
function saveSessions(sessions) {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
  } catch (error) {
    console.error('[AUTH] Error saving sessions:', error);
    throw error;
  }
}

// ============================================
// Exports
// ============================================

module.exports = {
  exchangeCodeForUser,
  createSession,
  validateSession,
  deleteSession,
};
