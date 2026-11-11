import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import {
  ResetMessageSchema,
  ShiftEventSchema,
  type ResetMessage,
  type ShiftEventMessage,
} from '@staffing/domain';
import { EVT_PREFIX, META_SK } from '@staffing/store';
import type { DynamoDBRecord, DynamoDBStreamEvent } from 'aws-lambda';
import type { Publish } from './appsync';
import type { RecordTiming } from './metrics';

const SHIFT_PREFIX = 'SHIFT#';

/** The channel every page showing this shift subscribes to. */
export const shiftChannel = (shiftId: string) => `/shifts/${shiftId}`;

type Out =
  | { channel: string; message: ShiftEventMessage & { kind: 'event' } }
  | { channel: string; message: ResetMessage };

/**
 * Turns one stream record into `{ channel, message }`, or null when it is neither a new
 * event item nor a new META item. A META insert only happens when a reset writes the shift
 * back (actions update META, they never insert it), so it becomes `{ kind: 'reset', epoch }`.
 */
export function toMessage(record: DynamoDBRecord, publishedAt: string): Out | null {
  if (record.eventName !== 'INSERT' || !record.dynamodb?.NewImage) return null;
  const item = unmarshall(record.dynamodb.NewImage as Record<string, AttributeValue>);
  if (typeof item.PK !== 'string' || !item.PK.startsWith(SHIFT_PREFIX)) return null;
  const channel = shiftChannel(item.PK.slice(SHIFT_PREFIX.length));

  if (item.SK === META_SK) {
    return { channel, message: ResetMessageSchema.parse({ kind: 'reset', epoch: item.epoch }) };
  }
  if (typeof item.SK !== 'string' || !item.SK.startsWith(EVT_PREFIX)) return null;

  const message = ShiftEventSchema.parse({
    kind: 'event',
    seq: item.seq,
    type: item.type,
    workerId: item.workerId,
    row: item.row,
    at: item.at,
    publishedAt,
    epoch: item.epoch,
  }) as ShiftEventMessage & { kind: 'event' };
  return { channel, message };
}

/**
 * DynamoDB Stream → AppSync Events. The event source mapping already filters to
 * `INSERT`s of `EVT#` items and of `META` (only committed transactions reach the stream);
 * the check is repeated here so a mapping change can never leak other items.
 * A failed publish throws, so Lambda retries, bisects and finally sends the record to the DLQ.
 */
export function makePublisher(
  publish: Publish,
  now: () => string = () => new Date().toISOString(),
  /** Per-hop timings for the measurements (see metrics.ts). */
  recordTiming: RecordTiming = () => {},
) {
  return async (event: DynamoDBStreamEvent): Promise<void> => {
    for (const record of event.Records) {
      const publishedAt = now();
      const out = toMessage(record, publishedAt);
      if (!out) continue;
      const { message } = out;
      const isEvent = message.kind === 'event';
      if (message.kind === 'event')
        recordTiming('CommitToPublisher', Date.parse(publishedAt) - Date.parse(message.at));
      const start = performance.now();
      await publish(out.channel, [JSON.stringify(out.message)]);
      if (isEvent) recordTiming('PublishDuration', performance.now() - start);
    }
  };
}
