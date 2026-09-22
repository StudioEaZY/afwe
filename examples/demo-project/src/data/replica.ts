import { Db } from "./db";
// Replica reads are only allowed for realtime status widgets (constraint: replica-read-policy)
export const replicaDb = new Db("replica");
