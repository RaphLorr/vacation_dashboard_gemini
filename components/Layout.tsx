import React from 'react';
import { Header } from './Header';
import { Footer } from './Footer';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <div className="min-h-screen flex flex-col bg-slate-900 text-slate-100 selection:bg-indigo-500 selection:text-white">
      <Header />
      <main className="flex-grow flex flex-col items-center justify-center p-6 sm:p-12 relative overflow-hidden">
        {/* Background Gradients for aesthetic depth */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-600/20 rounded-full blur-[100px] -z-10 pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-accent/10 rounded-full blur-[100px] -z-10 pointer-events-none" />
        
        <div className="w-full max-w-7xl z-10">
          {children}
        </div>
      </main>
      <Footer />
    </div>
  );
};