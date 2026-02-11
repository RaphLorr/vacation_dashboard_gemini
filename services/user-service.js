const fs = require('fs');
const path = require('path');

// ============================================
// User Profile Management
// ============================================

const USERS_FILE = path.join(__dirname, '..', 'users.json');

/**
 * Get user by userid
 * @param {string} userid - User ID
 * @returns {object|null} User object or null if not found
 */
function getUser(userid) {
  const users = loadUsers();
  return users[userid] || null;
}

/**
 * Create or update user profile
 * @param {string} userid - User ID
 * @param {string} name - User display name
 * @param {string} department - User department
 * @returns {object} Created/updated user object
 */
function createOrUpdateUser(userid, name, department) {
  const users = loadUsers();

  users[userid] = {
    userid,
    name,
    department,
    role: 'normal_user', // All users have the same role
    updatedAt: new Date().toISOString()
  };

  saveUsers(users);
  return users[userid];
}

/**
 * Get all users
 * @returns {object} All users object
 */
function getAllUsers() {
  return loadUsers();
}

/**
 * Delete user
 * @param {string} userid - User ID to delete
 * @returns {boolean} True if deleted, false if not found
 */
function deleteUser(userid) {
  const users = loadUsers();

  if (!users[userid]) {
    return false;
  }

  delete users[userid];
  saveUsers(users);
  return true;
}

// ============================================
// File Persistence
// ============================================

/**
 * Load users from JSON file
 * @returns {object} Users object
 */
function loadUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) {
      return {};
    }
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('[USER] Error loading users:', error);
    return {};
  }
}

/**
 * Save users to JSON file
 * @param {object} users - Users object to save
 */
function saveUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  } catch (error) {
    console.error('[USER] Error saving users:', error);
    throw error;
  }
}

// ============================================
// Exports
// ============================================

module.exports = {
  getUser,
  createOrUpdateUser,
  getAllUsers,
  deleteUser
};
