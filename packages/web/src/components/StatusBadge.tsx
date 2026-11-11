import { ATTENDANCE_LABELS, PARTICIPATION_LABELS, type Attendance, type Participation } from '@staffing/domain';

const PARTICIPATION_STYLE: Record<Participation, string> = {
  uninvited: 'bg-slate-100 text-slate-700',
  invited: 'bg-amber-100 text-amber-800',
  accepted: 'bg-emerald-100 text-emerald-800',
  declined: 'bg-rose-100 text-rose-800',
  cancelled: 'bg-slate-200 text-slate-700',
};

const ATTENDANCE_STYLE: Record<Attendance, string> = {
  not_started: 'bg-slate-100 text-slate-700',
  checked_in: 'bg-sky-100 text-sky-800',
  checked_out: 'bg-indigo-100 text-indigo-800',
};

const base = 'inline-block rounded-full px-2 py-0.5 text-xs font-medium';

export function ParticipationBadge({ value }: { value: Participation }) {
  return <span className={`${base} ${PARTICIPATION_STYLE[value]}`}>{PARTICIPATION_LABELS[value]}</span>;
}

export function AttendanceBadge({ value }: { value: Attendance }) {
  return <span className={`${base} ${ATTENDANCE_STYLE[value]}`}>{ATTENDANCE_LABELS[value]}</span>;
}
