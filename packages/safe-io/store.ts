import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
export class Store {
 db:DatabaseSync;
 constructor(file:string){mkdirSync(path.dirname(file),{recursive:true,mode:0o700});this.db=new DatabaseSync(file);this.db.exec('PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, product TEXT NOT NULL, digest TEXT NOT NULL, location TEXT NOT NULL, created_at TEXT NOT NULL); CREATE UNIQUE INDEX IF NOT EXISTS records_digest ON records(product,digest); PRAGMA user_version=1;');}
 put(id:string,product:string,digest:string,location:string){const old=this.db.prepare('SELECT * FROM records WHERE product=? AND digest=?').get(product,digest);if(old)return {duplicate:true,record:old};this.db.prepare('INSERT INTO records VALUES(?,?,?,?,?)').run(id,product,digest,location,new Date().toISOString());return {duplicate:false};}
 close(){this.db.close();}
}
