import { useId, type ReactNode } from 'react';

/**
 * The shared card shell: a round icon badge and a "Title • Subtitle" header, an optional
 * one-line summary, the body, and an optional footer of full-width pill buttons.
 * It is a region named by its title, so a card can be found by name (tests, screen readers).
 */
export function Card({
  icon,
  title,
  subtitle,
  summary,
  footer,
  className = '',
  headingLevel = 2,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  summary?: ReactNode;
  footer?: ReactNode;
  className?: string;
  headingLevel?: 2 | 3;
  children?: ReactNode;
}) {
  const titleId = useId();
  const Heading = `h${headingLevel}` as const;
  return (
    <section aria-labelledby={titleId} className={`card flex flex-col p-5 ${className}`}>
      <header className="flex items-center gap-3">
        <span className="icon-badge">{icon}</span>
        <div className="min-w-0 text-sm font-semibold">
          <Heading id={titleId} className="inline text-sm font-semibold">
            {title}
          </Heading>
          {subtitle && (
            <>
              <span aria-hidden="true" className="mx-1.5 text-muted">
                •
              </span>
              <span className="font-medium text-muted">{subtitle}</span>
            </>
          )}
        </div>
      </header>
      {summary && <p className="mt-3 text-lg leading-snug font-semibold tracking-tight">{summary}</p>}
      {children && <div className="mt-4 flex-1">{children}</div>}
      {footer && <div className="mt-5 flex flex-col gap-2 [&>*]:w-full">{footer}</div>}
    </section>
  );
}
