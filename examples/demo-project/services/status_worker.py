"""Realtime status worker: the one place allowed to read from the replica."""
import json
import time


class StatusWorker:
    def __init__(self, replica_url: str):
        self.replica_url = replica_url

    def poll(self) -> dict:
        # reads from the replica; eventual consistency is acceptable for status widgets
        return {"ts": time.time(), "source": self.replica_url}


def main():
    w = StatusWorker("replica://status")
    print(json.dumps(w.poll()))


if __name__ == "__main__":
    main()
