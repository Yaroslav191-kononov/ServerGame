const initSqlJs = require('sql.js');
const fs = require('fs');
const bcrypt = require('bcryptjs');

async function initDatabase() {
    const SQL = await initSqlJs();

    let db;
    if (fs.existsSync('ccg_game.db')) {
        const filebuffer = fs.readFileSync('ccg_game.db');
        db = new SQL.Database(filebuffer);
    } else {
        db = new SQL.Database();
    }

    // Создание таблиц
    const tables = [
        `CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            registration_date TEXT DEFAULT CURRENT_TIMESTAMP,
            rating INTEGER DEFAULT 0,
            coins INTEGER DEFAULT 0,
            matches INTEGER DEFAULT 0,
            meteor INTEGER DEFAULT 1,
            lush INTEGER DEFAULT 1,
            wins INTEGER DEFAULT 0
        );`,
        `CREATE TABLE IF NOT EXISTS cards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            type TEXT NOT NULL,
            rarity INTEGER NOT NULL,
            wood INTEGER,
            stone INTEGER,
            power INTEGER,
            health INTEGER,
            card_id INTEGER,
            image_url TEXT
        );`,
        `CREATE TABLE IF NOT EXISTS collections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            card_id INTEGER NOT NULL,
            quantity INTEGER DEFAULT 1,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(card_id) REFERENCES cards(id)
        );`,
        `CREATE TABLE IF NOT EXISTS units (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            card_id INTEGER NOT NULL,
            health INTEGER NOT NULL,
            power INTEGER NOT NULL,
            wood INTEGER,
            stone INTEGER,
            meleeSpeed INTEGER,
            isRange BOOLEAN,
            range INTEGER,
            attackCooldown INTEGER,
            image_url TEXT,
            FOREIGN KEY(card_id) REFERENCES cards(id)
        );`,
        `CREATE TABLE IF NOT EXISTS decs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            card_id1 INTEGER NOT NULL,
            card_id2 INTEGER NOT NULL,
            card_id3 INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            FOREIGN KEY(card_id1) REFERENCES cards(id),
            FOREIGN KEY(card_id2) REFERENCES cards(id),
            FOREIGN KEY(card_id3) REFERENCES cards(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        );`,
        `CREATE TABLE IF NOT EXISTS matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            player1_id INTEGER NOT NULL,
            player2_id INTEGER NOT NULL,
            status TEXT DEFAULT 'pending',
            start_time TEXT DEFAULT CURRENT_TIMESTAMP,
            end_time TEXT,
            winner_id INTEGER,
            FOREIGN KEY(player1_id) REFERENCES users(id),
            FOREIGN KEY(player2_id) REFERENCES users(id)
        );`,
        `CREATE TABLE IF NOT EXISTS abilities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            type TEXT NOT NULL,
            duration INTEGER,
            damage_per_tick INTEGER,
            apply_chance REAL DEFAULT 1.0,
            cooldown INTEGER DEFAULT 0,
            target TEXT DEFAULT 'enemy',
            color TEXT DEFAULT '#ffffff',
            icon_path TEXT
        );`,
        `CREATE TABLE IF NOT EXISTS unit_abilities (
            unit_id INTEGER NOT NULL,
            ability_id INTEGER NOT NULL,
            PRIMARY KEY (unit_id, ability_id),
            FOREIGN KEY(unit_id) REFERENCES units(id),
            FOREIGN KEY(ability_id) REFERENCES abilities(id)
        );`,
        `CREATE TABLE IF NOT EXISTS status_effects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            unit_id INTEGER NOT NULL,
            ability_id INTEGER NOT NULL,
            remaining_turns INTEGER,
            potency INTEGER,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(unit_id) REFERENCES units(id),
            FOREIGN KEY(ability_id) REFERENCES abilities(id)
        );`
    ];

    tables.forEach(sql => db.run(sql));

    async function hashPassword(password) {
        return await bcrypt.hash(password, 10);
    }

    async function createUser(username, password, email) {
        const hashed = await hashPassword(password);
        db.run(`INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)`, [username, hashed, email]);
    }

    async function seedDatabase() {
        //Добавляем способности
        const abilities = [
            { slug: 'burn', name: 'Burn', description: 'DoT огня: 3 урона за тик на 3 тика', type: 'dot', duration: 3, damage_per_tick: 3, apply_chance: 0.85, cooldown: 0, target: 'enemy', color: '#ff6b1a', icon_path: 'burn' },
            { slug: 'poison', name: 'Poison', description: 'DoT яд: 2 урона за тик на 4 тика', type: 'dot', duration: 4, damage_per_tick: 2, apply_chance: 0.7, cooldown: 0, target: 'enemy', color: '#4caf50', icon_path: 'Poison' }
        ];

        abilities.forEach(ab => {
            db.run(
                `INSERT OR IGNORE INTO abilities (slug, name, description, type, duration, damage_per_tick, apply_chance, cooldown, target, color, icon_path)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [ab.slug, ab.name, ab.description, ab.type, ab.duration, ab.damage_per_tick, ab.apply_chance, ab.cooldown, ab.target, ab.color, ab.icon_path]
            );
        });

        // Добавляем карты
        const cards = [
            { name: 'Кабина', type: 'Здание', rarity: 15, wood: 5, stone: 3, power: 3, health: 120, image_url: "cabinUrl", card_id: 1 },
            { name: 'Церковь', type: 'Здание', rarity: 10, wood: 2, stone: 4, power: 3, health: 120, image_url: "churchUrl", card_id: 2 },
            { name: 'Малый замок', type: 'Здание', rarity: 5, wood: 7, stone: 0, power: 3, health: 120, image_url: "smallCastlehUrl", card_id: 3 }
        ];

        cards.forEach(card => {
            db.run(
                `INSERT OR IGNORE INTO cards (name, type, rarity, wood, stone, power, health, image_url, card_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [card.name, card.type, card.rarity, card.wood ?? null, card.stone ?? null, card.power ?? null, card.health ?? null, card.image_url ?? null, card.card_id]
            );
        });

        // Добавляем юнитов
        const units = [
            { name: 'Житель', wood: 3, stone: 0, power: 6, health: 60, image_url: "Sel", card_id: 1, isRange: 0, meleeSpeed: 160, attackCooldown: 700 },
            { name: 'Деревеньшина', wood: 6, stone: 0, power: 8, health: 90, image_url: "Der", card_id: 1, isRange: 1, range: 600, meleeSpeed: 120, attackCooldown: 1200 },
            { name: 'Ополченец', wood: 9, stone: 0, power: 10, health: 120, image_url: "Opl", card_id: 1, isRange: 0, meleeSpeed: 160, attackCooldown: 700 },
            { name: 'Монах', wood: 1, stone: 2, power: 5, health: 50, image_url: "Monk", card_id: 2, isRange: 1, range: 1200, meleeSpeed: 60, attackCooldown: 1200 },
            { name: 'Просвящённый', wood: 4, stone: 2, power: 5, health: 100, image_url: "Prosv", card_id: 2, isRange: 0, meleeSpeed: 120, attackCooldown: 700 },
            { name: 'Инквизитор', wood: 4, stone: 4, power: 20, health: 200, image_url: "Incvisitor", card_id: 2, isRange: 0, meleeSpeed: 100, attackCooldown: 900 },
            { name: 'Оруженосец', wood: 0, stone: 3, power: 8, health: 80, image_url: "Veapon", card_id: 3, isRange: 0, meleeSpeed: 120, attackCooldown: 700 },
            { name: 'Рыцарь', wood: 0, stone: 6, power: 12, health: 120, image_url: "Knight", card_id: 3, isRange: 0, meleeSpeed: 80, attackCooldown: 700 },
            { name: 'Мфыеук ьуча', wood: 0, stone: 9, power: 15, health: 150, image_url: "Sword", card_id: 3, isRange: 1, range: 1700, meleeSpeed: 160, attackCooldown: 1000 }
        ];

        units.forEach(unit => {
            db.run(
                `INSERT OR IGNORE INTO units (name, power, health, image_url, wood, stone, card_id, isRange, range, meleeSpeed, attackCooldown)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [unit.name, unit.power, unit.health, unit.image_url, unit.wood, unit.stone, unit.card_id, unit.isRange, unit.range ?? null, unit.meleeSpeed ?? null, unit.attackCooldown ?? null ]
            );
        });

        //  Привязка абилити к юнитам
        const unitAbilities = [
            { unit_id: 6, ability_id: 1 },
            { unit_id: 7, ability_id: 1 },
            { unit_id: 4, ability_id: 1 },
            { unit_id: 1, ability_id: 2 },
            { unit_id: 2, ability_id: 2 },
            { unit_id: 3, ability_id: 2 }
        ];

        unitAbilities.forEach(ua => {
            db.run(
                `INSERT OR IGNORE INTO unit_abilities (unit_id, ability_id) VALUES (?, ?)`,
                [ua.unit_id, ua.ability_id]
            );
        });

        await createUser('admin', 'admin123', 'admin@example.com');

        // Сохраняем бд
        const data = db.export();
        fs.writeFileSync('ccg_game.db', Buffer.from(data));

        console.log('База данных заполнена seedDatabase() успешно');
    }

    await seedDatabase();
}


initDatabase();
