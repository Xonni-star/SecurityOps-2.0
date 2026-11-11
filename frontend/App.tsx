import React, { useState, useEffect, Component, ErrorInfo, ReactNode } from 'react';
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
import { X, AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 max-w-xl mx-auto my-12 bg-slate-900 border border-rose-500/40 rounded-2xl text-center space-y-4 shadow-2xl">
          <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 mx-auto flex items-center justify-center">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-white">Anwendungsmodul wiederherstellen</h2>
          <p className="text-xs text-slate-300 leading-relaxed">
            Ein untergeordnetes Modul hat einen Rendering-Fehler ausgelöst:
          </p>
          <div className="p-3 bg-slate-950 rounded-lg text-[11px] font-mono text-rose-300 text-left overflow-x-auto">
            {this.state.error?.message || 'Unbekannter Fehler'}
          </div>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 mx-auto"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Neu laden</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App(): React.ReactNode {
  const { activeTab, theme, setActiveTab } = useSecurityStore();
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
      case 'dashboard':
        return <Dashboard />;
      case 'backend_console':
        return <BackendLiveConsole />;
      case 'user_guide':
        return <IllustratedUserGuide />;
      case 'mobile_app':
        return <MobileAppShell />;
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
    <ErrorBoundary>
      <div className="min-h-screen bg-[#0a0f1d] dark:bg-[#0a0f1d] text-slate-100 flex flex-col font-sans transition-colors selection:bg-blue-600 selection:text-white">
        {/* Top Header */}
        <Navbar
          onOpenCopilot={() => setIsCopilotOpen(true)}
          onOpenNotifications={() => setIsNotifCenterOpen(true)}
          onOpenSyncManager={() => setIsSyncManagerOpen(true)}
          onOpenModuleManager={() => setIsModuleManagerOpen(true)}
          onOpenGlobalSearch={() => setIsGlobalSearchOpen(true)}
          onToggleMobileMenu={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        />

        {/* Main Workspace */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Desktop Sidebar */}
          <div className="hidden md:flex">
            <Sidebar />
          </div>

          {/* Mobile Slide-Over Sidebar */}
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

          {/* Content Viewport */}
          <main className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full focus:outline-none" tabIndex={-1}>
            <ErrorBoundary>
              {renderActiveModule()}
            </ErrorBoundary>
          </main>
        </div>

        <GlobalSearchModal isOpen={isGlobalSearchOpen} onClose={() => setIsGlobalSearchOpen(false)} />
        <AICopilotModal isOpen={isCopilotOpen} onClose={() => setIsCopilotOpen(false)} />
        <SyncManagerModal isOpen={isSyncManagerOpen} onClose={() => setIsSyncManagerOpen(false)} />
        <ModuleManager isOpen={isModuleManagerOpen} onClose={() => setIsModuleManagerOpen(false)} />
        <NotificationCenterModal isOpen={isNotifCenterOpen} onClose={() => setIsNotifCenterOpen(false)} />
      </div>
    </ErrorBoundary>
  );
}
