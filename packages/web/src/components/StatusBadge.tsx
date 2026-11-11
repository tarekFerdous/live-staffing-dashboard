import {
  ATTENDANCE_LABELS,
  PARTICIPATION_LABELS,
  type Attendance,
  type Participation,
} from '@staffing/domain';

// Semantic colours only (see index.css); the accent is reserved for actions.
const PARTICIPATION_STYLE: Record<Participation, string> = {
  uninvited: 'chip-neutral',
  invited: 'chip-warn',
  accepted: 'chip-ok',
  declined: 'chip-bad',
  cancelled: 'chip-neutral',
};

const ATTENDANCE_STYLE: Record<Attendance, string> = {
  not_started: 'chip-neutral',
  checked_in: 'chip-info',
  checked_out: 'chip-done',
};

export function ParticipationBadge({ value }: { value: Participation }) {
  return <span className={`chip ${PARTICIPATION_STYLE[value]}`}>{PARTICIPATION_LABELS[value]}</span>;
}

export function AttendanceBadge({ value }: { value: Attendance }) {
  return <span className={`chip ${ATTENDANCE_STYLE[value]}`}>{ATTENDANCE_LABELS[value]}</span>;
}
