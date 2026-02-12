/**
 * WeChat Work Callback Event Handler
 *
 * Processes sys_approval_change events from WeChat Work callbacks
 * for near-real-time leave data updates.
 *
 * Supplements (does not replace) the polling schedulers.
 * Callbacks can be missed per WeChat docs, so schedulers remain as safety net.
 */

const { extractXmlField } = require('./wecom-crypto');
const wecomService = require('./wecom-service');
const activeApprovalManager = require('./active-approvals');
const syncLock = require('./sync-lock');
const { loadLeaveData, saveLeaveData, mergeLeaveData } = require('./sync-scheduler');

// In-memory queue for events received while sync lock is held
const pendingQueue = [];

// Queue drain interval handle
let drainInterval = null;

/**
 * Handle a sys_approval_change callback event
 * @param {string} decryptedXml - Decrypted XML payload from WeChat Work
 */
async function handleApprovalChange(decryptedXml) {
  try {
    // 1. Extract ApprovalInfo block
    const approvalInfoXml = extractXmlField(decryptedXml, 'ApprovalInfo');
    if (!approvalInfoXml) {
      console.log('[CALLBACK] No ApprovalInfo in payload, ignoring');
      return;
    }

    // 2. Extract fields (PascalCase in callback XML)
    const spNo = extractXmlField(approvalInfoXml, 'SpNo');
    const spStatus = extractXmlField(approvalInfoXml, 'SpStatus');
    const spName = extractXmlField(approvalInfoXml, 'SpName');
    const statuChangeEvent = extractXmlField(approvalInfoXml, 'StatuChangeEvent');

    if (!spNo || !spStatus) {
      console.log('[CALLBACK] Missing SpNo or SpStatus, ignoring');
      return;
    }

    console.log(`[CALLBACK] Approval change: SpNo=${spNo}, SpStatus=${spStatus}, SpName=${spName}, StatuChangeEvent=${statuChangeEvent}`);

    // 3. Early exit filters
    if (spName && spName !== '请假') {
      console.log(`[CALLBACK] Not a leave request (${spName}), ignoring`);
      return;
    }

    if (statuChangeEvent === '10') {
      console.log('[CALLBACK] Comment event (StatuChangeEvent=10), ignoring');
      return;
    }

    // Skip intermediate approval steps for already-tracked pending approvals
    const spStatusNum = parseInt(spStatus, 10);
    if (spStatusNum === 1) {
      const activeData = activeApprovalManager.loadActiveApprovals();
      if (activeData.approvals[spNo]) {
        console.log(`[CALLBACK] Pending approval ${spNo} already tracked, ignoring intermediate step`);
        return;
      }
    }

    // 4. Try to acquire sync lock
    if (!syncLock.acquireLock()) {
      console.log(`[CALLBACK] Sync lock held, queuing SpNo=${spNo}`);
      pendingQueue.push({ spNo, spStatus: spStatusNum });
      return;
    }

    try {
      await processApprovalChange(spNo, spStatusNum);
    } finally {
      syncLock.releaseLock();
    }
  } catch (error) {
    console.error('[CALLBACK] Error handling approval change:', error.message);
  }
}

/**
 * Process a single approval change (caller must hold sync lock)
 * @param {string} spNo - Approval number
 * @param {number} callbackStatus - Status from callback (hint only — API detail is authoritative)
 */
async function processApprovalChange(spNo, callbackStatus) {
  try {
    // Fetch fresh detail from API (authoritative source)
    const accessToken = await wecomService.getAccessToken();
    const detail = await wecomService.getApprovalDetail(accessToken, spNo);
    const apiStatus = detail.sp_status;

    console.log(`[CALLBACK] Processing SpNo=${spNo}, API status=${apiStatus}`);

    const statusText = wecomService.getStatusText(apiStatus);
    if (!statusText) {
      console.log(`[CALLBACK] Unknown status ${apiStatus} for SpNo=${spNo}, skipping`);
      return;
    }

    const activeData = activeApprovalManager.loadActiveApprovals();
    const isInActiveList = !!activeData.approvals[spNo];

    if (apiStatus === 1) {
      await processPendingApproval(detail, accessToken, activeData);
    } else if (apiStatus === 2) {
      await processApprovedApproval(detail, accessToken, activeData, isInActiveList);
    } else {
      // Rejected/withdrawn/deleted/paid (3, 4, 6, 7, 10)
      await processFinalizedApproval(detail, accessToken, activeData, isInActiveList, statusText);
    }
  } catch (error) {
    console.error(`[CALLBACK] Failed to process SpNo=${spNo}:`, error.message);
  }
}

/**
 * Process a new pending approval (status 1)
 */
async function processPendingApproval(detail, accessToken, activeData) {
  const spNo = detail.sp_no;

  // Transform via existing battle-tested function
  const transformed = await wecomService.transformApprovalDetail(detail, accessToken);
  if (!transformed) {
    console.log(`[CALLBACK] Could not transform SpNo=${spNo}, skipping`);
    return;
  }

  // Build wecom-format data for merge
  const wecomData = buildWecomDataFromTransformed(transformed);

  // Merge into leave_data.json
  const existingData = loadLeaveData();
  const { merged } = mergeLeaveData(existingData, wecomData);
  saveLeaveData(merged);

  // Add to active approvals tracking
  activeData.approvals[spNo] = {
    sp_no: spNo,
    userid: transformed.userid,
    name: transformed.name,
    department: transformed.department,
    apply_time: detail.apply_time,
    submit_time: new Date(detail.apply_time * 1000).toISOString(),
    current_status: 1,
    status_text: '审批中',
    leave_dates: transformed.dateKeys,
    last_checked: Math.floor(Date.now() / 1000),
    last_checked_time: new Date().toISOString(),
  };
  activeApprovalManager.saveActiveApprovals(activeData);

  console.log(`[CALLBACK] Added pending approval SpNo=${spNo} for ${transformed.name} (${transformed.dateKeys.length} days)`);
}

/**
 * Process an approved approval (status 2)
 */
async function processApprovedApproval(detail, accessToken, activeData, isInActiveList) {
  const spNo = detail.sp_no;

  if (isInActiveList) {
    // Fast path: use stored leave_dates from active list
    const activeEntry = activeData.approvals[spNo];
    const existingData = loadLeaveData();

    if (existingData.leaveData[activeEntry.userid]) {
      activeEntry.leave_dates.forEach(dateKey => {
        existingData.leaveData[activeEntry.userid][dateKey] = '已通过';
      });
      existingData.updatedAt = new Date().toISOString();
      saveLeaveData(existingData);
    }

    // Remove from active list
    delete activeData.approvals[spNo];
    activeApprovalManager.saveActiveApprovals(activeData);

    console.log(`[CALLBACK] Approved SpNo=${spNo} for ${activeEntry.name}, updated ${activeEntry.leave_dates.length} dates`);
  } else {
    // Slow path: full transform + merge (handles status 2)
    const transformed = await wecomService.transformApprovalDetail(detail, accessToken);
    if (!transformed) {
      console.log(`[CALLBACK] Could not transform SpNo=${spNo}, skipping`);
      return;
    }

    const wecomData = buildWecomDataFromTransformed(transformed);
    const existingData = loadLeaveData();
    const { merged } = mergeLeaveData(existingData, wecomData);
    saveLeaveData(merged);

    console.log(`[CALLBACK] Approved SpNo=${spNo} for ${transformed.name} (not in active list, full merge)`);
  }
}

/**
 * Process a finalized approval (status 3/4/6/7/10)
 */
async function processFinalizedApproval(detail, accessToken, activeData, isInActiveList, statusText) {
  const spNo = detail.sp_no;

  if (isInActiveList) {
    // Use stored leave_dates from active list
    const activeEntry = activeData.approvals[spNo];
    const existingData = loadLeaveData();

    if (existingData.leaveData[activeEntry.userid]) {
      activeEntry.leave_dates.forEach(dateKey => {
        existingData.leaveData[activeEntry.userid][dateKey] = statusText;
      });
      existingData.updatedAt = new Date().toISOString();
      saveLeaveData(existingData);
    }

    // Remove from active list
    delete activeData.approvals[spNo];
    activeApprovalManager.saveActiveApprovals(activeData);

    console.log(`[CALLBACK] Finalized SpNo=${spNo} for ${activeEntry.name} -> ${statusText}`);
  } else {
    // Not in active list — extract dates from detail directly
    const vacationData = wecomService.parseVacationData(detail.apply_data);
    if (!vacationData) {
      console.log(`[CALLBACK] Could not parse vacation data for SpNo=${spNo}, skipping`);
      return;
    }

    const dateKeys = wecomService.generateDateKeys(vacationData, null, null);
    if (dateKeys.length === 0) {
      console.log(`[CALLBACK] No date keys for SpNo=${spNo}, skipping`);
      return;
    }

    const userid = detail.applier?.userid || detail.applyer?.userid;
    if (!userid) {
      console.log(`[CALLBACK] No userid for SpNo=${spNo}, skipping`);
      return;
    }

    const existingData = loadLeaveData();
    if (existingData.leaveData[userid]) {
      dateKeys.forEach(dateKey => {
        existingData.leaveData[userid][dateKey] = statusText;
      });
      existingData.updatedAt = new Date().toISOString();
      saveLeaveData(existingData);
      console.log(`[CALLBACK] Finalized SpNo=${spNo} for userid=${userid} -> ${statusText} (not in active list)`);
    } else {
      console.log(`[CALLBACK] Finalized SpNo=${spNo} but userid=${userid} not in leave data, skipping`);
    }
  }
}

/**
 * Build wecom-format data structure from a single transformed approval
 * Compatible with mergeLeaveData() input format
 */
function buildWecomDataFromTransformed(transformed) {
  const { userid, name, department, status, dateKeys } = transformed;

  const leaveData = {};
  leaveData[userid] = {};
  dateKeys.forEach(dateKey => {
    leaveData[userid][dateKey] = status;
  });

  const employeeInfo = {};
  employeeInfo[userid] = { name, department };

  return { leaveData, employeeInfo };
}

/**
 * Drain the pending queue when sync lock becomes available
 */
async function drainQueue() {
  if (pendingQueue.length === 0) {
    return;
  }

  if (syncLock.isLocked()) {
    return;
  }

  if (!syncLock.acquireLock()) {
    return;
  }

  // Take all items from queue atomically
  const items = pendingQueue.splice(0);
  console.log(`[CALLBACK] Draining queue: ${items.length} items`);

  try {
    // Deduplicate by spNo (keep latest status)
    const deduped = new Map();
    items.forEach(item => {
      deduped.set(item.spNo, item.spStatus);
    });

    for (const [spNo, spStatus] of deduped) {
      await processApprovalChange(spNo, spStatus);
    }
  } catch (error) {
    console.error('[CALLBACK] Queue drain error:', error.message);
  } finally {
    syncLock.releaseLock();
  }
}

/**
 * Start the queue drain interval
 */
function startQueueDrain() {
  if (drainInterval) {
    return;
  }
  drainInterval = setInterval(drainQueue, 2000);
  console.log('[CALLBACK] Queue drain started (every 2s)');
}

/**
 * Stop the queue drain interval
 */
function stopQueueDrain() {
  if (drainInterval) {
    clearInterval(drainInterval);
    drainInterval = null;
  }
}

module.exports = {
  handleApprovalChange,
  startQueueDrain,
  stopQueueDrain,
};
