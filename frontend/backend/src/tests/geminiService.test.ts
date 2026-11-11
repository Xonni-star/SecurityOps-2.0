jest.mock('../config/env', () => ({ env: { GEMINI_API_KEY: 'test-only-key' } }));
import { askSecurityCopilot, copilotInputSchema, generateIncidentAnalysis, incidentInputSchema } from '../services/geminiService';
import { env } from '../config/env';

const goodAnalysis = {
  formalTitle: 'Vorfall', din77200Category: 'Vorkommnis', legalAssessment: 'Prüfen',
  recommendedImmediateActions: ['Dokumentieren'], investigationQuestions: ['Wer war anwesend?'], formalReportDraft: 'Entwurf'
};
const mockedFetch = jest.fn();
global.fetch = mockedFetch as typeof fetch;

describe('Gemini-Service', () => {
  beforeEach(() => { mockedFetch.mockReset(); });

  it('validiert Eingaben und lehnt übergroße/unerwartete Felder ab', () => {
    expect(incidentInputSchema.safeParse({ rawNotes: '', siteName: 'A', guardName: 'B' }).success).toBe(false);
    expect(incidentInputSchema.safeParse({ rawNotes: 'x'.repeat(8001), siteName: 'A', guardName: 'B' }).success).toBe(false);
    expect(copilotInputSchema.safeParse({ question: 'Hallo', contextSummary: '', tenantId: 'forged' }).success).toBe(false);
  });

  it('liefert strukturierte Vorfallsanalyse und verwendet das serverseitige Secret', async () => {
    mockedFetch.mockResolvedValue({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(goodAnalysis) }] } }] }) });
    await expect(generateIncidentAnalysis({ rawNotes: 'Notiz', siteName: 'Objekt', guardName: 'Kraft' })).resolves.toEqual(goodAnalysis);
    expect(mockedFetch.mock.calls[0][0]).toContain('gemini-2.5-flash');
    expect(mockedFetch.mock.calls[0][1].headers['x-goog-api-key']).toBe('test-only-key');
  });

  it('liefert Copilot-Antwort und behandelt Providerfehler/Timeouts ohne Secretdetails', async () => {
    mockedFetch.mockResolvedValue({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Antwort auf Deutsch' }] } }] }) });
    await expect(askSecurityCopilot({ question: 'Was tun?', contextSummary: '' })).resolves.toBe('Antwort auf Deutsch');
    mockedFetch.mockResolvedValue({ ok: false, status: 403, text: async () => 'secret leaked upstream' });
    await expect(askSecurityCopilot({ question: 'Frage', contextSummary: '' })).rejects.toThrow('AI_PROVIDER_ERROR');
    mockedFetch.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await expect(askSecurityCopilot({ question: 'Frage', contextSummary: '' })).rejects.toThrow('AI_TIMEOUT');
  });

  it('verweigert Aufrufe ohne API-Konfiguration', async () => {
    (env as { GEMINI_API_KEY?: string }).GEMINI_API_KEY = undefined;
    await expect(askSecurityCopilot({ question: 'Frage', contextSummary: '' })).rejects.toThrow('AI_NOT_CONFIGURED');
    (env as { GEMINI_API_KEY?: string }).GEMINI_API_KEY = 'test-only-key';
  });
});
