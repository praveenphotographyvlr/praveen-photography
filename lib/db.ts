import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const DATABASE_URL = process.env.DATABASE_URL!

// In Next.js dev, the module is hot-reloaded — cache the client on `global`
// to avoid exhausting the Postgres connection pool.
declare global {
  // eslint-disable-next-line no-var
  var _pgClient: ReturnType<typeof postgres> | undefined
}

const client = global._pgClient ?? postgres(DATABASE_URL, { max: 10 })

if (process.env.NODE_ENV !== 'production') {
  global._pgClient = client
}

export const db = drizzle(client, { schema })
