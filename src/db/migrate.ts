import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { pool } from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  console.log('Running database migrations...');

  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  const migrationsDir = join(__dirname, 'migrations');

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existingSchema = await client.query("SELECT to_regclass('public.agents') AS agents");
      if (!existingSchema.rows[0].agents) {
        await client.query(schema);
      }

      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          name TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      const files = readdirSync(migrationsDir)
        .filter((name) => name.endsWith('.sql'))
        .sort();

      for (const name of files) {
        const applied = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
        if (applied.rowCount) continue;

        await client.query(readFileSync(join(migrationsDir, name), 'utf-8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        console.log(`Applied ${name}`);
      }

      await client.query('COMMIT');
      client.release();
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
      throw error;
    }
    console.log('Migrations completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
