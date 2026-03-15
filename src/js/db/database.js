import { SCHEMA_SQL } from './schema.js';

const DB_NAME = 'darts501';
let db = null;

export async function initDatabase() {
    if (db) return db;

    const { CapacitorSQLite, SQLiteConnection } = await import('@capacitor-community/sqlite');

    const sqlite = new SQLiteConnection(CapacitorSQLite);

    const isConn = await sqlite.isConnection(DB_NAME, false);

    if (isConn.result) {
        db = await sqlite.retrieveConnection(DB_NAME, false);
    } else {
        db = await sqlite.createConnection(
            DB_NAME,
            false,
            'no-encryption',
            1,
            false
        );
    }

    await db.open();
    await db.execute(SCHEMA_SQL);

    console.log('[db] Database initialised successfully');
    return db;
}

export function getDb() {
    if (!db) throw new Error('Database not initialised. Call initDatabase() first.');
    return db;
}

export async function runQuery(sql, params = []) {
    const database = getDb();
    return await database.run(sql, params);
}

export async function selectQuery(sql, params = []) {
    const database = getDb();
    const result = await database.query(sql, params);
    return result.values || [];
}