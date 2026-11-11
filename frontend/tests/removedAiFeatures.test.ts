import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Produktumfang ohne optionale Sprachmodellfunktionen', () => {
  test('Navbar und App enthalten keinen Copilot-Einstieg oder Dialog', () => {
    const app = source('App.tsx');
    const navbar = source('components/Navbar.tsx');
    expect(app).not.toMatch(/AICopilotModal|isCopilotOpen|onOpenCopilot/);
    expect(navbar).not.toMatch(/Copilot|KI-Assistent|Sparkles/);
  });

  test('Wachbuch behält die manuelle Eingabe und enthält keine Analyse-Schaltfläche', () => {
    const guardbook = source('components/GuardBookModule.tsx');
    expect(guardbook).toContain('addGuardBookEntry');
    expect(guardbook).toContain('Detaillierter Sachverhalt');
    expect(guardbook).toContain('onSubmit={handleSubmit}');
    expect(guardbook).not.toMatch(/generateIncidentAnalysis|isAnalyzing|KI-Vorschlag|Gemini|Sparkles/);
  });

  test('Umgebung, Compose und Frontend-Abhängigkeiten enthalten keine Modell-Secret-Konfiguration', () => {
    expect(source('backend/.env.example')).not.toMatch(/GEMINI_API_KEY/);
    expect(source('deploy/.env.example')).not.toMatch(/GEMINI_API_KEY/);
    expect(source('deploy/docker-compose.production.yml')).not.toMatch(/GEMINI_API_KEY|generativelanguage|aiplatform/);
    expect(source('deploy/Caddyfile')).not.toMatch(/generativelanguage|aiplatform|api\.openai\.com/);
    expect(source('package.json')).not.toMatch(/@google\/genai|google-auth-library|openai/);
  });
});
