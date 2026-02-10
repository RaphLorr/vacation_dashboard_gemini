import React from 'react';

export const Footer: React.FC = () => {
  return (
    <footer className="w-full border-t border-slate-800 bg-slate-950 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4 text-slate-500 text-sm">
        <p>&copy; {new Date().getFullYear()} Gemini Starter. All rights reserved.</p>
        <div className="flex gap-6">
          <a href="#" className="hover:text-slate-300 transition-colors">Privacy</a>
          <a href="#" className="hover:text-slate-300 transition-colors">Terms</a>
          <a href="#" className="hover:text-slate-300 transition-colors">Twitter</a>
          <a href="#" className="hover:text-slate-300 transition-colors">GitHub</a>
        </div>
      </div>
    </footer>
  );
};