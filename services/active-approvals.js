/**
 * Active Approvals Manager
 *
 * Manages the list of pending (审批中) leave approvals for status change tracking.
 * Only tracks approvals with apply_time >= 2026-01-01 00:00:00
 */

const fs = require('fs');
const path = require('path');

// Active approvals file path
const ACTIVE_APPROVALS_FILE = path.join(__dirname, '../.active_approvals.json');

// Cutoff date: only track approvals after 2026-01-01
const CUTOFF_TIMESTAMP = 1735660800; // 2026-01-01 00:00:00 UTC
const CUTOFF_DATE = '2026-01-01T00:00:00.000Z';

/**
 * Load active approvals from disk
 * @returns {Object} Active approvals data with metadata and approvals
 */
function loadActiveApprovals() {
  try {
    if (fs.existsSync(ACTIVE_APPROVALS_FILE)) {
      const data = fs.readFileSync(ACTIVE_APPROVALS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load active approvals:', error.message);
  }

  // Default structure
  return {
    metadata: {
      cutoffTimestamp: CUTOFF_TIMESTAMP,
      cutoffDate: CUTOFF_DATE,
    },
    approvals: {},
  };
}

/**
 * Save active approvals to disk
 * @param {Object} data - Active approvals data
 */
function saveActiveApprovals(data) {
  try {
    fs.writeFileSync(
      ACTIVE_APPROVALS_FILE,
      JSON.stringify(data, null, 2),
      'utf8'
    );
  } catch (error) {
    console.error('Failed to save active approvals:', error.message);
  }
}

/**
 * Add a new pending approval to active list
 * @param {Object} approval - Approval entry to add
 * @returns {boolean} True if added, false if not eligible or already exists
 */
function addToActiveApprovals(approval) {
  const data = loadActiveApprovals();
  const { sp_no } = approval;

  // Check if already exists
  if (data.approvals[sp_no]) {
    return false; // Already tracked
  }

  // Add to active list
  data.approvals[sp_no] = approval;
  saveActiveApprovals(data);
  return true;
}

/**
 * Remove an approval from active list
 * @param {string} sp_no - Approval number to remove
 */
function removeFromActiveApprovals(sp_no) {
  const data = loadActiveApprovals();

  if (data.approvals[sp_no]) {
    delete data.approvals[sp_no];
    saveActiveApprovals(data);
    return true;
  }

  return false;
}

/**
 * Check if status is final (should remove from active tracking)
 * @param {number} status - Status code
 * @returns {boolean} True if final status (not pending)
 */
function shouldRemoveFromActive(status) {
  // Final statuses: 2=已通过, 3=已驳回, 4=已撤销, 6=通过后撤销, 7=已删除, 10=已支付
  return [2, 3, 4, 6, 7, 10].includes(status);
}

/**
 * Check if approval is eligible for active tracking
 * @param {Object} detail - Approval detail from WeChat API
 * @returns {boolean} True if eligible
 */
function isEligibleForTracking(detail) {
  return (
    detail.sp_status === 1 &&                    // Pending
    detail.apply_time >= CUTOFF_TIMESTAMP &&     // After 2026-01-01
    detail.sp_name === '请假'                    // Leave request
  );
}

/**
 * Get count of active approvals
 * @returns {number} Count of active approvals
 */
function getActiveApprovalsCount() {
  const data = loadActiveApprovals();
  return Object.keys(data.approvals).length;
}

/**
 * Get status text from status code
 * @param {number} statusCode - Status code
 * @returns {string} Status text
 */
function getStatusText(statusCode) {
  const statusMap = {
    1: '审批中',
    2: '已通过',
    3: '已驳回',
    4: '已撤销',
    6: '通过后撤销',
    7: '已删除',
    10: '已支付',
  };
  return statusMap[statusCode] || '未知';
}

module.exports = {
  loadActiveApprovals,
  saveActiveApprovals,
  addToActiveApprovals,
  removeFromActiveApprovals,
  shouldRemoveFromActive,
  isEligibleForTracking,
  getActiveApprovalsCount,
  getStatusText,
  CUTOFF_TIMESTAMP,
};
