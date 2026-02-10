import React from 'react';
import { APP_NAME, NAV_ITEMS } from '../constants';
import { SparklesIcon } from './Icons';

export const Header: React.FC = () => {
  return (
    <header className="w-full border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-indigo-600 rounded-lg shadow-lg shadow-indigo-500/30">
            <SparklesIcon className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight text-white">{APP_NAME}</span>
        </div>
        
        <nav className="hidden md:flex items-center gap-8">
          {NAV_ITEMS.map((item) => (
            <a 
              key={item.label}
              href={item.href}
              className={`text-sm font-medium transition-colors duration-200 ${
                item.isActive 
                  ? 'text-white' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-4">
          <button className="hidden sm:block text-sm font-medium text-slate-400 hover:text-white transition-colors">
            Sign In
          </button>
          <button className="px-4 py-2 text-sm font-medium bg-white text-slate-900 rounded-lg hover:bg-slate-200 transition-colors shadow-lg shadow-white/5">
            Get Started
          </button>
        </div>
      </div>
    </header>
  );
};