import React, { useState, useEffect } from 'react';
import { useSecurityStore } from './store';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { GuardBookModule } from './components/GuardBookModule';
import { RosterModule } from './components/RosterModule';
import { SitesModule } from './components/SitesModule';
import { ClientsModule } from './components/ClientsModule';
import { EmployeesModule } from './components/EmployeesModule';
import { SOPModule } from './components/SOPModule';
import { AlarmsModule } from './components/AlarmsModule';
import { KeysModule } from './components/KeysModule';
import { TasksModule } from './components/TasksModule';
import { DocumentsModule } from './components/DocumentsModule';
import { AutomationCenter } from './components/AutomationCenter';
import { ReportsModule } from './components/ReportsModule';
import { ArchitectureCenter } from './components/ArchitectureCenter';
import { SecurityAuditCenter } from './components/SecurityAuditCenter';
import { E2EAcceptanceCenter } from './components/E2EAcceptanceCenter';
import { BackendLiveConsole } from './components/BackendLiveConsole';
import { MobileAppShell } from './components/MobileAppShell';
import { IllustratedUserGuide } from './components/IllustratedUserGuide';
import { AICopilotModal } from './components/AICopilotModal';
import { SyncManagerModal } from './components/SyncManagerModal';
import { ModuleManager } from './components/ModuleManager';
import { GlobalSearchModal } from './components/GlobalSearchModal';
import { NotificationCenterModal } from './components/NotificationCenterModal';
import { X } from 'lucide-react';

export default function App(): React.ReactNode {
  const { activeTab, theme } = useSecurityStore();
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [isNotifCenterOpen, setIsNotifCenterOpen] = useState(false);
  const [isSyncManagerOpen, setIsSyncManagerOpen] = useState(false);
  const [isModuleManagerOpen, setIsModuleManagerOpen] = useState(false);
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsGlobalSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const renderActiveModule = () => {
    switch (activeTab) {
      case 'backend_console':
        return <BackendLiveConsole />;
      case 'user_guide':
        return <IllustratedUserGuide />;
      case 'mobile_app':
        return <MobileAppShell />;
      case 'dashboard':
        return <Dashboard />;
      case 'guardbook':
        return <GuardBookModule />;
      case 'roster':
        return <RosterModule />;
      case 'sites':
        return <SitesModule />;
      case 'clients':
        return <ClientsModule />;
      case 'employees':
        return <EmployeesModule />;
      case 'sop':
        return <SOPModule />;
      case 'documents':
        return <DocumentsModule />;
      case 'automations':
        return <AutomationCenter />;
      case 'alarms':
        return <AlarmsModule />;
      case 'keys':
        return <KeysModule />;
      case 'tasks':
        return <TasksModule />;
      case 'reports':
        return <ReportsModule />;
      case 'e2e_acceptance':
        return <E2EAcceptanceCenter />;
      case 'security_audit':
        return <SecurityAuditCenter />;
      case 'architecture':
        return <ArchitectureCenter />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0f1d] dark:bg-[#0a0f1d] text-slate-100 flex flex-col font-sans transition-colors">
      <Navbar
        onOpenCopilot={() => setIsCopilotOpen(true)}
        onOpenNotifications={() => setIsNotifCenterOpen(true)}
        onOpenSyncManager={() => setIsSyncManagerOpen(true)}
        onOpenModuleManager={() => setIsModuleManagerOpen(true)}
        onOpenGlobalSearch={() => setIsGlobalSearchOpen(true)}
        onToggleMobileMenu={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
      />

      <div className="flex-1 flex overflow-hidden relative">
        <div className="hidden md:flex">
          <Sidebar />
        </div>

        {isMobileMenuOpen && (
          <div className="fixed inset-0 z-40 bg-black/80 md:hidden flex">
            <div className="w-64 bg-[#0a0f1d] h-full shadow-2xl flex flex-col">
              <div className="p-3 flex justify-end">
                <button
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="p-1 rounded text-slate-400 hover:text-white"
                  aria-label="Menü schließen"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <Sidebar onCloseMobileMenu={() => setIsMobileMenuOpen(false)} />
            </div>
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full focus:outline-none" tabIndex={-1}>
          {renderActiveModule()}
        </main>
      </div>

      <GlobalSearchModal isOpen={isGlobalSearchOpen} onClose={() => setIsGlobalSearchOpen(false)} />
      <AICopilotModal isOpen={isCopilotOpen} onClose={() => setIsCopilotOpen(false)} />
      <SyncManagerModal isOpen={isSyncManagerOpen} onClose={() => setIsSyncManagerOpen(false)} />
      <ModuleManager isOpen={isModuleManagerOpen} onClose={() => setIsModuleManagerOpen(false)} />
      <NotificationCenterModal isOpen={isNotifCenterOpen} onClose={() => setIsNotifCenterOpen(false)} />
    </div>
  );
}
