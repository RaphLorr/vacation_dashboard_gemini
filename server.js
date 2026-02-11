const express = require('express');
const fs = require('fs');
const path = require('path');
const wecomService = require('./services/wecom-service');
const holidayService = require('./services/holiday-service');
const syncScheduler = require('./services/sync-scheduler');
const syncLock = require('./services/sync-lock');

const app = express();
const PORT = process.env.PORT || 10890;
const DATA_FILE = path.join(__dirname, 'leave_data.json');

// Global sync lock - prevents concurrent manual and auto sync
let isSyncing = false;

// Rate limiting for sync endpoint
let lastSyncTime = null;

// Middleware
app.use(express.json({ limit: '50mb' }));

// Serve leave-board.html as the main page (BEFORE static middleware!)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'leave-board.html'));
});

// Static files (for other assets)
app.use(express.static(__dirname));

// API Routes

// GET: Retrieve all leave records
app.get('/api/leave-records', (req, res) => {
  if (!fs.existsSync(DATA_FILE)) {
    // If file doesn't exist, return empty data
    return res.json({ leaveData: {}, employeeInfo: {}, updatedAt: null });
  }

  fs.readFile(DATA_FILE, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading data file:', err);
      return res.status(500).json({ error: 'Failed to read data' });
    }
    try {
      res.json(JSON.parse(data));
    } catch (parseError) {
      console.error('Error parsing data file:', parseError);
      res.json({});
    }
  });
});

// POST: Save leave records
app.post('/api/leave-records', (req, res) => {
  const data = req.body;

  if (!data) {
    return res.status(400).json({ error: 'No data provided' });
  }

  fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), (err) => {
    if (err) {
      console.error('Error writing data file:', err);
      return res.status(500).json({ error: 'Failed to save data' });
    }
    console.log('Data saved successfully at', new Date().toISOString());
    res.json({ success: true, message: 'Data saved successfully' });
  });
});

/**
 * Helper: Load existing leave data from file
 */
function loadLeaveData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { leaveData: {}, employeeInfo: {}, updatedAt: null };
  }

  try {
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading leave data:', error);
    return { leaveData: {}, employeeInfo: {}, updatedAt: null };
  }
}

/**
 * Helper: Save leave data to file
 */
function saveLeaveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    console.log('✅ Leave data saved successfully');
    return true;
  } catch (error) {
    console.error('❌ Error saving leave data:', error);
    throw new Error('Failed to save data');
  }
}

/**
 * Helper: Merge WeChat data with existing data
 * Strategy: WeChat data takes priority (source of truth)
 */
function mergeLeaveData(existingData, wecomData) {
  const merged = {
    leaveData: { ...existingData.leaveData },
    employeeInfo: { ...existingData.employeeInfo },
  };

  let newEmployees = 0;
  let updatedEmployees = 0;

  // Merge employee info (WeChat data wins)
  Object.keys(wecomData.employeeInfo).forEach(name => {
    if (!merged.employeeInfo[name]) {
      newEmployees++;
    } else {
      updatedEmployees++;
    }
    merged.employeeInfo[name] = wecomData.employeeInfo[name];
  });

  // Merge leave data (WeChat data wins for conflicts)
  Object.keys(wecomData.leaveData).forEach(name => {
    if (!merged.leaveData[name]) {
      // New employee - add directly
      merged.leaveData[name] = wecomData.leaveData[name];
    } else {
      // Existing employee - merge dates (WeChat wins)
      merged.leaveData[name] = {
        ...merged.leaveData[name],
        ...wecomData.leaveData[name],
      };
    }
  });

  merged.updatedAt = new Date().toISOString();

  return { merged, stats: { newEmployees, updatedEmployees } };
}

// GET: Get holiday date config for a date range
app.get('/api/holidays/dateconfig', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: '缺少日期参数',
        code: 'MISSING_DATES',
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        error: '日期格式错误',
        code: 'INVALID_DATE_FORMAT',
      });
    }

    if (start > end) {
      return res.status(400).json({
        success: false,
        error: '开始日期不能晚于结束日期',
        code: 'INVALID_DATE_RANGE',
      });
    }

    // Generate date config with holiday information
    const dateConfig = await holidayService.generateDateConfig(start, end);

    res.json({
      success: true,
      data: {
        dateConfig,
        startDate: holidayService.formatDate(start),
        endDate: holidayService.formatDate(end),
        totalDays: dateConfig.length,
      },
    });
  } catch (error) {
    console.error('❌ Holiday API error:', error);
    res.status(500).json({
      success: false,
      error: '获取节假日信息失败',
      code: 'HOLIDAY_API_FAILED',
      details: error.message,
    });
  }
});

// GET: Get default date range
app.get('/api/holidays/default-range', (req, res) => {
  try {
    const { startDate, endDate } = holidayService.getDefaultDateRange();

    res.json({
      success: true,
      data: {
        startDate: holidayService.formatDate(startDate),
        endDate: holidayService.formatDate(endDate),
      },
    });
  } catch (error) {
    console.error('❌ Error getting default range:', error);
    res.status(500).json({
      success: false,
      error: '获取默认日期范围失败',
      code: 'DEFAULT_RANGE_FAILED',
    });
  }
});

// POST: Sync leave data from WeChat Work
app.post('/api/wecom/sync', async (req, res) => {
  try {
    // Check global sync lock - prevent concurrent manual and auto sync
    if (!syncLock.acquireLock()) {
      return res.status(409).json({
        success: false,
        error: '同步正在进行中，请稍后再试',
        code: 'SYNC_IN_PROGRESS',
      });
    }

    // Rate limiting: minimum 10 seconds between syncs
    if (lastSyncTime && Date.now() - lastSyncTime < 10000) {
      syncLock.releaseLock(); // Release lock before returning
      return res.status(429).json({
        success: false,
        error: '同步过于频繁，请稍后再试',
        code: 'RATE_LIMIT_EXCEEDED',
      });
    }

    console.log('🔄 Starting WeChat Work sync (manual)...');

    // Load credentials from .env.local
    require('dotenv').config({ path: '.env.local' });

    // Verify credentials are configured
    if (!process.env.WECOM_CORPID || !process.env.WECOM_SECRET) {
      return res.status(401).json({
        success: false,
        error: '企业微信凭证未配置，请检查 .env.local 文件',
        code: 'WECOM_CREDENTIALS_MISSING',
      });
    }

    // Get date range from request body (or use defaults)
    const { startDate, endDate } = req.body;
    let syncStartDate, syncEndDate;

    if (startDate && endDate) {
      syncStartDate = startDate;
      syncEndDate = endDate;
    } else {
      // Use default range if not provided
      const defaultRange = holidayService.getDefaultDateRange();
      syncStartDate = holidayService.formatDate(defaultRange.startDate);
      syncEndDate = holidayService.formatDate(defaultRange.endDate);
    }

    console.log(`   Sync range: ${syncStartDate} to ${syncEndDate}`);
    console.log(`   Note: This queries approval SUBMISSION time, not leave dates`);

    // Call WeChat Work API to fetch leave approvals
    const wecomData = await wecomService.syncLeaveApprovals(syncStartDate, syncEndDate);

    // Load existing data
    const existingData = loadLeaveData();

    // Merge with smart conflict resolution
    const { merged, stats } = mergeLeaveData(existingData, wecomData);

    // Save merged data
    saveLeaveData(merged);

    // Update rate limit timestamp
    lastSyncTime = Date.now();

    // Return sync results
    res.json({
      success: true,
      data: {
        syncedCount: wecomData.syncedCount,
        newEmployees: stats.newEmployees,
        updatedEmployees: stats.updatedEmployees,
        skippedCount: wecomData.skippedCount,
        errors: wecomData.errors,
      },
      timestamp: new Date().toISOString(),
    });

    console.log('✅ WeChat Work sync completed successfully');

  } catch (error) {
    console.error('❌ Sync error:', error);

    // Handle specific error types
    if (error instanceof wecomService.WecomAuthError) {
      return res.status(401).json({
        success: false,
        error: '企业微信认证失败，请检查配置',
        code: error.code || 'WECOM_AUTH_FAILED',
        details: error.message,
      });
    }

    if (error instanceof wecomService.WecomAPIError) {
      return res.status(503).json({
        success: false,
        error: '企业微信API调用失败',
        code: error.code || 'WECOM_API_FAILED',
        details: error.message,
      });
    }

    if (error instanceof wecomService.DataTransformError) {
      return res.status(500).json({
        success: false,
        error: '数据转换失败，部分记录已跳过',
        code: 'DATA_TRANSFORM_FAILED',
        details: error.message,
      });
    }

    // Generic error
    res.status(500).json({
      success: false,
      error: error.message || '同步失败，请重试',
      code: 'SYNC_FAILED',
    });
  } finally {
    // Always release lock
    syncLock.releaseLock();
  }
});

// Sync scheduler control endpoints
app.get('/api/sync/status', (req, res) => {
  try {
    const status = syncScheduler.getSyncStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/sync/start', (req, res) => {
  try {
    syncScheduler.startScheduler();
    res.json({ success: true, message: 'Scheduler started' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/sync/stop', (req, res) => {
  try {
    syncScheduler.stopScheduler();
    res.json({ success: true, message: 'Scheduler stopped' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/sync/reset', (req, res) => {
  try {
    const state = syncScheduler.resetSyncState();
    res.json({ success: true, message: 'Sync state reset', data: state });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/sync/trigger', async (req, res) => {
  try {
    await syncScheduler.performIncrementalSync();
    res.json({ success: true, message: 'Manual sync triggered' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Manual trigger for status check sync
app.post('/api/status-check/trigger', async (req, res) => {
  try {
    console.log('🔍 Manual status check triggered via API');
    await syncScheduler.performStatusCheckSync();
    res.json({ success: true, message: 'Status check completed' });
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: 'STATUS_CHECK_FAILED',
    });
  }
});

// Get active approvals list
app.get('/api/active-approvals', (req, res) => {
  try {
    const activeApprovalManager = require('./services/active-approvals');
    const activeData = activeApprovalManager.loadActiveApprovals();
    const approvals = activeData.approvals || {};
    const count = Object.keys(approvals).length;

    res.json({
      success: true,
      count,
      metadata: activeData.metadata,
      approvals,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);

  // Start automatic sync scheduler
  syncScheduler.startScheduler();

  // Start status check scheduler
  syncScheduler.startStatusCheckScheduler();
});
