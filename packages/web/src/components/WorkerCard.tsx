import { ATTENDANCE_LABELS, PARTICIPATION_LABELS, type Worker } from '@staffing/domain';
import type { ReactNode } from 'react';
import { formatTime } from '../lib/time';
import { toneFor, trackerFor, workerSentence } from '../lib/tracker';
import { Card } from './Card';
import { Tracker } from './Tracker';
import { WorkerAvatar } from './WorkerAvatar';

/**
 * One worker as a card (manager page and the worker's own page): their photo and name • status in the header,
 * a sentence about the latest change, the tracker, then status and all four timestamps.
 */
export function WorkerCard({
  worker: w,
  timeZone,
  footer,
  title = w.name,
  /** Test ids for the participation and attendance values (the worker page's own card). */
  testIdPrefix,
  headingLevel,
  /** Tint the card by status (the Manager dashboard does; the worker's own page doesn't). */
  tinted = false,
}: {
  worker: Worker;
  timeZone: string;
  footer?: ReactNode;
  title?: string;
  testIdPrefix?: string;
  headingLevel?: 2 | 3;
  tinted?: boolean;
}) {
  const time = (iso: string | null) => (iso ? formatTime(iso, timeZone) : '—');
  const details: [string, ReactNode, string?][] = [
    ['Participation', PARTICIPATION_LABELS[w.participation], testIdPrefix && `${testIdPrefix}-participation`],
    ['Attendance', ATTENDANCE_LABELS[w.attendance], testIdPrefix && `${testIdPrefix}-attendance`],
    ['Invited', time(w.invitedAt)],
    ['Responded', time(w.respondedAt)],
    ['Checked in', time(w.checkedInAt)],
    ['Checked out', time(w.checkedOutAt)],
  ];
  return (
    <Card
      icon={<WorkerAvatar workerId={w.id} />}
      title={title}
      subtitle={trackerFor(w).label}
      summary={workerSentence(w, timeZone)}
      footer={footer}
      headingLevel={headingLevel}
      tone={tinted ? toneFor(w) : undefined}
    >
      <Tracker worker={w} />
      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
        {details.map(([label, value, testId]) => (
          <div key={label} className="tile px-3 py-2">
            <dt className="text-xs text-muted">{label}</dt>
            <dd data-testid={testId || undefined} className="font-medium tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
