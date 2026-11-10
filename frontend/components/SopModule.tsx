import React, { useState } from 'react';
import { FileCheck2, Plus, Sparkles, CheckCircle2, FileSignature, ShieldCheck } from 'lucide-react';
import { store } from '../services/store';
import { SopInstruction } from '../types';
import { generateSopDraft } from '../services/geminiService';

export const SopModule: React.FC = () => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAiDraftModal, setShowAiDraftModal] = useState(false);
  const [aiTopic, setAiTopic] = useState('Zutrittskontrolle bei erhöhtem Terrorwarnstatus');
  const [aiSite, setAiSite] = useState('FinTech Tower Rechenzentrum');
  const [aiRisk, setAiRisk] = useState('Biometrie-Schleuse, KRITIS-Einstufung, externe Techniker');
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [aiGeneratedText, setAiGeneratedText] = useState('');

  // Standard Form
  const [code, setCode] = useState('DA-OBJ-05');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<SopInstruction['category']>('Objektspezifisch');
  const [content, setContent] = useState('');
  const [applicableSite, setApplicableSite] = useState('Alle Objekte');

  const sops = store.sops;

  const handleGenerateAiSop = async () => {
    setIsAiGenerating(true);
    try {
      const draft = await generateSopDraft(aiTopic, aiSite, aiRisk);
      setAiGeneratedText(draft);
      setContent(draft);
      setTitle(aiTopic);
    } catch (e) {
      console.error(e);
    } finally {
      setIsAiGenerating(false);
    }
  };

  const handleSaveSop = (e: React.FormEvent) => {
    e.preventDefault();
    store.addSop({
      code,
      title,
      category,
      version: '1.0',
      applicableSite,
      author: 'Einsatzleitung (Leitstand)',
      content,
      requiresDigitalSignature: true,
      totalRequiredGuards: 24
    });
    setShowAddModal(false);
    setShowAiDraftModal(false);
    setAiGeneratedText('');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 p-4 rounded-2xl border border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <FileCheck2 className="w-5 h-5 text-brand-400" />
            <h2 className="text-base font-bold text-white">Dienstanweisungen & Qualitätsmanagement (QM)</h2>
            <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono">
              DIN 77200 Zertifiziert
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Verbindliche Arbeits- und Notfallanweisungen mit digitaler Lesebestätigung und Revisionsverlauf.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAiDraftModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-brand-600 hover:from-indigo-500 hover:to-brand-500 text-white text-xs font-semibold shadow-md shadow-brand-900/40"
          >
            <Sparkles className="w-4 h-4 text-amber-300" />
            <span>KI-Dienstanweisung erstellen</span>
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700"
          >
            <Plus className="w-4 h-4" />
            <span>Manuell anlegen</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {sops.map((sop) => {
          const quota = Math.round((sop.acknowledgedCount / sop.totalRequiredGuards) * 100);
          return (
            <div key={sop.id} className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-brand-400 bg-brand-500/10 px-2.5 py-1 rounded border border-brand-500/20">
                    {sop.code}
                  </span>
                  <span className="text-xs font-bold text-white text-sm">{sop.title}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                    Version {sop.version}
                  </span>
                </div>
                <span className="text-xs text-slate-400">Gültig für: {sop.applicableSite}</span>
              </div>

              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 text-xs text-slate-300 leading-relaxed font-sans whitespace-pre-wrap max-h-48 overflow-y-auto">
                {sop.content}
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-800 text-xs">
                <div className="flex items-center gap-3">
                  <span className="text-slate-400">
                    Lesebestätigungen:{' '}
                    <strong className="text-white">
                      {sop.acknowledgedCount} / {sop.totalRequiredGuards}
                    </strong>{' '}
                    ({quota}%)
                  </span>
                  <div className="w-24 bg-slate-800 h-2 rounded-full overflow-hidden">
                    <div className="bg-brand-500 h-full rounded-full" style={{ width: `${quota}%` }} />
                  </div>
                </div>

                <button
                  onClick={() => store.acknowledgeSop(sop.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-950 border border-emerald-700/60 text-emerald-300 hover:bg-emerald-900 text-xs font-semibold"
                >
                  <FileSignature className="w-3.5 h-3.5" />
                  <span>Jetzt digital quittieren</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* AI Draft Generator Modal */}
      {showAiDraftModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-2xl rounded-2xl p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-300" />
                <h3 className="font-bold text-white text-base">
                  KI-Dienstanweisungsgenerator nach DIN 77200
                </h3>
              </div>
              <button
                onClick={() => setShowAiDraftModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-slate-400 mb-1">Gegenstand der Anweisung</label>
                <input
                  type="text"
                  value={aiTopic}
                  onChange={(e) => setAiTopic(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Einsatzobjekt</label>
                <input
                  type="text"
                  value={aiSite}
                  onChange={(e) => setAiSite(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Besondere Risiken & Verhaltensregeln</label>
                <input
                  type="text"
                  value={aiRisk}
                  onChange={(e) => setAiRisk(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                />
              </div>

              <button
                type="button"
                onClick={handleGenerateAiSop}
                disabled={isAiGenerating}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-brand-600 text-white font-semibold flex items-center justify-center gap-2 shadow-lg"
              >
                {isAiGenerating ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Gemini formuliert normkonforme Dienstanweisung...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-amber-300" />
                    <span>Rechtssicheren Entwurf jetzt generieren</span>
                  </>
                )}
              </button>

              {aiGeneratedText && (
                <div className="space-y-2 pt-2">
                  <label className="block text-slate-400 font-bold">Generierter Entwurf (Bearbeitbar):</label>
                  <textarea
                    rows={8}
                    value={aiGeneratedText}
                    onChange={(e) => {
                      setAiGeneratedText(e.target.value);
                      setContent(e.target.value);
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-200 font-sans leading-relaxed"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={handleSaveSop}
                      className="px-4 py-2 rounded-xl bg-brand-600 text-white font-semibold hover:bg-brand-500"
                    >
                      Dienstanweisung offiziell freigeben & veröffentlichen
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
