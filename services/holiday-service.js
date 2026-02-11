/**
 * Chinese Holiday Service
 *
 * Fetches official Chinese public holiday data from Aliyun Wannianli API
 * Provider: 万维易源 (showapi.com)
 * Data source: https://ali-wannianli.showapi.com
 *
 * Cache Strategy: Daily cache (resets at midnight, not 24-hour rolling)
 * - Each cache entry is tagged with the date it was created (YYYY-MM-DD)
 * - Cache is considered valid only if it was created on the current day
 * - This ensures exactly ONE API call per day (按日历天，午夜到午夜)
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Load environment variables from .env.local
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const HOLIDAY_API_BASE = 'https://jiejiari.market.alicloudapi.com/holidayList';
const APPCODE = process.env.ALIYUN_HOLIDAY_APPCODE;

if (!APPCODE) {
  console.warn('⚠️  ALIYUN_HOLIDAY_APPCODE not configured in .env.local');
  console.warn('    Please add your AppCode to enable holiday data fetching');
  console.warn('    Get AppCode from: https://market.aliyun.com/products/57126001/cmapi00055124.html');
}

// Cache for holiday data by year
const holidayCache = new Map();

// Persistent cache file path
const CACHE_FILE = path.join(__dirname, 'holiday-cache.json');

/**
 * Get today's date string for cache key
 * Format: YYYY-MM-DD
 */
function getTodayDateString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Check if cache is still valid for today
 * Cache is only valid if it was created on the current day (按日历天，午夜到午夜)
 */
function isCacheValidForToday(cachedDate) {
  return cachedDate === getTodayDateString();
}

/**
 * Load cache from disk
 */
function loadCacheFromDisk() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const fileContent = fs.readFileSync(CACHE_FILE, 'utf8');
      const cacheData = JSON.parse(fileContent);

      // Restore cache entries
      Object.entries(cacheData).forEach(([key, value]) => {
        holidayCache.set(key, value);
      });

      console.log(`📦 Loaded holiday cache from disk (${Object.keys(cacheData).length} entries)`);
    }
  } catch (error) {
    console.error('❌ Failed to load cache from disk:', error.message);
  }
}

/**
 * Save cache to disk
 */
function saveCacheToDisk() {
  try {
    const cacheData = {};
    holidayCache.forEach((value, key) => {
      cacheData[key] = value;
    });

    fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2), 'utf8');
    console.log(`💾 Saved holiday cache to disk`);
  } catch (error) {
    console.error('❌ Failed to save cache to disk:', error.message);
  }
}

// Load cache on startup
loadCacheFromDisk();

/**
 * Parse date string in YYYYMMDD format to Date object
 * @param {string} dateStr - Date string (e.g., "20260215")
 * @returns {Date} Date object
 */
function parseDateYYYYMMDD(dateStr) {
  const year = parseInt(dateStr.substring(0, 4), 10);
  const month = parseInt(dateStr.substring(4, 6), 10) - 1; // Month is 0-indexed
  const day = parseInt(dateStr.substring(6, 8), 10);
  return new Date(year, month, day);
}

/**
 * Format Date object to ISO string (YYYY-MM-DD)
 * @param {Date} date - Date object
 * @returns {string} ISO date string
 */
function formatDateToISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get holiday data for a specific year
 * @param {number} year - Year to fetch (e.g., 2026)
 * @returns {Promise<Object>} Holiday data with dates and types
 */
async function getHolidaysByYear(year) {
  const cacheKey = `year_${year}`;

  // Check cache first
  if (holidayCache.has(cacheKey)) {
    const cached = holidayCache.get(cacheKey);

    // Check if cache is still valid for today (按日历天，午夜到午夜)
    if (isCacheValidForToday(cached.cachedDate)) {
      console.log(`✅ Using cached holiday data for ${year} (cached on ${cached.cachedDate})`);
      return cached.data;
    } else {
      console.log(`⏰ Cache expired for ${year} (was cached on ${cached.cachedDate}, now is ${getTodayDateString()})`);
    }
  }

  if (!APPCODE) {
    console.error('❌ Cannot fetch holiday data: ALIYUN_HOLIDAY_APPCODE not configured');
    return {}; // Fallback to weekend detection
  }

  try {
    console.log(`📅 Fetching holiday data for ${year} from Aliyun API...`);

    // Call Aliyun API
    const response = await axios.get(HOLIDAY_API_BASE, {
      params: {
        year: String(year)
      },
      headers: {
        'Authorization': `APPCODE ${APPCODE}`
      },
      timeout: 10000,
      // Explicitly disable proxy (ignore environment variables)
      proxy: false,
      httpAgent: new http.Agent(),
      httpsAgent: new https.Agent(),
    });

    // Check response status
    if (response.data.showapi_res_code !== 0) {
      throw new Error(`API error: ${response.data.showapi_res_error || 'Unknown error'}`);
    }

    const data = response.data.showapi_res_body?.data || [];
    if (data.length === 0) {
      console.warn(`⚠️  No holiday data returned for ${year}, using weekend detection only`);
      return {};
    }

    // Transform data format
    // API returns holiday periods, need to expand to individual dates
    const holidayData = {};

    data.forEach(period => {
      // Parse dates (YYYYMMDD format)
      const beginDate = parseDateYYYYMMDD(period.begin);
      const endDate = parseDateYYYYMMDD(period.end);
      const holidayName = period.holiday;

      // Expand date range: from begin to end (inclusive)
      const currentDate = new Date(beginDate);
      while (currentDate <= endDate) {
        const dateStr = formatDateToISO(currentDate); // Format: "YYYY-MM-DD"

        holidayData[dateStr] = {
          holiday: true,
          name: holidayName,
          wage: 3, // Holiday pay
        };

        currentDate.setDate(currentDate.getDate() + 1);
      }

      // Mark inverse days (调休上班日) as workdays
      if (period.inverse_days && period.inverse_days.length > 0) {
        period.inverse_days.forEach(inverseDayStr => {
          const inverseDate = parseDateYYYYMMDD(inverseDayStr);
          const dateStr = formatDateToISO(inverseDate);

          holidayData[dateStr] = {
            holiday: false,
            name: holidayName, // Still show holiday name for context
            wage: 1, // Normal workday
          };
        });
      }
    });

    // Cache the result with today's date
    const cacheEntry = {
      data: holidayData,
      cachedDate: getTodayDateString(), // Store which day this was cached
      timestamp: Date.now(), // Keep timestamp for reference
    };

    holidayCache.set(cacheKey, cacheEntry);
    saveCacheToDisk(); // Persist to disk

    console.log(`✅ Fetched ${Object.keys(holidayData).length} holiday records for ${year}`);
    return holidayData;

  } catch (error) {
    console.error(`❌ Failed to fetch holiday data for ${year}:`, error.message);

    // Fallback: return empty object, system will use weekend detection
    return {};
  }
}

/**
 * Generate date config for a date range with holiday information
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Promise<Array>} Array of date configs with holiday info
 */
async function generateDateConfig(startDate, endDate) {
  const dates = [];
  const currentDate = new Date(startDate);

  // Get unique years in the range
  const years = new Set();
  const tempDate = new Date(startDate);
  while (tempDate <= endDate) {
    years.add(tempDate.getFullYear());
    tempDate.setMonth(tempDate.getMonth() + 1);
  }

  // Fetch holiday data for all years
  const holidayDataByYear = {};
  for (const year of years) {
    try {
      holidayDataByYear[year] = await getHolidaysByYear(year);
    } catch (error) {
      console.warn(`⚠️  Failed to fetch holidays for ${year}, using defaults`);
      holidayDataByYear[year] = {};
    }
  }

  // Generate date config
  while (currentDate <= endDate) {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth() + 1;
    const day = currentDate.getDate();
    // Include year in date key to avoid cross-year collisions (format: "YYYY-M.D")
    const dateKey = `${year}-${month}.${day}`;
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    // Check if it's a holiday
    const holidayInfo = holidayDataByYear[year]?.[dateStr];

    let type = '班'; // Default to workday
    let name = null;

    if (holidayInfo) {
      if (holidayInfo.holiday) {
        type = '休'; // Holiday
        name = holidayInfo.name || null;
      } else if (holidayInfo.wage === 1) {
        type = '班'; // Workday (including adjusted workdays)
        name = holidayInfo.name || null; // Show holiday name for adjusted workdays
      } else if (holidayInfo.wage === 2) {
        type = '休'; // Weekend
      } else if (holidayInfo.wage === 3) {
        type = '休'; // Public holiday
        name = holidayInfo.name || null;
      }
    } else {
      // Fallback: check if it's weekend
      const dayOfWeek = currentDate.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        type = '休';
      }
    }

    dates.push({
      date: dateKey,
      fullDate: dateStr,
      type: type,
      name: name,
      year: year,
      month: month,
      day: day,
    });

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return dates;
}

/**
 * Get default date range (today to 90 days from now)
 */
function getDefaultDateRange() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 90); // 90 days from today

  return {
    startDate: today,
    endDate: endDate,
  };
}

/**
 * Format date to YYYY-MM-DD
 */
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

module.exports = {
  getHolidaysByYear,
  generateDateConfig,
  getDefaultDateRange,
  formatDate,
};
