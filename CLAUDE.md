# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Leave Record Board** application for tracking employee leave requests during the Chinese New Year period (Feb 11-28, 2026). The app features:

- Visual calendar board showing approved/pending leave requests
- Excel file upload for batch importing leave data
- Department-based filtering
- Real-time server sync with local fallback
- Both React SPA and standalone HTML versions

## Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS (via CDN), XLSX (SheetJS)
- **Backend**: Node.js, Express
- **Storage**: JSON file system (`leave_data.json`)
- **Build**: Vite

## Development Commands

```bash
# Install dependencies
npm install

# Start server (serves both API and static files on port 3000)
npm start
# or
npm run dev

# Access the app
http://localhost:3000
```

**Important**: There is no separate build command. The app uses ES modules with import maps and loads React from CDN. Vite config exists but is not actively used in the current setup.

## Architecture

### Data Flow

1. **Initialization**: Client fetches data from `/api/leave-records` on load
   - If server available: loads server data
   - If server unavailable: falls back to localStorage
   - Shows sync status: "已同步至服务器" or "⚠ 仅本地保存"

2. **Excel Upload**: User uploads Excel → client parses with XLSX → persists to both localStorage and server

3. **Data Persistence**: All changes are saved to both localStorage (immediate) and server (async)

### Key Data Structures

```typescript
// Leave record for a single employee
LeaveRecord = {
  [date: string]: '已通过' | '审批中'  // e.g., "2.14": "已通过"
}

// All leave data
leaveData = {
  [employeeName: string]: LeaveRecord
}

// Employee metadata
employeeInfo = {
  [employeeName: string]: {
    department: string
  }
}

// Full API payload
AppData = {
  leaveData: Record<string, LeaveRecord>
  employeeInfo: Record<string, EmployeeInfo>
  updatedAt: string  // ISO timestamp
}
```

### Backend API

**Express server** (`server.js`) on port 3000:

- `GET /api/leave-records` - Retrieve all data
- `POST /api/leave-records` - Save data (upserts `leave_data.json`)
- Static file serving from root directory

**No authentication** - this is a simple collaborative tool.

### Date Configuration (Dynamic)

**The app now supports dynamic date ranges with automatic Chinese holiday detection!**

#### Features:
- **Date Range Selector**: Choose any start and end date to view leave records
- **Automatic Holiday Detection**: Fetches official Chinese public holiday data from [timor.tech API](http://timor.tech/api/holiday)
- **Weekend Detection**: Automatically identifies weekends as rest days
- **Default Range**: Shows today + 90 days by default

#### Date Config Structure:
```javascript
{
  date: "2.14",           // Display format
  fullDate: "2026-02-14", // ISO format
  type: "休" | "班",      // Rest day or workday
  name: "春节",           // Holiday name (if applicable)
  year: 2026,
  month: 2,
  day: 14
}
```

#### How It Works:
1. Page loads → Fetches default date range (today + 90 days)
2. Fetches holiday data from timor.tech API for the year(s) in range
3. Generates dynamic `dateConfig` with holiday information
4. User can change date range → Fetches new holiday data → Re-renders board

#### API Endpoints:
- `GET /api/holidays/default-range` - Get default date range
- `GET /api/holidays/dateconfig?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` - Get date config with holidays

**To change default range**: Modify `getDefaultDateRange()` in `services/holiday-service.js` (currently 90 days).

### Excel File Format

Expected Excel columns (Chinese):
- `申请人` - Employee name
- `申请人部门` - Department
- `开始时间` - Start time (format: `2026/2/14 上午/下午`)
- `结束时间` - End time (format: `2026/2/14 上午/下午`)
- `当前审批状态` - Status ("已通过" or "审批中")

Date parsing logic in `parseDateRange()` extracts day numbers from `2026/2/XX` patterns.

## File Structure

### Primary App (React + Server)

- `App.tsx` - Main React component with all business logic (500 lines)
- `index.html` - Entry point with React CDN imports and Tailwind config
- `index.tsx` - React root renderer (minimal)
- `server.js` - Express API server
- `leave_data.json` - Server-side data persistence (created on first save)

### Standalone Version

- `leave-board.html` - Fully self-contained HTML version without React or server dependencies
  - Includes inline styles and vanilla JavaScript
  - Same core functionality as React version
  - No persistence (only in-browser)

### Unused Components

- `components/` directory contains placeholder files (`Header.tsx`, `Footer.tsx`, `Hero.tsx`, `Layout.tsx`) that are **not imported** in the current app
- All UI is implemented directly in `App.tsx`

## WeChat Work Sync

The app supports automatic synchronization with WeChat Work (企业微信) API to fetch leave approval data.

### Setup

1. **Configure credentials** in `.env.local`:
   ```bash
   WECOM_CORPID=your_corp_id
   WECOM_SECRET=your_app_secret
   TEST_START_DATE=2026-02-01
   TEST_END_DATE=2026-02-28
   ```

2. **Verify API access**:
   ```bash
   node test-wecom-api.js
   ```

3. **API Permissions Required**:
   - 审批 (Approval) API access enabled in 企业微信管理后台
   - App must have permission to read approval data

### How It Works

1. **Manual Sync**: Click "🔄 从企业微信同步" button in the UI
2. **Data Fetching**: Fetches all approval records from WeChat Work API for the **currently selected date range**
3. **Filtering**: Only processes "请假" (leave) approvals with status "审批中" (1) or "已通过" (2)
4. **Merging**: WeChat data takes priority over Excel data (WeChat is source of truth)
5. **Auto-refresh**: UI automatically refreshes after successful sync

**Note**: Sync uses the date range shown in the UI. Change the date range to sync different periods.

### Merge Behavior

**WeChat Priority Strategy**:
- New employees from WeChat → Added with department info
- Existing employees → WeChat leave dates overwrite Excel conflicts
- Excel-only data → Preserved (not deleted)
- Department info → Updated from WeChat

Example:
```javascript
// Excel data
"张三": { "2.14": "审批中", "2.15": "已通过" }

// WeChat data
"张三": { "2.14": "已通过", "2.16": "已通过" }

// Merged result (WeChat wins for 2.14, Excel 2.15 preserved, WeChat 2.16 added)
"张三": { "2.14": "已通过", "2.15": "已通过", "2.16": "已通过" }
```

### Half-day Leaves

Half-day leaves are stored with time period annotations:
- Full day: `"2.14": "已通过"`
- Half day: `"2.14 (上午)": "已通过"` or `"2.14 (下午)": "已通过"`

The UI displays the time period in the cell.

### Rate Limiting

- **Client-side**: Button disabled during sync
- **Server-side**: Minimum 10 seconds between syncs (429 error if exceeded)
- **WeChat API**: 100ms delay between detail fetches, max 5 concurrent requests

### Error Handling

| Error | HTTP Code | User Message |
|-------|-----------|--------------|
| Missing credentials | 401 | "企业微信凭证未配置" |
| Authentication failed | 401 | "企业微信认证失败" |
| Rate limit exceeded | 429 | "同步过于频繁" |
| API call failed | 503 | "企业微信API调用失败" |
| Data transform error | 500 | "数据转换失败" |

### Troubleshooting

**Sync fails with authentication error**:
- Verify `WECOM_CORPID` and `WECOM_SECRET` in `.env.local`
- Check that credentials match 企业微信管理后台
- Ensure app secret hasn't expired

**No leave records synced**:
- Verify date range in `.env.local` includes approval records
- Check that approvals exist in WeChat Work for Feb 11-28, 2026
- Run `node test-wecom-api.js` to verify API access

**Partial sync (some records skipped)**:
- Check server console logs for specific errors
- Verify approval records have required vacation data fields
- Some non-leave approvals are intentionally skipped

**Rate limit error**:
- Wait at least 10 seconds between sync attempts
- Check if another user/process is syncing simultaneously

### Implementation Files

- `services/wecom-service.js` - WeChat Work API integration
- `server.js` - `/api/wecom/sync` endpoint and merge logic
- `leave-board.html` - Sync button UI and JavaScript
- `test-wecom-api.js` - API testing and verification script

## Key Patterns

### Immutable State Updates

The app uses React hooks with immutable patterns:

```typescript
// Good: Creates new objects
const batchUpdateState = (lData, eInfo) => {
  setLeaveData(lData);  // Replace entire state
  setEmployeeInfo(eInfo);
  // ...
};
```

### Sync Status Management

5 possible states: `idle`, `syncing`, `saved`, `error`, `offline`

- Shows visual badge in header
- `offline` means localStorage-only mode (server unavailable)

### Department Filtering

- Uses `Set<string>` for selected departments
- Filter dropdown with "全选/清空" (select all/clear all)
- `useMemo` to compute filtered data efficiently

### Statistics Calculation

`stats` object computed via `useMemo`:
- `totalEmployees` - Count of filtered employees
- `totalLeaveDays` - Sum of all leave days
- `approvedCount` - Count of approved leave days
- `pendingCount` - Count of pending leave days

## Common Modifications

### Adding a New Field to Leave Records

1. Update `LeaveRecord` interface in `App.tsx`
2. Modify Excel parsing in `processLeaveData()`
3. Update table rendering in JSX (around line 443)
4. Update `leave-board.html` if maintaining both versions

### Changing the Date Range

1. Update `DATE_CONFIG` array in `App.tsx`
2. Update date parsing regex in `parseDateRange()` (currently matches `2026/2/(\d+)`)
3. Update corresponding config in `leave-board.html`

### Adding New Status Types

Currently supports: `已通过` | `审批中`

1. Update TypeScript type in `LeaveRecord` interface
2. Add new cell styling in `<td>` rendering logic (around line 469)
3. Add legend item in legend section (around line 414)

## Troubleshooting

### Server not starting
- Check if port 3000 is available
- Ensure `express` is installed (`npm install`)

### Excel upload fails
- Verify Excel file has required columns in Chinese
- Check browser console for parsing errors
- Ensure XLSX library loaded (from CDN in `index.html`)

### Data not syncing
- Check browser Network tab for `/api/leave-records` requests
- Verify `leave_data.json` file permissions
- App will continue working in offline mode with localStorage

### TypeScript errors
- Run `npx tsc --noEmit` to check types
- Note: `tsconfig.json` has `"noEmit": true` - no build output expected
- Global `window.XLSX` is declared in `App.tsx` for CDN usage
