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

### Date Configuration

The app is **hardcoded** to display Feb 11-28, 2026 with specific work/holiday patterns in `DATE_CONFIG`:

```typescript
const DATE_CONFIG = [
  { date: '2.11', type: '班' },  // Workday
  { date: '2.12', type: '班' },
  // ... continues through 2.28
];
```

**To extend the date range**: Update `DATE_CONFIG` in `App.tsx` and the corresponding config in `leave-board.html`.

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
