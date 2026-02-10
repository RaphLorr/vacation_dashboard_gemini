import React, { useState } from 'react';
import { ArrowRightIcon, CodeIcon, PlayIcon } from './Icons';

export const Hero: React.FC = () => {
  const [count, setCount] = useState(0);

  return (
    <div className="flex flex-col items-center text-center space-y-8 animate-fade-in-up">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-medium uppercase tracking-wider mb-4">
        <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></span>
        Ready to Build
      </div>

      <h1 className="text-5xl sm:text-7xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white via-indigo-200 to-slate-400 pb-2">
        Build something <br className="hidden sm:block" />
        <span className="text-white">extraordinary.</span>
      </h1>

      <p className="max-w-2xl text-lg sm:text-xl text-slate-400 leading-relaxed">
        This is a production-ready boilerplate pre-configured with React 18, TypeScript, Tailwind CSS, and the Google GenAI SDK. 
        Start editing <code className="bg-slate-800 px-2 py-1 rounded text-indigo-300 text-sm">App.tsx</code> to see magic happen.
      </p>

      <div className="flex flex-col sm:flex-row items-center gap-4 mt-8">
        <button 
          onClick={() => setCount(c => c + 1)}
          className="group relative inline-flex items-center justify-center px-8 py-3.5 text-base font-semibold text-white transition-all duration-200 bg-indigo-600 rounded-xl hover:bg-indigo-700 hover:shadow-lg hover:shadow-indigo-500/25 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 focus:ring-offset-slate-900"
        >
          <PlayIcon className="w-5 h-5 mr-2 group-hover:scale-110 transition-transform" />
          Interactive Counter ({count})
        </button>
        
        <a 
          href="#"
          className="group inline-flex items-center justify-center px-8 py-3.5 text-base font-semibold text-slate-300 transition-all duration-200 bg-slate-800 border border-slate-700 rounded-xl hover:bg-slate-750 hover:text-white hover:border-slate-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-500 focus:ring-offset-slate-900"
        >
          <CodeIcon className="w-5 h-5 mr-2 text-slate-400 group-hover:text-white transition-colors" />
          View Documentation
          <ArrowRightIcon className="w-4 h-4 ml-2 opacity-50 group-hover:translate-x-1 transition-all" />
        </a>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-16 w-full max-w-4xl text-left">
        <FeatureCard 
          title="React 18 & TypeScript" 
          description="Latest features including Concurrent Mode, automatic batching, and strict type safety."
        />
        <FeatureCard 
          title="Tailwind CSS" 
          description="Utility-first CSS framework for rapid UI development with a custom slate theme."
        />
        <FeatureCard 
          title="Gemini AI Ready" 
          description="Pre-configured Google GenAI SDK service hooks located in services/geminiService.ts."
        />
      </div>
    </div>
  );
};

const FeatureCard: React.FC<{ title: string; description: string }> = ({ title, description }) => (
  <div className="p-6 rounded-2xl bg-slate-800/50 border border-slate-700/50 hover:bg-slate-800 transition-colors">
    <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
    <p className="text-slate-400 text-sm leading-relaxed">{description}</p>
  </div>
);
