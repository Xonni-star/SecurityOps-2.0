import {
  Tenant,
  Client,
  Site,
  Employee,
  Shift,
  GuardBookEntry,
  SOPDocument,
  EmergencyPlan,
  KeyItem,
  TaskItem,
  AutomationRule,
  AutomationExecutionLog,
  NotificationDelivery,
  NotificationPreference,
  UserRole,
  QualificationType,
  SecurityModuleManifest,
  SecurityAuditEntry,
  UserSessionDevice,
  GdprRetentionPolicy
} from './types';

export const initialTenants: Tenant[] = [
  {
    id: 'tenant-frankfurt',
    name: 'Securitas & Wache Frankfurt GmbH',
    subdomain: 'ffm-sec.securityops.de',
    taxNumber: 'DE301928374',
    licenseTier: 'Enterprise (Unbegrenzt)',
    din77200Certified: true,
    bwrRegisterId: 'BWR-HE-99201',
    active: true,
    contactEmail: 'zentrale@ffm-sec.securityops.de'
  },
  {
    id: 'tenant-bavaria',
    name: 'Bavaria Schutz & Werkschutz AG',
    subdomain: 'bavaria.securityops.de',
    taxNumber: 'DE819203948',
    licenseTier: 'Professional (Bis 50 MA)',
    din77200Certified: true,
    bwrRegisterId: 'BWR-BY-11029',
    active: true,
    contactEmail: 'leitstelle@bavaria-schutz.de'
  }
];

export const initialModules: SecurityModuleManifest[] = [
  {
    id: 'mod-core-dashboard',
    name: 'Zentrales Einsatz-Dashboard',
    description: 'Echtzeit-Kennzahlen, Schichtstatus, Vorkommnisse und DIN 77200 Erfüllung.',
    version: '2.0.0',
    category: 'CORE',
    enabled: true,
    requiredPermissions: [UserRole.ADMIN, UserRole.GF, UserRole.EINSATZLEITUNG, UserRole.OBJEKTLEITUNG, UserRole.AUDITOR],
    dependencies: [],
    isCore: true
  },
  {
    id: 'mod-guardbook',
    name: 'Digitales Wachbuch & Vorfälle',
    description: 'Revisionssichere Protokollierung von Rundgängen, Vorkommnissen und Schichtwechseln.',
    version: '2.0.0',
    category: 'OPERATIONS',
    enabled: true,
    requiredPermissions: [UserRole.ADMIN, UserRole.EINSATZLEITUNG, UserRole.OBJEKTLEITUNG, UserRole.GUARD],
    dependencies: ['mod-core-dashboard'],
    isCore: true
  },
  {
    id: 'mod-roster',
    name: 'Dienstplanung & Schichtbesetzung',
    description: 'Soll/Ist-Stunden, ArbZG-Konfliktprüfung, Qualifikationsfilter nach § 34a GewO.',
    version: '2.0.0',
    category: 'OPERATIONS',
    enabled: true,
    requiredPermissions: [UserRole.ADMIN, UserRole.GF, UserRole.EINSATZLEITUNG, UserRole.OBJEKTLEITUNG, UserRole.HR],
    dependencies: ['mod-core-dashboard'],
    isCore: true
  },
  {
    id: 'mod-keys',
    name: 'Schlüssel- & Transponderdepot',
    description: 'Ausgabe- und Rücknahmeprotokolle für Generalschlüssel und RFID-Zutrittsmedien.',
    version: '1.4.0',
    category: 'HARDWARE',
    enabled: true,
    requiredPermissions: [UserRole.ADMIN, UserRole.EINSATZLEITUNG, UserRole.OBJEKTLEITUNG, UserRole.GUARD],
    dependencies: ['mod-core-dashboard'],
    isCore: false
  },
  {
    id: 'mod-sop',
    name: 'Dienstanweisungen & QM-Bestätigungen',
    description: 'Digitale Lesebestätigung von Arbeitsanweisungen mit Versionskontrolle.',
    version: '1.2.1',
    category: 'COMPLIANCE',
    enabled: true,
    requiredPermissions: [UserRole.ADMIN, UserRole.QM, UserRole.OBJEKTLEITUNG, UserRole.GUARD],
    dependencies: ['mod-core-dashboard'],
    isCore: false
  },
  {
    id: 'mod-emergency',
    name: 'Notfall- & Alarmierungspläne',
    description: 'Maßnahmenkataloge für BMA, EMA, Bombendrohung und Evakuierungen.',
    version: '2.1.0',
    category: 'OPERATIONS',
    enabled: true,
    requiredPermissions: [UserRole.ADMIN, UserRole.EINSATZLEITUNG, UserRole.OBJEKTLEITUNG, UserRole.GUARD],
    dependencies: ['mod-core-dashboard'],
    isCore: false
  },
  {
    id: 'mod-handovers',
    name: 'Übergabemanagement',
    description: 'Objektbezogene Übergabeprotokolle, getrennte Bestätigungen, fortgeführte Aufgaben und Offline-Synchronisierung.',
    version: '1.0.0',
    category: 'OPERATIONS',
    enabled: true,
    requiredPermissions: [UserRole.ADMIN, UserRole.GF, UserRole.EINSATZLEITUNG, UserRole.OBJEKTLEITUNG, UserRole.GUARD, UserRole.AUDITOR],
    dependencies: ['mod-core-dashboard'],
    isCore: true
  },
  {
    id: 'mod-documents',
    name: 'Zentrales Dokumentenmanagement',
    description: 'Polymorphe Dokumentenablage für Kunden, Objekte, Mitarbeiter und Vorfälle.',
    version: '2.0.0',
    category: 'COMPLIANCE',
    enabled: true,
    requiredPermissions: [UserRole.ADMIN, UserRole.GF, UserRole.EINSATZLEITUNG, UserRole.OBJEKTLEITUNG, UserRole.HR, UserRole.QM],
    dependencies: ['mod-core-dashboard'],
    isCore: false
  },
  {
    id: 'mod-automations',
    name: 'Automatisierungsengine & Watchdog',
    description: 'Deklarative Trigger, Bedingungen, Aktionen und Benachrichtigungssteuerung.',
    version: '2.2.0',
    category: 'CORE',
    enabled: true,
    requiredPermissions: [UserRole.ADMIN, UserRole.GF, UserRole.EINSATZLEITUNG],
    dependencies: ['mod-core-dashboard'],
    isCore: true
  },
  {
    id: 'mod-security-audit',
    name: 'Sicherheits-Audit & RBAC-Center',
    description: 'BSI & DSGVO Kontrollzentrum: Sessions, RLS-Integrität, Audit-Log und Rechteprüfung.',
    version: '2.1.0',
    category: 'CORE',
    enabled: true,
    requiredPermissions: [UserRole.ADMIN, UserRole.GF],
    dependencies: ['mod-core-dashboard'],
    isCore: true
  }
];

export const initialClients: Client[] = [
  {
    id: 'c-1',
    tenantId: 'tenant-frankfurt',
    clientNumber: 'KUN-2024-001',
    companyName: 'MainTower Real Estate GmbH & Co. KG',
    contactPerson: 'Dr. Michael von Berg',
    email: 'm.vonberg@maintower-re.de',
    phone: '+49 69 9820-110',
    address: 'Neue Mainzer Straße 52, 60311 Frankfurt am Main',
    addresses: [
      { id: 'ca-1', type: 'Hauptsitz', street: 'Neue Mainzer Str. 52', city: 'Frankfurt', postalCode: '60311', country: 'Deutschland' },
      { id: 'ca-2', type: 'Rechnungsadresse', street: 'Bockenheimer Landstr. 10', city: 'Frankfurt', postalCode: '60323', country: 'Deutschland' }
    ],
    contractStart: '2022-01-01',
    contractEnd: '2026-12-31',
    contractAutoRenew: true,
    noticePeriodMonths: 3,
    slaLevel: 'Gold (24/7 Vor-Ort)',
    billingStatus: 'Regulär',
    assignedSiteCount: 2
  },
  {
    id: 'c-2',
    tenantId: 'tenant-frankfurt',
    clientNumber: 'KUN-2024-002',
    companyName: 'Technologiepark Adlershof Logistikzentrum',
    contactPerson: 'Susanne Weber',
    email: 'weber.facility@adlershof-tech.de',
    phone: '+49 30 6392-4400',
    address: 'Rudower Chaussee 29, 12489 Berlin',
    contractStart: '2023-04-01',
    contractEnd: '2025-06-30',
    contractAutoRenew: false,
    noticePeriodMonths: 1,
    slaLevel: 'Gold (24/7 Vor-Ort)',
    billingStatus: 'Regulär',
    assignedSiteCount: 1
  },
  {
    id: 'c-3',
    tenantId: 'tenant-bavaria',
    clientNumber: 'KUN-BAV-101',
    companyName: 'BioPharm Innovations AG (KRITIS)',
    contactPerson: 'Christian Lindner-Sachs',
    email: 'security-director@biopharm.eu',
    phone: '+49 89 4522-890',
    address: 'Am Klopferspitz 19, 82152 Planegg / München',
    contractStart: '2021-08-01',
    contractEnd: '2027-07-31',
    contractAutoRenew: true,
    noticePeriodMonths: 6,
    slaLevel: 'Gold (24/7 Vor-Ort)',
    billingStatus: 'Regulär',
    assignedSiteCount: 1
  }
];

export const initialSites: Site[] = [
  {
    id: 's-1',
    tenantId: 'tenant-frankfurt',
    clientId: 'c-1',
    clientName: 'MainTower Real Estate GmbH & Co. KG',
    siteCode: 'OBJ-FRA-01',
    name: 'Finanzturm Alpha (Hauptverwaltung)',
    address: 'Neue Mainzer Straße 52, 60311 Frankfurt',
    securityLevel: 'Hoch (KRITIS / BSI)',
    siteManagerId: 'e-2',
    siteManagerName: 'Tarkan Kaya',
    requiredGuardsDay: 4,
    requiredGuardsNight: 2,
    alarmSystem: 'Siemens Sinteso FC2040 + Telenot EMA',
    instructionsCount: 4,
    accessRules: 'Ausweispflicht, Schleusenvereinzelung, Taschenkontrolle bei Fremdfirmen',
    activeAlarms: 0,
    checkpoints: [
      { id: 'cp-1', code: 'CP-01', name: 'Hauptfoyer Schrankenanlage', locationDetails: 'EG Foyer Eingang Nord', rfidTag: 'RFID-9901-A', requiredIntervalMinutes: 60 },
      { id: 'cp-2', code: 'CP-02', name: 'Rechenzentrum Ebene -2', locationDetails: 'UG2 Sicherheitstür B24', rfidTag: 'RFID-9902-B', requiredIntervalMinutes: 30 },
      { id: 'cp-3', code: 'CP-03', name: 'Tiefgarage Zufahrt & Schranke', locationDetails: 'UG1 Rolltor West', rfidTag: 'RFID-9903-C', requiredIntervalMinutes: 90 },
      { id: 'cp-4', code: 'CP-04', name: 'Dachterrasse Fluchttreppenhaus', locationDetails: 'Etage 48 Notausgang', rfidTag: 'RFID-9904-D', requiredIntervalMinutes: 120 }
    ]
  },
  {
    id: 's-2',
    tenantId: 'tenant-frankfurt',
    clientId: 'c-2',
    clientName: 'Technologiepark Adlershof Logistikzentrum',
    siteCode: 'OBJ-BER-02',
    name: 'Logistik-Hub & Warenverteilzentrum Ost',
    address: 'Rudower Chaussee 29, 12489 Berlin',
    securityLevel: 'Mittel',
    siteManagerId: 'e-1',
    siteManagerName: 'Alexander Schmidt',
    requiredGuardsDay: 2,
    requiredGuardsNight: 2,
    alarmSystem: 'Bosch Modular FPA-5000',
    instructionsCount: 2,
    accessRules: 'LKW-Waage Erfassung, Frachtpapiere-Prüfung, Besucherausweise mit Pfand',
    activeAlarms: 1,
    checkpoints: [
      { id: 'cp-5', code: 'CP-LOG-1', name: 'Pforte 1 Toranlage', locationDetails: 'Zufahrt LKW', rfidTag: 'RFID-8801-A', requiredIntervalMinutes: 45 },
      { id: 'cp-6', code: 'CP-LOG-2', name: 'Hochregallager Gefahrgutsektor', locationDetails: 'Halle 4 Brandwand Süd', rfidTag: 'RFID-8802-B', requiredIntervalMinutes: 60 }
    ]
  },
  {
    id: 's-3',
    tenantId: 'tenant-bavaria',
    clientId: 'c-3',
    clientName: 'BioPharm Innovations AG (KRITIS)',
    siteCode: 'OBJ-MUC-03',
    name: 'Forschungscampus & Labor BSL-3',
    address: 'Am Klopferspitz 19, 82152 Planegg',
    securityLevel: 'Höchste Sicherheitsstufe',
    siteManagerId: 'e-6',
    siteManagerName: 'Maximilian Huber',
    requiredGuardsDay: 3,
    requiredGuardsNight: 3,
    alarmSystem: 'Honeywell MB-Secure 6000 & Biometrie-Zutritt',
    instructionsCount: 6,
    accessRules: 'Sicherheitsüberprüfung Ü2 nach SÜG, Biometrischer Iris-Scan, Begleitpflicht Besucher',
    activeAlarms: 0,
    checkpoints: [
      { id: 'cp-7', code: 'CP-LAB-1', name: 'Schleuse BSL-3 Labor', locationDetails: 'Haus C Reinraum 1', rfidTag: 'RFID-7701-X', requiredIntervalMinutes: 30 },
      { id: 'cp-8', code: 'CP-LAB-2', name: 'Chemikalienbunker & Notstrom', locationDetails: 'Außenbereich Südwest', rfidTag: 'RFID-7702-Y', requiredIntervalMinutes: 60 }
    ]
  }
];

export const initialEmployees: Employee[] = [
  {
    id: 'e-1',
    tenantId: 'tenant-frankfurt',
    personnelNumber: 'MA-0104',
    firstName: 'Alexander',
    lastName: 'Schmidt',
    email: 'a.schmidt@ffm-sec.de',
    phone: '+49 171 4455881',
    role: UserRole.EINSATZLEITUNG,
    status: 'Aktiv',
    weeklyHours: 40,
    hourlyRate: 26.50,
    dateOfJoining: '2020-03-01',
    assignedSiteIds: ['s-1', 's-2'],
    qualifications: [
      { id: 'q-1', type: QualificationType.GEWO_34A_SACHKUNDE, issueDate: '2018-05-10', expiryDate: '2028-05-10', certificateNumber: 'IHK-FFM-8911', verified: true },
      { id: 'q-2', type: QualificationType.FIRE_SAFETY, issueDate: '2023-02-15', expiryDate: '2026-02-15', certificateNumber: 'TUV-BSH-401', verified: true },
      { id: 'q-3', type: QualificationType.FIRST_AID, issueDate: '2023-09-10', expiryDate: '2025-09-10', certificateNumber: 'DRK-FA-9921', verified: true }
    ]
  },
  {
    id: 'e-2',
    tenantId: 'tenant-frankfurt',
    personnelNumber: 'MA-0108',
    firstName: 'Tarkan',
    lastName: 'Kaya',
    email: 't.kaya@ffm-sec.de',
    phone: '+49 172 9012344',
    role: UserRole.OBJEKTLEITUNG,
    status: 'Aktiv',
    weeklyHours: 40,
    hourlyRate: 24.00,
    dateOfJoining: '2021-06-15',
    assignedSiteIds: ['s-1'],
    qualifications: [
      { id: 'q-4', type: QualificationType.GEWO_34A_SACHKUNDE, issueDate: '2019-11-20', expiryDate: '2029-11-20', certificateNumber: 'IHK-MUC-4412', verified: true },
      { id: 'q-5', type: QualificationType.DEESCALATION, issueDate: '2024-01-12', expiryDate: '2026-01-12', certificateNumber: 'DEESC-2024-88', verified: true },
      { id: 'q-6', type: QualificationType.FIRST_AID, issueDate: '2022-04-10', expiryDate: '2024-04-10', certificateNumber: 'ASB-EH-102', verified: true }
    ]
  },
  {
    id: 'e-3',
    tenantId: 'tenant-frankfurt',
    personnelNumber: 'MA-0215',
    firstName: 'Sabine',
    lastName: 'Becker',
    email: 's.becker@ffm-sec.de',
    phone: '+49 176 8812773',
    role: UserRole.GUARD,
    status: 'Aktiv',
    weeklyHours: 38,
    hourlyRate: 17.50,
    dateOfJoining: '2022-10-01',
    assignedSiteIds: ['s-1'],
    qualifications: [
      { id: 'q-7', type: QualificationType.GEWO_34A_SACHKUNDE, issueDate: '2022-02-14', expiryDate: '2032-02-14', certificateNumber: 'IHK-BER-1022', verified: true },
      { id: 'q-8', type: QualificationType.FIRST_AID, issueDate: '2023-11-01', expiryDate: '2025-11-01', certificateNumber: 'MHD-EH-481', verified: true }
    ]
  },
  {
    id: 'e-4',
    tenantId: 'tenant-frankfurt',
    personnelNumber: 'MA-0220',
    firstName: 'Dennis',
    lastName: 'Kowalski',
    email: 'd.kowalski@ffm-sec.de',
    phone: '+49 151 7722119',
    role: UserRole.GUARD,
    status: 'Urlaub',
    weeklyHours: 35,
    hourlyRate: 16.80,
    dateOfJoining: '2023-01-15',
    assignedSiteIds: ['s-2'],
    absences: [
      { id: 'abs-1', type: 'Urlaub', startDate: '2025-05-12', endDate: '2025-05-18', approved: true }
    ],
    qualifications: [
      { id: 'q-9', type: QualificationType.GEWO_34A_UNTERRICHTUNG, issueDate: '2021-04-01', expiryDate: '2031-04-01', certificateNumber: 'IHK-FFM-UN-77', verified: true },
      { id: 'q-10', type: QualificationType.FIRE_SAFETY, issueDate: '2024-02-10', expiryDate: '2027-02-10', certificateNumber: 'BSS-8812', verified: true }
    ]
  },
  {
    id: 'e-5',
    tenantId: 'tenant-frankfurt',
    personnelNumber: 'MA-0231',
    firstName: 'Marek',
    lastName: 'Jankowski',
    email: 'm.jankowski@ffm-sec.de',
    phone: '+49 170 3399110',
    role: UserRole.GUARD,
    status: 'Krank',
    weeklyHours: 40,
    hourlyRate: 17.00,
    dateOfJoining: '2023-07-01',
    assignedSiteIds: ['s-1'],
    absences: [
      { id: 'abs-2', type: 'Krankheit', startDate: '2025-05-14', endDate: '2025-05-20', approved: true }
    ],
    qualifications: [
      { id: 'q-11', type: QualificationType.GEWO_34A_SACHKUNDE, issueDate: '2023-03-20', expiryDate: '2033-03-20', certificateNumber: 'IHK-KOLN-551', verified: true },
      { id: 'q-12', type: QualificationType.FIRST_AID, issueDate: '2022-02-01', expiryDate: '2024-02-01', certificateNumber: 'DRK-EXP-11', verified: false }
    ]
  }
];

export const initialShifts: Shift[] = [
  {
    id: 'sh-1',
    tenantId: 'tenant-frankfurt',
    siteId: 's-1',
    siteName: 'Finanzturm Alpha (Hauptverwaltung)',
    employeeId: 'e-3',
    employeeName: 'Sabine Becker',
    date: new Date().toISOString().split('T')[0],
    startTime: '06:00',
    endTime: '18:00',
    type: 'Tagdienst',
    status: 'Besetzt',
    requiredQualification: QualificationType.GEWO_34A_SACHKUNDE,
    actualStart: '05:52'
  },
  {
    id: 'sh-2',
    tenantId: 'tenant-frankfurt',
    siteId: 's-1',
    siteName: 'Finanzturm Alpha (Hauptverwaltung)',
    employeeId: 'e-2',
    employeeName: 'Tarkan Kaya',
    date: new Date().toISOString().split('T')[0],
    startTime: '18:00',
    endTime: '06:00',
    type: 'Nachtdienst',
    status: 'Besetzt',
    requiredQualification: QualificationType.GEWO_34A_SACHKUNDE
  },
  {
    id: 'sh-3',
    tenantId: 'tenant-frankfurt',
    siteId: 's-2',
    siteName: 'Logistik-Hub & Warenverteilzentrum Ost',
    employeeId: undefined,
    employeeName: undefined,
    date: new Date().toISOString().split('T')[0],
    startTime: '18:00',
    endTime: '06:00',
    type: 'Nachtdienst',
    status: 'Offen',
    requiredQualification: QualificationType.GEWO_34A_UNTERRICHTUNG,
    conflictReason: 'Marek Jankowski krankgemeldet – Ersatzkraft erforderlich!'
  }
];

export const initialGuardBookEntries: GuardBookEntry[] = [
  {
    id: 'gb-1',
    tenantId: 'tenant-frankfurt',
    timestamp: '2025-05-14T06:00:00Z',
    siteId: 's-1',
    siteName: 'Finanzturm Alpha (Hauptverwaltung)',
    guardId: 'e-3',
    guardName: 'Sabine Becker',
    category: 'Schichtübergabe',
    priority: 'Normal',
    stage: 'Abgeschlossen',
    title: 'Dienstantritt Frühschicht & Schlüsselübernahme',
    description: 'Schlüsselbund Pforte vollständig (8 Schlüssel, 4 RFID-Transponder). BMA im Normalzustand.',
    policeInvolved: false,
    resolved: true
  },
  {
    id: 'gb-3',
    tenantId: 'tenant-frankfurt',
    timestamp: '2025-05-14T11:42:00Z',
    siteId: 's-2',
    siteName: 'Logistik-Hub & Warenverteilzentrum Ost',
    guardId: 'e-1',
    guardName: 'Alexander Schmidt',
    category: 'Vorkommnis',
    priority: 'Dringend',
    stage: 'In Bewertung',
    title: 'Unberechtigter Zutrittsversuch Schrankenbereich Tor 2',
    description: 'Fahrzeug mit ausländischem Kennzeichen versuchte ohne Lieferschein das Werksgelände zu befahren.',
    policeInvolved: false,
    assignedManagerName: 'Alexander Schmidt',
    createdTaskId: 't-inc-1',
    resolved: false
  },
  {
    id: 'gb-4',
    tenantId: 'tenant-frankfurt',
    timestamp: '2025-05-14T13:05:00Z',
    siteId: 's-2',
    siteName: 'Logistik-Hub & Warenverteilzentrum Ost',
    guardId: 'e-1',
    guardName: 'Alexander Schmidt',
    category: 'Fehlalarm',
    priority: 'Kritisch',
    stage: 'Eskaliert',
    title: 'Fehlalarm BMA Meldergruppe 14 / Halle 3',
    description: 'Optischer Rauchmelder durch Stapler-Abgase ausgelöst. Hauptmelderlinie rückgestellt.',
    policeInvolved: false,
    assignedManagerName: 'Alexander Schmidt',
    createdTaskId: 't-inc-2',
    resolved: false
  }
];

export const initialSOPs: SOPDocument[] = [
  {
    id: 'sop-1',
    tenantId: 'tenant-frankfurt',
    sopNumber: 'DA-OBJ-01-V4',
    title: 'Dienstanweisung Pforten- und Empfangsdienst Finanzturm Alpha',
    category: 'Objektbezogen',
    siteId: 's-1',
    version: '4.2',
    effectiveDate: '2024-01-01',
    author: 'Tarkan Kaya (Objektleiter)',
    signedCount: 14,
    totalRequired: 14,
    content: '1. Jeder Besucher muss vor Betreten des Hochhauses registriert werden.',
    mandatoryAcknowledgment: true,
    unacknowledgedEmployeeNames: []
  },
  {
    id: 'sop-2',
    tenantId: 'tenant-frankfurt',
    sopNumber: 'DA-GEN-02',
    title: 'Verhalten bei Bombendrohung & Evakuierungsalarmierung',
    category: 'Notfall-SOP',
    version: '2.0',
    effectiveDate: '2023-06-01',
    author: 'Alexander Schmidt (Einsatzleiter)',
    signedCount: 3,
    totalRequired: 5,
    content: 'Ruhe bewahren, Notruf 110 absetzen, Aufzeichnung des Telefonats nach DIN 77200 Leitfaden.',
    mandatoryAcknowledgment: true,
    unacknowledgedEmployeeNames: ['Dennis Kowalski', 'Marek Jankowski']
  }
];

export const initialEmergencyPlans: EmergencyPlan[] = [
  {
    id: 'ep-1',
    tenantId: 'tenant-frankfurt',
    siteId: 's-1',
    siteName: 'Finanzturm Alpha (Hauptverwaltung)',
    scenario: 'BMA - Brandmeldeanlage',
    chainOfAction: [
      '1. FIZ / FAT (Feuerwehr-Informationszentrum) anlaufen',
      '2. Sofortige Erkundung durch Erstkraft mit Handfunkgerät',
      '3. Bei echtem Feuer: Hausalarm manuell auslösen und Leitstelle/112 bestätigen'
    ],
    contacts: [
      { role: 'Feuerwehr Leitstelle', name: 'Notruf 112', phone: '112' },
      { role: 'Einsatzleiter vom Dienst', name: 'Alexander Schmidt', phone: '+49 171 4455881' }
    ],
    lastDrillDate: '2024-03-12'
  }
];

export const initialKeys: KeyItem[] = [
  {
    id: 'k-1',
    tenantId: 'tenant-frankfurt',
    keyNumber: 'SCHL-FRA-01',
    label: 'Generalschlüssel Hauptfoyer & Technikebenen',
    siteId: 's-1',
    siteName: 'Finanzturm Alpha (Hauptverwaltung)',
    type: 'Master-Schlüssel',
    status: 'Ausgegeben',
    currentHolderName: 'Sabine Becker',
    currentHolderId: 'e-3',
    issuedAt: '2025-05-14 05:55',
    expectedReturn: '2025-05-14 18:00',
    isOverdue: false
  },
  {
    id: 'k-3',
    tenantId: 'tenant-frankfurt',
    keyNumber: 'SCHL-LOG-09',
    label: 'Sicherheitsschlüssel Gefahrgutlager Halle 4',
    siteId: 's-2',
    siteName: 'Logistik-Hub & Warenverteilzentrum Ost',
    type: 'Schrankenschlüssel',
    status: 'Ausgegeben',
    currentHolderName: 'Dennis Kowalski',
    currentHolderId: 'e-4',
    issuedAt: '2025-05-11 08:00',
    expectedReturn: '2025-05-11 18:00',
    isOverdue: true
  }
];

export const initialTasks: TaskItem[] = [
  {
    id: 't-1',
    tenantId: 'tenant-frankfurt',
    title: 'Ersthelfer-Nachschulung für Tarkan Kaya veranlassen',
    assignedToName: 'Personalverwaltung (HR)',
    sourceModule: 'Qualifikation',
    dueDate: '2025-05-25',
    priority: 'Hoch',
    status: 'Offen',
    category: 'Nachschulung'
  },
  {
    id: 't-2',
    tenantId: 'tenant-frankfurt',
    title: 'DIN 77200 Zertifizierungsaudit Vorbereitung Finanzturm Alpha',
    assignedToName: 'Alexander Schmidt',
    siteName: 'Finanzturm Alpha',
    sourceModule: 'QM Audit',
    dueDate: '2025-06-01',
    priority: 'Hoch',
    status: 'In Bearbeitung',
    category: 'Audit'
  }
];

// ==============================================================================
// PHASE 8: DEKLARATIVE AUTOMATISIERUNGSREGELN, TEMPLATES & EXECUTION LOGS
// ==============================================================================

export const initialAutomations: AutomationRule[] = [
  {
    id: 'rule-qual-watchdog',
    tenantId: 'tenant-frankfurt',
    name: 'Qualifikations-Ablauf-Watchdog (§ 34a & Ersthelfer)',
    description: 'Prüft täglich alle Qualifikationen. Erstellt 30 Tage vor Ablauf automatisch eine HR-Aufgabe und In-App-Meldung.',
    trigger: 'QUALIFICATION_EXPIRING',
    category: 'Personal',
    conditions: [
      { field: 'daysUntilExpiry', operator: 'LESS_THAN_DAYS', value: 30 },
      { field: 'verified', operator: 'EQUALS', value: true }
    ],
    actions: [
      {
        type: 'CREATE_TASK',
        targetRole: UserRole.HR,
        taskTitleTemplate: 'Re-Zertifizierung fällig: {qualificationType} für {employeeName}',
        taskPriority: 'Hoch'
      },
      {
        type: 'SEND_NOTIFICATION',
        notificationTitle: 'Ablaufender Nachweis',
        notificationMessage: '{employeeName}: {qualificationType} läuft am {expiryDate} ab.',
        notificationSeverity: 'WARNUNG'
      }
    ],
    active: true,
    lastRun: 'Heute, 04:00 Uhr',
    lastRunStatus: 'SUCCESS',
    actionsTriggeredCount: 2
  },
  {
    id: 'rule-contract-renewal',
    tenantId: 'tenant-frankfurt',
    name: 'Vertragsverlängerungs- & Kündigungsfristenprüfer',
    description: 'Überwacht Mandantenverträge auf anstehende Kündigungs- oder Verlängerungsfristen (<90 Tage).',
    trigger: 'CONTRACT_EXPIRING',
    category: 'Verträge',
    conditions: [
      { field: 'daysUntilContractEnd', operator: 'LESS_THAN_DAYS', value: 90 },
      { field: 'billingStatus', operator: 'EQUALS', value: 'Regulär' }
    ],
    actions: [
      {
        type: 'CREATE_TASK',
        targetRole: UserRole.GF,
        taskTitleTemplate: 'Vertragsverlängerung verhandeln: {companyName} (Ende: {contractEnd})',
        taskPriority: 'Hoch'
      },
      {
        type: 'SEND_NOTIFICATION',
        notificationTitle: 'Vertrag endet bald',
        notificationMessage: 'Mandant {companyName}: Vertrag endet am {contractEnd}.',
        notificationSeverity: 'WARNUNG'
      }
    ],
    active: true,
    lastRun: 'Heute, 04:00 Uhr',
    lastRunStatus: 'SUCCESS',
    actionsTriggeredCount: 1
  },
  {
    id: 'rule-key-overdue',
    tenantId: 'tenant-frankfurt',
    name: 'Schlüsselverzug & Rückgabe-Eskalation',
    description: 'Erkennt überfällige Generalschlüssel sofort nach Ablauf des vereinbarten Rückgabezeitpunkts.',
    trigger: 'KEY_OVERDUE',
    category: 'Schlüssel',
    conditions: [
      { field: 'status', operator: 'EQUALS', value: 'Ausgegeben' },
      { field: 'isOverdue', operator: 'EQUALS', value: true }
    ],
    actions: [
      {
        type: 'SET_KEY_OVERDUE'
      },
      {
        type: 'CREATE_TASK',
        targetRole: UserRole.EINSATZLEITUNG,
        taskTitleTemplate: 'Schlüsselrückgabe überfällig: {label} ({currentHolderName})',
        taskPriority: 'Hoch'
      },
      {
        type: 'SEND_NOTIFICATION',
        notificationTitle: 'Schlüssel überfällig!',
        notificationMessage: '{label} ({keyNumber}) ist seit Ablaufzeitpunkt nicht zurückgekehrt.',
        notificationSeverity: 'ALARM'
      }
    ],
    active: true,
    lastRun: 'Heute, 14:00 Uhr',
    lastRunStatus: 'SUCCESS',
    actionsTriggeredCount: 1
  },
  {
    id: 'rule-incident-critical',
    tenantId: 'tenant-frankfurt',
    name: 'Automatische Aufgabenanlage bei kritischen Vorfällen',
    description: 'Erzeugt bei Wachbucheinträgen mit Priorität "Kritisch" oder "Dringend" eine Bearbeitungsaufgabe für den Objektleiter.',
    trigger: 'INCIDENT_CREATED',
    category: 'Wachbuch',
    conditions: [
      { field: 'priority', operator: 'IN_ARRAY', value: ['Kritisch', 'Dringend'] }
    ],
    actions: [
      {
        type: 'CREATE_TASK',
        targetRole: UserRole.OBJEKTLEITUNG,
        taskTitleTemplate: 'Vorfallsbearbeitung: {title} ({siteName})',
        taskPriority: 'Hoch'
      },
      {
        type: 'ESCALATE_INCIDENT'
      }
    ],
    active: true,
    lastRun: 'Vor 2 Stunden',
    lastRunStatus: 'SUCCESS',
    actionsTriggeredCount: 3
  },
  {
    id: 'rule-roster-conflict',
    tenantId: 'tenant-frankfurt',
    name: 'Dienstplan-Qualifikations- & ArbZG-Wächter',
    description: 'Prüft bei Schichtdisposition fehlende Qualifikation nach § 34a GewO sowie Urlaubs-/Krankheitsstatus.',
    trigger: 'SHIFT_CONFLICT_DETECTED',
    category: 'Dienstplan',
    conditions: [
      { field: 'status', operator: 'EQUALS', value: 'Konflikt' }
    ],
    actions: [
      {
        type: 'SEND_NOTIFICATION',
        notificationTitle: 'Dienstplankonflikt erkannt!',
        notificationMessage: 'Schicht {siteName} ({date}): {conflictReason}',
        notificationSeverity: 'ALARM'
      }
    ],
    active: true,
    lastRun: 'Heute, 11:30 Uhr',
    lastRunStatus: 'SUCCESS',
    actionsTriggeredCount: 1
  }
];

export const initialAutomationTemplates: AutomationRule[] = [
  {
    id: 'tmpl-1',
    name: 'Vorlage: BMA-Alarm Revisionsaufgabe',
    description: 'Erzeugt nach BMA-Fehlalarmen eine automatische Prüfaufgabe zur Meldergruppen-Revision.',
    trigger: 'INCIDENT_CREATED',
    category: 'Wachbuch',
    conditions: [{ field: 'category', operator: 'EQUALS', value: 'Fehlalarm' }],
    actions: [
      { type: 'CREATE_TASK', taskTitleTemplate: 'BMA-Revision nach Fehlalarm: {siteName}', taskPriority: 'Mittel' }
    ],
    active: false,
    isTemplate: true,
    actionsTriggeredCount: 0
  },
  {
    id: 'tmpl-2',
    name: 'Vorlage: QM-Dienstanweisung Lesequote',
    description: 'Erinnert Wachkräfte 7 Tage nach Veröffentlichung an ausstehende Bestätigungen.',
    trigger: 'SOP_UNACKNOWLEDGED',
    category: 'QM',
    conditions: [{ field: 'unacknowledgedCount', operator: 'GREATER_THAN', value: 0 }],
    actions: [
      { type: 'SEND_NOTIFICATION', notificationTitle: 'Dienstanweisung unbestätigt', notificationMessage: 'Bitte bestätigen Sie die Anweisung zeitnah.', notificationSeverity: 'INFO' }
    ],
    active: false,
    isTemplate: true,
    actionsTriggeredCount: 0
  }
];

export const initialExecutionLogs: AutomationExecutionLog[] = [
  {
    id: 'log-001',
    tenantId: 'tenant-frankfurt',
    ruleId: 'rule-qual-watchdog',
    ruleName: 'Qualifikations-Ablauf-Watchdog (§ 34a & Ersthelfer)',
    executedAt: '2025-05-15 04:00:12',
    triggerEvent: 'QUALIFICATION_EXPIRING',
    matchedEntityId: 'e-2',
    matchedEntityDesc: 'Tarkan Kaya (Erste-Hilfe-Nachweis)',
    status: 'SUCCESS',
    actionsExecuted: ['TASK_CREATED', 'NOTIFICATION_SENT'],
    executionDurationMs: 42,
    details: 'Gültigkeit überschritten; Aufgabe t-1 für HR angelegt.'
  },
  {
    id: 'log-002',
    tenantId: 'tenant-frankfurt',
    ruleId: 'rule-key-overdue',
    ruleName: 'Schlüsselverzug & Rückgabe-Eskalation',
    executedAt: '2025-05-15 14:00:05',
    triggerEvent: 'KEY_OVERDUE',
    matchedEntityId: 'k-3',
    matchedEntityDesc: 'SCHL-LOG-09 (Dennis Kowalski)',
    status: 'SUCCESS',
    actionsExecuted: ['KEY_FLAGGED_OVERDUE', 'TASK_CREATED', 'NOTIFICATION_SENT'],
    executionDurationMs: 38,
    details: 'Rückgabefrist um 72h überschritten. Eskalationsaufgabe an Einsatzleitung zugewiesen.'
  },
  {
    id: 'log-003',
    tenantId: 'tenant-frankfurt',
    ruleId: 'rule-incident-critical',
    ruleName: 'Automatische Aufgabenanlage bei kritischen Vorfällen',
    executedAt: '2025-05-14 13:05:30',
    triggerEvent: 'INCIDENT_CREATED',
    matchedEntityId: 'gb-4',
    matchedEntityDesc: 'Fehlalarm BMA Meldergruppe 14 / Halle 3',
    status: 'SUCCESS',
    actionsExecuted: ['TASK_CREATED: t-inc-2', 'INCIDENT_STAGE_UPDATED: Eskaliert'],
    executionDurationMs: 51
  },
  {
    id: 'log-004',
    tenantId: 'tenant-frankfurt',
    ruleId: 'rule-contract-renewal',
    ruleName: 'Vertragsverlängerungs- & Kündigungsfristenprüfer',
    executedAt: '2025-05-15 04:00:15',
    triggerEvent: 'CONTRACT_EXPIRING',
    matchedEntityId: 'c-2',
    matchedEntityDesc: 'Technologiepark Adlershof (<45 Tage)',
    status: 'SUCCESS',
    actionsExecuted: ['TASK_CREATED', 'NOTIFICATION_SENT'],
    executionDurationMs: 34
  }
];

export const initialNotificationDeliveries: NotificationDelivery[] = [
  {
    id: 'nd-001',
    tenantId: 'tenant-frankfurt',
    title: 'Ablaufender Nachweis',
    message: 'Tarkan Kaya: Erste-Hilfe-Nachweis ist abgelaufen. Nachzertifizierung erforderlich.',
    channel: 'IN_APP',
    severity: 'WARNUNG',
    status: 'DELIVERED',
    createdAt: '2025-05-15 04:00:12',
    deliveredAt: '2025-05-15 04:00:12',
    read: false,
    sourceModule: 'Personal'
  },
  {
    id: 'nd-002',
    tenantId: 'tenant-frankfurt',
    title: 'Schlüssel überfällig!',
    message: 'SCHL-LOG-09 ist seit 3 Tagen überfällig. Aufgabe für Einsatzleiter erzeugt.',
    channel: 'IN_APP',
    severity: 'ALARM',
    status: 'DELIVERED',
    createdAt: '2025-05-15 14:00:05',
    deliveredAt: '2025-05-15 14:00:05',
    read: false,
    sourceModule: 'Schlüssel'
  },
  {
    id: 'nd-003',
    tenantId: 'tenant-frankfurt',
    title: 'Dienstplankonflikt erkannt!',
    message: 'Schicht Logistik-Hub Berlin: Marek Jankowski krankgemeldet – Ersatzkraft erforderlich!',
    channel: 'IN_APP',
    severity: 'ALARM',
    status: 'DELIVERED',
    createdAt: '2025-05-15 11:30:00',
    deliveredAt: '2025-05-15 11:30:00',
    read: true,
    sourceModule: 'Dienstplan'
  },
  {
    id: 'nd-004',
    tenantId: 'tenant-frankfurt',
    recipientEmail: 'a.schmidt@ffm-sec.de',
    title: 'Eilmeldung: Kritisches Vorkommnis Halle 3',
    message: 'BMA Meldergruppe 14 ausgelöst. Bitte Leitstelle und Feuerwehr einweisen.',
    channel: 'EMAIL',
    severity: 'KRITISCH',
    status: 'SENT',
    createdAt: '2025-05-14 13:05:32',
    deliveredAt: '2025-05-14 13:05:35',
    read: true,
    sourceModule: 'Wachbuch'
  }
];

export const initialNotificationPreferences: NotificationPreference = {
  userId: 'user-schmidt',
  emailEnabled: true,
  inAppEnabled: true,
  pushEnabled: false,
  qualificationWarnings: true,
  contractDeadlines: true,
  criticalIncidents: true,
  keyReturns: true,
  rosterConflicts: true
};

export const initialAuditLogs: SecurityAuditEntry[] = [
  {
    id: 'audit-001',
    timestamp: '2025-05-15 08:31:02',
    actorEmail: 'a.schmidt@ffm-sec.de',
    actorRole: 'Einsatzleitung',
    actionType: 'LOGIN',
    severity: 'INFO',
    targetEntity: 'Session / OAuth JWT',
    details: 'Erfolgreiche Anmeldung via Argon2id. MFA-Verifikation abgeschlossen.',
    ipAddress: '194.25.101.44',
    tenantId: 'tenant-frankfurt'
  },
  {
    id: 'audit-002',
    timestamp: '2025-05-15 09:12:45',
    actorEmail: 'attacker-spoof@darkweb.net',
    actorRole: 'Unauthentifiziert',
    actionType: 'IDOR_BLOCKED',
    severity: 'KRITISCH',
    targetEntity: 'Customer / IDOR Probe',
    details: 'Physischer Cross-Tenant Zugriff auf c-3 (Bavaria Schutz) mit manipuliertem JWT abgewiesen. RLS-Trigger aktiv.',
    ipAddress: '185.220.101.5',
    tenantId: 'tenant-frankfurt'
  },
  {
    id: 'audit-003',
    timestamp: '2025-05-15 10:05:18',
    actorEmail: 'a.schmidt@ffm-sec.de',
    actorRole: 'Einsatzleitung',
    actionType: 'INCIDENT_MOD',
    severity: 'INFO',
    targetEntity: 'Wachbuch gb-3',
    details: 'Wachbucheintrag gb-3: Statusänderung zu "In Bewertung" (Revisionsvektor v2 angehängt).',
    ipAddress: '194.25.101.44',
    tenantId: 'tenant-frankfurt'
  },
  {
    id: 'audit-004',
    timestamp: '2025-05-15 11:20:00',
    actorEmail: 'a.schmidt@ffm-sec.de',
    actorRole: 'Einsatzleitung',
    actionType: 'DATA_EXPORT',
    severity: 'WARNUNG',
    targetEntity: 'DSGVO / Art. 15 Export',
    details: 'Audit-Protokoll und Dienstplan für Monat 05/2025 als DIN 77200 PDF exportiert.',
    ipAddress: '194.25.101.44',
    tenantId: 'tenant-frankfurt'
  },
  {
    id: 'audit-005',
    timestamp: '2025-05-15 14:00:10',
    actorEmail: 'system-engine@secops.local',
    actorRole: 'Systemadministrator',
    actionType: 'AUTOMATION_RUN',
    severity: 'INFO',
    targetEntity: 'AutomationEngine',
    details: 'Automatisierungslauf ausgeführt: 4 Regeln geprüft, 2 Aktionen ausgelöst.',
    ipAddress: '127.0.0.1',
    tenantId: 'tenant-frankfurt'
  }
];

export const initialActiveSessions: UserSessionDevice[] = [
  {
    id: 'sess-01',
    deviceName: 'Leitstellen-Arbeitsplatz 01 (HP EliteDesk)',
    browser: 'Chrome 125.0 Enterprise (Windows 11 Pro)',
    ipAddress: '194.25.101.44',
    lastActivity: 'Vor 2 Minuten',
    isCurrentSession: true,
    status: 'ACTIVE',
    mfaVerified: true
  },
  {
    id: 'sess-02',
    deviceName: 'Dienst-Tablet Revier Ost (Samsung Galaxy ActiveTab 4)',
    browser: 'PWA Mobile Shell (Android 14)',
    ipAddress: '80.187.112.90',
    lastActivity: 'Vor 42 Minuten',
    isCurrentSession: false,
    status: 'ACTIVE',
    mfaVerified: true
  }
];

export const initialGdprPolicies: GdprRetentionPolicy[] = [
  {
    id: 'gdpr-1',
    category: 'Digitales Wachbuch & Vorfälle',
    statutoryBasis: '§ 34a GewO / DIN 77200 / BGB § 195 (Verjährungsfristen)',
    retentionYears: 3,
    autoPurgeEnabled: false
  },
  {
    id: 'gdpr-2',
    category: 'Mitarbeiter Arbeitszeiterfassung & Schichten',
    statutoryBasis: 'Arbeitszeitgesetz (ArbZG § 16 Abs. 2) / MiLoG',
    retentionYears: 2,
    autoPurgeEnabled: true
  }
];
