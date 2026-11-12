import { redisOptions } from './redis';

describe('redisOptions', () => {
  it('parses host, port, credentials and db', () => {
    expect(redisOptions('redis://user:p%40ss@cache.internal:6380/2')).toMatchObject({
      host: 'cache.internal',
      port: 6380,
      username: 'user',
      password: 'p@ss',
      db: 2,
      tls: undefined,
      maxRetriesPerRequest: null,
    });
  });

  it('enables TLS for rediss URLs and defaults the port', () => {
    expect(redisOptions('rediss://cache.example.com')).toMatchObject({ port: 6379, db: 0, tls: {} });
  });
});
