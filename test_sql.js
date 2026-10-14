const initSqlJs = require('sql.js');
const fs = require('fs');

async function test() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT);");
  db.run("INSERT INTO test (name) VALUES ('FarmDirect Fresh');");
  const stmt = db.prepare("SELECT * FROM test");
  while (stmt.step()) {
    console.log("Row:", stmt.getAsObject());
  }
  stmt.free();
  
  // Test export to disk
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync('test.db', buffer);
  
  // Test load from disk
  const fileBuffer = fs.readFileSync('test.db');
  const db2 = new SQL.Database(fileBuffer);
  const res = db2.exec("SELECT * FROM test");
  console.log("From loaded DB:", res);
  fs.unlinkSync('test.db');
  console.log("SUCCESS_SQL_JS_TEST");
}

test().catch(console.error);
