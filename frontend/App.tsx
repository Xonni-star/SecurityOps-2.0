import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { Sidebar, ActiveModule } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { BackendExplorer } from './components/BackendExplorer';
import { DatabaseExplorer } from './components/DatabaseExplorer';
import { WachbuchModule } from './components/WachbuchModule';
import { ScheduleModule } from './components/ScheduleModule';
import { EmployeesModule } from './components/EmployeesModule';
import { SitesModule } from './components/SitesModule';
import { ClientsModule } from './components/ClientsModule';
import { SopModule } from './components/SopModule';
import { AlarmsModule } from './components/AlarmsModule';
import { KeysModule } from './components/KeysModule';
import { TasksModule } from './components/TasksModule';
import { ReportsModule } from './components/ReportsModule';
import { TenantModule } from './components/TenantModule';
import { OfflineSyncModule } from './components/OfflineSyncModule';
import { ModuleRegistryView } from './components/ModuleRegistryView';
import { ArchitectureCenter } from './components/ArchitectureCenter';
import { AiAssistantModal } from './components/AiAssistantModal';
import { SystemArchitectureModal } from './components/SystemArchitectureModal';
import { store } from './services/store';

export const App: React.FC = () => {
  const [activeModule, setActiveModule] = useState<ActiveModule>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [globalSearch, setGlobalSearch] = useState<string>('');
  const [showAiModal, setShowAiModal] = useState<boolean>(false);
  const [showArchModal, setShowArchModal] = useState<boolean>(false);

  // Subscribe to store updates
  const [, setTick] = useState(0);
  useEffect(() => {
    return store.subscribe(() => setTick((t) => t + 1));
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col text-slate-100 font-sans selection:bg-brand-600">
      {/* Top Application Bar */}
      <Header
        onOpenAiAssistant={() => setShowAiModal(true)}
        onOpenArchitectureModal={() => setShowArchModal(true)}
        globalSearch={globalSearch}
        setGlobalSearch={setGlobalSearch}
        onOpenOfflineQueue={() => setActiveModule('offlineSync')}
      />

      {/* Main Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* Navigation Sidebar */}
        <Sidebar
          activeModule={activeModule}
          setActiveModule={setActiveModule}
          collapsed={sidebarCollapsed}
          setCollapsed={setSidebarCollapsed}
        />

        {/* Content Viewport */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-gradient-to-b from-slate-950 to-slate-900/80">
          <div className="max-w-7xl mx-auto">
            {activeModule === 'dashboard' && (
              <Dashboard
                onNavigate={(mod) => setActiveModule(mod)}
                onOpenAiAssistant={() => setShowAiModal(true)}
              />
            )}
            {activeModule === 'backendExplorer' && <BackendExplorer />}
            {activeModule === 'databaseExplorer' && <DatabaseExplorer />}
            {activeModule === 'wachbuch' && <WachbuchModule globalSearch={globalSearch} />}
            {activeModule === 'schedule' && <ScheduleModule />}
            {activeModule === 'employees' && <EmployeesModule globalSearch={globalSearch} />}
            {activeModule === 'sites' && <SitesModule />}
            {activeModule === 'clients' && <ClientsModule />}
            {activeModule === 'sops' && <SopModule />}
            {activeModule === 'alarms' && <AlarmsModule />}
            {activeModule === 'keys' && <KeysModule />}
            {activeModule === 'tasks' && <TasksModule />}
            {activeModule === 'reports' && <ReportsModule />}
            {activeModule === 'tenants' && <TenantModule />}
            {activeModule === 'offlineSync' && <OfflineSyncModule />}
            {activeModule === 'modules' && <ModuleRegistryView />}
            {activeModule === 'architecture' && (
              <ArchitectureCenter onOpenArchitectureModal={() => setShowArchModal(true)} />
            )}
          </div>
        </main>
      </div>

      {/* Modals */}
      <AiAssistantModal isOpen={showAiModal} onClose={() => setShowAiModal(false)} />
      <SystemArchitectureModal isOpen={showArchModal} onClose={() => setShowArchModal(false)} />
    </div>
  );
};

export default App;
