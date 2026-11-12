import { RedisOptions } from 'ioredis';

/** Turns redis://user:pass@host:port/db (or rediss:// for TLS) into ioredis options. */
export function redisOptions(url: string): RedisOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    // BullMQ workers need this so blocking commands are not cut off.
    maxRetriesPerRequest: null,
  };
}
