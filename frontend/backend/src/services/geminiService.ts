import { z } from 'zod';
import { env } from '../config/env';

export const incidentInputSchema = z.object({
  rawNotes: z.string().trim().min(1).max(8_000),
  siteName: z.string().trim().min(1).max(200),
  guardName: z.string().trim().min(1).max(200)
}).strict();
export const copilotInputSchema = z.object({
  question: z.string().trim().min(1).max(4_000),
  contextSummary: z.string().trim().max(4_000).default('')
}).strict();

const incidentResultSchema = z.object({
  formalTitle: z.string(), din77200Category: z.string(), legalAssessment: z.string(),
  recommendedImmediateActions: z.array(z.string()), investigationQuestions: z.array(z.string()), formalReportDraft: z.string()
});
const MODEL = 'gemini-2.5-flash';

async function generate(prompt: string, json = false): Promise<string> {
  if (!env.GEMINI_API_KEY) throw new Error('AI_NOT_CONFIGURED');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], ...(json ? { generationConfig: { responseMimeType: 'application/json' } } : {}) })
    });
    if (!response.ok) throw new Error('AI_PROVIDER_ERROR');
    const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('');
    if (!text) throw new Error('AI_EMPTY_RESPONSE');
    return text;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('AI_')) throw error;
    throw new Error(error instanceof Error && error.name === 'AbortError' ? 'AI_TIMEOUT' : 'AI_PROVIDER_ERROR');
  } finally { clearTimeout(timeout); }
}

export async function generateIncidentAnalysis(input: z.infer<typeof incidentInputSchema>) {
  const prompt = `Du bist ein erfahrener Sicherheitsjurist und Einsatzleiter eines deutschen Sicherheitsunternehmens. Erstelle einen sachlichen Vorschlag für eine Vorfallsdokumentation. Die Ausgabe ist unverbindlich und muss fachlich geprüft werden.\nObjekt: ${input.siteName}\nSicherheitskraft: ${input.guardName}\nNotizen: ${input.rawNotes}\nAntworte ausschließlich als JSON mit formalTitle, din77200Category, legalAssessment, recommendedImmediateActions (Array), investigationQuestions (Array), formalReportDraft.`;
  const result = incidentResultSchema.safeParse(JSON.parse(await generate(prompt, true)));
  if (!result.success) throw new Error('AI_INVALID_RESPONSE');
  return result.data;
}

export async function askSecurityCopilot(input: z.infer<typeof copilotInputSchema>): Promise<string> {
  return generate(`Du bist SecurityOps Copilot. Antworte präzise, fachkundig, praxisnah und strukturiert auf Deutsch. Kennzeichne die Antwort als unverbindlichen Vorschlag.\nSystemkontext:\n${input.contextSummary}\nBenutzerfrage:\n${input.question}`);
}
