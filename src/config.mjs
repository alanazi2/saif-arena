/* كل الإعدادات من متغيرات البيئة فقط (12-factor). لا ملف .env في الحاوية. */
import { DEFAULT_MAX_ROUNDS_PER_DAY } from './core.mjs';

const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; };
const bool = (v, d = false) => (v == null || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v)));

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'production';
  const cfg = {
    nodeEnv,
    debug: bool(env.APP_DEBUG, false) && nodeEnv !== 'production',
    port: int(env.PORT, 8080),
    host: '0.0.0.0',
    appUrl: (env.APP_URL || '').replace(/\/+$/, ''),
    adminPin: String(env.ADMIN_PIN || ''),
    runMigrations: bool(env.RUN_MIGRATIONS, false),
    maxRoundsPerDay: int(env.MAX_ROUNDS_PER_DAY, DEFAULT_MAX_ROUNDS_PER_DAY),
    shutdownGraceMs: int(env.SHUTDOWN_GRACE_SECONDS, 25) * 1000,
    s3PublicUrl: (env.S3_PUBLIC_URL || '').replace(/\/+$/, ''),
    db: {
      url: env.DATABASE_URL || '',
      host: env.DB_HOST || 'localhost', port: int(env.DB_PORT, 5432), name: env.DB_NAME || 'saif', user: env.DB_USER || 'saif', password: env.DB_PASSWORD || '',
      sslmode: env.DB_SSLMODE || 'prefer',
      poolMax: int(env.DB_POOL_MAX, 10),
      migrationUrl: env.MIGRATION_DATABASE_URL || '',
    },
  };
  return cfg;
}

/* يبني خيارات pg من الإعدادات (DATABASE_URL أو DB_*) */
export function pgOptions(db, { migration = false } = {}) {
  const base = migration && db.migrationUrl ? { connectionString: db.migrationUrl } : db.url ? { connectionString: db.url } : { host: db.host, port: db.port, database: db.name, user: db.user, password: db.password };
  const m = String(db.sslmode).toLowerCase();
  const ssl = m === 'disable' || m === 'allow' || m === 'prefer' ? false : m === 'verify-full' || m === 'verify-ca' ? { rejectUnauthorized: true } : { rejectUnauthorized: false };
  return { ...base, ssl };
}
