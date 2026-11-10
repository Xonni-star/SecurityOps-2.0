import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

interface MermaidDiagramProps {
  chart: string;
  id: string;
  className?: string;
}

export const MermaidDiagram: React.FC<MermaidDiagramProps> = ({ chart, id, className = '' }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    try {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        securityLevel: 'loose',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        themeVariables: {
          darkMode: true,
          background: '#090d16',
          primaryColor: '#1e4887',
          primaryTextColor: '#f8fafc',
          primaryBorderColor: '#3b82f6',
          lineColor: '#60a5fa',
          secondaryColor: '#10b981',
          tertiaryColor: '#f59e0b'
        }
      });

      const uniqueId = `mermaid-${id}-${Math.floor(Math.random() * 100000)}`;

      mermaid
        .render(uniqueId, chart.trim())
        .then(({ svg }) => {
          if (isMounted) {
            setSvgContent(svg);
            setRenderError(null);
          }
        })
        .catch((err) => {
          if (isMounted) {
            console.warn('Mermaid rendering fallback:', err);
            setRenderError(String(err));
          }
        });
    } catch (e) {
      if (isMounted) {
        setRenderError(String(e));
      }
    }

    return () => {
      isMounted = false;
    };
  }, [chart, id]);

  if (renderError) {
    return (
      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-400 overflow-x-auto">
        <div className="text-amber-400 font-bold mb-1">Architektur-Diagramm (Textfassung):</div>
        <pre className="text-[11px] leading-relaxed whitespace-pre-wrap">{chart}</pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 overflow-x-auto flex justify-center text-xs ${className}`}
      dangerouslySetInnerHTML={{ __html: svgContent }}
    />
  );
};
