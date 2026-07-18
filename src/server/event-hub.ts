import type { IncomingMessage, ServerResponse } from "node:http";

type Subscription = Readonly<{
  heartbeat: NodeJS.Timeout;
  response: ServerResponse;
}>;

export class EventHub {
  private readonly subscriptions = new Map<string, Set<Subscription>>();
  private revision = 0;

  close(): void {
    for (const householdSubscriptions of this.subscriptions.values()) {
      for (const subscription of householdSubscriptions) {
        clearInterval(subscription.heartbeat);
        subscription.response.end();
      }
    }
    this.subscriptions.clear();
  }

  subscribe(householdId: string, request: IncomingMessage, response: ServerResponse): void {
    response.writeHead(200, {
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    });
    response.write(
      `retry: 2000\nevent: ready\ndata: ${JSON.stringify({ revision: this.revision })}\n\n`,
    );

    const heartbeat = setInterval(() => response.write(": keepalive\n\n"), 25_000);
    heartbeat.unref();
    const subscription = { heartbeat, response };
    const householdSubscriptions = this.subscriptions.get(householdId) || new Set();
    householdSubscriptions.add(subscription);
    this.subscriptions.set(householdId, householdSubscriptions);

    request.once("close", () => {
      clearInterval(heartbeat);
      householdSubscriptions.delete(subscription);
      if (householdSubscriptions.size === 0) {
        this.subscriptions.delete(householdId);
      }
    });
  }

  publish(householdId: string): void {
    this.revision += 1;
    const event = `id: ${this.revision}\nevent: state-changed\ndata: ${JSON.stringify({ revision: this.revision })}\n\n`;
    for (const subscription of this.subscriptions.get(householdId) || []) {
      subscription.response.write(event);
    }
  }
}
