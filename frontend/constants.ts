import {
  Tenant,
  Client,
  SecuritySite,
  Employee,
  Shift,
  Incident,
  SopInstruction,
  KeyItem,
  OperationalTask,
  NotificationItem,
  ModuleManifest,
  SyncQueueItem
} from './types';

export const INITIAL_TENANTS: Tenant[] = [
  {
    id: 'tenant-1',
    code: 'ARGUS',
    name: 'Argus Sicherheitsdienst & Werkschutz GmbH',
    companyRegistrationNumber: 'HRB München 218940',
    address: 'Sicherheitsallee 12, 80339 München',
    primaryContact: 'Dipl.-Ing. Frank Sommer (Geschäftsführer)',
    email: 'leitstand@argus-security.de',
    phone: '+49 89 203940-0',
    din77200CertificateNumber: 'TÜV-SÜD-DIN77200-2024-MUC',
    licenseLevel: 'Enterprise Tier 1',
    activeModules: ['mod-core', 'mod-wachbuch', 'mod-schedule', 'mod-kritis', 'mod-ai-patrol', 'mod-keys'],
    maxGuards: 150,
    dataStorageRegion: 'eu-central-1 (Frankfurt)',
    rlsSchemaName: 'tenant_argus_prod',
    createdAt: '2023-01-15'
  },
  {
    id: 'tenant-2',
    code: 'VANGUARD',
    name: 'Vanguard Security Services Rhein-Main AG',
    companyRegistrationNumber: 'HRB Frankfurt 994012',
    address: 'Eschersheimer Landstr. 88, 60322 Frankfurt am Main',
    primaryContact: 'Clara von Wedel (Vorstand Operations)',
    email: 'ops@vanguard-security.com',
    phone: '+49 69 881290-0',
    din77200CertificateNumber: 'VdS-DIN77200-FRA-8821',
    licenseLevel: 'Enterprise Tier 1',
    activeModules: ['mod-core', 'mod-wachbuch', 'mod-schedule', 'mod-alarms'],
    maxGuards: 220,
    dataStorageRegion: 'eu-central-1 (Frankfurt)',
    rlsSchemaName: 'tenant_vanguard_prod',
    createdAt: '2023-08-01'
  }
];

export const INITIAL_CLIENTS: Client[] = [
  {
    id: 'cli-1',
    tenantId: 'tenant-1',
    customerNumber: 'KD-2024-081',
    name: 'Bayerische Motoren Logistik GmbH',
    industry: 'Automobil & Kontraktlogistik',
    contactPerson: 'Dr. Michael Vogl (Leiter Werksicherheit)',
    email: 'm.vogl@bml-logistics.de',
    phone: '+49 89 458920-11',
    address: 'Industriepark Nord 14, 80939 München',
    contractStart: '2022-01-01',
    contractEnd: '2026-12-31',
    slaLevel: 'Gold (24/7 Intervention)',
    billingStatus: 'Aktiv',
    assignedSitesCount: 2,
    monthlyRevenue: 28450,
    syncState: 'synced',
    version: 1
  },
  {
    id: 'cli-2',
    tenantId: 'tenant-1',
    customerNumber: 'KD-2023-019',
    name: 'FinTech Tower Frankfurt Holding',
    industry: 'Banken & Finanzdienstleistung',
    contactPerson: 'Susanne Albrecht (Facility Managerin)',
    email: 'albrecht@ftt-frankfurt.com',
    phone: '+49 69 771200-45',
    address: 'Mainzer Landstraße 180, 60327 Frankfurt am Main',
    contractStart: '2023-04-15',
    contractEnd: '2025-12-31',
    slaLevel: 'Gold (24/7 Intervention)',
    billingStatus: 'Aktiv',
    assignedSitesCount: 1,
    monthlyRevenue: 34200,
    syncState: 'synced',
    version: 1
  },
  {
    id: 'cli-3',
    tenantId: 'tenant-2',
    customerNumber: 'KD-VG-001',
    name: 'Commerz Logistics Hub Taunus',
    industry: 'Werttransport & Wertlagerung',
    contactPerson: 'Harald Mende (Sicherheitsdirektor)',
    email: 'mende@commerz-hub.de',
    phone: '+49 6172 99120',
    address: 'Gewerbestraße 5, 61352 Bad Homburg',
    contractStart: '2024-01-01',
    contractEnd: '2027-12-31',
    slaLevel: 'Gold (24/7 Intervention)',
    billingStatus: 'Aktiv',
    assignedSitesCount: 1,
    monthlyRevenue: 48900,
    syncState: 'synced',
    version: 1
  }
];

export const INITIAL_SITES: SecuritySite[] = [
  {
    id: 'site-1',
    tenantId: 'tenant-1',
    clientId: 'cli-1',
    clientName: 'Bayerische Motoren Logistik GmbH',
    siteCode: 'OBJ-MUC-01',
    name: 'Logistikzentrum Nord & Hochregallager',
    address: 'Industriepark Nord 14, 80939 München',
    siteLeader: 'Markus Hauer (Einsatzleiter)',
    riskLevel: 'Mittel',
    alarmSystem: 'Telenot Complex 400H / BMA Esser IQ8',
    checkpointsCount: 32,
    activeGuardsRequired: 3,
    specialInstructions: 'LKW-Einfahrtskontrolle mit Kennzeichenabgleich. § 34a Sachkundeprüfung zwingend erforderlich.',
    keysCount: 48,
    status: 'In Betrieb',
    syncState: 'synced',
    version: 1
  },
  {
    id: 'site-2',
    tenantId: 'tenant-1',
    clientId: 'cli-2',
    clientName: 'FinTech Tower Frankfurt Holding',
    siteCode: 'OBJ-FRA-01',
    name: 'FinTech Tower Empfang & Rechenzentrum',
    address: 'Mainzer Landstraße 180, 60327 Frankfurt am Main',
    siteLeader: 'Stefan Becker (Objektleiter)',
    riskLevel: 'Kritische Infrastruktur (KRITIS)',
    alarmSystem: 'Siemens Sinteso BMA & Honeywell Accenta',
    checkpointsCount: 44,
    activeGuardsRequired: 4,
    specialInstructions: 'Biometrische Schleusenprüfung für RZ-Bereich Ebene -2. Begleitpflicht für externe Dienstleister.',
    keysCount: 65,
    status: 'In Betrieb',
    syncState: 'synced',
    version: 1
  },
  {
    id: 'site-3',
    tenantId: 'tenant-2',
    clientId: 'cli-3',
    clientName: 'Commerz Logistics Hub Taunus',
    siteCode: 'OBJ-VG-01',
    name: 'Hochsicherheitsdepot Taunus',
    address: 'Gewerbestraße 5, 61352 Bad Homburg',
    siteLeader: 'Ralf Westermann',
    riskLevel: 'Kritische Infrastruktur (KRITIS)',
    alarmSystem: 'VdS Klasse C / Körperschall / Schleusenkontrolle',
    checkpointsCount: 60,
    activeGuardsRequired: 6,
    specialInstructions: 'Waffenträger zwingend. Doppelte Personenverifikation vor Toröffnung.',
    keysCount: 52,
    status: 'In Betrieb',
    syncState: 'synced',
    version: 1
  }
];

export const INITIAL_EMPLOYEES: Employee[] = [
  {
    id: 'emp-1',
    tenantId: 'tenant-1',
    personnelNumber: 'SEC-1042',
    firstName: 'Timo',
    lastName: 'Kranz',
    role: 'Schichtleiter / Sicherheitsfachkraft',
    email: 't.kranz@argus-security.de',
    phone: '+49 171 4458921',
    status: 'Aktiv',
    employmentType: 'Vollzeit',
    targetHours: 173,
    actualHoursMonth: 168,
    overtimeBalance: 14.5,
    assignedSiteId: 'site-1',
    assignedSiteName: 'Logistikzentrum Nord & Hochregallager',
    syncState: 'synced',
    version: 1,
    qualifications: [
      { id: 'q-1', name: 'Sachkundeprüfung gem. § 34a GewO (IHK)', type: '34a_Sachkunde', issuer: 'IHK München', issuedDate: '2019-04-12', expiryDate: '2029-04-12', isValid: true },
      { id: 'q-2', name: 'Brandschutz- und Evakuierungshelfer (DGUV)', type: 'Brandschutz', issuer: 'TÜV Süd', issuedDate: '2023-01-15', expiryDate: '2026-01-15', isValid: true },
      { id: 'q-3', name: 'Betrieblicher Ersthelfer', type: 'Erste_Hilfe', issuer: 'DRK München', issuedDate: '2023-08-20', expiryDate: '2025-08-20', isValid: true }
    ]
  },
  {
    id: 'emp-2',
    tenantId: 'tenant-1',
    personnelNumber: 'SEC-1088',
    firstName: 'Alexander',
    lastName: 'Novak',
    role: 'Sicherheitsmitarbeiter Werkschutz',
    email: 'a.novak@argus-security.de',
    phone: '+49 172 8821940',
    status: 'Aktiv',
    employmentType: 'Vollzeit',
    targetHours: 173,
    actualHoursMonth: 176,
    overtimeBalance: 22.0,
    assignedSiteId: 'site-2',
    assignedSiteName: 'FinTech Tower Empfang & Rechenzentrum',
    syncState: 'synced',
    version: 1,
    qualifications: [
      { id: 'q-4', name: 'Sachkundeprüfung gem. § 34a GewO (IHK)', type: '34a_Sachkunde', issuer: 'IHK Frankfurt', issuedDate: '2021-03-10', expiryDate: '2031-03-10', isValid: true },
      { id: 'q-5', name: 'Interventionskraft nach VdS 2172', type: 'Interventionskraft', issuer: 'VdS Köln', issuedDate: '2022-05-18', expiryDate: '2025-05-18', isValid: true },
      { id: 'q-6', name: 'Betrieblicher Ersthelfer (Ablaufend!)', type: 'Erste_Hilfe', issuer: 'Malteser', issuedDate: '2022-04-01', expiryDate: '2024-04-01', isValid: false }
    ]
  },
  {
    id: 'emp-3',
    tenantId: 'tenant-1',
    personnelNumber: 'SEC-1120',
    firstName: 'Fatima',
    lastName: 'Al-Mansoor',
    role: 'Pforten- und Empfangsdienst',
    email: 'f.almansoor@argus-security.de',
    phone: '+49 173 9931204',
    status: 'Aktiv',
    employmentType: 'Teilzeit',
    targetHours: 120,
    actualHoursMonth: 118,
    overtimeBalance: 4.0,
    assignedSiteId: 'site-2',
    assignedSiteName: 'FinTech Tower Empfang & Rechenzentrum',
    syncState: 'synced',
    version: 1,
    qualifications: [
      { id: 'q-7', name: 'Unterrichtungsnachweis § 34a GewO (IHK)', type: '34a_Unterrichtung', issuer: 'IHK Frankfurt', issuedDate: '2020-09-01', expiryDate: '2030-09-01', isValid: true },
      { id: 'q-8', name: 'Betrieblicher Ersthelfer', type: 'Erste_Hilfe', issuer: 'Johanniter', issuedDate: '2023-11-10', expiryDate: '2025-11-10', isValid: true }
    ]
  },
  {
    id: 'emp-4',
    tenantId: 'tenant-2',
    personnelNumber: 'VG-2001',
    firstName: 'Bastian',
    lastName: 'Reichert',
    role: 'Bewaffnete Interventionskraft (§ 7 WaffG)',
    email: 'reichert@vanguard-security.com',
    phone: '+49 170 882194',
    status: 'Aktiv',
    employmentType: 'Vollzeit',
    targetHours: 173,
    actualHoursMonth: 170,
    overtimeBalance: 6.0,
    assignedSiteId: 'site-3',
    assignedSiteName: 'Hochsicherheitsdepot Taunus',
    syncState: 'synced',
    version: 1,
    qualifications: [
      { id: 'q-9', name: 'Sachkundeprüfung gem. § 34a GewO (IHK)', type: '34a_Sachkunde', issuer: 'IHK Frankfurt', issuedDate: '2018-02-10', expiryDate: '2028-02-10', isValid: true },
      { id: 'q-10', name: 'Waffensachkunde gem. § 7 WaffG', type: 'Waffenschein', issuer: 'Polizeipräsidium Frankfurt', issuedDate: '2021-04-12', expiryDate: '2026-04-12', isValid: true }
    ]
  }
];

export const INITIAL_SHIFTS: Shift[] = [
  {
    id: 'sh-101',
    tenantId: 'tenant-1',
    date: '2025-05-12',
    shiftType: 'Frühschicht (06:00 - 14:00)',
    siteId: 'site-1',
    siteName: 'Logistikzentrum Nord & Hochregallager',
    employeeId: 'emp-1',
    employeeName: 'Timo Kranz',
    status: 'Besetzt',
    requiredQualification: 'Sachkundeprüfung § 34a',
    hours: 8,
    syncState: 'synced',
    version: 1
  },
  {
    id: 'sh-102',
    tenantId: 'tenant-1',
    date: '2025-05-12',
    shiftType: 'Frühschicht (06:00 - 14:00)',
    siteId: 'site-2',
    siteName: 'FinTech Tower Empfang & Rechenzentrum',
    employeeId: 'emp-2',
    employeeName: 'Alexander Novak',
    status: 'Konflikt',
    hasConflict: true,
    conflictReason: 'Ersthelfer-Qualifikation seit 4 Wochen abgelaufen. Nachschulung erforderlich!',
    requiredQualification: 'Sachkundeprüfung § 34a + Ersthelfer',
    hours: 8,
    syncState: 'synced',
    version: 1
  }
];

export const INITIAL_INCIDENTS: Incident[] = [
  {
    id: 'inc-901',
    tenantId: 'tenant-1',
    incidentNumber: 'VB-2025-0511-01',
    timestamp: '2025-05-11 23:42',
    siteId: 'site-1',
    siteName: 'Logistikzentrum Nord & Hochregallager',
    guardName: 'Timo Kranz',
    category: 'Einbruchversuch',
    priority: 'KRITISCH',
    title: 'Perimeterschutz Zaunüberstieg Zaunfeld 14 Ostseite',
    description: 'Um 23:42 Uhr löste der Körperschallmelder Zaunabschnitt Ost aus. Bei sofortiger Überprüfung mit Diensthundeführer wurden zwei dunkel gekleidete Personen festgestellt, die das Gelände fluchtartig Richtung Autobahn verließen. Drahtzaun wurde auf einer Breite von 40cm aufgeschnitten.',
    actionsTaken: 'Polizeiinspektion München-Nord alarmiert (Einsatz-Nr. POL-88219). Zaun provisorisch gesichert. Werksleiter telefonisch verständigt.',
    policeInvolved: true,
    resolved: false,
    imagesCount: 3,
    escalationStatus: 'Eskaliert',
    syncState: 'synced',
    version: 1,
    auditHash: 'sha256-a982f1b80c12e431d27f8841a0bc8e11'
  },
  {
    id: 'inc-902',
    tenantId: 'tenant-1',
    incidentNumber: 'VB-2025-0510-04',
    timestamp: '2025-05-10 14:15',
    siteId: 'site-2',
    siteName: 'FinTech Tower Empfang & Rechenzentrum',
    guardName: 'Fatima Al-Mansoor',
    category: 'Zutrittsverstoß',
    priority: 'Mittel',
    title: 'Unbefugter Annäherungsversuch an RZ-Schleuse Ebene -2',
    description: 'Techniker einer externen Klimafirma versuchte ohne hinterlegten RZ-Sicherheitsausweis und ohne Begleitschein die biometrische Schleuse zu passieren. Der Zutritt wurde verwehrt.',
    actionsTaken: 'Person identifiziert, Personalien notiert, Ansprechpartnerin Fr. Albrecht kontaktiert. Ausweisausgabe nach Genehmigung erfolgt.',
    policeInvolved: false,
    resolved: true,
    imagesCount: 1,
    escalationStatus: 'Abgeschlossen',
    syncState: 'synced',
    version: 1,
    auditHash: 'sha256-f442b09c12e88a0021c33d87bb01e8aa'
  }
];

export const INITIAL_SOPS: SopInstruction[] = [
  {
    id: 'sop-1',
    tenantId: 'tenant-1',
    code: 'DA-KRITIS-01',
    title: 'Dienstanweisung: Alarmverifikation und Einbruchmeldeanlagen',
    category: 'Objektspezifisch',
    version: '2.4',
    applicableSite: 'Logistikzentrum Nord & FinTech Tower',
    updatedAt: '2025-01-10',
    author: 'Markus Hauer (Einsatzleitung)',
    content: 'Bei Alarmauslösung der Einbruchmeldeanlage ist unverzüglich die Leitstelle zu verständigen. Alle Zugänge sind auf Einbruchspuren zu prüfen. Niemals ein Gebäude allein bei begründetem Verdacht betreten. Eigensicherung steht an oberster Stelle.',
    requiresDigitalSignature: true,
    acknowledgedCount: 18,
    totalRequiredGuards: 22,
    syncState: 'synced'
  }
];

export const INITIAL_KEYS: KeyItem[] = [
  {
    id: 'k-1',
    tenantId: 'tenant-1',
    keyNumber: 'BND-MUC-101',
    siteName: 'Logistikzentrum Nord & Hochregallager',
    bundleLabel: 'Generalschlüssel GHS 01 (Außenhaut & Pforte)',
    status: 'Ausgegeben',
    currentHolder: 'Timo Kranz',
    issuedAt: '2025-05-12 05:50',
    expectedReturn: '2025-05-12 14:15',
    doorAccess: ['Tor 1-4', 'Pforte', 'Technikzentrale', 'Mülllager'],
    syncState: 'synced'
  }
];

export const INITIAL_TASKS: OperationalTask[] = [
  {
    id: 'tsk-1',
    tenantId: 'tenant-1',
    title: 'Audit: Prüfung der Erste-Hilfe-Ausrüstung und Defibrillatoren',
    siteName: 'Logistikzentrum Nord & Hochregallager',
    assignedTo: 'Timo Kranz',
    dueDate: '2025-05-16',
    priority: 'Dringend',
    status: 'Offen',
    category: 'Audit',
    syncState: 'synced',
    version: 1
  }
];

export const INITIAL_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'notif-1',
    tenantId: 'tenant-1',
    type: 'alert',
    title: 'Kritischer Vorfall erfasst',
    message: 'Einbruchversuch Logistikzentrum Nord gemeldet. Polizei vor Ort.',
    timestamp: 'Vor 2 Stunden',
    read: false
  },
  {
    id: 'notif-2',
    tenantId: 'tenant-1',
    type: 'warning',
    title: 'Dienstplankonflikt',
    message: 'Schicht FinTech Tower: Mitarbeiter Novak hat abgelaufene Ersthelfer-Urkunde.',
    timestamp: 'Vor 4 Stunden',
    read: false
  }
];

export const INITIAL_SYNC_QUEUE: SyncQueueItem[] = [
  {
    id: 'sq-1',
    tenantId: 'tenant-1',
    entityType: 'incident',
    entityId: 'inc-901',
    action: 'CREATE',
    payloadSummary: 'Wachbucheintrag Zaunüberstieg Zaunfeld 14 Ostseite',
    createdAt: '2025-05-11 23:42:10',
    retryCount: 0,
    status: 'synced'
  }
];

export const SYSTEM_MODULES: ModuleManifest[] = [
  {
    id: 'mod-core',
    code: 'CORE-TENANT',
    title: 'Mandanten- & Benutzerverwaltung (RBAC/RLS)',
    version: '2.1.0',
    category: 'Core',
    description: 'PostgreSQL Row-Level-Security, JWT Tenant-Claims, Mandantenisolierung nach DSGVO Art. 32.',
    author: 'SecurityOps Enterprise Systems',
    dependencies: [],
    permissionsRequired: ['tenant:read', 'tenant:admin'],
    apiEndpointPrefix: '/api/v1/tenants',
    isCore: true,
    status: 'Aktiv'
  },
  {
    id: 'mod-wachbuch',
    code: 'OPS-WACHBUCH',
    title: 'Revisionssicheres Digitales Wachbuch & Vorfallmanagement',
    version: '2.3.1',
    category: 'Operations',
    description: 'Lückenlose Dokumentation mit SHA-256 Krypto-Prüfsummen, Offline-Zwischenspeicher & DIN 77200 Zertifikat.',
    author: 'SecurityOps Operations Division',
    dependencies: ['mod-core'],
    permissionsRequired: ['incidents:read', 'incidents:write'],
    apiEndpointPrefix: '/api/v1/wachbuch',
    isCore: true,
    status: 'Aktiv'
  },
  {
    id: 'mod-schedule',
    code: 'HR-DISPO',
    title: 'Intelligente Dienst- & Schichtplanung (§ 34a Radar)',
    version: '2.2.0',
    category: 'Operations',
    description: 'Echtzeit-Konflikterkennung, Qualifikationsprüfungen, Urlaubs- & Krankheitsvertretungen.',
    author: 'SecurityOps HR Tech',
    dependencies: ['mod-core'],
    permissionsRequired: ['shifts:read', 'shifts:dispatch'],
    apiEndpointPrefix: '/api/v1/schedule',
    isCore: true,
    status: 'Aktiv'
  },
  {
    id: 'mod-offline',
    code: 'SYS-OFFLINE-SYNC',
    title: 'Offline First Engine & Krypto-Warteschlange',
    version: '2.0.4',
    category: 'Core',
    description: 'IndexedDB Replikation, Vektor-Clock Konfliktlösung, Resilienz bei Netzausfällen in Tiefgaragen/Bunkern.',
    author: 'SecurityOps Resilient Core',
    dependencies: ['mod-core'],
    permissionsRequired: ['system:sync'],
    apiEndpointPrefix: '/api/v1/sync',
    isCore: true,
    status: 'Aktiv'
  },
  {
    id: 'mod-ai-patrol',
    code: 'AI-ANALYSIS',
    title: 'Gemini KI-Lagezentrum & Norm-Audit Copilot',
    version: '2.5.0',
    category: 'AI & IoT',
    description: 'Automatisierte Gefährdungsbeurteilung, VdS/DIN 77200 Konformitätsprüfung und SOP-Formulierung.',
    author: 'Vertex AI Security Studio',
    dependencies: ['mod-core', 'mod-wachbuch'],
    permissionsRequired: ['ai:analyze'],
    apiEndpointPrefix: '/api/v1/ai',
    isCore: false,
    status: 'Aktiv'
  },
  {
    id: 'mod-kritis',
    code: 'KRITIS-SHIELD',
    title: 'KRITIS-Objektschutz & Perimeter-Überwachung',
    version: '1.4.0',
    category: 'Surveillance',
    description: 'BSI KritisV Konformität, Zaunüberstiegsmelder-Integration, biometrische Schleusenprotokolle.',
    author: 'Critical Infrastructure SecLab',
    dependencies: ['mod-core', 'mod-wachbuch'],
    permissionsRequired: ['sites:kritis_admin'],
    apiEndpointPrefix: '/api/v1/kritis',
    isCore: false,
    status: 'Aktiv'
  }
];
