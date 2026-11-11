import { Request, Response } from 'express';
import { copilotInputSchema, generateIncidentAnalysis, incidentInputSchema, askSecurityCopilot } from '../services/geminiService';
import { env } from '../config/env';

function respondError(res: Response, error: unknown): void {
  const code = error instanceof Error ? error.message : '';
  if (code === 'AI_NOT_CONFIGURED' || !env.GEMINI_API_KEY) {
    res.status(503).json({ success: false, message: 'KI-Funktion ist derzeit nicht konfiguriert.' }); return;
  }
  if (code === 'AI_TIMEOUT') {
    res.status(504).json({ success: false, message: 'Der KI-Dienst hat nicht rechtzeitig geantwortet.' }); return;
  }
  res.status(502).json({ success: false, message: 'Der KI-Dienst ist derzeit nicht verfügbar oder lieferte ein ungültiges Ergebnis.' });
}

export async function analyzeIncident(req: Request, res: Response): Promise<void> {
  const input = incidentInputSchema.safeParse(req.body);
  if (!input.success) { res.status(400).json({ success: false, message: 'Ungültige Eingabe.' }); return; }
  try {
    const data = await generateIncidentAnalysis(input.data);
    res.json({ success: true, message: 'KI-Ergebnis ist ein unverbindlicher Vorschlag und muss geprüft werden.', data });
  } catch (error) { respondError(res, error); }
}

export async function copilot(req: Request, res: Response): Promise<void> {
  const input = copilotInputSchema.safeParse(req.body);
  if (!input.success) { res.status(400).json({ success: false, message: 'Ungültige Eingabe.' }); return; }
  try {
    const answer = await askSecurityCopilot(input.data);
    res.json({ success: true, message: 'KI-Antwort ist ein unverbindlicher Vorschlag und muss geprüft werden.', data: { answer } });
  } catch (error) { respondError(res, error); }
}
