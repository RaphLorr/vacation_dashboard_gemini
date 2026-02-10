import React, { useState, useMemo, useEffect, useRef } from 'react';

// Declaration for the global XLSX object from CDN
declare global {
  interface Window {
    XLSX: any;
  }
}

// Types
interface DateConfigItem {
  date: string;
  type: '班' | '休';
}

interface LeaveRecord {
  [date: string]: '已通过' | '审批中';
}

interface EmployeeInfo {
  department: string;
}

interface Stats {
  totalEmployees: number;
  totalLeaveDays: number;
  approvedCount: number;
  pendingCount: number;
}

interface AppData {
  leaveData: Record<string, LeaveRecord>;
  employeeInfo: Record<string, EmployeeInfo>;
  updatedAt: string;
}

// Configuration
const DATE_CONFIG: DateConfigItem[] = [
  { date: '2.11', type: '班' },
  { date: '2.12', type: '班' },
  { date: '2.13', type: '班' },
  { date: '2.14', type: '班' },
  { date: '2.15', type: '休' },
  { date: '2.16', type: '休' },
  { date: '2.17', type: '休' },
  { date: '2.18', type: '休' },
  { date: '2.19', type: '休' },
  { date: '2.20', type: '休' },
  { date: '2.21', type: '休' },
  { date: '2.22', type: '休' },
  { date: '2.23', type: '休' },
  { date: '2.24', type: '班' },
  { date: '2.25', type: '班' },
  { date: '2.26', type: '班' },
  { date: '2.27', type: '班' },
  { date: '2.28', type: '班' },
];

const STORAGE_KEY = 'LEAVE_BOARD_DATA';
const API_ENDPOINT = '/api/leave-records';

export default function App() {
  const [leaveData, setLeaveData] = useState<Record<string, LeaveRecord>>({});
  const [employeeInfo, setEmployeeInfo] = useState<Record<string, EmployeeInfo>>({});
  const [allDepartments, setAllDepartments] = useState<string[]>([]);
  const [selectedDepartments, setSelectedDepartments] = useState<Set<string>>(new Set());
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  
  // Sync Status State
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'saved' | 'error' | 'offline'>('idle');
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);

  const filterRef = useRef<HTMLDivElement>(null);

  // Initialize Data (Try Server -> Fallback to Local)
  useEffect(() => {
    const initData = async () => {
      setSyncStatus('syncing');
      try {
        const response = await fetch(API_ENDPOINT);
        if (response.ok) {
          const data: AppData = await response.json();
          if (data && data.leaveData) {
            batchUpdateState(data.leaveData, data.employeeInfo);
            setLastSyncTime(data.updatedAt);
            setSyncStatus('saved');
            return;
          }
        } else {
            console.log("Backend not available, using local storage.");
        }
      } catch (e) {
        console.log("Failed to fetch from server, using local storage.", e);
      }

      // Fallback to local storage
      const savedData = localStorage.getItem(STORAGE_KEY);
      if (savedData) {
        try {
          const parsed = JSON.parse(savedData);
          if (parsed.leaveData && parsed.employeeInfo) {
            batchUpdateState(parsed.leaveData, parsed.employeeInfo);
            setLastSyncTime(parsed.updatedAt);
            setSyncStatus('offline'); // Working in offline mode
          } else {
            setSyncStatus('idle');
          }
        } catch (e) {
          console.error("Local storage corrupted");
          setSyncStatus('idle');
        }
      } else {
        setSyncStatus('idle');
      }
    };

    initData();
  }, []);

  // Helper to update all state from data source
  const batchUpdateState = (lData: Record<string, LeaveRecord>, eInfo: Record<string, EmployeeInfo>) => {
    setLeaveData(lData);
    setEmployeeInfo(eInfo);
    
    const depts = new Set<string>();
    Object.values(eInfo).forEach(info => {
      if (info.department) depts.add(info.department);
    });
    const sortedDepts = Array.from(depts).sort();
    setAllDepartments(sortedDepts);
    setSelectedDepartments(new Set(sortedDepts));
  };

  // Close filter dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setIsFilterOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const persistData = async (lData: Record<string, LeaveRecord>, eInfo: Record<string, EmployeeInfo>) => {
    const now = new Date().toISOString();
    const payload: AppData = {
      leaveData: lData,
      employeeInfo: eInfo,
      updatedAt: now
    };

    // 1. Always save locally first
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      setLastSyncTime(now);
    } catch (e) {
      console.error("Local save failed", e);
    }

    // 2. Try to save to server
    setSyncStatus('syncing');
    try {
      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        setSyncStatus('saved');
      } else {
        // If server returns 404/500, we are effectively offline/local-only
        setSyncStatus('offline'); 
      }
    } catch (e) {
      console.error("Server sync failed");
      setSyncStatus('offline');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = window.XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = window.XLSX.utils.sheet_to_json(worksheet);

        processLeaveData(jsonData);
      } catch (error) {
        alert('文件读取失败，请确保上传的是正确的Excel文件');
        console.error(error);
      }
      
      const fileInput = document.getElementById('fileInput') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
    };
    reader.readAsArrayBuffer(file);
  };

  const parseDateRange = (startTime: string, endTime: string): string[] => {
    const dates: string[] = [];
    if (!startTime || !endTime) return dates;
    
    const sTime = String(startTime);
    const eTime = String(endTime);

    const startMatch = sTime.match(/2026\/2\/(\d+)/);
    const endMatch = eTime.match(/2026\/2\/(\d+)/);

    if (!startMatch || !endMatch) return dates;

    const startDay = parseInt(startMatch[1], 10);
    const endDay = parseInt(endMatch[1], 10);

    for (let day = Math.max(11, startDay); day <= Math.min(28, endDay); day++) {
      dates.push(`2.${day}`);
    }

    return dates;
  };

  const processLeaveData = (data: any[]) => {
    const newLeaveRecords: Record<string, LeaveRecord> = {};
    const newEmployeeInfo: Record<string, EmployeeInfo> = {};

    data.forEach(row => {
      const name = row['申请人'];
      const dept = row['申请人部门'] || '未知';
      const startTime = row['开始时间'];
      const endTime = row['结束时间'];
      const status = row['当前审批状态'];

      if (!name || !startTime || !endTime) return;

      if (!newEmployeeInfo[name]) {
        newEmployeeInfo[name] = { department: String(dept) };
      }

      if (!newLeaveRecords[name]) {
        newLeaveRecords[name] = {};
      }

      const leaveDates = parseDateRange(startTime, endTime);
      leaveDates.forEach(date => {
        const currentStatus = newLeaveRecords[name][date];
        if (!currentStatus || (status === '已通过' && currentStatus !== '已通过')) {
          newLeaveRecords[name][date] = status;
        }
      });
    });

    batchUpdateState(newLeaveRecords, newEmployeeInfo);
    persistData(newLeaveRecords, newEmployeeInfo);
  };

  const handleClearData = () => {
    if (window.confirm('确定要清空所有数据吗？此操作将覆盖服务器数据。')) {
      const emptyData = {};
      const emptyInfo = {};
      batchUpdateState(emptyData, emptyInfo);
      persistData(emptyData, emptyInfo);
    }
  };

  const filteredData = useMemo(() => {
    const filtered: Record<string, LeaveRecord> = {};
    Object.keys(leaveData).forEach(name => {
      const empDept = employeeInfo[name]?.department;
      if (selectedDepartments.has(empDept)) {
        filtered[name] = leaveData[name];
      }
    });
    return filtered;
  }, [leaveData, employeeInfo, selectedDepartments]);

  const stats: Stats = useMemo(() => {
    let totalLeaveDays = 0;
    let approvedCount = 0;
    let pendingCount = 0;
    const names = Object.keys(filteredData);

    names.forEach(name => {
      const records = filteredData[name];
      const dates = Object.keys(records);
      totalLeaveDays += dates.length;
      dates.forEach(date => {
        if (records[date] === '已通过') approvedCount++;
        else pendingCount++;
      });
    });

    return {
      totalEmployees: names.length,
      totalLeaveDays,
      approvedCount,
      pendingCount
    };
  }, [filteredData]);

  const toggleDepartment = (dept: string) => {
    const next = new Set(selectedDepartments);
    if (next.has(dept)) next.delete(dept);
    else next.add(dept);
    setSelectedDepartments(next);
  };

  const selectAll = () => setSelectedDepartments(new Set(allDepartments));
  const clearAll = () => setSelectedDepartments(new Set());

  // Helper for status badge
  const getStatusBadge = () => {
    switch (syncStatus) {
      case 'syncing':
        return <span className="text-yellow-200 text-xs animate-pulse">↻ 同步中...</span>;
      case 'saved':
        return <span className="text-green-200 text-xs">✓ 已同步至服务器</span>;
      case 'offline':
        return <span className="text-gray-300 text-xs" title="数据仅保存在本地">⚠ 仅本地保存</span>;
      case 'error':
        return <span className="text-red-300 text-xs">✕ 同步失败</span>;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col font-sans text-[#333]">
      {/* Top Bar */}
      <div className="flex flex-col md:flex-row justify-between items-center p-4 bg-gradient-to-br from-[#667eea] to-[#764ba2] text-white shadow-md gap-4">
        <div className="flex items-center gap-4 w-full md:w-auto">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold m-0">🎊 请假记录看板</h1>
              {getStatusBadge()}
            </div>
            <p className="opacity-90 text-xs m-0">2.11 - 2.28 {lastSyncTime && `(更新于 ${new Date(lastSyncTime).toLocaleTimeString()})`}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-end">
          {allDepartments.length > 0 && (
            <div className="relative" ref={filterRef}>
              <button 
                onClick={() => setIsFilterOpen(!isFilterOpen)}
                className="flex items-center gap-2 px-3 py-1.5 bg-white/20 border border-white/40 rounded hover:bg-white/30 transition-all text-sm"
              >
                <span>📂 部门筛选</span>
                <span>
                  {selectedDepartments.size === allDepartments.length 
                    ? '(全部)' 
                    : selectedDepartments.size === 0 
                      ? '(无)' 
                      : `(${selectedDepartments.size}/${allDepartments.length})`}
                </span>
              </button>

              {isFilterOpen && (
                <div className="absolute top-full right-0 mt-1 bg-white border border-gray-200 rounded shadow-xl p-2 min-w-[200px] z-50 text-gray-800 max-h-[300px] overflow-y-auto flex flex-col">
                  <div className="flex flex-col gap-1 mb-2">
                    {allDepartments.map(dept => (
                      <label key={dept} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-100 rounded cursor-pointer text-sm">
                        <input 
                          type="checkbox" 
                          checked={selectedDepartments.has(dept)} 
                          onChange={() => toggleDepartment(dept)}
                          className="accent-[#667eea]"
                        />
                        <span>{dept}</span>
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-2 border-t border-gray-100 sticky bottom-0 bg-white">
                    <button onClick={selectAll} className="flex-1 py-1 px-2 bg-gray-100 hover:bg-gray-200 text-xs rounded border border-gray-300">全选</button>
                    <button onClick={clearAll} className="flex-1 py-1 px-2 bg-gray-100 hover:bg-gray-200 text-xs rounded border border-gray-300">清空</button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2">
            {Object.keys(leaveData).length > 0 && (
              <button 
                onClick={handleClearData}
                className="px-3 py-1.5 bg-red-500/80 border border-red-500/40 rounded hover:bg-red-600/90 transition-all text-sm text-white"
              >
                清空数据
              </button>
            )}
            
            <label className="cursor-pointer px-4 py-1.5 bg-white/20 border border-white/40 rounded hover:bg-white/30 transition-all text-sm text-white inline-flex items-center gap-2">
              <span>📁 上传Excel</span>
              <input 
                id="fileInput"
                type="file" 
                accept=".xlsx,.xls" 
                onChange={handleFileUpload} 
                className="hidden" 
              />
            </label>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="px-5 py-3 bg-gray-50 flex flex-wrap gap-5 border-b border-gray-200 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-3.5 border border-gray-300 rounded-sm bg-orange-500"></div>
          <span>请假(已通过)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-3.5 border border-gray-300 rounded-sm striped-bg"></div>
          <span>请假(审批中)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-3.5 border border-gray-300 rounded-sm bg-green-300"></div>
          <span>假期(休)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-3.5 border border-gray-300 rounded-sm bg-white"></div>
          <span>工作日(班)</span>
        </div>
      </div>

      {/* Main Board */}
      <div className="flex-grow overflow-auto">
        {Object.keys(leaveData).length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 p-10">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-20 h-20 mb-5 opacity-30">
              <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z"/>
            </svg>
            <p>请上传Excel文件查看请假记录</p>
          </div>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="border border-gray-200 p-1.5 text-center font-semibold min-w-[140px] sticky left-0 z-20 bg-gray-200">
                  姓名(部门)
                </th>
                {DATE_CONFIG.map((cfg) => (
                  <th key={cfg.date} className="border border-gray-200 p-1.5 text-center font-semibold min-w-[50px]">
                    <div className="font-bold mb-px">{cfg.date}</div>
                    <div className="text-[9px] text-gray-500 font-normal">({cfg.type})</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.keys(filteredData).sort().map(name => {
                const empInfo = employeeInfo[name];
                return (
                  <tr key={name} className="hover:bg-gray-50">
                    <td className="border border-gray-200 p-1.5 text-left font-medium sticky left-0 z-10 bg-gray-50 whitespace-nowrap">
                      {name}
                      <span className="text-[11px] text-gray-500 font-normal ml-2">
                        ({empInfo?.department || '未知'})
                      </span>
                    </td>
                    {DATE_CONFIG.map((cfg) => {
                      const status = filteredData[name][cfg.date];
                      let cellClass = "bg-white"; // default workday
                      
                      if (status) {
                        if (status === '已通过') cellClass = "bg-orange-500";
                        else cellClass = "striped-bg"; // pending
                      } else if (cfg.type === '休') {
                        cellClass = "bg-green-300"; // holiday
                      }

                      return (
                        <td key={cfg.date} className={`border border-gray-200 p-1 min-w-[50px] ${cellClass}`} />
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Stats Footer */}
      {Object.keys(leaveData).length > 0 && (
        <div className="p-3 text-xs text-gray-600 bg-gray-50 border-t border-gray-200">
          共 {stats.totalEmployees} 人 | 请假总天数：{stats.totalLeaveDays} 天 | 已通过：{stats.approvedCount} 天 | 审批中：{stats.pendingCount} 天
        </div>
      )}
    </div>
  );
}