// telemetry stage: event sink
export class RawEventSink {
  private events: string[] = [];

  record(event: string): void {
    this.events.push(event);
  }

  getEvents(): string[] {
    return this.events;
  }
}
