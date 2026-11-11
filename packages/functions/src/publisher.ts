import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { ShiftEventSchema, type ShiftEventMessage } from '@staffing/domain';
import { EVT_PREFIX } from '@staffing/store';
import type { DynamoDBRecord, DynamoDBStreamEvent } from 'aws-lambda';
import type { Publish } from './appsync';

const SHIFT_PREFIX = 'SHIFT#';

/** The channel every page showing this shift subscribes to. */
export const shiftChannel = (shiftId: string) => `/shifts/${shiftId}`;

/** Turns one stream record into `{ channel, message }`, or null when it is not a new event item. */
export function toMessage(record: DynamoDBRecord, publishedAt: string) {
  if (record.eventName !== 'INSERT' || !record.dynamodb?.NewImage) return null;
  const item = unmarshall(record.dynamodb.NewImage as Record<string, AttributeValue>);
  if (typeof item.SK !== 'string' || !item.SK.startsWith(EVT_PREFIX)) return null;
  if (typeof item.PK !== 'string' || !item.PK.startsWith(SHIFT_PREFIX)) return null;

  const message: ShiftEventMessage = ShiftEventSchema.parse({
    seq: item.seq,
    type: item.type,
    workerId: item.workerId,
    row: item.row,
    at: item.at,
    publishedAt,
  });
  return { channel: shiftChannel(item.PK.slice(SHIFT_PREFIX.length)), message };
}

/**
 * DynamoDB Stream → AppSync Events. The event source mapping already filters to
 * `INSERT`s of `EVT#` items (only committed transactions reach the stream); the
 * check is repeated here so a mapping change can never leak other items.
 * A failed publish throws, so Lambda retries, bisects and finally sends the record to the DLQ.
 */
export function makePublisher(publish: Publish, now: () => string = () => new Date().toISOString()) {
  return async (event: DynamoDBStreamEvent): Promise<void> => {
    for (const record of event.Records) {
      const out = toMessage(record, now());
      if (out) await publish(out.channel, [JSON.stringify(out.message)]);
    }
  };
}
