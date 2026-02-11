/**
 * WeChat Work (企业微信) API Service
 *
 * This service handles all interactions with the WeChat Work API
 * to fetch and transform leave approval data.
 */

require('dotenv').config({ path: '.env.local' });
const axios = require('axios');

// Temporarily disable proxy for WeChat Work API
const originalNoProxy = process.env.NO_PROXY || process.env.no_proxy || '';
process.env.NO_PROXY = originalNoProxy
  ? `${originalNoProxy},qyapi.weixin.qq.com,.weixin.qq.com`
  : 'qyapi.weixin.qq.com,.weixin.qq.com';
process.env.no_proxy = process.env.NO_PROXY;

const BASE_URL = 'https://qyapi.weixin.qq.com/cgi-bin';

// Create axios instance without proxy for WeChat Work API
const axiosInstance = axios.create({
  timeout: 30000,
});

// Access token cache
let cachedToken = null;
let tokenExpiry = null;

/**
 * Custom error types
 */
class WecomAuthError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'WecomAuthError';
    this.code = code;
  }
}

class WecomAPIError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'WecomAPIError';
    this.code = code;
  }
}

class DataTransformError extends Error {
  constructor(message, originalError) {
    super(message);
    this.name = 'DataTransformError';
    this.originalError = originalError;
  }
}

/**
 * Get access token with 7200s caching
 */
async function getAccessToken() {
  const corpid = process.env.WECOM_CORPID;
  const secret = process.env.WECOM_SECRET;

  if (!corpid || corpid === 'your_corp_id_here') {
    throw new WecomAuthError('WECOM_CORPID not configured', 'MISSING_CORPID');
  }

  if (!secret || secret === 'your_app_secret_here') {
    throw new WecomAuthError('WECOM_SECRET not configured', 'MISSING_SECRET');
  }

  // Return cached token if still valid (with 300s buffer)
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry - 300000) {
    return cachedToken;
  }

  try {
    const response = await axiosInstance.get(`${BASE_URL}/gettoken`, {
      params: {
        corpid: corpid,
        corpsecret: secret,
      },
    });

    if (response.data.errcode !== 0) {
      throw new WecomAuthError(
        `Authentication failed: ${response.data.errmsg}`,
        `WECOM_${response.data.errcode}`
      );
    }

    cachedToken = response.data.access_token;
    tokenExpiry = Date.now() + (response.data.expires_in * 1000);

    console.log('✅ WeChat Work access token obtained');
    return cachedToken;
  } catch (error) {
    if (error instanceof WecomAuthError) {
      throw error;
    }
    throw new WecomAuthError(
      `Failed to get access token: ${error.message}`,
      'TOKEN_REQUEST_FAILED'
    );
  }
}

/**
 * Fetch approval list for date range
 * Note: WeChat Work API has a 31-day limit for date ranges
 */
/**
 * Fetch approval list by Unix timestamps (for precise minute-level sync)
 */
async function fetchApprovalListByTimestamp(accessToken, startTimestamp, endTimestamp) {
  const startTime = startTimestamp;
  const endTime = endTimestamp;

  // Validate date range (WeChat Work API limit: 31 days)
  const daysDiff = Math.ceil((endTime - startTime) / 86400);
  if (daysDiff > 31) {
    throw new WecomAPIError(
      `Date range too large (${daysDiff} days). WeChat Work API limit is 31 days. This should have been split into chunks by the caller.`,
      'DATE_RANGE_TOO_LARGE'
    );
  }

  const minutesDiff = Math.ceil((endTime - startTime) / 60);
  const startDate = new Date(startTime * 1000).toISOString().replace('T', ' ').substring(0, 19);
  const endDate = new Date(endTime * 1000).toISOString().replace('T', ' ').substring(0, 19);

  console.log(`   📅 Fetching approvals: ${startDate} → ${endDate} (${minutesDiff} minutes)`);
  console.log(`   🕐 Unix timestamps: ${startTime} → ${endTime}`);

  try {
    // Fetch all pages (WeChat Work API returns max 100 records per page)
    const allSpNoList = [];
    let cursor = 0;
    let hasMore = true;
    let pageNum = 1;

    while (hasMore) {
      const requestBody = {
        starttime: startTime,
        endtime: endTime,
        cursor: cursor,
        size: 100,
        filters: [
          {
            key: 'record_type',
            value: 1, // 1 = 请假 (leave) - using integer
          },
        ],
      };

      const response = await axiosInstance.post(
        `${BASE_URL}/oa/getapprovalinfo?access_token=${accessToken}`,
        requestBody
      );

      if (response.data.errcode !== 0) {
        throw new WecomAPIError(
          `Failed to fetch approval list: ${response.data.errmsg}`,
          `WECOM_${response.data.errcode}`
        );
      }

      const spNoList = response.data.sp_no_list || [];
      allSpNoList.push(...spNoList);

      // Check if there are more pages
      hasMore = spNoList.length === 100;
      cursor += spNoList.length;

      if (hasMore) {
        console.log(`   📄 Page ${pageNum}: ${spNoList.length} records (fetching more...)`);
        pageNum++;
        // Small delay between pages to avoid rate limiting
        await delay(200);
      } else {
        if (pageNum > 1) {
          console.log(`   📄 Page ${pageNum}: ${spNoList.length} records (last page)`);
        }
      }
    }

    console.log(`📋 Found ${allSpNoList.length} approval records${pageNum > 1 ? ` (${pageNum} pages)` : ''}`);
    return allSpNoList;
  } catch (error) {
    if (error instanceof WecomAPIError) {
      throw error;
    }
    throw new WecomAPIError(
      `Failed to fetch approval list: ${error.message}`,
      'APPROVAL_LIST_FAILED'
    );
  }
}

// User info cache to avoid redundant API calls
const userInfoCache = new Map();
const departmentCache = new Map();

/**
 * Get department name by department id
 */
async function getDepartmentName(accessToken, deptId) {
  // Check cache first
  if (departmentCache.has(deptId)) {
    return departmentCache.get(deptId);
  }

  try {
    const response = await axiosInstance.get(
      `${BASE_URL}/department/get?access_token=${accessToken}&id=${deptId}`
    );

    if (response.data.errcode !== 0) {
      console.warn(`⚠️  Failed to fetch department info for ${deptId}: ${response.data.errmsg}`);
      return null;
    }

    const deptName = response.data.department?.name || null;

    // Cache the result
    if (deptName) {
      departmentCache.set(deptId, deptName);
    }

    return deptName;
  } catch (error) {
    console.warn(`⚠️  Failed to fetch department info for ${deptId}: ${error.message}`);
    return null;
  }
}

/**
 * Get user information by userid (with caching)
 */
async function getUserInfo(accessToken, userid) {
  // Check cache first
  if (userInfoCache.has(userid)) {
    return userInfoCache.get(userid);
  }

  try {
    const response = await axiosInstance.get(
      `${BASE_URL}/user/get?access_token=${accessToken}&userid=${userid}`
    );

    if (response.data.errcode !== 0) {
      console.warn(`⚠️  Failed to fetch user info for ${userid}: ${response.data.errmsg}`);
      return null;
    }

    const userInfo = {
      name: response.data.name,
      department: response.data.department || [],
      main_department: response.data.main_department || null,
    };

    // Cache the result
    userInfoCache.set(userid, userInfo);

    return userInfo;
  } catch (error) {
    console.warn(`⚠️  Failed to fetch user info for ${userid}: ${error.message}`);
    return null;
  }
}

/**
 * Get detailed approval information
 */
async function getApprovalDetail(accessToken, spNo) {
  try {
    const response = await axiosInstance.post(
      `${BASE_URL}/oa/getapprovaldetail?access_token=${accessToken}`,
      { sp_no: spNo }
    );

    if (response.data.errcode !== 0) {
      throw new WecomAPIError(
        `Failed to fetch approval detail: ${response.data.errmsg}`,
        `WECOM_${response.data.errcode}`
      );
    }

    return response.data.info;
  } catch (error) {
    if (error instanceof WecomAPIError) {
      throw error;
    }
    throw new WecomAPIError(
      `Failed to fetch approval detail for ${spNo}: ${error.message}`,
      'APPROVAL_DETAIL_FAILED'
    );
  }
}

/**
 * Convert WeChat status code to internal status text
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
  return statusMap[statusCode] || null;
}

/**
 * Parse vacation data from approval detail
 */
function parseVacationData(applyData) {
  if (!applyData || !applyData.contents) {
    return null;
  }

  // Find vacation field
  const vacationField = applyData.contents.find(
    field => field.value && field.value.vacation
  );

  if (!vacationField || !vacationField.value.vacation.attendance) {
    return null;
  }

  const vacation = vacationField.value.vacation;
  const attendance = vacation.attendance;
  const dateRange = attendance.date_range;

  if (!dateRange) {
    return null;
  }

  // Extract dates
  const startTimestamp = dateRange.new_begin; // Unix timestamp in seconds
  const endTimestamp = dateRange.new_end;
  const duration = dateRange.new_duration; // Duration in seconds

  // Check half-day from date_range.type field
  const isHalfDay = dateRange.type === 'halfday';

  // Convert timestamps to Date objects
  const startDate = new Date(startTimestamp * 1000);
  const endDate = new Date(endTimestamp * 1000);

  // Get slice_info for day-by-day duration details
  const sliceInfo = attendance.slice_info;

  return {
    startDate,
    endDate,
    duration,
    isHalfDay,
    dateRangeType: dateRange.type,
    sliceInfo,
  };
}

/**
 * Generate date keys for leave period
 * Supports half-day leaves with annotations based on slice_info
 */
function generateDateKeys(vacationData, startTimeStr, endTimeStr) {
  const dates = [];
  const { startDate, sliceInfo } = vacationData;

  // Use slice_info for accurate day-by-day duration info
  if (sliceInfo && sliceInfo.day_items && sliceInfo.day_items.length > 0) {
    // Process each day from slice_info
    for (const dayItem of sliceInfo.day_items) {
      const dayTimestamp = dayItem.daytime; // Unix timestamp in seconds
      const dayDuration = dayItem.duration; // Duration in seconds

      const dayDate = new Date(dayTimestamp * 1000);
      const year = dayDate.getFullYear();
      const month = dayDate.getMonth() + 1;
      const day = dayDate.getDate();

      // Generate date key with year (format: "YYYY-M.D")
      const dateKey = `${year}-${month}.${day}`;

      // Check if this specific day is half-day (43200s = 12 hours)
      // Full day = 86400s = 24 hours
      const isHalfDay = dayDuration === 43200;

      if (isHalfDay) {
        // Determine morning/afternoon from start time hour
        const startHour = startDate.getHours();
        const period = startHour < 12 ? '上午' : '下午';
        dates.push(`${dateKey} (${period})`);
      } else {
        // Full day - no annotation
        dates.push(dateKey);
      }
    }
  } else {
    // Fallback: treat entire period uniformly (old behavior)
    const { endDate, isHalfDay } = vacationData;
    const startHour = startDate.getHours();
    const period = isHalfDay ? (startHour < 12 ? '上午' : '下午') : null;

    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth() + 1;
      const day = currentDate.getDate();

      const dateKey = `${year}-${month}.${day}`;

      if (isHalfDay && period) {
        dates.push(`${dateKey} (${period})`);
      } else {
        dates.push(dateKey);
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }
  }

  return dates;
}

/**
 * Transform WeChat approval detail to internal format
 * NOTE: Must call with await since it fetches user info
 */
async function transformApprovalDetail(detail, accessToken) {
  try {
    // Get userid (fix: use 'applier' not 'applyer')
    const userid = detail.applier?.userid || detail.applyer?.userid || 'Unknown';
    const statusCode = detail.sp_status;
    const status = getStatusText(statusCode);

    // Only process "请假" (leave) approvals
    if (detail.sp_name !== '请假') {
      console.log(`⏭️  Skipped: sp_no=${detail.sp_no}, type="${detail.sp_name}" (not 请假), applicant=${userid}`);
      return null;
    }

    // Only process pending (1) and approved (2) statuses
    if (statusCode !== 1 && statusCode !== 2) {
      console.log(`⏭️  Skipped: sp_no=${detail.sp_no}, status=${statusCode} (${status || 'unknown'}), applicant=${userid}`);
      return null;
    }

    // Fetch user information (name + department) from WeChat API
    let name = userid; // Fallback to userid
    let department = '未知';

    if (userid && userid !== 'Unknown') {
      const userInfo = await getUserInfo(accessToken, userid);
      if (userInfo) {
        name = userInfo.name || userid;

        // Get department name: try main_department first, then first department in array
        let deptId = userInfo.main_department;
        if (!deptId && userInfo.department && userInfo.department.length > 0) {
          deptId = userInfo.department[0];
        }

        if (deptId) {
          const deptName = await getDepartmentName(accessToken, deptId);
          if (deptName) {
            department = deptName;
          } else {
            // Fallback to partyname if department API fails
            department = detail.applier?.partyname || detail.applyer?.partyname || '未知';
          }
        } else {
          // No department ID, use partyname as fallback
          department = detail.applier?.partyname || detail.applyer?.partyname || '未知';
        }
      }
    }

    // Parse vacation data
    const vacationData = parseVacationData(detail.apply_data);
    if (!vacationData) {
      console.warn(`⚠️  Failed to parse vacation data for ${name}`);
      return null;
    }

    // Generate date keys
    const dateKeys = generateDateKeys(vacationData, null, null);

    if (dateKeys.length === 0) {
      return null; // No dates in date range
    }

    return {
      userid,      // Use userid as primary key
      name,        // name is just an attribute
      department,
      status,
      dateKeys,
      isHalfDay: vacationData.isHalfDay,
    };
  } catch (error) {
    throw new DataTransformError(
      `Failed to transform approval detail: ${error.message}`,
      error
    );
  }
}

/**
 * Transform WeChat data to internal format
 * Uses userid as the unique identifier (not name)
 */
function transformWecomData(approvalDetails) {
  const leaveData = {};
  const employeeInfo = {};

  approvalDetails.forEach(detail => {
    if (!detail) return; // Skip filtered or invalid records

    const { userid, name, department, status, dateKeys } = detail;

    // Initialize employee info (use userid as key, name as attribute)
    if (!employeeInfo[userid]) {
      employeeInfo[userid] = {
        name,
        department
      };
    }

    // Initialize leave data (use userid as key)
    if (!leaveData[userid]) {
      leaveData[userid] = {};
    }

    // Add leave dates
    dateKeys.forEach(dateKey => {
      // If date already exists, prefer "已通过" status
      const existingStatus = leaveData[userid][dateKey];
      if (!existingStatus || (status === '已通过' && existingStatus !== '已通过')) {
        leaveData[userid][dateKey] = status;
      }
    });
  });

  return { leaveData, employeeInfo };
}

/**
 * Add delay between API calls to respect rate limits
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch approval details with rate limiting and concurrency control
 */
async function fetchApprovalDetails(accessToken, spNoList) {
  const details = [];
  const errors = [];
  let concurrencyLimit = 3;      // Safe limit - original value that worked reliably
  let delayMs = 100;              // 100ms delay between batches (original safe value)
  let rateLimitHits = 0;          // Track rate limit errors for adaptive throttling

  console.log(`📄 Fetching details for ${spNoList.length} approvals...`);
  console.log(`   ⚡ Using ${concurrencyLimit} concurrent requests with ${delayMs}ms delay`);

  for (let i = 0; i < spNoList.length; i += concurrencyLimit) {
    const batch = spNoList.slice(i, i + concurrencyLimit);
    const batchNum = Math.floor(i / concurrencyLimit) + 1;
    const totalBatches = Math.ceil(spNoList.length / concurrencyLimit);

    // Show progress every 10 batches or on last batch
    if (batchNum % 10 === 0 || i + concurrencyLimit >= spNoList.length) {
      console.log(`   📊 Progress: ${i + batch.length}/${spNoList.length} (${Math.round((i + batch.length) / spNoList.length * 100)}%)`);
    }

    const batchPromises = batch.map(async (spNo) => {
      // Retry logic with exponential backoff for rate limit errors
      const maxRetries = 3;
      let retryCount = 0;

      while (retryCount <= maxRetries) {
        try {
          const detail = await getApprovalDetail(accessToken, spNo);
          const transformed = await transformApprovalDetail(detail, accessToken);
          return { success: true, data: transformed };
        } catch (error) {
          // Check if it's a rate limit error (error code 45009)
          const isRateLimitError = error.message.includes('45009') || error.message.includes('freq out of limit');

          if (isRateLimitError && retryCount < maxRetries) {
            retryCount++;
            const backoffDelay = Math.min(1000 * Math.pow(2, retryCount), 8000); // Exponential backoff: 2s, 4s, 8s
            console.warn(`⚠️  Rate limit hit for ${spNo}, retry ${retryCount}/${maxRetries} after ${backoffDelay}ms...`);
            await delay(backoffDelay);
            continue; // Retry
          }

          // Max retries reached or non-rate-limit error
          console.error(`❌ Failed to fetch detail for ${spNo}:`, error.message);
          errors.push({
            spNo,
            error: error.message,
          });
          return { success: false, error };
        }
      }
    });

    const batchResults = await Promise.all(batchPromises);

    // Check for rate limit errors in this batch
    let batchRateLimitCount = 0;
    batchResults.forEach(result => {
      if (result.success && result.data) {
        details.push(result.data);
      } else if (result.error && result.error.message &&
                 (result.error.message.includes('45009') || result.error.message.includes('freq out of limit'))) {
        batchRateLimitCount++;
        rateLimitHits++;
      }
    });

    // Adaptive rate limiting: slow down if hitting rate limits
    if (batchRateLimitCount > 0) {
      delayMs = Math.min(delayMs * 2, 500); // Double delay, max 500ms
      console.warn(`⚠️  Rate limits detected, increasing delay to ${delayMs}ms`);
    } else if (rateLimitHits === 0 && delayMs > 50) {
      delayMs = Math.max(delayMs * 0.8, 50); // Gradually reduce delay if no issues
    }

    // Rate limiting delay (except for last batch)
    if (i + concurrencyLimit < spNoList.length) {
      await delay(delayMs);
    }
  }

  console.log(`✅ Successfully fetched ${details.length} leave approvals`);
  if (errors.length > 0) {
    console.warn(`⚠️  ${errors.length} records failed`);
  }

  return { details, errors };
}

/**
 * Split date range into 31-day chunks (WeChat Work API limit)
 */
function splitDateRangeIntoChunks(startDate, endDate, maxDays = 31) {
  const chunks = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  let currentStart = new Date(start);

  while (currentStart <= end) {
    // Calculate chunk end (31 days from current start, or final end date)
    const currentEnd = new Date(currentStart);
    currentEnd.setDate(currentEnd.getDate() + maxDays - 1); // -1 because start day counts as day 1

    // Don't exceed the final end date
    if (currentEnd > end) {
      currentEnd.setTime(end.getTime());
    }

    chunks.push({
      start: currentStart.toISOString().split('T')[0],
      end: currentEnd.toISOString().split('T')[0],
    });

    // Move to next chunk (day after current chunk end)
    currentStart = new Date(currentEnd);
    currentStart.setDate(currentStart.getDate() + 1);
  }

  return chunks;
}

/**
 * Split timestamp range into chunks (WeChat Work API limit: 31 days)
 * @param {number} startTimestamp - Start Unix timestamp in seconds
 * @param {number} endTimestamp - End Unix timestamp in seconds
 * @param {number} maxDays - Maximum days per chunk (default 31)
 * @returns {Array<{start: number, end: number}>} Array of timestamp chunks
 */
function splitTimestampRangeIntoChunks(startTimestamp, endTimestamp, maxDays = 31) {
  const chunks = [];
  const maxSeconds = maxDays * 24 * 60 * 60; // Convert days to seconds

  let currentStart = startTimestamp;

  while (currentStart < endTimestamp) {
    // Calculate chunk end (maxDays from current start, or final end)
    const currentEnd = Math.min(currentStart + maxSeconds, endTimestamp);

    chunks.push({
      start: currentStart,
      end: currentEnd,
    });

    // Move to next chunk (1 second after current chunk end to avoid overlap)
    currentStart = currentEnd + 1;
  }

  return chunks;
}

/**
 * Main sync orchestrator
 * @param {string} startDate - Start date in YYYY-MM-DD format (optional)
 * @param {string} endDate - End date in YYYY-MM-DD format (optional)
 */
async function syncLeaveApprovals(startDate, endDate) {
  console.log('🚀 Starting WeChat Work sync...');

  try {
    // Step 1: Get access token
    const accessToken = await getAccessToken();

    // Step 2: Determine date range
    // Use provided dates or fall back to environment variables
    const syncStartDate = startDate || process.env.TEST_START_DATE || '2026-02-01';
    const syncEndDate = endDate || process.env.TEST_END_DATE || '2026-02-28';

    console.log(`   Syncing from ${syncStartDate} to ${syncEndDate}`);

    // Step 3: Split into 31-day chunks if needed
    const chunks = splitDateRangeIntoChunks(syncStartDate, syncEndDate, 31);

    if (chunks.length > 1) {
      console.log(`   📦 Split into ${chunks.length} chunks (31-day limit)`);
    }

    // Step 4: Fetch approval lists for all chunks
    const allSpNoList = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`   📋 Fetching chunk ${i + 1}/${chunks.length}: ${chunk.start} to ${chunk.end}`);

      const spNoList = await fetchApprovalList(accessToken, chunk.start, chunk.end);
      allSpNoList.push(...spNoList);

      // Small delay between chunks to avoid rate limiting
      if (i < chunks.length - 1) {
        await delay(500);
      }
    }

    console.log(`   📊 Total approval records found: ${allSpNoList.length}`);

    const spNoList = allSpNoList;

    if (spNoList.length === 0) {
      console.log('ℹ️  No approval records found in date range');
      return {
        leaveData: {},
        employeeInfo: {},
        syncedCount: 0,
        newEmployees: 0,
        updatedEmployees: 0,
        skippedCount: 0,
        errors: [],
      };
    }

    // Step 3: Fetch detailed approval info
    const { details, errors } = await fetchApprovalDetails(accessToken, spNoList);

    // Step 4: Transform to internal format
    const { leaveData, employeeInfo } = transformWecomData(details);

    const syncedCount = details.length;
    const newEmployees = Object.keys(employeeInfo).length;
    const skippedCount = spNoList.length - details.length;

    console.log('✅ Sync completed successfully');
    console.log(`   Synced: ${syncedCount} records`);
    console.log(`   Employees: ${newEmployees}`);
    console.log(`   Skipped: ${skippedCount} records`);

    return {
      leaveData,
      employeeInfo,
      syncedCount,
      newEmployees,
      updatedEmployees: 0, // Will be calculated in merge
      skippedCount,
      errors,
    };
  } catch (error) {
    console.error('❌ Sync failed:', error);
    throw error;
  }
}

/**
 * Sync leave approvals using precise Unix timestamps (minute-level sync)
 * @param {number} startTimestamp - Start time in Unix seconds
 * @param {number} endTimestamp - End time in Unix seconds
 * @returns {Promise<Object>} Sync result with leaveData and employeeInfo
 */
async function syncLeaveApprovalsByTimestamp(startTimestamp, endTimestamp) {
  console.log('🚀 Starting WeChat Work sync (by timestamp)...');

  try {
    // Step 1: Get access token
    const accessToken = await getAccessToken();

    console.log(`   Syncing from timestamp ${startTimestamp} to ${endTimestamp}`);

    // Step 2: Check if time range exceeds 31 days, split into chunks if needed
    const daysDiff = Math.ceil((endTimestamp - startTimestamp) / 86400);

    if (daysDiff > 31) {
      console.log(`   ⚠️  Time range (${daysDiff} days) exceeds 31-day limit`);
      console.log(`   📦 Splitting into chunks...`);
    }

    const chunks = splitTimestampRangeIntoChunks(startTimestamp, endTimestamp, 31);

    if (chunks.length > 1) {
      console.log(`   📦 Split into ${chunks.length} chunks (31-day limit)`);
    }

    // Step 3: Fetch approval lists for all chunks
    const allSpNoList = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkStart = new Date(chunk.start * 1000).toISOString().replace('T', ' ').substring(0, 19);
      const chunkEnd = new Date(chunk.end * 1000).toISOString().replace('T', ' ').substring(0, 19);

      console.log(`   📋 Fetching chunk ${i + 1}/${chunks.length}: ${chunkStart} → ${chunkEnd}`);

      const spNoList = await fetchApprovalListByTimestamp(accessToken, chunk.start, chunk.end);
      allSpNoList.push(...spNoList);

      // Small delay between chunks to avoid rate limiting
      if (i < chunks.length - 1) {
        await delay(500);
      }
    }

    console.log(`   📊 Total approval records found: ${allSpNoList.length}`);

    const spNoList = allSpNoList;

    if (spNoList.length === 0) {
      console.log('ℹ️  No approval records found in time range');
      return {
        leaveData: {},
        employeeInfo: {},
        syncedCount: 0,
        newEmployees: 0,
        updatedEmployees: 0,
        skippedCount: 0,
        errors: [],
      };
    }

    // Step 4: Fetch detailed approval info
    const { details, errors } = await fetchApprovalDetails(accessToken, spNoList);

    // Step 5: Transform to internal format
    const { leaveData, employeeInfo } = transformWecomData(details);

    const syncedCount = details.length;
    const newEmployees = Object.keys(employeeInfo).length;
    const skippedCount = spNoList.length - details.length;

    console.log('✅ Sync completed successfully');
    console.log(`   Synced: ${syncedCount} records`);
    console.log(`   Employees: ${newEmployees}`);
    console.log(`   Skipped: ${skippedCount} records`);

    return {
      leaveData,
      employeeInfo,
      syncedCount,
      newEmployees,
      updatedEmployees: 0, // Will be calculated in merge
      skippedCount,
      errors,
      rawDetails: details, // Include raw details for active approvals tracking
    };
  } catch (error) {
    console.error('❌ Sync failed:', error);
    throw error;
  }
}

/**
 * Fetch approval details for status checking (optimized for smaller batches)
 * @param {string} accessToken - WeChat access token
 * @param {Array<string>} spNoList - List of sp_no to fetch
 * @returns {Promise<Object>} { details, errors }
 */
async function fetchApprovalDetailsForStatusCheck(accessToken, spNoList) {
  const details = [];
  const errors = [];
  const concurrencyLimit = 5;      // Higher concurrency for status checks
  const delayMs = 50;               // Shorter delay

  console.log(`   🔍 Fetching details for ${spNoList.length} active approvals...`);

  for (let i = 0; i < spNoList.length; i += concurrencyLimit) {
    const batch = spNoList.slice(i, i + concurrencyLimit);

    const batchPromises = batch.map(async (spNo) => {
      try {
        const detail = await getApprovalDetail(accessToken, spNo);
        return { success: true, data: detail };
      } catch (error) {
        console.error(`   ❌ Failed to fetch detail for ${spNo}:`, error.message);
        errors.push({
          spNo,
          error: error.message,
        });
        return { success: false, error };
      }
    });

    const batchResults = await Promise.all(batchPromises);

    batchResults.forEach(result => {
      if (result.success && result.data) {
        details.push(result.data);
      }
    });

    // Rate limiting delay (except for last batch)
    if (i + concurrencyLimit < spNoList.length) {
      await delay(delayMs);
    }
  }

  console.log(`   ✅ Fetched ${details.length}/${spNoList.length} approval details`);
  if (errors.length > 0) {
    console.warn(`   ⚠️  ${errors.length} records failed`);
  }

  return { details, errors };
}

module.exports = {
  syncLeaveApprovals,
  syncLeaveApprovalsByTimestamp,
  fetchApprovalDetailsForStatusCheck,
  getAccessToken,
  WecomAuthError,
  WecomAPIError,
  DataTransformError,
};
