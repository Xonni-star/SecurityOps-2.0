import React, { useState } from 'react';
import { Sparkles, Send, Bot, Shield, X, HelpCircle, Loader2 } from 'lucide-react';
import { askSecurityCopilot } from '../geminiService';
import { useSecurityStore } from '../store';

interface AICopilotModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  time: string;
}

export const AICopilotModal: React.FC<AICopilotModalProps> = ({ isOpen, onClose }) => {
  const { sites, shifts, guardBook, employees } = useSecurityStore();

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content:
        'Hallo! Ich bin Ihr **SecurityOps 2.0 KI-Copilot** (Gemini 2.5 Flash). Ich kann Sie bei Schichtkonflikten, DIN 77200 Anforderungen, § 34a GewO Qualifikationen, BMA/EMA Notfallplänen oder behördlichen Vorfallsberichten unterstützen. Wie kann ich helfen?',
      time: 'Jetzt'
    }
  ]);

  if (!isOpen) return null;

  const quickPrompts = [
    'Prüfe Schichtbesetzung auf ArbZG-Ruhezeiten',
    'Wie gehe ich bei BMA-Täuschungsalarm rechtssicher vor?',
    'DIN 77200 Zertifizierung: Welche Nachweise fehlen noch?'
  ];

  const handleSend = async (textToSend?: string) => {
    const query = textToSend || input;
    if (!query.trim() || isLoading) return;

    const userMsg: ChatMessage = {
      role: 'user',
      content: query,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    const context = `
Aktive Objekte: ${sites.length} (${sites.map((s) => s.name).join(', ')})
Mitarbeiter im System: ${employees.length}
Aktive Schichten: ${shifts.length}
Wachbuch-Vorfälle: ${guardBook.length} (Letzter Vorfall: ${guardBook[0]?.title || 'Keiner'})
`;

    const reply = await askSecurityCopilot(query, context);

    const botMsg: ChatMessage = {
      role: 'assistant',
      content: reply,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages((prev) => [...prev, botMsg]);
    setIsLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#0b1329] border border-blue-500/30 rounded-2xl max-w-2xl w-full h-[85vh] flex flex-col shadow-2xl overflow-hidden ring-1 ring-white/10">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 bg-[#0f172a] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
              <Sparkles className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-white">SecurityOps AI Copilot</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  Gemini 2.5 Flash
                </span>
              </div>
              <p className="text-[11px] text-slate-400">DIN 77200 & § 34a GewO Berater</p>
            </div>
          </div>

          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Message Stream */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={`flex gap-2.5 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {m.role === 'assistant' && (
                <div className="w-7 h-7 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center shrink-0 border border-blue-500/30">
                  <Bot className="w-4 h-4" />
                </div>
              )}

              <div
                className={`max-w-[85%] p-3.5 rounded-2xl leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-blue-600 text-white rounded-tr-none'
                    : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-none shadow-sm'
                }`}
              >
                {m.content}
                <div className={`text-[9px] mt-1 text-right ${m.role === 'user' ? 'text-blue-200' : 'text-slate-500'}`}>
                  {m.time}
                </div>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex items-center gap-2 text-slate-400 text-xs pl-9">
              <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
              <span>Sicherheitsanalyst prüft Vorgaben...</span>
            </div>
          )}
        </div>

        {/* Suggested Prompts */}
        <div className="px-4 py-2 border-t border-slate-800/80 bg-slate-950/60 flex items-center gap-2 overflow-x-auto text-[11px]">
          <span className="text-slate-500 shrink-0">Vorschläge:</span>
          {quickPrompts.map((p, idx) => (
            <button
              key={idx}
              onClick={() => handleSend(p)}
              className="px-2.5 py-1 rounded-full bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 shrink-0 text-left transition"
            >
              {p}
            </button>
          ))}
        </div>

        {/* Input bar */}
        <div className="p-3 border-t border-slate-800 bg-[#0a0f1d]">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Frage zu Dienstplan, Rechtsgrundlagen oder Alarmabläufen stellen..."
              className="flex-1 bg-slate-900 text-xs text-slate-200 px-3 py-2.5 rounded-xl border border-slate-800 focus:outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="p-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 transition"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
