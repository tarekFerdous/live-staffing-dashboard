export const PARTICIPATIONS = ['uninvited', 'invited', 'accepted', 'declined', 'cancelled'] as const;
export type Participation = (typeof PARTICIPATIONS)[number];

export const ATTENDANCES = ['not_started', 'checked_in', 'checked_out'] as const;
export type Attendance = (typeof ATTENDANCES)[number];

export const PARTICIPATION_LABELS: Record<Participation, string> = {
  uninvited: 'Uninvited',
  invited: 'Invited',
  accepted: 'Accepted',
  declined: 'Declined',
  cancelled: 'Cancelled',
};

export const ATTENDANCE_LABELS: Record<Attendance, string> = {
  not_started: 'Not started',
  checked_in: 'Checked in',
  checked_out: 'Checked out',
};
