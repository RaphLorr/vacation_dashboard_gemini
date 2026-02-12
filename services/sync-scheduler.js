/**
 * Sync Scheduler - Automatic incremental sync with WeChat Work
 *
 * Runs every minute to fetch new approval records
 * Uses incremental sync to only fetch records since last successful sync
 */

const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const wecomService = require('./wecom-service');
const syncLock = require('./sync-lock');

// Data file path
const DATA_FILE = path.join(__dirname, '../leave_data.json');

// Sync state file to track last sync timestamp
const SYNC_STATE_FILE = path.join(__dirname, '../.sync_state.json');

// Default: sync every 1 minute
const SYNC_INTERVAL = process.env.SYNC_INTERVAL || '*/5 * * * *';

// Enable/disable auto-sync via environment variable
const AUTO_SYNC_ENABLED = process.env.AUTO_SYNC_ENABLED !== 'false';

// Status check configuration
const STATUS_CHECK_INTERVAL = process.env.STATUS_CHECK_INTERVAL || '*/5 * * * *'; // Every 5 minutes
const STATUS_CHECK_ENABLED = process.env.STATUS_CHECK_ENABLED !== 'false';

let syncJob = null;
let statusCheckJob = null;

/**
 * Load leave data from disk
 */
function loadLeaveData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load leave data:', error.message);
  }
  return { leaveData: {}, employeeInfo: {}, updatedAt: new Date().toISOString() };
}

/**
 * Save leave data to disk
 */
function saveLeaveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to save leave data:', error.message);
  }
}

/**
 * Merge WeChat data with existing data
 * Strategy: WeChat data takes priority (source of truth)
 */
function mergeLeaveData(existingData, wecomData) {
  const merged = {
    leaveData: { ...existingData.leaveData },
    employeeInfo: { ...existingData.employeeInfo },
  };

  let newEmployees = 0;
  let updatedEmployees = 0;

  // Merge employee info (WeChat data wins) - now using userid as key
  Object.keys(wecomData.employeeInfo).forEach(userid => {
    if (!merged.employeeInfo[userid]) {
      newEmployees++;
    } else {
      updatedEmployees++;
    }
    merged.employeeInfo[userid] = wecomData.employeeInfo[userid];
  });

  // Merge leave data (WeChat data wins for conflicts) - now using userid as key
  Object.keys(wecomData.leaveData).forEach(userid => {
    if (!merged.leaveData[userid]) {
      // New employee - add directly
      merged.leaveData[userid] = wecomData.leaveData[userid];
    } else {
      // Existing employee - merge dates (WeChat wins)
      merged.leaveData[userid] = {
        ...merged.leaveData[userid],
        ...wecomData.leaveData[userid],
      };
    }
  });

  merged.updatedAt = new Date().toISOString();

  return { merged, stats: { newEmployees, updatedEmployees } };
}

/**
 * Load sync state from disk
 */
function loadSyncState() {
  try {
    if (fs.existsSync(SYNC_STATE_FILE)) {
      const data = fs.readFileSync(SYNC_STATE_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load sync state:', error.message);
  }

  // Default: start from 2026-01-01 00:00:00 UTC+8 (Unix timestamp in seconds)
  const fallbackTimestamp = 1767196800; // 2026-01-01 00:00:00 UTC+8
  return {
    lastSyncEndTimestamp: fallbackTimestamp,
    lastSyncTime: new Date(fallbackTimestamp * 1000).toISOString(),
    totalSynced: 0,
    successfulSyncs: 0,
    failedSyncs: 0
  };
}

/**
 * Save sync state to disk
 */
function saveSyncState(state) {
  try {
    fs.writeFileSync(SYNC_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to save sync state:', error.message);
  }
}

/**
 * Perform incremental sync
 */
async function performIncrementalSync() {
  // Try to acquire lock
  if (!syncLock.acquireLock()) {
    console.log('⏭️  Sync already in progress (locked), skipping this cycle');
    return;
  }

  const syncStartTime = Date.now();

  try {
    console.log('\n🔄 Starting automatic incremental sync...');

    // Load last sync state
    const syncState = loadSyncState();

    // Use last sync end timestamp as start, current time as end
    const startTimestamp = syncState.lastSyncEndTimestamp;
    const endTimestamp = Math.floor(Date.now() / 1000); // Current Unix timestamp in seconds

    // If no new time has passed, skip
    if (endTimestamp <= startTimestamp) {
      console.log(`   ℹ️  No new data to sync (no time has passed)`);
      return;
    }

    const minutesSinceLastSync = Math.floor((endTimestamp - startTimestamp) / 60);
    const startDate = new Date(startTimestamp * 1000).toISOString();
    const endDate = new Date(endTimestamp * 1000).toISOString();
    console.log(`   📅 Syncing from ${startDate} to ${endDate} (${minutesSinceLastSync} minutes)`);

    // Perform sync using precise timestamps
    const wecomData = await wecomService.syncLeaveApprovalsByTimestamp(startTimestamp, endTimestamp);

    // Load existing data
    const existingData = loadLeaveData();

    // Merge with smart conflict resolution
    const { merged, stats } = mergeLeaveData(existingData, wecomData);

    // Save merged data
    saveLeaveData(merged);

    // Update active approvals list with new pending records
    const activeApprovalManager = require('./active-approvals');
    const activeData = activeApprovalManager.loadActiveApprovals();
    const activeApprovals = activeData.approvals || {};
    const cutoffTimestamp = activeApprovalManager.CUTOFF_TIMESTAMP;

    let newPendingCount = 0;

    // Scan the raw details for pending approvals
    if (wecomData.rawDetails && wecomData.rawDetails.length > 0) {
      for (const detail of wecomData.rawDetails) {
        const sp_no = detail.sp_no;
        const status = detail.sp_status;
        const apply_time = detail.apply_time;

        // Check if this should be added to active list
        if (
          status === 1 &&                    // Pending
          apply_time >= cutoffTimestamp &&   // After 2026-01-01
          detail.sp_name === '请假' &&       // Leave request
          !activeApprovals[sp_no]            // Not already tracked
        ) {
          // Get transformed data (already done in wecomData)
          // Find the corresponding transformed data
          const userid = detail.applier?.userid || detail.applyer?.userid;
          if (userid && wecomData.employeeInfo[userid]) {
            // Use spDateKeysMap for this specific approval's dates only
            // NOT the merged leaveData which contains dates from ALL approvals
            const approvalDateKeys = (wecomData.spDateKeysMap && wecomData.spDateKeysMap[sp_no]) || [];
            activeApprovals[sp_no] = {
              sp_no,
              userid,
              name: wecomData.employeeInfo[userid].name,
              department: wecomData.employeeInfo[userid].department,
              apply_time,
              submit_time: new Date(apply_time * 1000).toISOString(),
              current_status: status,
              status_text: '审批中',
              leave_dates: approvalDateKeys,
              last_checked: endTimestamp,
              last_checked_time: new Date(endTimestamp * 1000).toISOString(),
            };
            newPendingCount++;
          }
        }
      }
    }

    if (newPendingCount > 0) {
      activeData.approvals = activeApprovals;
      activeApprovalManager.saveActiveApprovals(activeData);
      console.log(`   ➕ Added ${newPendingCount} new pending approval(s) to active list`);
    }

    console.log(`   📌 Active approvals: ${Object.keys(activeApprovals).length} total`);

    const syncDuration = ((Date.now() - syncStartTime) / 1000).toFixed(1);

    console.log(`✅ Incremental sync completed in ${syncDuration}s`);
    console.log(`   📊 Synced: ${wecomData.syncedCount} records`);
    console.log(`   👥 Employees: ${wecomData.newEmployees} (${stats.newEmployees} new, ${stats.updatedEmployees} updated)`);
    console.log(`   ⏭️  Skipped: ${wecomData.skippedCount} records`);

    // Update sync state - use current end timestamp as the new lastSyncEndTimestamp
    syncState.lastSyncEndTimestamp = endTimestamp;
    syncState.lastSyncTime = new Date(endTimestamp * 1000).toISOString();
    syncState.totalSynced += wecomData.syncedCount;
    syncState.successfulSyncs += 1;
    saveSyncState(syncState);
  } catch (error) {
    console.error('❌ Incremental sync error:', error.message);

    // Update failed sync count
    const syncState = loadSyncState();
    syncState.failedSyncs += 1;
    saveSyncState(syncState);
  } finally {
    // Always release lock
    syncLock.releaseLock();
  }
}

/**
 * Check status of existing active approvals
 * Detects status changes (审批中 → 已通过/已驳回)
 */
async function performStatusCheckSync() {
  console.log('\n🔍 Starting status check sync for active approvals...');

  const syncStartTime = Date.now();

  try {
    // 1. Load active approvals
    const activeApprovalManager = require('./active-approvals');
    const activeData = activeApprovalManager.loadActiveApprovals();
    const activeApprovals = activeData.approvals || {};
    const activeCount = Object.keys(activeApprovals).length;

    if (activeCount === 0) {
      console.log('   ℹ️  No active approvals to check');
      return;
    }

    console.log(`   📋 Checking ${activeCount} active approvals...`);

    // 2. Get access token
    const accessToken = await wecomService.getAccessToken();

    // 3. Re-fetch details for all active sp_no
    const spNoList = Object.keys(activeApprovals);
    const { details, errors } = await wecomService.fetchApprovalDetailsForStatusCheck(
      accessToken,
      spNoList
    );

    // 4. Check each detail for status changes
    const statusChanges = [];
    let removed = 0;
    let stillActive = 0;
    const nowTimestamp = Math.floor(Date.now() / 1000);

    details.forEach(detail => {
      const sp_no = detail.sp_no;
      const oldStatus = activeApprovals[sp_no].current_status;
      const newStatus = detail.sp_status;

      if (newStatus !== oldStatus) {
        // Status changed!
        const oldStatusText = activeApprovalManager.getStatusText(oldStatus);
        const newStatusText = activeApprovalManager.getStatusText(newStatus);

        statusChanges.push({
          sp_no,
          userid: activeApprovals[sp_no].userid,
          name: activeApprovals[sp_no].name,
          leave_dates: activeApprovals[sp_no].leave_dates,
          oldStatus: oldStatusText,
          newStatus: newStatusText,
          newStatusCode: newStatus,
        });

        console.log(`      ✨ ${activeApprovals[sp_no].name}: ${oldStatusText} → ${newStatusText}`);
      }

      // Update or remove based on new status
      if (activeApprovalManager.shouldRemoveFromActive(newStatus)) {
        delete activeApprovals[sp_no];
        removed++;
      } else {
        // Still active, update last_checked
        activeApprovals[sp_no].current_status = newStatus;
        activeApprovals[sp_no].status_text = activeApprovalManager.getStatusText(newStatus);
        activeApprovals[sp_no].last_checked = nowTimestamp;
        activeApprovals[sp_no].last_checked_time = new Date().toISOString();
        stillActive++;
      }
    });

    // 5. Update leave_data.json if status changes detected
    if (statusChanges.length > 0) {
      console.log(`   💾 Updating leave_data.json with ${statusChanges.length} status changes...`);

      const existingData = loadLeaveData();

      // Update each changed status
      statusChanges.forEach(change => {
        if (existingData.leaveData[change.userid]) {
          change.leave_dates.forEach(dateKey => {
            existingData.leaveData[change.userid][dateKey] = change.newStatus;
          });
        }
      });

      existingData.updatedAt = new Date().toISOString();
      saveLeaveData(existingData);
    }

    // 6. Save updated active approvals list
    activeData.approvals = activeApprovals;
    activeApprovalManager.saveActiveApprovals(activeData);

    const syncDuration = ((Date.now() - syncStartTime) / 1000).toFixed(1);

    console.log(`✅ Status check completed in ${syncDuration}s`);
    console.log(`   Still active: ${stillActive}`);
    console.log(`   Finalized (removed): ${removed}`);
    console.log(`   Status changes: ${statusChanges.length}`);
    console.log(`   Total active: ${Object.keys(activeApprovals).length}`);

  } catch (error) {
    console.error('❌ Status check sync error:', error.message);
  }
}

/**
 * Start the sync scheduler
 */
function startScheduler() {
  if (!AUTO_SYNC_ENABLED) {
    console.log('ℹ️  Auto-sync is disabled (set AUTO_SYNC_ENABLED=true to enable)');
    return;
  }

  if (syncJob) {
    console.log('⚠️  Scheduler already running');
    return;
  }

  console.log(`\n🕐 Starting sync scheduler...`);
  console.log(`   ⏰ Interval: ${SYNC_INTERVAL} (every 5 minutes)`);
  console.log(`   📁 State file: ${SYNC_STATE_FILE}`);

  // Create cron job
  syncJob = cron.schedule(SYNC_INTERVAL, async () => {
    await performIncrementalSync();
  });

  // Initial sync state check
  const syncState = loadSyncState();
  console.log(`   📊 Stats: ${syncState.successfulSyncs} successful, ${syncState.failedSyncs} failed`);
  console.log(`   🕐 Last sync: ${syncState.lastSyncTime}`);
  console.log('✅ Scheduler started successfully');

  // Run initial sync after 5 seconds
  setTimeout(() => {
    console.log('\n🚀 Running initial sync...');
    performIncrementalSync();
  }, 5000);
}

/**
 * Stop the sync scheduler
 */
function stopScheduler() {
  if (syncJob) {
    syncJob.stop();
    syncJob = null;
    console.log('🛑 Scheduler stopped');
  }
}

/**
 * Start the status check scheduler
 */
function startStatusCheckScheduler() {
  if (!STATUS_CHECK_ENABLED) {
    console.log('ℹ️  Status check is disabled (set STATUS_CHECK_ENABLED=true to enable)');
    return;
  }

  if (statusCheckJob) {
    console.log('⚠️  Status check scheduler already running');
    return;
  }

  console.log(`\n🔍 Starting status check scheduler...`);
  console.log(`   ⏰ Interval: ${STATUS_CHECK_INTERVAL} (every 5 minutes)`);

  // Create cron job
  statusCheckJob = cron.schedule(STATUS_CHECK_INTERVAL, async () => {
    await performStatusCheckSync();
  });

  console.log('✅ Status check scheduler started successfully');

  // Run initial status check after 10 seconds
  setTimeout(() => {
    console.log('\n🚀 Running initial status check...');
    performStatusCheckSync();
  }, 10000);
}

/**
 * Stop the status check scheduler
 */
function stopStatusCheckScheduler() {
  if (statusCheckJob) {
    statusCheckJob.stop();
    statusCheckJob = null;
    console.log('🛑 Status check scheduler stopped');
  }
}

/**
 * Get current sync status
 */
function getSyncStatus() {
  const syncState = loadSyncState();
  return {
    enabled: AUTO_SYNC_ENABLED,
    running: syncJob !== null,
    syncing: syncLock.isLocked(),
    interval: SYNC_INTERVAL,
    lastSyncEndTimestamp: syncState.lastSyncEndTimestamp,
    lastSyncTime: syncState.lastSyncTime,
    stats: {
      totalSynced: syncState.totalSynced,
      successfulSyncs: syncState.successfulSyncs,
      failedSyncs: syncState.failedSyncs
    }
  };
}

/**
 * Reset sync state (start from scratch)
 */
function resetSyncState() {
  const fallbackTimestamp = 1767196800; // 2026-01-01 00:00:00 UTC+8
  const state = {
    lastSyncEndTimestamp: fallbackTimestamp,
    lastSyncTime: new Date(fallbackTimestamp * 1000).toISOString(),
    totalSynced: 0,
    successfulSyncs: 0,
    failedSyncs: 0
  };
  saveSyncState(state);
  console.log('🔄 Sync state reset to 2026-01-01');
  return state;
}

module.exports = {
  startScheduler,
  stopScheduler,
  startStatusCheckScheduler,
  stopStatusCheckScheduler,
  getSyncStatus,
  resetSyncState,
  performIncrementalSync,
  performStatusCheckSync,
  loadLeaveData,
  saveLeaveData,
  mergeLeaveData,
};
