const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const wecomService = require('./services/wecom-service');
const holidayService = require('./services/holiday-service');
const syncScheduler = require('./services/sync-scheduler');
const syncLock = require('./services/sync-lock');
const authService = require('./services/auth-service');
const userService = require('./services/user-service');
const { requireAuth, optionalAuth } = require('./middleware/auth-middleware');
const { WecomCrypto, WecomCryptoError, extractXmlField } = require('./services/wecom-crypto');
const callbackHandler = require('./services/callback-handler');

const app = express();
const PORT = process.env.PORT || 10890;
const DATA_FILE = path.join(__dirname, 'leave_data.json');

// Global sync lock - prevents concurrent manual and auto sync
let isSyncing = false;

// Rate limiting for sync endpoint
let lastSyncTime = null;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());

// Serve leave-board.html as the main page (BEFORE static middleware!)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'leave-board.html'));
});

// Static files (for other assets)
app.use(express.static(__dirname));

// ============================================
// WeChat Work Callback Routes (no auth — signature verification instead)
// ============================================

// Lazy singleton for WecomCrypto (initialized on first use)
let wecomCrypto = null;
function getWecomCrypto() {
  if (!wecomCrypto) {
    const token = process.env.WECOM_CALLBACK_TOKEN;
    const encodingAESKey = process.env.WECOM_CALLBACK_ENCODING_AES_KEY;
    const corpId = process.env.WECOM_CORPID;

    if (!token || !encodingAESKey || !corpId) {
      return null;
    }

    wecomCrypto = new WecomCrypto(token, encodingAESKey, corpId);
  }
  return wecomCrypto;
}

// GET /callback — URL verification (WeChat Work sends this when configuring the callback URL)
app.get('/callback', (req, res) => {
  const { msg_signature, timestamp, nonce, echostr } = req.query;

  if (!msg_signature || !timestamp || !nonce || !echostr) {
    console.error('[CALLBACK] Missing required query params');
    return res.status(400).send('Missing parameters');
  }

  const cryptoInstance = getWecomCrypto();
  if (!cryptoInstance) {
    console.error('[CALLBACK] Callback credentials not configured');
    return res.status(503).send('Service unavailable');
  }

  try {
    if (!cryptoInstance.verifySignature(msg_signature, timestamp, nonce, echostr)) {
      console.error('[CALLBACK] Signature verification failed (GET)');
      return res.status(403).send('Invalid signature');
    }

    const plaintext = cryptoInstance.decrypt(echostr);
    console.log('[CALLBACK] URL verification successful');
    res.type('text/plain').send(plaintext);
  } catch (error) {
    console.error('[CALLBACK] Verification error:', error.message);
    res.status(403).send('Verification failed');
  }
});

// POST /callback — Event notification (WeChat Work sends encrypted XML payloads)
app.post('/callback', express.text({ type: ['text/xml', 'application/xml'] }), (req, res) => {
  const { msg_signature, timestamp, nonce } = req.query;

  // Always return "success" to prevent WeChat retry storms
  const sendSuccess = () => res.type('text/plain').send('success');

  if (!msg_signature || !timestamp || !nonce) {
    console.error('[CALLBACK] Missing required query params (POST)');
    return sendSuccess();
  }

  const cryptoInstance = getWecomCrypto();
  if (!cryptoInstance) {
    console.error('[CALLBACK] Callback credentials not configured');
    return sendSuccess();
  }

  try {
    const body = req.body;
    const encrypt = extractXmlField(body, 'Encrypt');

    if (!encrypt) {
      console.error('[CALLBACK] No <Encrypt> field in XML body');
      return sendSuccess();
    }

    if (!cryptoInstance.verifySignature(msg_signature, timestamp, nonce, encrypt)) {
      console.error('[CALLBACK] Signature verification failed (POST)');
      return sendSuccess();
    }

    const decryptedXml = cryptoInstance.decrypt(encrypt);

    const msgType = extractXmlField(decryptedXml, 'MsgType');
    const event = extractXmlField(decryptedXml, 'Event');
    console.log(`[CALLBACK] Received event: MsgType=${msgType}, Event=${event}`);

    // Fire-and-forget: process approval change events asynchronously
    if (msgType === 'event' && event === 'sys_approval_change') {
      callbackHandler.handleApprovalChange(decryptedXml).catch(err => {
        console.error('[CALLBACK] Async handler error:', err.message);
      });
    }

    sendSuccess();
  } catch (error) {
    console.error('[CALLBACK] Event processing error:', error.message);
    sendSuccess();
  }
});

// ============================================
// Authentication Routes
// ============================================

// DEPRECATED: QR code login is now embedded in frontend (no redirect needed)
// This route is kept for backward compatibility but not used
app.get('/auth/login', (req, res) => {
  res.status(404).json({
    error: 'Route deprecated',
    message: 'Use QR code login embedded in frontend instead'
  });
});

// OAuth callback handler
app.get('/auth/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code) {
      console.error('[AUTH] No code in callback');
      return res.redirect('/?error=no_code');
    }

    console.log('[AUTH] Received OAuth callback with code');

    // Exchange code for user info
    const { userid, name, department } = await authService.exchangeCodeForUser(code);
    console.log(`[AUTH] User authenticated: ${userid} (${name})`);

    // Create or update user
    userService.createOrUpdateUser(userid, name, department);

    // Create session
    const sessionId = authService.createSession(userid, name, department);

    // Set secure HTTP-only cookie
    res.cookie('session_id', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: 'lax'
    });

    console.log(`[AUTH] Session created: ${sessionId.substring(0, 8)}...`);
    res.redirect('/');
  } catch (error) {
    console.error('[AUTH] Callback error:', error);
    res.redirect('/?error=login_failed');
  }
});

// Logout endpoint
app.post('/auth/logout', (req, res) => {
  const sessionId = req.cookies.session_id;

  if (sessionId) {
    authService.deleteSession(sessionId);
    console.log(`[AUTH] Session deleted: ${sessionId.substring(0, 8)}...`);
  }

  res.clearCookie('session_id');
  res.json({ success: true });
});

// Get auth configuration for frontend QR code login
app.get('/api/auth/config', (req, res) => {
  res.json({
    corpId: process.env.WECOM_CORPID,
    agentId: process.env.WECOM_OAUTH_AGENTID,
    callbackUrl: process.env.WECOM_OAUTH_CALLBACK_URL
  });
});

// Generate JS-SDK signature for @wecom/jssdk Web Login Component
app.get('/api/auth/jssdk-signature', async (req, res) => {
  try {
    const url = req.query.url;

    if (!url) {
      return res.status(400).json({ error: 'URL parameter required' });
    }

    // Get JS-SDK ticket (different from access_token)
    const ticket = await wecomService.getJsApiTicket();

    // Generate signature
    const timestamp = Math.floor(Date.now() / 1000);
    const nonceStr = crypto.randomBytes(16).toString('hex');

    const signStr = `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`;
    const signature = crypto.createHash('sha1').update(signStr).digest('hex');

    console.log(`[AUTH] JS-SDK signature generated for ${url}`);
    res.json({
      timestamp,
      nonceStr,
      signature
    });
  } catch (error) {
    console.error('[AUTH] JS-SDK signature error:', error);
    res.status(500).json({ error: 'Failed to generate signature' });
  }
});

// Get current user info
app.get('/api/user/me', requireAuth, (req, res) => {
  res.json({
    success: true,
    user: {
      userid: req.user.userid,
      name: req.user.name,
      department: req.user.department,
      role: req.user.role || 'normal_user'
    }
  });
});

// ============================================
// API Routes
// ============================================

// GET: Retrieve all leave records
app.get('/api/leave-records', requireAuth, (req, res) => {
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
app.post('/api/leave-records', requireAuth, (req, res) => {
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
app.get('/api/holidays/dateconfig', requireAuth, async (req, res) => {
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
app.get('/api/holidays/default-range', requireAuth, (req, res) => {
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
app.post('/api/wecom/sync', requireAuth, async (req, res) => {
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
app.get('/api/sync/status', requireAuth, (req, res) => {
  try {
    const status = syncScheduler.getSyncStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/sync/start', requireAuth, (req, res) => {
  try {
    syncScheduler.startScheduler();
    res.json({ success: true, message: 'Scheduler started' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/sync/stop', requireAuth, (req, res) => {
  try {
    syncScheduler.stopScheduler();
    res.json({ success: true, message: 'Scheduler stopped' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/sync/reset', requireAuth, (req, res) => {
  try {
    const state = syncScheduler.resetSyncState();
    res.json({ success: true, message: 'Sync state reset', data: state });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/sync/trigger', requireAuth, async (req, res) => {
  try {
    await syncScheduler.performIncrementalSync();
    res.json({ success: true, message: 'Manual sync triggered' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Manual trigger for status check sync
app.post('/api/status-check/trigger', requireAuth, async (req, res) => {
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
app.get('/api/active-approvals', requireAuth, (req, res) => {
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

  // Start callback handler queue drain (only if callback credentials are configured)
  if (getWecomCrypto()) {
    callbackHandler.startQueueDrain();
    console.log('[CALLBACK] Handler initialized');
  }
});
