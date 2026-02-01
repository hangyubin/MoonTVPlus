const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// SHA-256 加密密码（与 Redis 保持一致）
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// 确保 .data 目录存在
const dataDir = path.join(__dirname, '../.data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 创建数据库
const dbPath = path.join(dataDir, 'moontv.db');
const db = new Database(dbPath);

console.log('📦 Initializing SQLite database for development...');
console.log('📍 Database location:', dbPath);

// 读取迁移脚本
const migrationPath = path.join(__dirname, '../migrations/001_initial_schema.sql');
if (!fs.existsSync(migrationPath)) {
  console.error('❌ Migration file not found:', migrationPath);
  process.exit(1);
}

const sql = fs.readFileSync(migrationPath, 'utf8');

// 执行迁移
try {
  db.exec(sql);
  console.log('✅ Database schema created successfully!');

  // 创建默认管理员用户（可选）
  const username = process.env.USERNAME || 'admin';
  const password = process.env.PASSWORD || '123456789';
  const passwordHash = hashPassword(password);

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO users (username, password_hash, role, created_at, playrecord_migrated, favorite_migrated, skip_migrated)
    VALUES (?, ?, 'owner', ?, 1, 1, 1)
  `);

  stmt.run(username, passwordHash, Date.now());
  console.log(`✅ Default admin user created: ${username}`);
} catch (err) {
  console.error('❌ Migration failed:', err);
  process.exit(1);
} finally {
  db.close();
}

console.log('');
console.log('🎉 SQLite database initialized successfully!');
console.log('');
console.log('Next steps:');
console.log('1. Set NEXT_PUBLIC_STORAGE_TYPE=d1 in .env');
console.log('2. Run: npm run dev');
