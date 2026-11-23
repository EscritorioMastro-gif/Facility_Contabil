import { useRef, useState } from 'react';
import { acordarLeitor } from '@/lib/acordarLeitor';
import { IconArquivo, IconRecarregar, IconUpload, IconX } from './icons';

const ACCEPT = '.pdf,.ofx,.qfx,.csv,.txt,.xls,.xlsx';

function tamanho(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

export function FileDrop({
  file,
  onFile,
  accept = ACCEPT,
  titulo = 'Arraste o extrato aqui ou clique para escolher',
  formatos = 'PDF, OFX, CSV, XLS ou XLSX',
}: {
  file: File | null;
  onFile: (f: File | null) => void;
  accept?: string;
  titulo?: string;
  formatos?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  // escolheu o arquivo: o leitor vai acordando enquanto a pessoa preenche o resto
  const escolher = (f: File | null) => {
    if (f) acordarLeitor();
    onFile(f);
  };
  const abrir = () => inputRef.current?.click();
  const ext = file?.name.split('.').pop()?.toUpperCase() ?? '';

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={file ? `Arquivo escolhido: ${file.name}. Enter para trocar.` : titulo}
      onClick={abrir}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          abrir();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) escolher(f);
      }}
      className={`group relative cursor-pointer overflow-hidden rounded-2xl border-2 border-dashed text-sm transition-all duration-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-300/40 ${
        over
          ? 'scale-[1.01] border-brand-400 bg-brand-50 shadow-glow'
          : file
            ? 'border-brand-300 bg-brand-50/40'
            : 'border-brand-200 bg-white/60 hover:border-brand-400 hover:bg-brand-50/50'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          escolher(e.target.files?.[0] ?? null);
          // permite escolher o mesmo arquivo de novo depois de remover
          e.target.value = '';
        }}
      />
      <div className="bg-grid-light pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)] group-hover:opacity-100" />

      {file ? (
        <div className="relative flex items-center gap-4 px-5 py-5">
          <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white text-brand-600 shadow-card ring-1 ring-brand-200">
            <IconArquivo className="h-6 w-6" />
            {ext && (
              <span className="absolute -bottom-1.5 -right-1.5 rounded-md bg-brand-700 px-1 font-mono text-[9px] font-semibold text-white">
                {ext}
              </span>
            )}
          </span>
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate font-semibold text-slate-800" title={file.name}>
              {file.name}
            </p>
            <p className="text-xs text-slate-500">{tamanho(file.size)} · pronto para ler</p>
          </div>
          <span className="hidden items-center gap-1 text-xs font-semibold text-brand-600 sm:inline-flex">
            <IconRecarregar className="h-3.5 w-3.5" /> trocar
          </span>
          <button
            type="button"
            title="Remover arquivo"
            aria-label="Remover arquivo"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
            onClick={(e) => {
              e.stopPropagation();
              onFile(null);
            }}
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="relative flex flex-col items-center justify-center px-6 py-9 text-center">
          <span
            className={`grid h-14 w-14 place-items-center rounded-2xl transition-all duration-200 ${
              over
                ? 'bg-brand-700 text-white shadow-glow'
                : 'bg-white text-brand-600 shadow-card ring-1 ring-brand-200 group-hover:-translate-y-0.5 group-hover:text-brand-700'
            }`}
          >
            <IconUpload className="h-6 w-6" />
          </span>
          <p className="mt-3.5 font-semibold text-slate-700">{over ? 'Pode soltar o arquivo' : titulo}</p>
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            {formatos
              .split(/,| ou /)
              .map((f) => f.trim())
              .filter(Boolean)
              .map((f) => (
                <span key={f} className="rounded-md bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-500 ring-1 ring-brand-200">
                  {f}
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
