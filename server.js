const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const httpsLocalhost = require("https-localhost");
const WebSocket = require('ws');
const http = require('http');
const DB_PATH = path.join(__dirname, 'ccg_game.db');
const { randomBytes, createCipheriv, createDecipheriv } = require('crypto');
const svgCaptchaModule = require('svg-captcha');
const svgCaptcha = svgCaptchaModule.default || svgCaptchaModule;
const rateLimit = require('express-rate-limit');

const CAPTCHA_SECRET = randomBytes(32).toString('hex'); 

function encryptCaptcha(text) {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', Buffer.from(CAPTCHA_SECRET, 'hex'), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decryptCaptcha(text) {
  try {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = createDecipheriv('aes-256-cbc', Buffer.from(CAPTCHA_SECRET, 'hex'), iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    return null;
  }
}

//Ограничинения для пользовательских форм 
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // минуты
  max: 10, // попытки
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "TOO_MANY_ATTEMPTS"
  }
});

//Ограничения для остальных запросов
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300
});

async function startServer() {
  const SQL = await initSqlJs();
  
  let db;
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Функция для сохранения изменений в бд
  function saveDb() {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }

  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server });

  async function query(sql, params = []) {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        const rows = [];
        while (stmt.step()) {
          rows.push(stmt.getAsObject());
        }
        stmt.free();

        saveDb();
        
        resolve(rows);
      } catch (err) {
        reject(err);
      }
    });
  }
function mirrorIndices(indices, cols, rows) {
  const maxRow = rows;
  const totalCols = cols + 1;
  return indices.map(elem => {
    const index = elem.cell;
    const row = Math.floor(index / totalCols);
    const col = index % totalCols;
    const mirroredRow = maxRow - row;
    return {
      cell: mirroredRow * totalCols + col,
      textures: elem.textures
    };
  });
}

//загрузить утилиту
const loadUtils = async (arr) => {
  const { addRandomTextures } = await import('../my-vue-app/src/utilit/gameUtils.ts');
  let rnd = JSON.parse(addRandomTextures(...arr));
  return rnd;
};

// Настройки CORS
const corsOptions = {
  origin: [
    'https://localhost',
    'http://localhost:8100'
  ],
  credentials: true,
};
// Middleware
app.use(cors(corsOptions));
app.use('/images', express.static(path.join(__dirname, 'public/images')));
app.use(bodyParser.json());
app.use(globalLimiter);

// Универсальная функция для создания запросов
function RequestHandler(endpoint, sql, paramSort) {
  return async (req, res) => {
    try {
      const params = paramSort(req.body);
      const result = await query(sql, params);
      result.length > 0 ? res.json(result) : res.json(false);
    } catch (error) {
      console.error(`Ошибка в эндпоинте ${endpoint}:`, error);
      res.json(false);
    }
  };
}

// быстрое реагирование
let waitingPlayer = null;
let waitingId = null;
let all = [];
let check;
wss.on('connection', ws => {
  ws.on('message', async message => {
    const data = JSON.parse(message);
    if (data.type === 'find_match') {
      if (waitingPlayer === null) {
        waitingPlayer = ws;
        waitingId = data.id;
        ws.send(JSON.stringify({ type: 'waiting' }));
      } else {
        const player1 = waitingPlayer;
        const player2 = ws;
        waitingPlayer = null;
        const startMsg1 = JSON.stringify({ type: 'match_start', opponent: 'Player2' });
        const startMsg2 = JSON.stringify({ type: 'match_start', opponent: 'Player1' });
        all.push({ id1: data.id, id2: waitingId, player1: player1, player2: player2 });
        waitingId = null;
        player1.send(startMsg1);
        player2.send(startMsg2);
      }
    }
    else if (data.type === 'setRandomTexture') {
      all = all.map(elem => {
        elem.id1 == data.id ? elem.player1 = ws : null;
        elem.id2 == data.id ? elem.player2 = ws : null;
        return elem;
      });
      let user = all.filter(elem => elem.id1 == data.id || elem.id2 == data.id);
      let rnd;
      if (check) {
        rnd = check;
        check = null;
      }
      else {
        rnd = await loadUtils(data.arr);
        check = rnd;
      }

      user.forEach(elem => {
        elem.player1.send(JSON.stringify({ elems: rnd, type: "rndTexture" }));
        elem.player2.send(JSON.stringify({ elems: mirrorIndices(rnd, data.arr[1][1], data.arr[1][2]), type: "rndTexture" }));
      });
    }
    else if (data.type === 'capture') {
      let users = all.filter(elem => elem.id1 == data.id || elem.id2 == data.id);
      users.forEach(elem => {
        if (elem.id1 == data.id) {
          elem.player1.send(JSON.stringify({ arr: data.arr, typeCell: "player", type: "capture" }));
          elem.player2.send(JSON.stringify({ arr: mirrorIndices(data.arr, data.HexArr[1], data.HexArr[2]), typeCell: "enemy", type: "capture" }));
        }
        else {
          elem.player1.send(JSON.stringify({ arr: mirrorIndices(data.arr, data.HexArr[1], data.HexArr[2]), typeCell: "enemy", type: "capture" }));
          elem.player2.send(JSON.stringify({ arr: data.arr, typeCell: "player", type: "capture" }));
        }
      });
    }
    else if (data.type === 'Win') {
      let users = all.filter(elem => elem.id1 == data.id || elem.id2 == data.id);
      users.forEach(async elem => {
          const user1=await query('SELECT * FROM `users` WHERE `id` = ?',  [elem.id1]);
          const user2=await query('SELECT * FROM `users` WHERE `id` = ?', [elem.id2]);
          
        if (elem.id1 == data.id) {
          await query('UPDATE \`users\` SET \`matches\` = ?, \`wins\`= ? WHERE \`id\` = ?', [user1[0].matches + 1,user1[0].wins + 1, elem.id1]);
          await query('UPDATE \`users\` SET \`matches\` = ?  WHERE \`id\` = ?', [user2[0].matches + 1, elem.id2]);
          elem.player1.send(JSON.stringify({ arr: data.arr, type: "Win" }));
          elem.player2.send(JSON.stringify({ arr: data.arr, type: "Lose" }));
        }
        else {
          await query('UPDATE \`users\` SET \`matches\` = ?, \`wins\`= ? WHERE \`id\` = ?', [user2[0].matches + 1,user2[0].wins + 1, elem.id2]);
          await query('UPDATE \`users\` SET \`matches\` = ?  WHERE \`id\` = ?', [user1[0].matches + 1, elem.id1]);
          elem.player1.send(JSON.stringify({ arr: data.arr, type: "Lose" }));
          elem.player2.send(JSON.stringify({ arr: data.arr, type: "Win" }));
        }
      });
    }
    else if (data.type === 'setHeartUnits') {
      let users = all.filter(elem => elem.id1 == data.id || elem.id2 == data.id);
      users.forEach(elem => {
        if (elem.id1 == data.id) {
          elem.player2.send(JSON.stringify({ arr: data.arr, type: "setHeartUnits" }));
          elem.player1.send(JSON.stringify({ arr: data.arr, type: "setMyHeartUnits" }));
        }
        else {
          elem.player1.send(JSON.stringify({ arr: data.arr, type: "setHeartUnits" }));
          elem.player2.send(JSON.stringify({ arr: data.arr, type: "setMyHeartUnits" }));
        }
      });
    }
    else if (data.type === 'Move') {
      let users = all.filter(elem => elem.id1 == data.id || elem.id2 == data.id);
      users.forEach(elem => {
        if (elem.id1 == data.id) {
          elem.player1.send(JSON.stringify({ arr: data.arr, type: "Move", who: "hero" }));
          elem.player2.send(JSON.stringify({ arr: mirrorIndices(data.arr, data.HexArr[1], data.HexArr[2]), type: "Move", who: "evil" }));
        }
        else {
          elem.player1.send(JSON.stringify({ arr: mirrorIndices(data.arr, data.HexArr[1], data.HexArr[2]), type: "Move", who: "evil" }));
          elem.player2.send(JSON.stringify({ arr: data.arr, type: "Move", who: "hero" }));
        }
      });
    }
    else if (data.type === 'Building') {
      let users = all.filter(elem => elem.id1 == data.id || elem.id2 == data.id);
      users.forEach(elem => {
        if (elem.id1 == data.id) {
          elem.player1.send(JSON.stringify({ arr: data.arr, type: "Building", who: "hero" }));
          elem.player2.send(JSON.stringify({ arr: mirrorIndices(data.arr, data.HexArr[1], data.HexArr[2]), type: "Building", who: "evil" }));
        }
        else {
          elem.player1.send(JSON.stringify({ arr: mirrorIndices(data.arr, data.HexArr[1], data.HexArr[2]), type: "Building", who: "evil" }));
          elem.player2.send(JSON.stringify({ arr: data.arr, type: "Building", who: "hero" }));
        }
      });
    }
    else if (data.type === 'Destroy') {
      let users = all.filter(elem => elem.id1 == data.id || elem.id2 == data.id);
      users.forEach(elem => {
        if (elem.id1 == data.id) {
          elem.player1.send(JSON.stringify({ arr: data.arr, type: "Destroy" }));
          elem.player2.send(JSON.stringify({ arr: mirrorIndices(data.arr, data.HexArr[1], data.HexArr[2]), type: "Destroy" }));
        }
        else {
          elem.player1.send(JSON.stringify({ arr: mirrorIndices(data.arr, data.HexArr[1], data.HexArr[2]), type: "Destroy" }));
          elem.player2.send(JSON.stringify({ arr: data.arr, type: "Destroy" }));
        }
      });
    }
    else if (data.type === 'Fight') {
      let users = all.filter(elem => elem.id1 == data.id || elem.id2 == data.id);
      users.forEach(elem => {
          const otherId = (elem.id1 == data.id) ? elem.id2 : elem.id1;
          elem.player1.send(JSON.stringify({ type: "Fight", opponentID: otherId,id:data.id,battleId:users[0].id1+users[0].id2 }));
          elem.player2.send(JSON.stringify({ type: "Fight", opponentID: otherId,id:data.id,battleId:users[0].id1+users[0].id2 }));
      });
    }
    else if (data.type === 'HeroDestroy') {
      let users = all.filter(elem => elem.id1 == data.id || elem.id2 == data.id);
      users.forEach(elem => {
        if (elem.id1 == data.id) {
          elem.player1.send(JSON.stringify({ arr: data.arr, type: "HeroDestroy", who: "hero" }));
          elem.player2.send(JSON.stringify({ arr: mirrorIndices(data.arr, data.HexArr[1], data.HexArr[2]), type: "EvilDestroy", who: "evil" }));
          elem.player2.send(JSON.stringify({type: "StopTranslation"}));
        }
        else {
          elem.player1.send(JSON.stringify({type: "StopTranslation"}));
          elem.player1.send(JSON.stringify({ arr: mirrorIndices(data.arr, data.HexArr[1], data.HexArr[2]), type: "EvilDestroy", who: "evil" }));
          elem.player2.send(JSON.stringify({ arr: data.arr, type: "HeroDestroy", who: "hero" }));
        }
      });
    }
    else if (data.type === 'EvilDestroy') {
      let users = all.filter(elem => elem.id1 == data.id || elem.id2 == data.id);
      users.forEach(elem => {
        if (elem.id1 == data.id) {
          elem.player1.send(JSON.stringify({ arr: data.arr, type: "EvilDestroy", who: "evil" }));
          elem.player2.send(JSON.stringify({ arr: mirrorIndices(data.arr, data.HexArr[1], data.HexArr[2]), type: "HeroDestroy", who: "hero" }));
          elem.player2.send(JSON.stringify({type: "StopTranslation"}));
        }
        else {
          elem.player1.send(JSON.stringify({type: "StopTranslation"}));
          elem.player1.send(JSON.stringify({ arr: mirrorIndices(data.arr, data.HexArr[1], data.HexArr[2]), type: "HeroDestroy", who: "hero" }));
          elem.player2.send(JSON.stringify({ arr: data.arr, type: "EvilDestroy", who: "evil" }));
        }
      });
    }
    else if (data.type === 'triggerMeteorFall') {
      let users = all.filter(elem => elem.id1 == data.id || elem.id2 == data.id);
      users.forEach(elem => {
        const otherId = (elem.id1 == data.id) ? elem.id2 : elem.id1;
        elem.player1.send(JSON.stringify({ type: "triggerMeteorFall", id: data.id, opponentID: otherId, battleId: users[0].id1+users[0].id2, arr:data.arr }));
        elem.player2.send(JSON.stringify({ type: "triggerMeteorFall", id: data.id, opponentID: otherId, battleId: users[0].id1+users[0].id2, arr:data.arr }));
      });
    }
    else if (data.type === 'triggerHealingLush') {
      let users = all.filter(elem => elem.id1 == data.id || elem.id2 == data.id);
      users.forEach(elem => {
        const otherId = (elem.id1 == data.id) ? elem.id2 : elem.id1;
        elem.player1.send(JSON.stringify({ type: "triggerHealingLush", id: data.id, opponentID: otherId, battleId: users[0].id1+users[0].id2, arr:data.arr }));
        elem.player2.send(JSON.stringify({ type: "triggerHealingLush", id: data.id, opponentID: otherId, battleId: users[0].id1+users[0].id2, arr:data.arr }));
      });
    }
    else if (data.type === 'startFight') {
      let users = all.filter(elem => elem.id1 == data.id || elem.id2 == data.id);
      users.forEach(elem => {
        const otherId = (elem.id1 == data.id) ? elem.id2 : elem.id1;
        elem.player1.send(JSON.stringify({ type: "startFight", id: data.id,units:data.units,currentID:data.currentID, opponentID: otherId, battleId: users[0].id1+users[0].id2 }));
        elem.player2.send(JSON.stringify({ type: "startFight", id: data.id,units:data.units,currentID:data.currentID, opponentID: otherId, battleId: users[0].id1+users[0].id2 }));
      });
    }
    else if (data.type === 'HeartFight') {
      let users = all.filter(elem => elem.id1 == data.id || elem.id2 == data.id);
      users.forEach(elem => {
        const otherId = (elem.id1 == data.id) ? elem.id2 : elem.id1;
        if(otherId==elem.id1){
          elem.player1.send(JSON.stringify({ type: "PrepairHeart", id: data.id,units:data.arr[0],currentID:data.currentID, opponentID: otherId, battleId: users[0].id1+users[0].id2 }));
          elem.player2.send(JSON.stringify({ type: "startFight", id: data.id,units:data.arr[0],currentID:data.currentID, opponentID: otherId, battleId: users[0].id1+users[0].id2 }));
        }
        else if(otherId==elem.id2){
          elem.player1.send(JSON.stringify({ type: "startFight", id: data.id,units:data.arr[0],currentID:data.currentID, opponentID: otherId, battleId: users[0].id1+users[0].id2 }));
          elem.player2.send(JSON.stringify({ type: "PrepairHeart", id: data.id,units:data.arr[0],currentID:data.currentID, opponentID: otherId, battleId: users[0].id1+users[0].id2 }));
        }
        
      });
    }
    // Битва в игре
    else if (data.type === 'damage') {
      let pair = all.find(pair => pair.id1 === data.id || pair.id2 === data.id);
      if (pair) {
        const otherPlayer = (pair.id1 === data.id) ? pair.player2 : pair.player1;
        if (otherPlayer && otherPlayer.readyState === WebSocket.OPEN) {
          otherPlayer.send(JSON.stringify({ type: 'damage', targetId: data.data.targetId, damage: data.data.damage, side: data.data.side }));
        }
      }
    }
    else if (data.type === 'unitDestroyed') {
      let pair = all.find(pair => pair.id1 === data.id || pair.id2 === data.id);
      if (pair) {
        const otherPlayer = (pair.id1 === data.id) ? pair.player2 : pair.player1;
        if (otherPlayer && otherPlayer.readyState === WebSocket.OPEN) {
          otherPlayer.send(JSON.stringify({ type: 'unitDestroyed', unitId: data.data.unitId, side: data.data.side }));
        }
      }
    }
    else if (data.type === 'moveUnit') {
      let pair = all.find(pair => pair.id1 === data.id || pair.id2 === data.id);
      if (pair) {
        const otherPlayer = (pair.id1 === data.id) ? pair.player2 : pair.player1;
        if (otherPlayer && otherPlayer.readyState === WebSocket.OPEN) {
          otherPlayer.send(JSON.stringify({ type: 'moveUnit', x: data.data.x, y: data.data.y, unitId:data.data.unitId, side: data.data.side }));
        }
      }
    }
    else if (data.type === 'healingLush') {
      let pair = all.find(pair => pair.id1 === data.id || pair.id2 === data.id);
      if (pair) {
        const otherPlayer = (pair.id1 === data.id) ? pair.player2 : pair.player1;
        if (otherPlayer && otherPlayer.readyState === WebSocket.OPEN) {
          otherPlayer.send(JSON.stringify({ type: 'healingLush', position: data.data.position }));
        }
      }
    }
    else if (data.type === 'unitSpawn') {
      let pair = all.find(pair => pair.id1 === data.id || pair.id2 === data.id);
      if (pair) {
        const otherPlayer = (pair.id1 === data.id) ? pair.player2 : pair.player1;
        if (otherPlayer && otherPlayer.readyState === WebSocket.OPEN) {
          otherPlayer.send(JSON.stringify({ type: 'unitSpawn', side: data.data.side, unitId: data.data.unitId, position: data.data.position }));
        }
      }
    }
    else if (data.type === 'healingUnit') {
      let pair = all.find(pair => pair.id1 === data.id || pair.id2 === data.id);
      if (pair) {
        const otherPlayer = (pair.id1 === data.id) ? pair.player2 : pair.player1;
        if (otherPlayer && otherPlayer.readyState === WebSocket.OPEN) {
          otherPlayer.send(JSON.stringify({ type: 'healingUnit', side: data.data.side, unitId: data.data.unitId, heal: data.data.heal }));
        }
      }
    }
    else if (data.type === 'meteorFall') {
      let pair = all.find(pair => pair.id1 === data.id || pair.id2 === data.id);
      if (pair) {
        const otherPlayer = (pair.id1 === data.id) ? pair.player2 : pair.player1;
        if (otherPlayer && otherPlayer.readyState === WebSocket.OPEN) {
          otherPlayer.send(JSON.stringify({ type: 'meteorFall', position: data.data.position  }));
        }
      }
    }
    else if (data.type === 'effect') {
      let pair = all.find(pair => pair.id1 === data.id || pair.id2 === data.id);
      if (pair) {
        const otherPlayer = (pair.id1 === data.id) ? pair.player2 : pair.player1;
        if (otherPlayer && otherPlayer.readyState === WebSocket.OPEN) {
          otherPlayer.send(JSON.stringify({ type: 'effect',side: data.data.side, targetId: data.data.targetId, ability: data.data.ability   }));
        }
      }
    }
    else if (data.type === 'endBattle') {
      let pair = all.find(pair => pair.id1 === data.id || pair.id2 === data.id);
      if (pair) {
        const otherPlayer = (pair.id1 === data.id) ? pair.player2 : pair.player1;
        if (otherPlayer && otherPlayer.readyState === WebSocket.OPEN) {
          otherPlayer.send(JSON.stringify({ type: 'endBattle',side: data.data.side}));
        }
      }
    }
  });
  ws.on('close', () => {
    if (waitingPlayer === ws) {
      waitingPlayer = null;
    }
  });
});

// создать капчу
app.get('/api/captcha',loginLimiter, (req, res) => {
  try {
    const num1 = Math.floor(Math.random() * 10) + 1;
    const num2 = Math.floor(Math.random() * 10) + 1;
    
    const questionText = `${num1} + ${num2} = ?`;
    const correctAnswer = String(num1 + num2);

    const expires = Date.now() + 3 * 60 * 1000;
    const tokenData = `${correctAnswer}|${expires}`;
    const captchaToken = encryptCaptcha(tokenData);

    res.status(200).json({
      question: questionText,
      captchaToken: captchaToken
    });

  } catch (error) {
    console.error("Критическая ошибка генерации капчи:", error);
    res.status(500).json(false);
  }
});

// Проверка пользователя
app.post('/api/check',loginLimiter, async (req, res) => {
  try {
    const { name, password, captchaInput, captchaToken } = req.body;

    if (!name || !password || !captchaInput || !captchaToken) {
      return res.json({ status: "WRONG_CREDENTIALS" });
    }

    const decrypted = decryptCaptcha(captchaToken);
    if (!decrypted) {
      return res.json({ status: "WRONG_CAPTCHA" });
    }

    const [correctText, expires] = decrypted.split('|');

    if (Date.now() > parseInt(expires)) {
      return res.json({ status: "WRONG_CAPTCHA" });
    }

    if (captchaInput.toLowerCase() !== correctText) {
      return res.json({ status: "WRONG_CAPTCHA" });
    }

    const result = await query(`SELECT * FROM \`users\` WHERE \`username\` = ?`, [name]);
    if (result.length === 0) {
      return res.json({ status: "WRONG_CREDENTIALS" }); 
    }

    const passwordMatch = await bcrypt.compare(password, result[0].password_hash);
    if (passwordMatch) {
      res.json({ status: "SUCCESS", id: result[0].id });
    } else {
      res.json({ status: "WRONG_CREDENTIALS" }); 
    }

  } catch (error) {
    console.error('Ошибка при проверке пользователя:', error);
    res.json({ status: "SERVER_ERROR" });
  }
});

// авторизация
app.post('/api/checkUser',loginLimiter, async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!name || !email) return res.json({ status: "INVALID_FIELDS" });

    const nameCheck = await query(`SELECT * FROM \`users\` WHERE \`username\`=?`, [name]);
    if (nameCheck.length > 0) {
      return res.json({ status: "NAME_TAKEN" });
    }

    const emailCheck = await query(`SELECT * FROM \`users\` WHERE \`email\`=?`, [email]);
    if (emailCheck.length > 0) {
      return res.json({ status: "EMAIL_TAKEN" });
    }
    
    res.json({ status: "FREE" });
  } catch (error) {
    console.error('Ошибка в эндпоинте /api/checkUser:', error);
    res.json({ status: "SERVER_ERROR" });
  }
});

// проверка капчи
app.post('/api/verifyCaptcha',loginLimiter, async (req, res) => {
  try {
    const { captchaInput, captchaToken } = req.body;

    if (!captchaInput || !captchaToken) {
      return res.json({ status: "INVALID_DATA" });
    }

    const decrypted = decryptCaptcha(captchaToken);

    if (!decrypted) {
      return res.json({ status: "CAPTCHA_ERROR" });
    }

    const [correctText, expires] = decrypted.split('|');

    if (Date.now() > parseInt(expires)) {
      return res.json({ status: "CAPTCHA_EXPIRED" });
    }

    if (captchaInput.toLowerCase() !== correctText) {
      return res.json({ status: "CAPTCHA_ERROR" });
    }

    return res.json({ status: "SUCCESS" });

  } catch (e) {
    return res.json({ status: "SERVER_ERROR" });
  }
});

// добавление пользователя
app.post('/api/addUser',loginLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.send({
        status: 'INVALID_DATA'
      });
    }

    const userByName = await query(
      `SELECT * FROM users WHERE username=?`,
      [name]
    );

    if (userByName.length > 0) {
      return res.send({
        status: 'NAME_TAKEN'
      });
    }

    const userByEmail = await query(
      `SELECT * FROM users WHERE email=?`,
      [email]
    );

    if (userByEmail.length > 0) {
      return res.send({
        status: 'EMAIL_TAKEN'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const date = new Date().toISOString().split('T')[0];

    // создаем пользователя
    await query(
      `INSERT INTO users 
      (username, password_hash, email, rating, coins, registration_date)
      VALUES (?, ?, ?, 0, 100, ?)`,
      [name, hashedPassword, email, date]
    );

    const newUser = await query(
      `SELECT * FROM users WHERE username=?`,
      [name]
    );

    return res.send({
      status: 'SUCCESS',
      id: newUser[0].id
    });

  } catch (error) {
    console.error('Ошибка /api/addUser:', error);

    return res.send({
      status: 'SERVER_ERROR'
    });
  }
});

// обновление способности
app.post('/api/getUser', RequestHandler('/api/getUser', 'SELECT * FROM `users` WHERE `id` = ?', (body) => [body.id]));

// получение способностей юнитов
app.post('/api/getUnitAbilities', RequestHandler('/api/getUser',
  `SELECT * FROM \`unit_abilities\`
  JOIN \`units\` ON \`unit_abilities\`.\`unit_id\`=\`units\`.\`id\`
  JOIN \`abilities\` ON \`unit_abilities\`.\`ability_id\`=\`abilities\`.\`id\`  WHERE \`units\`.\`id\` = ?`, (body) => [body.card]));
  
// награда за квест
app.post('/api/claimDailyReward', async (req, res) => {
  try {
    const [user] = await query(
      'SELECT * FROM `users` WHERE `id` = ?',
      [req.body.id]
    );

    if (!user) {
      return res.json(false);
    }

    const newCoins = user.coins + 5;
    await query(
      'UPDATE `users` SET `coins` = ? WHERE `id` = ?',
      [newCoins, req.body.id]
    );

    res.json({
      success: true,
      coins: newCoins
    });
  } catch (error) {
    console.error('Ошибка при начислении монет:', error);
    res.json(false);
  }
});

// Получение информации о пользователе
app.post('/api/getUnit', RequestHandler('/api/getUser', 'SELECT * FROM `units` WHERE `card_id` = ?', (body) => [body.card]));

// Обновление имени пользователя
app.post('/api/updateUser', RequestHandler('/api/updateUser', 'UPDATE `users` SET `username` = ? WHERE `id` = ?', (body) => [body.name, body.id]));

// Получение всех карт пользователя
app.post('/api/getPlayerCollections', RequestHandler('/api/getPlayerCollections', 'SELECT * FROM `collections` JOIN `cards` ON `collections`.`card_id` = `cards`.`id` WHERE `user_id` = ?', (body) => [body.id]));

// Получить колоду игрока
app.post('/api/getPlayerDecs', RequestHandler('/api/getUser',`SELECT \`d\`.*FROM \`decs\` \`d\` WHERE \`d\`.\`user_id\` = ?`, (body) => [body.id]));

// Получить колоду игрока в матче
app.post('/api/getPlayerTotalDecs', RequestHandler('/api/getUser',`SELECT \`d\`.* FROM \`decs\` \`d\` WHERE \`d\`.\`id\` = ?`, (body) => [body.id]));

// Создать колоду игрока
app.post('/api/createDeck', RequestHandler('/api/getUser',
  `INSERT INTO \`decs\` (\`name\`, \`card_id1\`, \`card_id2\`, \`card_id3\`, \`user_id\`)
    VALUES (?, ?, ?, ?, ?)`, (body) => [body.name,body.card1,body.card2,body.card3,body.id]));

// Получение всех карт
app.get('/api/getCollections', RequestHandler('/api/getCollections', 'SELECT * FROM `cards`', () => []));

//Получить все данные для игры
app.get('/api/allFiles', async (req, res) => {
  try {
    let files = await
      new Promise((resolve, reject) => {
        fs.readdir(__dirname + '/public/images', (err, files) => {
          if (err) return reject(err);
          resolve(files);
        });
      });
    res.json(files);
  } catch (error) {
    console.error('Ошибка при покупке карты:', error);
    res.status(500).json({ error: 'Произошла ошибка' });
  }
});

// Покупка карты
app.post('/api/buyCard', async (req, res) => {
  try {
    const [user] = await query('SELECT * FROM `users` WHERE `id` = ?', [req.body.id]);
    const [card] = await query('SELECT * FROM `cards` WHERE `id` = ?', [req.body.card]);
    const [collections] = await query('SELECT * FROM `collections` WHERE `card_id` = ? AND `user_id` = ?', [req.body.card, req.body.id]);
    if (collections) {
      return res.json('У вас уже есть эта карта');
    }
    if (user.coins < card.rarity) {
      return res.json('Недостаточно золота');
    }
    await query('INSERT INTO `collections` (`user_id`, `card_id`) VALUES (?, ?)', [req.body.id, req.body.card]);
    await query('UPDATE `users` SET `coins` = ? WHERE `id` = ?', [user.coins - card.rarity, req.body.id]);
    res.json('Карта успешно куплена');
  } catch (error) {
    console.error('Ошибка при покупке карты:', error);
    res.status(500).json({ error: 'Произошла ошибка' });
  }
});
  const PORT = 3000;
  server.listen(PORT,'0.0.0.0', () => {
    console.log(`Сервер запущен на порту ${PORT}`);
  });
}
startServer().catch(err => console.error(err));