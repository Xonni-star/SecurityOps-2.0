import { apiClient } from './services/apiClient';

export interface IncidentAnalysisResult {
  formalTitle: string;
  din77200Category: string;
  legalAssessment: string;
  recommendedImmediateActions: string[];
  investigationQuestions: string[];
  formalReportDraft: string;
}

export async function generateIncidentAnalysis(rawNotes: string, siteName: string, guardName: string): Promise<IncidentAnalysisResult> {
  return apiClient.post<IncidentAnalysisResult>('/ai/incident-analysis', { rawNotes, siteName, guardName });
}

export async function askSecurityCopilot(question: string, contextSummary: string): Promise<string> {
  const result = await apiClient.post<{ answer: string }>('/ai/copilot', { question, contextSummary });
  return result.answer;
}
