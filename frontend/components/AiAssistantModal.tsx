import React, { useState } from 'react';
import { Sparkles, Send, Bot, Shield, X, CheckCircle, AlertTriangle } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';

interface AiAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Message {
  role: 'user' | 'assistant';
  text: string;
}

export const AiAssistantModal: React.FC<AiAssistantModalProps> = ({ isOpen, onClose }) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      text: 'Guten Tag, Einsatzleitung! Ich bin Ihr SecurityOps 2.0 KI-Copilot. Ich unterstütze Sie bei der Lagebeurteilung, DIN 77200 Richtlinien, Qualifikationsprüfungen nach § 34a GewO und der rechtssicheren Formulierung von Dienstanweisungen. Wie kann ich helfen?'
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text: userMessage }]);
    setLoading(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY, vertexai: true });
      const prompt = `
Du bist der leitende KI-Sicherheitsberater und Einsatzleiter in der Sicherheitsdienstverwaltung SecurityOps 2.0.
Du kennst DIN 77200, die Bewachungsverordnung (BewachV), § 34a GewO, DGUV Vorschrift 23 (Wach- und Sicherungsdienst), VdS-Richtlinien und DSGVO.
Antworte präzise, sachlich, professionell und handlungsorientiert auf Deutsch.

Benutzeranfrage:
${userMessage}
`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt
      });

      const reply = response.text || 'Entschuldigung, ich konnte keine Antwort generieren.';
      setMessages((prev) => [...prev, { role: 'assistant', text: reply }]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: 'Fehler bei der Verbindung zum KI-Sicherheitsmodell. Bitte prüfen Sie die Netzwerkanbindung.'
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col h-[600px] overflow-hidden">
        {/* Header */}
        <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500 to-brand-600 text-white">
              <Sparkles className="w-4 h-4 text-amber-300 animate-pulse" />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">SecurityOps KI-Einsatzberater</h3>
              <p className="text-[11px] text-slate-400">Gemini 2.5 Flash • DIN 77200 & § 34a GewO Assistent</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Message Area */}
        <div className="flex-1 p-4 overflow-y-auto space-y-3 text-xs">
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={`flex items-start gap-2.5 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {m.role === 'assistant' && (
                <div className="p-1.5 rounded-lg bg-indigo-900/60 border border-indigo-700/50 text-indigo-200 shrink-0">
                  <Bot className="w-4 h-4" />
                </div>
              )}
              <div
                className={`p-3 rounded-2xl max-w-[85%] leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-brand-600 text-white rounded-tr-none'
                    : 'bg-slate-950 border border-slate-800 text-slate-200 rounded-tl-none whitespace-pre-wrap'
                }`}
              >
                {m.text}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-xs text-brand-300 font-mono py-2">
              <div className="w-3.5 h-3.5 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
              <span>KI analysiert Rechtsgrundlagen & Sicherheitslage...</span>
            </div>
          )}
        </div>

        {/* Quick suggestions */}
        <div className="px-4 py-2 bg-slate-950/80 border-t border-slate-800/80 flex gap-2 overflow-x-auto text-[11px]">
          <button
            onClick={() => setInput('Welche Pflichtausrüstung verlangt die DGUV Vorschrift 23 für Nachtstreifen?')}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 whitespace-nowrap"
          >
            DGUV V23 Nachtstreife
          </button>
          <button
            onClick={() => setInput('Wie gehe ich bei einer Meldegruppenauslösung einer BMA nach VdS vor?')}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 whitespace-nowrap"
          >
            BMA Melderauslösung
          </button>
          <button
            onClick={() => setInput('Erstelle mir eine Checkliste für die Schichtübergabe an der Pforte.')}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 whitespace-nowrap"
          >
            Schichtübergabe Checkliste
          </button>
        </div>

        {/* Input Form */}
        <form onSubmit={handleSend} className="p-3 bg-slate-950 border-t border-slate-800 flex gap-2">
          <input
            type="text"
            placeholder="Fragen zur Einsatzleitung, Wachbuch, Vorschriften eingeben..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-brand-500"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold disabled:opacity-50 flex items-center gap-1.5"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Senden</span>
          </button>
        </form>
      </div>
    </div>
  );
};
