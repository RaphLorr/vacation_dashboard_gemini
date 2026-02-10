// Define global interfaces and types here

export interface NavItem {
  label: string;
  href: string;
  isActive?: boolean;
}

export enum AppStatus {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR',
}