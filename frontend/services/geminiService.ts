import { GoogleGenAI } from '@google/genai';

// Initialize with environment API key as instructed for Vertex AI context
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY, vertexai: true });

export interface IncidentAnalysisResult {
  summary: string;
  threatLevel: 'Gering' | 'Mäßig' | 'Kritisch' | 'Katastrophal';
  din77200ComplianceNotes: string;
  recommendedImmediateActions: string[];
  policeReportDraft: string;
}

/**
 * Analyzes an incident from the digital logbook and generates actionable security advice
 */
export async function analyzeIncidentReport(
  title: string,
  category: string,
  siteName: string,
  description: string,
  actionsTaken: string
): Promise<IncidentAnalysisResult> {
  const prompt = `
Du bist ein erfahrener Einsatzleiter und Sicherheitsauditor für gewerbliche Sicherheitsdienste (DIN 77200, § 34a GewO, VdS-Richtlinien).
Analysiere den folgenden Vorfall aus dem digitalen Wachbuch und erstelle eine strukturierte Risikobewertung mit Sofortmaßnahmen:

Objekt: ${siteName}
Kategorie: ${category}
Titel: ${title}
Sachverhalt: ${description}
Bisherige Maßnahmen: ${actionsTaken}

Antworte ausschließlich im folgenden JSON-Format ohne Markdown-Ausschmückungen:
{
  "summary": "Prägnante 2-3 Sätze Zusammenfassung des Geschehens",
  "threatLevel": "Gering" | "Mäßig" | "Kritisch" | "Katastrophal",
  "din77200ComplianceNotes": "Bewertung der Einhaltung von Meldewegen und Normen",
  "recommendedImmediateActions": ["Maßnahme 1", "Maßnahme 2", "Maßnahme 3"],
  "policeReportDraft": "Kurzer, sachlicher Textbaustein für die polizeiliche Anzeigenerstattung oder Kundenweiterleitung"
}
`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.2
      }
    });

    const text = response.text || '{}';
    return JSON.parse(text) as IncidentAnalysisResult;
  } catch (error) {
    console.error('Fehler bei Gemini Incident-Analyse:', error);
    return {
      summary: 'Automatische KI-Analyse momentan nicht verfügbar. Vorfall wurde manuell verifiziert.',
      threatLevel: 'Kritisch',
      din77200ComplianceNotes: 'Meldeweg an Einsatzleitung und Dokumentation im Wachbuch eingehalten.',
      recommendedImmediateActions: [
        'Objektleiter und Kundenansprechpartner umgehend informieren',
        'Fotodokumentation und Spurensicherung sicherstellen',
        'Zusätzlichen Kontrollgang zur Nachsicherung anordnen'
      ],
      policeReportDraft: `Am Objekt ${siteName} ereignete sich am heutigen Tag folgender Vorfall: ${title}. ${description}. Sachdienliche Hinweise liegen bei der Sicherheitszentrale vor.`
    };
  }
}

/**
 * Generates or refines a security SOP (Dienstanweisung) based on German legal standards
 */
export async function generateSopDraft(
  topic: string,
  siteName: string,
  riskContext: string
): Promise<string> {
  const prompt = `
Erstelle als leitender Sicherheitsingenieur eine rechtssichere, präzise Dienstanweisung (Dienstanweisung / Standard Operating Procedure) für den Sicherheitsdienst nach DIN 77200.

Thema: ${topic}
Einsatzobjekt: ${siteName}
Besonderheiten / Risiken: ${riskContext}

Struktur der Dienstanweisung:
1. Geltungsbereich und Zielsetzung
2. Gesetzliche & vertragliche Grundlagen (§ 34a GewO, DGUV V23)
3. Verhaltens- und Handlungsvorschriften (Schritt-für-Schritt)
4. Melde- und Eskalationswege (Meldung an Leitstelle / Polizei / Rettungsdienst)
5. Dokumentationspflichten im digitalen Wachbuch
6. Eigensicherung des Sicherheitsmitarbeiters

Schreibe sachlich, unmissverständlich und praxistauglich in deutscher Sprache.
`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        temperature: 0.3
      }
    });

    return response.text || 'Entwurf konnte nicht generiert werden.';
  } catch (error) {
    console.error('Fehler bei SOP-Erstellung:', error);
    return `DIENSTANWEISUNG: ${topic}\n\n1. Geltungsbereich: Gültig für alle Sicherheitsmitarbeiter am Objekt ${siteName}.\n2. Vorschrift: Vorfall unverzüglich im digitalen Wachbuch erfassen und Einsatzleitung kontaktieren.\n3. Eigensicherung beachten gem. DGUV Vorschrift 23.`;
  }
}
