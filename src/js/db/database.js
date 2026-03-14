import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { SCHEMA_SQL } from './schema.js';

const DB_NAME = 'darts501';
let db = null;
let sqlite = null;

export async function initDatabase() {
    if (db) return db;

    sqlite = new SQLiteConnection(CapacitorSQLite);

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

    console.log('Darts501 database initialised successfully');
    return db;
}

export async function runQuery(sql, params = []) {
    const database = await initDatabase();
    return await database.run(sql, params);
}

export async function selectQuery(sql, params = []) {
    const database = await initDatabase();
    const result = await database.query(sql, params);
    return result.values || [];
}