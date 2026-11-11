// The handlers depend only on these ports. Each has a cloud adapter and a local one:
//
//   port             cloud                                    local (docker compose)
//   AssignmentStore  DynamoDB                                 DynamoDB Local (same code, other endpoint)
//   ChangeFeed       DynamoDB Streams → Lambda event source   polling DynamoDB Local's stream API
//   Publisher        AppSync Events HTTP publish (SigV4)      in-process `ws` server, same message shape
import type { DynamoDBStreamEvent } from 'aws-lambda';

export type { ShiftStore as AssignmentStore } from '@staffing/store';
export type { Publish as Publisher } from './appsync';

/** Handles one batch of committed table changes (the publisher). Throwing means "retry this batch". */
export type ChangeHandler = (event: DynamoDBStreamEvent) => Promise<void>;

/** Delivers committed table changes, in order per item, to a handler. */
export type ChangeFeed = {
  start(onChanges: ChangeHandler): { stop(): Promise<void> };
};
