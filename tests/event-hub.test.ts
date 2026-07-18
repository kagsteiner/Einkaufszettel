import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import test from "node:test";
import { EventHub } from "../src/server/event-hub.ts";

test("closing the event hub ends active live-update responses", () => {
  const request = new EventEmitter() as IncomingMessage;
  const writes: string[] = [];
  let ended = false;
  const response = {
    end: () => {
      ended = true;
    },
    write: (value: string) => {
      writes.push(value);
      return true;
    },
    writeHead: () => response,
  } as unknown as ServerResponse;
  const eventHub = new EventHub();

  eventHub.subscribe("household", request, response);
  assert.equal(writes.length, 1);

  eventHub.close();
  eventHub.publish("household");

  assert.equal(ended, true);
  assert.equal(writes.length, 1);
});
