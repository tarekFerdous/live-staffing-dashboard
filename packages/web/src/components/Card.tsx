import { useId, type ReactNode } from 'react';
import type { Tone } from '../lib/tracker';

/**
 * The shared card shell: a round icon badge and a "Title • Subtitle" header, an optional
 * one-line summary, the body, and an optional footer of full-width pill buttons.
 * It is a region named by its title, so a card can be found by name (tests, screen readers).
 *
 * With `media` (a decorative image), the media runs edge to edge from the top of the card and
 * grows to fill the card's free height (at least 160 px); the header sits on it in white, over
 * a blurred, softly darkened top band, and the body follows on the normal card surface.
 */
export function Card({
  icon,
  title,
  subtitle,
  summary,
  footer,
  media,
  tone,
  className = '',
  bodyClassName = '',
  headingLevel = 2,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  summary?: ReactNode;
  footer?: ReactNode;
  /** A decorative image (hidden from assistive tech) shown full-bleed under the header. */
  media?: ReactNode;
  /** A status tint (soft wash and ring), exposed as `data-tone`; leave out for an untinted card. */
  tone?: Tone;
  className?: string;
  /** Extra classes for the body wrapper (e.g. to let it shrink and scroll). */
  bodyClassName?: string;
  headingLevel?: 2 | 3;
  children?: ReactNode;
}) {
  const titleId = useId();
  const Heading = `h${headingLevel}` as const;
  const onMedia = media !== undefined;
  const header = (
    <header className={`flex items-center gap-3 ${onMedia ? 'relative p-5 text-white' : ''}`}>
      <span className={onMedia ? 'icon-badge icon-badge-on-media' : 'icon-badge'}>{icon}</span>
      <div className={`min-w-0 text-sm font-semibold ${onMedia ? 'text-shadow-on-media' : ''}`}>
        <Heading id={titleId} className="inline text-sm font-semibold">
          {title}
        </Heading>
        {subtitle && (
          <>
            <span aria-hidden="true" className={`mx-1.5 ${onMedia ? 'text-white/80' : 'text-muted'}`}>
              •
            </span>
            <span className={`font-medium ${onMedia ? 'text-white/90' : 'text-muted'}`}>{subtitle}</span>
          </>
        )}
      </div>
    </header>
  );
  return (
    <section aria-labelledby={titleId} data-tone={tone} className={`card flex flex-col p-5 ${className}`}>
      {onMedia ? (
        <div
          data-testid="card-media"
          className="relative -mx-5 -mt-5 flex min-h-40 flex-1 flex-col overflow-hidden rounded-t-[var(--card-radius)]"
        >
          <div
            aria-hidden="true"
            className="absolute inset-0 [&>img]:h-full [&>img]:w-full [&>img]:object-cover"
          >
            {media}
          </div>
          {/* Blur that fades out downwards, and a soft dark gradient, so the white header reads. */}
          <div aria-hidden="true" className="media-scrim absolute inset-x-0 top-0 h-24" />
          {header}
        </div>
      ) : (
        header
      )}
      {summary && <p className="mt-3 text-lg leading-snug font-semibold tracking-tight">{summary}</p>}
      {children && <div className={`mt-4 ${onMedia ? '' : 'flex-1'} ${bodyClassName}`}>{children}</div>}
      {footer && <div className="mt-5 flex flex-col gap-2 [&>*]:w-full">{footer}</div>}
    </section>
  );
}
