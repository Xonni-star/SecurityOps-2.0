# SECURITYOPS 2.0 – MODULARE SOFTWAREARCHITEKTUR (PHASE 1)

## 1. Modulare Gliederung & Abhängigkeitsgraph (DAG)

```mermaid
graph TD
    Kernel["Core: App Kernel, Auth & Tenant Context"]
    
    subgraph Layer1 ["Fundamentale Stammdaten"]
        ModClients["Modul: Kunden & Verträge"]
        ModSites["Modul: KRITIS-Objekte & Kontrollpunkte"]
        ModHR["Modul: Personalstamm & §34a GewO"]
        ModOffline["Modul: Offline-First Sync Engine"]
    end

    subgraph Layer2 ["Operative Einsatzleitung"]
        ModDispo["Modul: Dienst- & Schichtplanung"]
        ModWachbuch["Modul: Digitales Wachbuch & Vorfälle"]
    end

    subgraph Layer3 ["Sicherheitsdienste & QM"]
        ModKeys["Modul: Schlüssel & Zutritt"]
        ModAlarms["Modul: Alarm- & Notfallpläne"]
        ModQM["Modul: Dienstanweisungen & Signatur"]
        ModTasks["Modul: Aufgaben & Maßnahmen"]
    end

    subgraph Layer4 ["Erweiterungen & KI"]
        ModAI["Modul: Gemini KI-Copilot & Lagezentrum"]
        ModReports["Modul: Revisionsberichte & Export"]
    end

    Kernel --> Layer1
    ModClients --> ModSites
    ModSites --> ModDispo
    ModHR --> ModDispo
    ModDispo --> ModWachbuch
    ModOffline --> ModWachbuch
    ModSites --> ModWachbuch
    ModWachbuch --> Layer3
    Layer3 --> Layer4
```

---

## 2. Modul-Interface & Lifecycle-Vertrag

Jedes Fachmodul implementiert das standardisierte Python Interface:

```python
# backend/app/core/base_module.py
from abc import ABC, abstractmethod
from fastapi import FastAPI

class SecurityOpsModuleInterface(ABC):
    @property
    @abstractmethod
    def module_id(self) -> str:
        """Eindeutige Modul-ID, z.B. 'mod-wachbuch'"""
        pass

    @property
    @abstractmethod
    def version(self) -> str:
        """SemVer Version des Moduls"""
        pass

    @abstractmethod
    def register_routes(self, app: FastAPI) -> None:
        """Registriert Modul-Router unter /api/v1/{module}"""
        pass

    @abstractmethod
    def register_events(self, event_bus) -> None:
        """Abonniert globale Systemereignisse"""
        pass
```
