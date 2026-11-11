import { marshall } from '@aws-sdk/util-dynamodb';
import { ShiftEventSchema } from '@staffing/domain';
import { evtSk, META_SK, shiftPk, workerSk } from '@staffing/store';
import type { DynamoDBRecord, DynamoDBStreamEvent } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { createAppSyncPublisher } from './appsync';
import { makePublisher } from './publisher';

const AT = '2026-12-12T22:01:00.000Z';
const PUBLISHED_AT = '2026-12-12T22:01:00.120Z';

const row = {
  id: 'amara',
  name: 'Amara Okafor',
  participation: 'accepted',
  attendance: 'not_started',
  invitedAt: '2026-12-12T21:00:00.000Z',
  respondedAt: AT,
  checkedInAt: null,
  checkedOutAt: null,
  role: 'Worker',
  phone: '+1 416-555-0142',
  email: 'amara.okafor@example.com',
  address: '88 Bathurst St, Toronto, ON M5V 2P5',
  version: 2,
};

/** The item the store writes for one committed change. */
const evtItem = (seq = 7) => ({
  PK: shiftPk('harbourfront-gala'),
  SK: evtSk(seq),
  seq,
  type: 'accept',
  workerId: 'amara',
  actor: 'worker',
  row,
  at: AT,
});

const record = (
  item: Record<string, unknown>,
  eventName: DynamoDBRecord['eventName'] = 'INSERT',
): DynamoDBRecord => ({
  eventName,
  dynamodb: { NewImage: marshall(item, { removeUndefinedValues: true }) as never },
});

const stream = (...records: DynamoDBRecord[]) => ({ Records: records }) as DynamoDBStreamEvent;

describe('publisher Lambda', () => {
  it('turns one stream record into one publish on the shift channel', async () => {
    const publish = vi.fn(async () => {});
    await makePublisher(publish, () => PUBLISHED_AT)(stream(record(evtItem())));

    expect(publish).toHaveBeenCalledTimes(1);
    const [channel, events] = publish.mock.calls[0] as unknown as [string, string[]];
    expect(channel).toBe('/shifts/harbourfront-gala');
    expect(events).toHaveLength(1);
    const body = JSON.parse(events[0]!);
    expect(body).toEqual({
      kind: 'event',
      seq: 7,
      type: 'accept',
      workerId: 'amara',
      row,
      at: AT,
      publishedAt: PUBLISHED_AT,
    });
    expect(ShiftEventSchema.safeParse(body).success).toBe(true);
  });

  it('turns a META insert (a reset) into a reset message with the epoch on the shift channel', async () => {
    const publish = vi.fn(async () => {});
    const pk = shiftPk('harbourfront-gala');
    await makePublisher(publish)(stream(record({ PK: pk, SK: META_SK, seq: 0, epoch: 4 })));
    expect(publish).toHaveBeenCalledWith('/shifts/harbourfront-gala', [
      JSON.stringify({ kind: 'reset', epoch: 4 }),
    ]);
  });

  it('publishes nothing for worker rows, META updates, modifies or removes', async () => {
    const publish = vi.fn(async () => {});
    const pk = shiftPk('harbourfront-gala');
    await makePublisher(publish)(
      stream(
        record({ PK: pk, SK: META_SK, seq: 7, epoch: 1 }, 'MODIFY'),
        record({ PK: pk, SK: META_SK, seq: 7, epoch: 1 }, 'REMOVE'),
        record({ PK: pk, SK: workerSk('amara'), ...row }),
        record({ PK: pk, SK: workerSk('amara'), ...row }, 'REMOVE'),
        record(evtItem(), 'MODIFY'),
        record(evtItem(), 'REMOVE'),
      ),
    );
    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes each record of a batch in order', async () => {
    const publish = vi.fn(async () => {});
    await makePublisher(publish)(stream(record(evtItem(1)), record(evtItem(2))));
    const seqs = publish.mock.calls.map((c) => JSON.parse((c as unknown as [string, string[]])[1][0]!).seq);
    expect(seqs).toEqual([1, 2]);
  });

  it('records the commit-to-publisher and publish timings of each published event (not of resets)', async () => {
    const timings: [string, number][] = [];
    await makePublisher(
      async () => {},
      () => PUBLISHED_AT,
      (name, ms) => timings.push([name, ms]),
    )(stream(record(evtItem()), record({ PK: shiftPk('harbourfront-gala'), SK: META_SK, seq: 0, epoch: 2 })));

    expect(timings.map(([n]) => n)).toEqual(['CommitToPublisher', 'PublishDuration']);
    expect(timings[0]![1]).toBe(120); // PUBLISHED_AT − AT
    expect(timings[1]![1]).toBeGreaterThanOrEqual(0);
  });

  it('fails (so Lambda retries and then dead-letters) when the publish fails', async () => {
    const publish = vi.fn(async () => {
      throw new Error('AppSync down');
    });
    await expect(makePublisher(publish)(stream(record(evtItem())))).rejects.toThrow('AppSync down');
  });
});

describe('AppSync Events publisher', () => {
  const credentials = () => ({
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'secret',
    sessionToken: 'token',
  });

  it('POSTs a SigV4-signed (IAM) request to the HTTP endpoint', async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ successful: [{ index: 0 }], failed: [] })),
    );
    const publish = createAppSyncPublisher({
      httpHost: 'abc.appsync-api.ca-central-1.amazonaws.com',
      region: 'ca-central-1',
      credentials,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await publish('/shifts/harbourfront-gala', ['{"seq":1}']);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://abc.appsync-api.ca-central-1.amazonaws.com/event');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      channel: '/shifts/harbourfront-gala',
      events: ['{"seq":1}'],
    });
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/ca-central-1\/appsync\/aws4_request, SignedHeaders=.*host.*, Signature=[0-9a-f]{64}$/,
    );
    expect(headers['x-amz-security-token']).toBe('token');
    expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
    expect(headers).not.toHaveProperty('host');
  });

  it('throws on an HTTP error or a rejected event', async () => {
    const make = (res: Response) =>
      createAppSyncPublisher({
        httpHost: 'h',
        region: 'ca-central-1',
        credentials,
        fetchFn: (async () => res) as unknown as typeof fetch,
      });
    await expect(make(new Response('denied', { status: 401 }))('/shifts/x', ['{}'])).rejects.toThrow(/401/);
    await expect(
      make(new Response(JSON.stringify({ successful: [], failed: [{ index: 0, code: 400 }] })))('/shifts/x', [
        '{}',
      ]),
    ).rejects.toThrow(/rejected 1 event/);
  });
});
