import React, { useState } from 'react';
import {
  BookOpen,
  Search,
  Printer,
  ChevronRight,
  ShieldCheck,
  Building2,
  Users,
  Calendar,
  KeyRound,
  FileCheck2,
  Siren,
  Smartphone,
  HardDrive,
  Layers,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Maximize2,
  Zap,
  HelpCircle,
  FileText,
  MousePointerClick
} from 'lucide-react';
import { useSecurityStore } from '../store';

interface GuideStep {
  stepNumber: number;
  title: string;
  description: string;
  calloutTarget: string;
}

interface GuideChapter {
  id: string;
  title: string;
  badge: string;
  category: 'Grundlagen' | 'Einsatz & Mobil' | 'Objekt & Personal' | 'Compliance & IT';
  summary: string;
  steps: GuideStep[];
  svgDiagramType: 'dashboard' | 'employee_create' | 'guardbook_entry' | 'mobile_scanner' | 'offline_sync' | 'kiosk_terminal' | 'keys_depot';
}

export const IllustratedUserGuide: React.FC = () => {
  const { setActiveTab, theme } = useSecurityStore();
  const [selectedChapterId, setSelectedChapterId] = useState<string>('chap-dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeStepIndex, setActiveStepIndex] = useState<number>(0);

  const chapters: GuideChapter[] = [
    {
      id: 'chap-dashboard',
      title: '1. Einsatz-Dashboard & Leitstellen-Lagebild',
      badge: 'Leitstelle / GF',
      category: 'Grundlagen',
      summary: 'Echtzeit-Überwachung von Schichtbesetzungen, offenen Alarmen, RFID-Kontrollgangsquoten und DIN 77200 Zertifizierungsgrad.',
      svgDiagramType: 'dashboard',
      steps: [
        {
          stepNumber: 1,
          title: 'Mandanten-Umschaltung prüfen',
          description: 'Überprüfen Sie in der Kopfzeile den aktiven Mandanten. Alle Kennzahlen, Wachbücher und Schichten filtern sofort isoliert auf dieses Unternehmen.',
          calloutTarget: 'Mandanten-Selektor'
        },
        {
          stepNumber: 2,
          title: 'Echtzeit-KPIs ablesen',
          description: 'Die oberen vier Kacheln zeigen Wachpersonal-Verfügbarkeit, Schutzobjekte, Besetzungsquote und Generalschlüssel-Status im Tresor.',
          calloutTarget: 'KPI Kacheln'
        },
        {
          stepNumber: 3,
          title: 'Vorkommnis-Radar & Schnellerfassung',
          description: 'Über die blaue Schaltfläche "Wachbucheintrag erfassen" kann das Protokoll direkt aus dem Lagebild geöffnet werden.',
          calloutTarget: 'Schnellzugriff'
        }
      ]
    },
    {
      id: 'chap-employee',
      title: '2. Personalverwaltung & § 34a GewO Nachweisführung',
      badge: 'HR / Personal',
      category: 'Objekt & Personal',
      summary: 'Lückenlose Verwaltung von Personalstammdaten, IHK-Sachkundeprüfungen, DGUV Ersthelfer-Zertifikaten und Bewacherregister (BWR) Fristen.',
      svgDiagramType: 'employee_create',
      steps: [
        {
          stepNumber: 1,
          title: 'Mitarbeiterverwaltung öffnen',
          description: 'Wählen Sie in der linken Navigation unter "STAMMDATEN & OBJEKTE" den Punkt "Personal & § 34a GewO".',
          calloutTarget: 'Menüpunkt Personal'
        },
        {
          stepNumber: 2,
          title: 'Schaltfläche "Mitarbeiter anlegen" klicken',
          description: 'Oben rechts öffnet sich der Eingabedialog für Personalstammdaten, Telefon und Stundenlohn.',
          calloutTarget: 'Button Neu'
        },
        {
          stepNumber: 3,
          title: 'Qualifikation & BWR-Zertifikat hinterlegen',
          description: 'Wählen Sie "Sachkundeprüfung § 34a" oder "Unterrichtung", tragen Sie die IHK-Zertifikatsnummer und das Ablaufdatum ein.',
          calloutTarget: 'Zertifikatsmaske'
        },
        {
          stepNumber: 4,
          title: 'Speichern & Watchdog-Überwachung',
          description: 'Nach dem Speichern überwacht die Automatisierungsengine das Ablaufdatum automatisch und warnt 30 Tage vor Fristablauf.',
          calloutTarget: 'Speicher-Button'
        }
      ]
    },
    {
      id: 'chap-guardbook',
      title: '3. Digitales Wachbuch & Vorfallsmanagement (DIN 77200)',
      badge: 'Operativ / Wachdienst',
      category: 'Einsatz & Mobil',
      summary: 'Manuelle Erfassung von Kontrollgängen, Schichtübergaben und Vorkommnissen mit Append-Only Historie.',
      svgDiagramType: 'guardbook_entry',
      steps: [
        {
          stepNumber: 1,
          title: 'Wachbuchmodul aufrufen',
          description: 'Klicken Sie auf "Digitales Wachbuch" in der Navigation oder nutzen Sie den Tastaturbefehl Ctrl+K.',
          calloutTarget: 'Navigation Wachbuch'
        },
        {
          stepNumber: 2,
          title: 'Ereignis erfassen öffnen',
          description: 'Wählen Sie das Sicherheitsobjekt, die protokollierende Wachkraft, Kategorie (z. B. Vorkommnis oder Fehlalarm) und Priorität.',
          calloutTarget: 'Formulardialog'
        },
        {
          stepNumber: 3,
          title: 'Bericht manuell formulieren',
          description: 'Dokumentieren Sie den beobachteten Sachverhalt in eigenen Worten. Prüfen Sie Angaben, Zeiten und Beteiligte vor dem Speichern.',
          calloutTarget: 'Sachverhaltsfeld'
        },
        {
          stepNumber: 4,
          title: 'Append-Only Revisionshistorie',
          description: 'Ein gespeicherter Eintrag kann nicht unbemerkt gelöscht werden. Korrekturen werden als versionierte Revision angehängt.',
          calloutTarget: 'Revisions-Badge'
        }
      ]
    },
    {
      id: 'chap-mobile',
      title: '4. Mobile Mitarbeiter-App & QR-/NFC-Kontrollgang',
      badge: 'Mitarbeiter-App / PWA',
      category: 'Einsatz & Mobil',
      summary: 'Smartphone-optimierte Daumennavigation für Schichtzeiten, Diensttausch, digitale Übergabe und Anti-Duplikat QR/NFC Scanner.',
      svgDiagramType: 'mobile_scanner',
      steps: [
        {
          stepNumber: 1,
          title: 'Mitarbeiter-App auf Smartphone starten',
          description: 'In der Navbar auf "Mitarbeiter-App" tippen oder die App auf dem Smartphone als PWA installieren.',
          calloutTarget: 'Mobile App Switch'
        },
        {
          stepNumber: 2,
          title: 'Heutigen Dienst & Ansprechpartner prüfen',
          description: 'Der Reiter "Dienst" zeigt Schichtzeiten, Objektadresse und den direkten Anruf-Button zum Objektleiter.',
          calloutTarget: 'Mein Dienst'
        },
        {
          stepNumber: 3,
          title: 'Zentralen "Scan"-Button betätigen',
          description: 'Kamera aktivieren und QR-Code oder NFC-Wandtransponder an der Stechstelle erfassen.',
          calloutTarget: 'Scan Floating Button'
        },
        {
          stepNumber: 4,
          title: 'Schichtübergabe digital quittieren',
          description: 'Unter "Übergabe" Schlüsselbestände und offene Vorkommnisse mit der Ablösekraft gegenzeichnen.',
          calloutTarget: 'Übergabe-Tab'
        }
      ]
    },
    {
      id: 'chap-offline',
      title: '5. Offline-Betrieb & Synchronisations-Zentrale',
      badge: 'Offline-First',
      category: 'Compliance & IT',
      summary: 'Zuverlässiges Arbeiten im Funkloch oder Tiefgaragen: Lokale IndexedDB Outbox, automatische Idempotenz und Side-by-Side Konfliktlösung.',
      svgDiagramType: 'offline_sync',
      steps: [
        {
          stepNumber: 1,
          title: 'Offline-Zustand erkennen',
          description: 'Bei Verbindungsabbruch schaltet die App automatisch auf "Offline-Modus" um. Alle Formulare bleiben voll bedienbar.',
          calloutTarget: 'Offline-Indikator'
        },
        {
          stepNumber: 2,
          title: 'Lokale Speicherung in Outbox',
          description: 'Wachbucheinträge, Scans und Fotos werden persistent in der Browser-IndexedDB gesichert.',
          calloutTarget: 'IndexedDB Outbox'
        },
        {
          stepNumber: 3,
          title: 'Automatische Synchronisation bei Reconnect',
          description: 'Sobald Empfang besteht, überträgt das Push-Protokoll alle Einträge idempotent an die PostgreSQL-Datenbank.',
          calloutTarget: 'Sync-Warteschlange'
        },
        {
          stepNumber: 4,
          title: 'Konfliktmanagement (Side-by-Side Diff)',
          description: 'Bei paralleler Aufgabenbearbeitung öffnet das System einen Gegenüberstellungs-Dialog zum Vergleichen.',
          calloutTarget: 'Konflikt-Diff'
        }
      ]
    },
    {
      id: 'chap-kiosk',
      title: '6. Kiosk-Modus für Pforten- & Wachlokal-Tablets',
      badge: 'Wachlokal / Hardware',
      category: 'Compliance & IT',
      summary: 'Dauerbetrieb auf Wand-Tablets mit PIN-Schnellwechsel, automatischer Sitzungssperre nach Inaktivität und Offline-Puffer.',
      svgDiagramType: 'kiosk_terminal',
      steps: [
        {
          stepNumber: 1,
          title: 'Kiosk-Vollbildmodus aktivieren',
          description: 'Im Browser oder Android-Enterprise Kiosk startet SecurityOps im gesperrten Vollbildmodus.',
          calloutTarget: 'Vollbild-Terminal'
        },
        {
          stepNumber: 2,
          title: 'Wachkraft-Schnellanmeldung per PIN/Transponder',
          description: 'Wachkräfte melden sich zum Rundgang oder Wachwechsel über persönliche Dienstnummer oder RFID an.',
          calloutTarget: 'PIN-Pad'
        },
        {
          stepNumber: 3,
          title: 'Automatischer Timeout-Schutz',
          description: 'Nach 2 Minuten Inaktivität sperrt das Terminal sensible Kundendaten automatisch.',
          calloutTarget: 'Inaktivitäts-Timer'
        }
      ]
    },
    {
      id: 'chap-keys',
      title: '7. Schlüssel- & Transponderdepotverwaltung',
      badge: 'Hardware & Zutritt',
      category: 'Objekt & Personal',
      summary: 'Lückenlose Übergabe von Generalschlüsseln und RFID-Medien mit automatischer Rückgabeverzug-Erkennung.',
      svgDiagramType: 'keys_depot',
      steps: [
        {
          stepNumber: 1,
          title: 'Schlüsselverzeichnis öffnen',
          description: 'Navigieren Sie zu "Schlüssel & Zutrittsmedien". Sie sehen alle Medien und den aktuellen Verbleib.',
          calloutTarget: 'Schlüsselliste'
        },
        {
          stepNumber: 2,
          title: 'Schlüssel an Wachkraft ausgeben',
          description: 'Klicken Sie auf "Ausgeben", wählen Sie die Wachkraft und den erwarteten Rückgabezeitpunkt (z. B. 18:00 Uhr).',
          calloutTarget: 'Ausgabedialog'
        },
        {
          stepNumber: 3,
          title: 'Überfälligkeit & Watchdog-Eskalation',
          description: 'Wird der Schlüssel nicht fristgerecht zurückgegeben, markiert das System ihn als überfällig und erzeugt eine Aufgabe.',
          calloutTarget: 'Überfälligkeits-Warnung'
        },
        {
          stepNumber: 4,
          title: 'Rücknahme ins Tresordepot quittieren',
          description: 'Klicken Sie auf "Rücknahme bestätigen". Der Status springt sofort auf "Im Tresor".',
          calloutTarget: 'Rücknahme-Button'
        }
      ]
    }
  ];

  const filteredChapters = chapters.filter(
    (c) =>
      c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedChapter = chapters.find((c) => c.id === selectedChapterId) || chapters[0];

  const handlePrint = () => {
    window.print();
  };

  // SVG Renderer generating crisp, professional software screenshots with callouts & numbered annotations
  const renderVisualScreenshot = (type: GuideChapter['svgDiagramType']) => {
    return (
      <div className="w-full bg-[#070b14] border border-slate-800 rounded-2xl p-4 sm:p-6 overflow-hidden shadow-2xl relative select-none">
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-800/80 text-[11px] text-slate-400 font-mono">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80 inline-block" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
            <span className="ml-2 text-slate-300 font-semibold font-sans">
              SecurityOps 2.0 – Originalansicht: {selectedChapter.title.replace(/^[0-9]+\.\s*/, '')}
            </span>
          </div>
          <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 font-bold border border-blue-500/20">
            DIN 77200 LIVE
          </span>
        </div>

        {type === 'dashboard' && (
          <div className="space-y-4">
            {/* Mock Header */}
            <div className="flex items-center justify-between bg-slate-900/90 p-3 rounded-xl border border-slate-800 relative">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-xs">SO</div>
                <div>
                  <div className="text-xs font-bold text-white">Securitas & Wache Frankfurt GmbH</div>
                  <div className="text-[10px] text-emerald-400">● PostgreSQL Live (RLS Aktiv)</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="px-2.5 py-1 rounded bg-blue-600 text-white text-[11px] font-bold">Wachbuch +</div>
              </div>
              {/* Callout 1 */}
              <div className="absolute -top-3 -left-3 w-6 h-6 rounded-full bg-rose-500 text-white font-bold text-xs flex items-center justify-center ring-4 ring-[#070b14] shadow-lg animate-bounce">
                1
              </div>
            </div>

            {/* Mock KPI Cards */}
            <div className="grid grid-cols-4 gap-3 relative">
              <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 block">Wachpersonal</span>
                <span className="text-base font-bold text-white mt-1 block">4 / 5 Aktiv</span>
                <span className="text-[9px] text-emerald-400">95% Bereitschaft</span>
              </div>
              <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 block">Schutzobjekte</span>
                <span className="text-base font-bold text-white mt-1 block">2 KRITIS</span>
                <span className="text-[9px] text-blue-400">100% Besetzt</span>
              </div>
              <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 block">Schichtbesetzung</span>
                <span className="text-base font-bold text-white mt-1 block">2 / 3 Besetzt</span>
                <span className="text-[9px] text-rose-400">1 Schicht offen!</span>
              </div>
              <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 block">Schlüsseldepot</span>
                <span className="text-base font-bold text-white mt-1 block">2 Ausgegeben</span>
                <span className="text-[9px] text-amber-400">1 Überfällig</span>
              </div>
              {/* Callout 2 */}
              <div className="absolute -top-3 left-1/2 w-6 h-6 rounded-full bg-rose-500 text-white font-bold text-xs flex items-center justify-center ring-4 ring-[#070b14] shadow-lg">
                2
              </div>
            </div>

            {/* Mock Chart Bar */}
            <div className="p-4 bg-slate-900/60 rounded-xl border border-slate-800 flex items-center justify-between text-xs text-slate-300 relative">
              <div className="space-y-1">
                <span className="font-bold text-white block">Soll/Ist Stundenvergleich (Woche)</span>
                <div className="flex items-center gap-3 text-[11px] text-slate-400">
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-blue-500 rounded" /> Ist: 476h</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-slate-600 rounded" /> Soll: 480h</span>
                </div>
              </div>
              <div className="w-48 bg-slate-800 h-3 rounded-full overflow-hidden">
                <div className="bg-blue-500 h-full w-[98%]" />
              </div>
              {/* Callout 3 */}
              <div className="absolute -top-3 right-4 w-6 h-6 rounded-full bg-rose-500 text-white font-bold text-xs flex items-center justify-center ring-4 ring-[#070b14] shadow-lg">
                3
              </div>
            </div>
          </div>
        )}

        {type === 'employee_create' && (
          <div className="space-y-4">
            <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="font-bold text-white text-xs">Mitarbeitererfassung: Sabine Becker (MA-0215)</span>
                <span className="text-[10px] text-emerald-400 font-mono">BWR Status: GÜLTIG</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-[11px]">
                <div className="p-2 bg-slate-800 rounded">Rolle: Wachdienstmitarbeiter</div>
                <div className="p-2 bg-slate-800 rounded">Vertrag: 38.0 Std/Woche (17.50 €/h)</div>
                <div className="p-2 bg-slate-800 rounded text-blue-400">Nachweis: Sachkundeprüfung § 34a GewO</div>
                <div className="p-2 bg-slate-800 rounded text-emerald-400">Gültigkeit: 14.02.2032 (IHK-BER-1022)</div>
              </div>
            </div>
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-[11px] text-amber-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Watchdog aktiv: Automatische Warnung 30 Tage vor Zertifikatsablauf an Personalabteilung.</span>
            </div>
          </div>
        )}

        {type === 'guardbook_entry' && (
          <div className="space-y-3 text-xs">
            <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white">Unberechtigter Zutrittsversuch Schrankenbereich Tor 2</span>
                <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold text-[10px]">Dringend</span>
              </div>
              <p className="text-[11px] text-slate-300">
                Fahrzeug mit ausländischem Kennzeichen versuchte ohne Lieferschein das Werksgelände zu befahren. Nach Deeskalation Platzverweis erteilt.
              </p>
              <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-[10px] text-slate-400">
                <span>Objekt: Logistik-Hub Berlin • Wachkraft: Alexander Schmidt</span>
                <span className="text-blue-400 font-bold">Revision v2 (Append-Only)</span>
              </div>
            </div>
          </div>
        )}

        {type === 'mobile_scanner' && (
          <div className="max-w-xs mx-auto bg-slate-900 border border-blue-500/40 rounded-2xl p-4 text-xs space-y-3">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-blue-400 font-bold">Mein Dienst: Finanzturm Alpha</span>
              <span className="text-emerald-400">06:00 - 18:00</span>
            </div>
            <div className="aspect-video bg-black rounded-xl border border-slate-700 flex items-center justify-center relative">
              <div className="border-2 border-dashed border-blue-400 w-28 h-20 rounded flex items-center justify-center text-[10px] text-blue-300">
                QR / NFC Scan
              </div>
            </div>
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-300 text-[10px] text-center">
              ✓ CP-01 Hauptfoyer Schrankenanlage erfasst (Anti-Duplikat aktiv)
            </div>
          </div>
        )}

        {type === 'offline_sync' && (
          <div className="space-y-3 text-xs">
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center justify-between text-rose-200">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-rose-400 animate-ping" />
                <span className="font-bold">Offline-Modus aktiv: Keine Funkverbindung</span>
              </div>
              <span className="text-[10px] font-mono">IndexedDB Vault bereit</span>
            </div>
            <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 text-[11px] text-slate-300">
              <div className="flex justify-between font-bold mb-1">
                <span>Outbox-Warteschlange (2 Mutationen)</span>
                <span className="text-amber-400">Pending Sync</span>
              </div>
              <div className="text-[10px] text-slate-400">
                • Kontrollgang CP-03 Tiefgarage (Erfasst 11:42 Uhr)<br />
                • Vorfallsprotokoll mit 1.4 MB Fotobeweis
              </div>
            </div>
          </div>
        )}

        {type === 'kiosk_terminal' && (
          <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-3 text-xs text-center">
            <div className="text-sm font-bold text-white">Wachlokal Terminal 01 (Kiosk Mode)</div>
            <p className="text-[11px] text-slate-400">PIN eingeben oder Dienstausweis vor Wandleser halten:</p>
            <div className="flex justify-center gap-2 font-mono text-base font-bold text-blue-400">
              <span className="px-3 py-1 bg-slate-800 rounded">●</span>
              <span className="px-3 py-1 bg-slate-800 rounded">●</span>
              <span className="px-3 py-1 bg-slate-800 rounded">●</span>
              <span className="px-3 py-1 bg-slate-800 rounded">○</span>
            </div>
            <div className="text-[10px] text-slate-500">Automatischer Sitzungs-Timeout: 120 Sekunden</div>
          </div>
        )}

        {type === 'keys_depot' && (
          <div className="space-y-3 text-xs">
            <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 flex items-center justify-between">
              <div>
                <span className="font-bold text-white">SCHL-LOG-09 (Sicherheitsschlüssel Gefahrgutlager Halle 4)</span>
                <div className="text-[10px] text-slate-400">Inhaber: Dennis Kowalski • Rückgabe fällig: 11.05. 18:00 Uhr</div>
              </div>
              <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-400 font-bold text-[10px]">
                3 Tage überfällig
              </span>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-blue-400" />
            <h1 className="text-xl font-bold text-white">Bebildertes Benutzerhandbuch & Schulungscenter</h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Illustrierte Schritt-für-Schritt-Anleitungen mit Original-Screenshots, Callouts und visueller Arbeitsablauf-Führung für SecurityOps 2.0.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handlePrint}
            className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-lg shadow-blue-600/20 transition flex items-center gap-1.5"
            title="Druckversion oder PDF-Export"
          >
            <Printer className="w-4 h-4" />
            <span>PDF-Handbuch drucken</span>
          </button>
        </div>
      </div>

      {/* Search and Category Filter Bar */}
      <div className="p-3.5 bg-slate-900/90 rounded-2xl border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
        <div className="relative w-full sm:flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Handbuch durchsuchen (z. B. Mitarbeiter anlegen, Wachbuch, Kontrollgang, Offline)..."
            className="w-full bg-slate-800 text-slate-200 pl-9 pr-3 py-2 rounded-lg border border-slate-700 focus:outline-none focus:border-blue-500"
          />
        </div>

        <span className="text-[11px] text-slate-400 font-mono">
          {filteredChapters.length} Kapitel verfügbar
        </span>
      </div>

      {/* Main Layout: Chapter Directory & Illustrated Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Chapter List Column */}
        <div className="lg:col-span-4 space-y-2.5">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
            Inhaltsverzeichnis:
          </span>

          <div className="space-y-2">
            {filteredChapters.map((chap) => {
              const isActive = selectedChapter.id === chap.id;
              return (
                <div
                  key={chap.id}
                  onClick={() => {
                    setSelectedChapterId(chap.id);
                    setActiveStepIndex(0);
                  }}
                  className={`p-3.5 rounded-xl border cursor-pointer transition flex items-center justify-between ${
                    isActive
                      ? 'bg-blue-600/15 border-blue-500 text-white shadow-md'
                      : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="space-y-1 pr-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs">{chap.title}</span>
                    </div>
                    <p className="text-[10px] text-slate-400 line-clamp-1">{chap.summary}</p>
                    <span className="inline-block text-[9px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-blue-400 font-semibold">
                      {chap.badge}
                    </span>
                  </div>

                  <ChevronRight className={`w-4 h-4 shrink-0 transition-transform ${isActive ? 'text-blue-400 translate-x-1' : 'text-slate-500'}`} />
                </div>
              );
            })}
          </div>
        </div>

        {/* Selected Chapter View with Visual Callouts and Steps */}
        <div className="lg:col-span-8 bg-slate-900 rounded-2xl border border-slate-800 p-5 sm:p-6 space-y-6">
          {/* Chapter Header */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  {selectedChapter.category}
                </span>
                <span className="text-xs font-mono text-slate-400">Modul-Leitfaden</span>
              </div>
              <h2 className="text-lg font-bold text-white mt-1">{selectedChapter.title}</h2>
              <p className="text-xs text-slate-300 mt-1">{selectedChapter.summary}</p>
            </div>

            <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-800 text-slate-300 self-start shrink-0">
              {selectedChapter.badge}
            </span>
          </div>

          {/* Visual Software Screenshot with Dynamic Annotations */}
          <div>
            <div className="flex items-center justify-between mb-2 text-xs">
              <span className="font-bold text-slate-200 flex items-center gap-1.5">
                <MousePointerClick className="w-4 h-4 text-blue-400" />
                <span>Originale Benutzeroberfläche & Markierungen</span>
              </span>
              <span className="text-[11px] text-slate-500 font-mono">Schritt {activeStepIndex + 1} von {selectedChapter.steps.length}</span>
            </div>

            {renderVisualScreenshot(selectedChapter.svgDiagramType)}
          </div>

          {/* Step-By-Step Guidance Carousel */}
          <div className="space-y-3 pt-2">
            <h3 className="font-bold text-sm text-white">Bebilderte Arbeitsschritte:</h3>

            <div className="space-y-2.5">
              {selectedChapter.steps.map((st, idx) => {
                const isCurrent = activeStepIndex === idx;
                return (
                  <div
                    key={st.stepNumber}
                    onClick={() => setActiveStepIndex(idx)}
                    className={`p-3.5 rounded-xl border cursor-pointer transition text-xs flex items-start gap-3 ${
                      isCurrent
                        ? 'bg-blue-600/10 border-blue-500/60 text-white ring-1 ring-blue-500/20'
                        : 'bg-slate-800/40 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className={`w-6 h-6 rounded-full font-bold text-xs flex items-center justify-center shrink-0 mt-0.5 ${
                      isCurrent ? 'bg-blue-600 text-white shadow' : 'bg-slate-800 text-slate-400'
                    }`}>
                      {st.stepNumber}
                    </div>

                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-100">{st.title}</span>
                        <span className="text-[10px] font-mono text-blue-400">{st.calloutTarget}</span>
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed">{st.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Direct Link to Live Module */}
          <div className="p-4 rounded-xl bg-slate-800/60 border border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="text-slate-300">
              <span className="font-semibold text-white block">Dieses Modul direkt ausprobieren?</span>
              <span className="text-[11px] text-slate-400">Wechseln Sie direkt in die laufende Arbeitsansicht der Anwendung.</span>
            </div>

            <button
              onClick={() => {
                if (selectedChapter.id === 'chap-dashboard') setActiveTab('dashboard');
                else if (selectedChapter.id === 'chap-employee') setActiveTab('employees');
                else if (selectedChapter.id === 'chap-guardbook') setActiveTab('guardbook');
                else if (selectedChapter.id === 'chap-mobile') setActiveTab('mobile_app');
                else if (selectedChapter.id === 'chap-keys') setActiveTab('keys');
                else setActiveTab('dashboard');
              }}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold flex items-center gap-1.5 shrink-0 shadow transition"
            >
              <span>Zum Modul wechseln</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
