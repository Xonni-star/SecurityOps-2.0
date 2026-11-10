export enum UserRole {
  ADMIN = 'Systemadministrator',
  MANAGEMENT = 'Geschäftsführung',
  DISPATCHER = 'Einsatzleitung',
  SITE_MANAGER = 'Objektleitung',
  HR = 'Personalverwaltung',
  QM = 'Qualitätsmanagement',
  GUARD = 'Sicherheitsmitarbeiter'
}

export type SyncState = 'synced' | 'pending' | 'conflict' | 'error';

export interface Tenant {
  id: string;
  code: string;
  name: string;
  companyRegistrationNumber: string;
  address: string;
  primaryContact: string;
  email: string;
  phone: string;
  din77200CertificateNumber: string;
  licenseLevel: 'Enterprise Tier 1' | 'Professional Tier 2' | 'Standard Tier 3';
  activeModules: string[];
  maxGuards: number;
  dataStorageRegion: 'eu-central-1 (Frankfurt)' | 'eu-west-3 (Paris)';
  rlsSchemaName: string;
  createdAt: string;
}

export interface Client {
  id: string;
  tenantId: string;
  customerNumber: string;
  name: string;
  industry: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  contractStart: string;
  contractEnd: string;
  slaLevel: 'Gold (24/7 Intervention)' | 'Silber (Werkschutz)' | 'Bronze (Revierdienst)';
  billingStatus: 'Aktiv' | 'In Prüfung' | 'Gekündigt';
  assignedSitesCount: number;
  monthlyRevenue: number;
  syncState: SyncState;
  version: number;
}

export interface SecuritySite {
  id: string;
  tenantId: string;
  clientId: string;
  clientName: string;
  siteCode: string;
  name: string;
  address: string;
  siteLeader: string;
  riskLevel: 'Niedrig' | 'Mittel' | 'Hoch' | 'Kritische Infrastruktur (KRITIS)';
  alarmSystem: string;
  checkpointsCount: number;
  activeGuardsRequired: number;
  specialInstructions: string;
  keysCount: number;
  status: 'In Betrieb' | 'Wartung' | 'Gefährdet';
  syncState: SyncState;
  version: number;
}

export interface Qualification {
  id: string;
  name: string;
  type: '34a_Sachkunde' | '34a_Unterrichtung' | 'Erste_Hilfe' | 'Brandschutz' | 'Waffenschein' | 'Hundefuehrer' | 'Interventionskraft';
  issuer: string;
  issuedDate: string;
  expiryDate: string;
  isValid: boolean;
  documentUrl?: string;
}

export interface Employee {
  id: string;
  tenantId: string;
  personnelNumber: string;
  firstName: string;
  lastName: string;
  role: string;
  email: string;
  phone: string;
  status: 'Aktiv' | 'Urlaub' | 'Krank' | 'Freigestellt';
  employmentType: 'Vollzeit' | 'Teilzeit' | 'Minijob' | 'Subunternehmer';
  targetHours: number;
  actualHoursMonth: number;
  overtimeBalance: number;
  qualifications: Qualification[];
  assignedSiteId?: string;
  assignedSiteName?: string;
  syncState: SyncState;
  version: number;
}

export interface Shift {
  id: string;
  tenantId: string;
  date: string;
  shiftType: 'Frühschicht (06:00 - 14:00)' | 'Spätschicht (14:00 - 22:00)' | 'Nachtschicht (22:00 - 06:00)' | '24h Bereitschaft';
  siteId: string;
  siteName: string;
  employeeId?: string;
  employeeName?: string;
  status: 'Besetzt' | 'Offen' | 'Konflikt' | 'Abgeschlossen';
  requiredQualification: string;
  hasConflict?: boolean;
  conflictReason?: string;
  hours: number;
  syncState: SyncState;
  version: number;
}

export interface Incident {
  id: string;
  tenantId: string;
  incidentNumber: string;
  timestamp: string;
  siteId: string;
  siteName: string;
  guardName: string;
  category: 'Einbruchversuch' | 'Brandmeldeauslösung' | 'Zutrittsverstoß' | 'Vandalismus' | 'Technischer Defekt' | 'Routinekontrolle' | 'Personenkontrolle';
  priority: 'Niedrig' | 'Mittel' | 'Hoch' | 'KRITISCH';
  title: string;
  description: string;
  actionsTaken: string;
  policeInvolved: boolean;
  resolved: boolean;
  imagesCount: number;
  escalationStatus: 'Gemeldet' | 'In Bearbeitung' | 'Eskaliert' | 'Abgeschlossen';
  syncState: SyncState;
  version: number;
  offlineCreated?: boolean;
  auditHash?: string;
}

export interface SopInstruction {
  id: string;
  tenantId: string;
  code: string;
  title: string;
  category: 'Objektspezifisch' | 'Arbeitssicherheit' | 'Notfallprotokoll' | 'Datenschutz / DSGVO';
  version: string;
  applicableSite: string;
  updatedAt: string;
  author: string;
  content: string;
  requiresDigitalSignature: boolean;
  acknowledgedCount: number;
  totalRequiredGuards: number;
  syncState: SyncState;
}

export interface KeyItem {
  id: string;
  tenantId: string;
  keyNumber: string;
  siteName: string;
  bundleLabel: string;
  status: 'Im Tresor' | 'Ausgegeben' | 'Verlustmeldung';
  currentHolder?: string;
  issuedAt?: string;
  expectedReturn?: string;
  doorAccess: string[];
  syncState: SyncState;
}

export interface OperationalTask {
  id: string;
  tenantId: string;
  title: string;
  siteName: string;
  assignedTo: string;
  dueDate: string;
  priority: 'Dringend' | 'Normal' | 'Niedrig';
  status: 'Offen' | 'In Bearbeitung' | 'Erledigt';
  category: 'Audit' | 'Wartung' | 'Kundenanforderung' | 'Schulung';
  syncState: SyncState;
  version: number;
}

export interface NotificationItem {
  id: string;
  tenantId: string;
  type: 'warning' | 'alert' | 'info';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

export interface SyncQueueItem {
  id: string;
  tenantId: string;
  entityType: 'incident' | 'shift' | 'task' | 'key' | 'employee';
  entityId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  payloadSummary: string;
  createdAt: string;
  retryCount: number;
  status: 'pending' | 'syncing' | 'synced' | 'conflict';
  conflictDetails?: {
    serverVersion: number;
    clientVersion: number;
    serverPayloadSnippet: string;
  };
}

export interface ModuleManifest {
  id: string;
  code: string;
  title: string;
  version: string;
  category: 'Core' | 'Operations' | 'Surveillance' | 'Compliance' | 'AI & IoT';
  description: string;
  author: string;
  dependencies: string[];
  permissionsRequired: string[];
  apiEndpointPrefix: string;
  isCore: boolean;
  status: 'Aktiv' | 'Inaktiv' | 'Beta';
}
