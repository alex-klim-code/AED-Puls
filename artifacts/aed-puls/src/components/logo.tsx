import { cn } from '@/lib/utils';

/** Znak AED Puls: serce z linią EKG. Wymienny — docelowy znak konkursowy zastąpi ten plik. */
export function LogoMark({ className, title = 'AED Puls' }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn('h-9 w-9 shrink-0', className)} role="img" aria-label={title}>
      <rect width="48" height="48" rx="12" fill="#DC2626" />
      <path
        d="M24 37s-12-7.4-12-16a6.6 6.6 0 0 1 12-3.8A6.6 6.6 0 0 1 36 21c0 8.6-12 16-12 16z"
        fill="none"
        stroke="#F8FAFC"
        strokeWidth="2.8"
        strokeLinejoin="round"
      />
      <path
        d="M8 25h8.5l2.5-5 4 10 3-6.5 1.5 1.5H40"
        fill="none"
        stroke="#F8FAFC"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ className, invert = false }: { className?: string; invert?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className={cn('font-display text-xl font-extrabold leading-none', invert ? 'text-[#F8FAFC]' : 'text-foreground')}>
        AED<span className="text-primary"> Puls</span>
      </span>
    </span>
  );
}
