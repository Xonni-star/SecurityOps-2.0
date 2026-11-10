import { GoogleGenAI } from '@google/genai';

// Initialize the official Google Gen AI SDK exclusively with process.env.API_KEY
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY, vertexai: true });

export interface IncidentAnalysisResult {
  formalTitle: string;
  din77200Category: string;
  legalAssessment: string;
  recommendedImmediateActions: string[];
  investigationQuestions: string[];
  formalReportDraft: string;
}

export async function generateIncidentAnalysis(
  rawNotes: string,
  siteName: string,
  guardName: string
): Promise<IncidentAnalysisResult> {
  const prompt = `
Du bist ein erfahrener Sicherheitsjurist und Einsatzleiter eines nach DIN 77200 zertifizierten deutschen Sicherheitsunternehmens.
Analysiere die folgenden stichpunktartigen Notizen einer Sicherheitskraft und erstelle eine professionelle, rechtssichere Vorfallsdokumentation für das digitale Wachbuch.

Objekt: ${siteName}
Protokollierende Sicherheitskraft: ${guardName}
Vorfallsnotizen: "${rawNotes}"

Antworte bitte ausschließlich im validen JSON-Format mit folgenden Schlüsseln:
{
  "formalTitle": "Prägnante, behördentaugliche Überschrift",
  "din77200Category": "Kategorie nach DIN 77200 (z. B. Hausfriedensbruch § 123 StGB, BMA-Täuschungsalarm, Zutrittsverweigerung)",
  "legalAssessment": "Kurze rechtliche Würdigung nach deutschem Recht (Jedermannsrechte § 127 StPO, Notwehr § 32 StGB, Hausrecht § 903 BGB oder GewO)",
  "recommendedImmediateActions": ["Maßnahme 1", "Maßnahme 2", "Maßnahme 3"],
  "investigationQuestions": ["Offene Frage 1", "Offene Frage 2"],
  "formalReportDraft": "Ausführlicher, sachlicher Fließtextbericht in formaler Behördensprache"
}
`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        role: 'user',
        parts: [{ text: prompt }]
      },
      config: {
        responseMimeType: 'application/json'
      }
    });

    const parsed = JSON.parse(response.text || '{}');
    return {
      formalTitle: parsed.formalTitle || 'Sicherheitsrelevantes Vorkommnis',
      din77200Category: parsed.din77200Category || 'Besonderes Ereignis',
      legalAssessment: parsed.legalAssessment || 'Rechtliche Prüfung nach Hausrecht (§ 903 BGB) und § 34a GewO.',
      recommendedImmediateActions: parsed.recommendedImmediateActions || ['Erhöhte Bestreifung', 'Information an Objektleitung'],
      investigationQuestions: parsed.investigationQuestions || ['Wurden Zeugen namentlich erfasst?'],
      formalReportDraft: parsed.formalReportDraft || rawNotes
    };
  } catch (error) {
    console.error('Gemini incident analysis error:', error);
    return {
      formalTitle: 'Meldung zu Sicherheitsvorfall',
      din77200Category: 'Sicherheitsvorfall Vor-Ort',
      legalAssessment: 'Gemäß Hausordnung und Dienstleistungsvertrag (§ 34a GewO).',
      recommendedImmediateActions: ['Objektleiter verständigen', 'Wachbuch-Eintrag finalisieren'],
      investigationQuestions: ['Waren Kameras auf den Bereich gerichtet?'],
      formalReportDraft: `Am Objekt ${siteName} wurde durch ${guardName} folgender Vorfall dokumentiert: ${rawNotes}`
    };
  }
}

export async function askSecurityCopilot(question: string, contextSummary: string): Promise<string> {
  const prompt = `
Du bist "SecurityOps Copilot", der KI-Sicherheitsberater der SecurityOps 2.0 Plattform.
Du unterstützt Einsatzleiter, Objektleiter und Geschäftsführung nach DIN 77200, § 34a GewO, DGUV Vorschrift 23 (Wach- und Sicherungsdienst), Arbeitszeitgesetz (ArbZG) und DSGVO.

Aktueller Systemkontext:
${contextSummary}

Benutzeranfrage:
"${question}"

Antworte präzise, fachkundig, praxisnah und strukturiert auf Deutsch. Nutze Aufzählungspunkte und Markdown-Fettungen für maximale Lesbarkeit im Leitstellenalltag.
`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        role: 'user',
        parts: [{ text: prompt }]
      }
    });

    return response.text || 'Keine Antwort erhalten.';
  } catch (err: any) {
    console.error('Copilot query error:', err);
    return `Fehler bei der Anfrage an SecurityOps Copilot: ${err?.message || 'Verbindung fehlgeschlagen.'}`;
  }
}
