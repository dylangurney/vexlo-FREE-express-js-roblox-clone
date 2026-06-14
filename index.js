const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
const { spawn } = require("child_process");
const net = require("net");
const zlib = require("zlib");
const fs = require("fs");
const http = require("http");
const { createProxyServer } = require("http-proxy");
const multer = require("multer");
const { filterText } = require("./filtertext")

const app = express();

const DB_DIR = path.join(__dirname, "..", "VexloDB");

const users_DB = new Database(path.join(DB_DIR, "vexlo_users.db"));
const sessions_DB = new Database(path.join(DB_DIR, "vexlo_sessions.db"));
const games_DB = new Database(path.join(DB_DIR, "vexlo_games.db"));
const avatars_DB = new Database(path.join(DB_DIR, "vexlo_avatars.db"));
const avatarimages_DB = new Database(path.join(DB_DIR, "vexlo_avatarimages.db"));
const gameimages_DB = new Database(path.join(DB_DIR, "vexlo_gameimages.db"));
const friends_DB = new Database(path.join(DB_DIR, "vexlo_friends.db"));

const ranks = {
  [1]: "Admin",
}


function hashString(string) {
  return crypto
    .createHash("sha1")
    .update(string)
    .digest("hex");
}

avatars_DB.exec(`
CREATE TABLE IF NOT EXISTS avatars (
    hash TEXT PRIMARY KEY,
    data TEXT NOT NULL
);
`);

avatarimages_DB.exec(`
CREATE TABLE IF NOT EXISTS avatar_images (
    hash TEXT PRIMARY KEY,
    image BLOB NOT NULL
);
`);

gameimages_DB.exec(`
CREATE TABLE IF NOT EXISTS game_images (
    hash TEXT PRIMARY KEY,
    image BLOB NOT NULL
);
`);

gameimages_DB.exec(`
CREATE TABLE IF NOT EXISTS game_image_moderation (
    hash TEXT PRIMARY KEY,
    approved INTEGER NOT NULL DEFAULT 0,
    reviewed_at INTEGER DEFAULT (strftime('%s','now'))
);
`);


users_DB.exec(`
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password_hash TEXT,
    salt TEXT,
    avatar_hash TEXT,
    avatar_image_hash TEXT,
    last_online INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS friends (
  user_id INTEGER NOT NULL,
  friend_id INTEGER NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  PRIMARY KEY (user_id, friend_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS friend_requests (
  sender_id INTEGER NOT NULL,
  receiver_id INTEGER NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  PRIMARY KEY (sender_id, receiver_id)
);

`);

const cols = users_DB.prepare(`PRAGMA table_info(users)`).all().map(c => c.name);

if (!cols.includes("last_online")) {
  users_DB.exec(`ALTER TABLE users ADD COLUMN last_online INTEGER`);
}


sessions_DB.exec(`
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    user_id INTEGER,
    created_at INTEGER
);
`);

games_DB.exec(`
CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER NOT NULL,
    name TEXT DEFAULT "Untitled Game",
    description TEXT DEFAULT "",
    data BLOB,
    data_saved BLOB,
    data_saved_size INTEGER DEFAULT 0,
    data_size INTEGER DEFAULT 0,
    thumbnail TEXT,
    is_public INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS game_votes (
  user_id INTEGER NOT NULL,
  game_id INTEGER NOT NULL,
  value INTEGER NOT NULL, -- 1 = like, -1 = dislike
  PRIMARY KEY (user_id, game_id)
);
`);



const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 // 100KB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "image/png") {
      return cb(new Error("Only PNG files are allowed"));
    }

    cb(null, true);
  }
});

const Player_counts = new Map()
const Players_in_games = new Map()

app.use(cookieParser());
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));


//For now, we’ll keep it simple in memory:

function getSession(cookie) {
    const stmt = sessions_DB.prepare(`
        SELECT user_id, created_at FROM sessions WHERE session_id = ?
    `);

    const session = stmt.get(cookie);

    if (!session) return null;

    const expired =
        Date.now() - session.created_at > 7 * 24 * 60 * 60 * 1000;

    if (expired) {
        sessions_DB.prepare("DELETE FROM sessions WHERE session_id = ?").run(cookie);
        return null;
    }

    return session.user_id;
}

function setSession(sessionId, userID) {
    const stmt = sessions_DB.prepare(`
        INSERT INTO sessions (session_id, user_id, created_at)
        VALUES (?, ?, ?)
    `);

    stmt.run(sessionId, userID, Date.now());
}

const pepper = process.env.PEPPER
function Sha256text(text) {
    return crypto
        .createHash("sha256")
        .update(pepper + text)
        .digest("hex");
}

function generateSalt() {
    return crypto.randomBytes(16).toString("hex");
}

function getUserFromReq(req) {
  const cookieHeader = req.headers.cookie || "";

  const cookies = Object.fromEntries(
    cookieHeader.split(";").map(c => {
      const [k, ...v] = c.trim().split("=");
      return [k, decodeURIComponent(v.join("="))];
    })
  );

  const sessionId = cookies.sessionId;
  if (!sessionId) return null;

  const userId = getSession(sessionId);
  if (!userId) return null;

  return users_DB.prepare(`
    SELECT id, username
    FROM users
    WHERE id = ?
  `).get(userId) || null;
}


function getUser(req, res, next) {
    const sessionId = req.cookies.sessionId;

    const userId = getSession(sessionId);

    if (!userId) {
        req.user = null;
        return next();
    }

    const stmt = users_DB.prepare("SELECT id, username FROM users WHERE id = ?");
    const user = stmt.get(userId);

    req.user = user || null;
    next();
}

app.use(getUser);

const ERROR_MESSAGES = {
    1: "Account was not found",
    2: "Incorrect password",
    3: "Username already taken",
    4: "Missing Fields",
    5: "Passwords do not match",
};

const ERROR = {
    USER_NOT_FOUND: 1,
    WRONG_PASSWORD: 2,
    USERNAME_TAKEN: 3,
    MISSINGFIELDS: 4,
    PASSWORD_NOT_MATCH: 5,
};

function isadmin(req) {
  if (!req.user) {
    return false
  }
  const userid = req.user.id
  if (!userid) {
    return false
  }
  const adminrank = ranks[userid]
  if (!adminrank) {
    return false
  }
  return true
}


function getViewData(req) {
    return {
        user: req.user || null,
        error: ERROR_MESSAGES[req.query.error] || null,
        isadmin: isadmin(req) || null,
    };
}

app.get("/scripting", (req, res) => {
    res.render("scripting");
});

app.get("/", (req, res) => {
    res.render("index", getViewData(req));
});

app.get("/settings", (req, res) => {
    res.render("settings", getViewData(req));
});


app.get("/imageapprove", (req, res) => {
    const admin = isadmin(req)
    if (!admin) {
      return res.redirect("/404")
    }

    res.render("imageapprove", getViewData(req));
});

app.get("/api/admin/pendingassets", (req, res) => {
  const admin = isadmin(req)
  if (!admin) {
    return res.redirect("/404")
  }

  const pending = gameimages_DB.prepare(`
    SELECT hash
    FROM game_image_moderation
    WHERE approved = 0
    ORDER BY reviewed_at ASC
  `).all();

  res.json(pending);
});


app.get("/avatar", (req, res) => {
    res.render("avatar", getViewData(req));
});

app.get("/friends", (req, res) => {
    res.render("friends", getViewData(req));
});

const DEFAULT_AVATAR = {
        "Head": "#ffff00",
        "Torso": "#0000ff",
        "LeftArm": "#ffff00",
        "RightArm": "#ffff00",
        "LeftLeg": "#80ff00",
        "RightLeg": "#80ff00"
    }

app.get("/api/avatar/:user_id", (req, res) => {
  const { user_id } = req.params;

  // 1. get avatar hash from user
  const userRow = users_DB.prepare(`
    SELECT avatar_hash FROM users WHERE id = ?
  `).get(user_id);

  if (!userRow || !userRow.avatar_hash) {
    return res.json(DEFAULT_AVATAR);
  }

  const avatarHash = userRow.avatar_hash;

  // 2. get avatar data from avatars table
  const avatarRow = avatars_DB.prepare(`
    SELECT data FROM avatars WHERE hash = ?
  `).get(avatarHash);

  if (!avatarRow || !avatarRow.data) {
    return res.json(DEFAULT_AVATAR);
  }

  try {
    return res.json(JSON.parse(avatarRow.data));
  } catch (e) {
    return res.json(DEFAULT_AVATAR);
  }
});

const validLimbs = [
  "Head",
  "Torso",
  "LeftArm",
  "RightArm",
  "LeftLeg",
  "RightLeg",
];

app.post("/api/avatar", (req, res) => {
  const avatar = req.body;

  if (!req.user) {
    return res.redirect("/signin?error=1");
  }

  if (!avatar || typeof avatar !== "object") {
    return res.status(400).json({ error: "Missing or invalid avatar" });
  }

  const data = JSON.stringify(avatar);
  const hashed = hashString(data);

  // 1. store / update avatar globally
  avatars_DB.prepare(`
    INSERT INTO avatars (hash, data)
    VALUES (?, ?)
    ON CONFLICT(hash) DO UPDATE SET data = excluded.data
  `).run(hashed, data);

  // 2. link avatar to user
  users_DB.prepare(`
    UPDATE users
    SET avatar_hash = ?
    WHERE id = ?
  `).run(hashed, req.user.id);

  return res.json({
    success: true,
    avatar_hash: hashed
  });
});

app.get("/headshots/:id", (req, res) => {
  const userId = Number(req.params.id);

  if (isNaN(userId)) {
    return res.sendFile(path.join(__dirname, "default.png"));
  }

  const user = users_DB.prepare(`
    SELECT avatar_image_hash FROM users WHERE id = ?
  `).get(userId);

  if (!user?.avatar_image_hash) {
    return res.sendFile(path.join(__dirname, "default.png"));
  }

  const row = avatarimages_DB.prepare(`
    SELECT image FROM avatar_images WHERE hash = ?
  `).get(user.avatar_image_hash);

  if (!row?.image) {
    return res.sendFile(path.join(__dirname, "default.png"));
  }

  res.setHeader("Content-Type", "image/png");
  res.send(row.image);
});

app.post(
  "/api/avatarheadshot",
  express.raw({ type: "image/png", limit: "10kb" }),
  (req, res) => {
    if (!req.user) {
      return res.redirect("/signin?error=1");
    }

    const imageBuffer = req.body;
    if (!imageBuffer || !imageBuffer.length) {
      return res.status(400).json({ error: "Missing image" });
    }

    // 1. generate image hash (based on image)
    const imageHash = hashString(imageBuffer.toString("base64"));

    // 2. store image
    avatarimages_DB.prepare(`
      INSERT INTO avatar_images (hash, image)
      VALUES (?, ?)
      ON CONFLICT(hash) DO UPDATE SET image = excluded.image
    `).run(imageHash, imageBuffer);

    // 3. link to user
    users_DB.prepare(`
      UPDATE users
      SET avatar_image_hash = ?
      WHERE id = ?
    `).run(imageHash, req.user.id);

    return res.json({
      success: true,
      image_hash: imageHash
    });
  }
);



app.get("/games", (req, res) => {
    res.render("games", getViewData(req));
});

app.get("/signup", (req, res) => {
    res.render("signup", getViewData(req));
});

app.get("/signin", (req, res) => {
    res.render("signin", getViewData(req));
});




app.get("/build", (req, res) => {
    if (!req.user) {
        return res.redirect("/signin?error=1");
    }

    res.render("build", getViewData(req));
});

app.get("/gamesettings/:id", (req, res) => {
    if (!req.user) {
        return res.redirect("/signin?error=1");
    }

    const gameId = Number(req.params.id);

    if (isNaN(gameId)) {
        return res.status(400).send("Invalid game ID");
    }

    const game = games_DB.prepare(`
        SELECT 
            id,
            owner_id,
            name,
            description,
            thumbnail,
            is_public,
            data_size,
            created_at,
            updated_at
        FROM games
        WHERE id = ?
    `).get(gameId);

    if (!game) {
        return res.status(404).send("Game not found");
    }

    // 🔒 ownership check
    if (!isadmin(req)) {
      if (game.owner_id !== req.user.id) {
          return res.status(403).send("Not your game");
      }
    }


    res.render("gamesettings", {
        ...getViewData(req),
        game
    });
});

app.get("/gamethumbnails/:hash", (req, res) => {
  const { hash } = req.params;

  const image = gameimages_DB.prepare(`
    SELECT image
    FROM game_images
    WHERE hash = ?
  `).get(hash);

  if (!image) {
    return res.sendFile(path.join(__dirname, "default_200.png"));
  }

  const moderation = gameimages_DB.prepare(`
    SELECT approved
    FROM game_image_moderation
    WHERE hash = ?
  `).get(hash);
  
  console.log(moderation)

  // pending / not reviewed
  if (!moderation || moderation.approved === 0) {
    return res.sendFile(path.join(__dirname, "pendingapprove.png"));
  }

  // rejected
  if (moderation.approved === -1) {
    return res.sendFile(path.join(__dirname, "rejectapprove.png"));
  }


  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=31536000");

  res.send(image.image);
});

app.get("/pendingthumbs/:hash", (req, res) => {
  if (!isadmin(req)) {
    return res.redirect("/404")
  }
  const { hash } = req.params;

  const image = gameimages_DB.prepare(`
    SELECT image
    FROM game_images
    WHERE hash = ?
  `).get(hash);

  if (!image) {
    return res.sendFile(path.join(__dirname, "default_200.png"));
  }
  
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=31536000");

  res.send(image.image);
});

app.post("/api/admin/assets/:hash/approve", (req, res) => {
  if (!isadmin(req)) {
    return res.redirect("/404")
  }

  const hash = req.params.hash;

  gameimages_DB.prepare(`
    UPDATE game_image_moderation
    SET approved = 1,
        reviewed_at = strftime('%s','now')
    WHERE hash = ?
  `).run(hash);

  res.json({ ok: true });
});

app.post("/api/admin/assets/:hash/reject", (req, res) => {
  if (!isadmin(req)) {
    return res.redirect("/404")
  }

  const hash = req.params.hash;

  gameimages_DB.prepare(`
    UPDATE game_image_moderation
    SET approved = -1,
        reviewed_at = strftime('%s','now')
    WHERE hash = ?
  `).run(hash);

  res.json({ ok: true });
});


app.get("/gamethumbnails/", (req, res) => {
    return res.sendFile(path.join(__dirname, "default_200.png"));
});

app.post("/api/games/:id/settings", upload.single("thumbnail"), (req, res) => {
  const gameId = Number(req.params.id);

  const name = filterText(req.body.name);
  const description = filterText(req.body.description);
  const is_public = req.body.is_public === "true";
  
  let thumbnailPath = null;

  if (req.file) {
    const hash = crypto
      .createHash("sha1")
      .update(req.file.buffer)
      .digest("hex");

    const existing = gameimages_DB.prepare(`
      SELECT hash FROM game_images WHERE hash = ?
    `).get(hash);

    if (!existing) {
      gameimages_DB.prepare(`
        INSERT INTO game_images (hash, image)
        VALUES (?, ?)
      `).run(hash, req.file.buffer);
    }

    // set moderation status to pending
    gameimages_DB.prepare(`
      INSERT OR REPLACE INTO game_image_moderation
      (hash, approved, reviewed_at)
      VALUES (?, 0, strftime('%s','now'))
    `).run(hash);

    thumbnailPath = hash;
  }

  games_DB.prepare(`
    UPDATE games
    SET name = ?,
        description = ?,
        is_public = ?,
        updated_at = strftime('%s','now'),
        thumbnail = COALESCE(?, thumbnail)
    WHERE id = ?
  `).run(
    name,
    description,
    is_public ? 1 : 0,
    thumbnailPath,
    gameId
  );

  res.json({ ok: true });
});

app.get("/studio/:id", (req, res) => {
    if (!req.user) {
        return res.redirect("/signin?error=1");
    }

    res.render("studio", getViewData(req));
});

app.get("/game/:id", (req, res) => {
  const gameId = Number(req.params.id);

  if (isNaN(gameId)) {
    return res.status(400).send("Invalid game ID");
  }

  const game = games_DB.prepare(`
    SELECT 
      id,
      owner_id,
      name,
      description,
      thumbnail,
      is_public,
      data_size,
      created_at,
      updated_at
    FROM games
    WHERE id = ?
  `).get(gameId);

  if (!game) {
    return res.status(404).send("Game not found");
  }

  let canplay = true;

  if (!isadmin(req)) {
    const userId = req.user?.id;

    const isOwner = userId && game.owner_id === userId;
    const isPublic = game.is_public;

    if (!isPublic && !isOwner) {
      canplay = false;
    }
  }
  console.log(canplay)


  const playerCount = Player_counts.get(gameId) || 0;


  // Optional: get owner username
  const owner = users_DB.prepare(`
    SELECT username FROM users WHERE id = ?
  `).get(game.owner_id);

  const votes = games_DB.prepare(`
    SELECT 
      SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END) as likes,
      SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END) as dislikes
    FROM game_votes
    WHERE game_id = ?
  `).get(gameId) || { likes: 0, dislikes: 0 };

  const likes = votes.likes || 0;
  const dislikes = votes.dislikes || 0;
  const total = likes + dislikes;
  const percent = total > 0
    ? Math.round((likes / total) * 100)
    : 50;

  res.render("game", {
    ...getViewData(req),
    game,
    owner: owner?.username || "Unknown",
    ownerID: game.owner_id,
    playerCount,
    percent,
    likes,
    dislikes,
    canplay
  });
});

function getVoteStats(gameId) {
  return games_DB.prepare(`
    SELECT 
      SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END) as likes,
      SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END) as dislikes
    FROM game_votes
    WHERE game_id = ?
  `).get(gameId) || { likes: 0, dislikes: 0 };
}

app.post("/api/games/:id/like", (req, res) => {
  if (!req.user) {
    return res.sendStatus(403)
  }

  const gameId = Number(req.params.id);
  const userId = req.user.id;

  const existing = games_DB.prepare(`
    SELECT value FROM game_votes
    WHERE user_id = ? AND game_id = ?
  `).get(userId, gameId);

  if (!existing) {
    // no vote → like it
    games_DB.prepare(`
      INSERT INTO game_votes (user_id, game_id, value)
      VALUES (?, ?, 1)
    `).run(userId, gameId);

  } else if (existing.value === 1) {
    // already liked → remove like (unlike)
    games_DB.prepare(`
      DELETE FROM game_votes
      WHERE user_id = ? AND game_id = ?
    `).run(userId, gameId);

  } else {
    // was dislike → switch to like
    games_DB.prepare(`
      UPDATE game_votes
      SET value = 1
      WHERE user_id = ? AND game_id = ?
    `).run(userId, gameId);
  }

  const stats = getVoteStats(gameId);

  res.json({
    ok: true,
    likes: stats.likes || 0,
    dislikes: stats.dislikes || 0
  });
});

app.post("/api/games/:id/dislike", (req, res) => {
  if (!req.user) {
    return res.sendStatus(403)
  }

  const gameId = Number(req.params.id);
  const userId = req.user.id;

  const existing = games_DB.prepare(`
    SELECT value FROM game_votes
    WHERE user_id = ? AND game_id = ?
  `).get(userId, gameId);

  if (!existing) {
    // no vote → dislike it
    games_DB.prepare(`
      INSERT INTO game_votes (user_id, game_id, value)
      VALUES (?, ?, -1)
    `).run(userId, gameId);

  } else if (existing.value === -1) {
    // already disliked → remove dislike (undislike)
    games_DB.prepare(`
      DELETE FROM game_votes
      WHERE user_id = ? AND game_id = ?
    `).run(userId, gameId);

  } else {
    // was like → switch to dislike
    games_DB.prepare(`
      UPDATE game_votes
      SET value = -1
      WHERE user_id = ? AND game_id = ?
    `).run(userId, gameId);
  }

  const stats = getVoteStats(gameId);

  res.json({
    ok: true,
    likes: stats.likes || 0,
    dislikes: stats.dislikes || 0
  });
});

app.get("/profile/:userid", (req, res) => {
  const profileId = Number(req.params.userid);


  const profileUser = users_DB.prepare(`
    SELECT id, username, last_online FROM users WHERE id = ?
  `).get(profileId);

  if (!profileUser) {
    return res.redirect(`/profile/1?error=${ERROR.USER_NOT_FOUND}`);
  }

  const viewerId = req.user?.id;

  let relation = "none";

  if (viewerId && viewerId !== profileId) {

    const isFriend = users_DB.prepare(`
      SELECT 1 FROM friends
      WHERE user_id = ? AND friend_id = ?
    `).get(viewerId, profileId);

    const outgoing = users_DB.prepare(`
      SELECT 1 FROM friend_requests
      WHERE sender_id = ? AND receiver_id = ?
    `).get(viewerId, profileId);

    const incoming = users_DB.prepare(`
      SELECT 1 FROM friend_requests
      WHERE sender_id = ? AND receiver_id = ?
    `).get(profileId, viewerId);

    if (isFriend) {
      relation = "friends";
    } else if (outgoing) {
      relation = "outgoing";
    } else if (incoming) {
      relation = "incoming";
    }
  }

  // ✅ ONLINE STATUS LOGIC
  const now = Math.floor(Date.now() / 1000);

  const diff = now - profileUser.last_online;

  let LASTONLINE = "";

  if (diff < 60) {
    LASTONLINE = `${diff} second${diff !== 1 ? "s" : ""} ago`;
  } else if (diff < 3600) {
    const mins = Math.floor(diff / 60);
    LASTONLINE = `${mins} minute${mins !== 1 ? "s" : ""} ago`;
  } else if (diff < 86400) {
    const hours = Math.floor(diff / 3600);
    LASTONLINE = `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  } else {
    const days = Math.floor(diff / 86400);
    LASTONLINE = `${days} day${days !== 1 ? "s" : ""} ago`;
  }

  let status = "";

  if (profileUser.last_online && (now - profileUser.last_online) < 30) {
    status = "onlinestatus";
    LASTONLINE = "online"
  }

  let gamename = "";
  let gamethumb = "";
  let gameid = "";
  let jobid = ""

  const ingame = Players_in_games.get(profileId)
  if (ingame) {
    jobid = ingame["jobid"]
    const game = games_DB.prepare(`
      SELECT id, name, thumbnail
      FROM games
      WHERE id = ?
    `).get(ingame["gameid"]);
    if (game) {
      gamename = game.name;
      gamethumb = game.thumbnail;
      gameid = game.id;

      status = "gamestatus"
    }
  }

  const notmyprofile = viewerId != profileId

  res.render("profile", {
    ...getViewData(req),
    userid: profileUser.id,
    username: profileUser.username,
    relation,
    status,
    gamename,
    gamethumb,
    gameid,
    jobid,
    notmyprofile,
    LASTONLINE
  });
});

function login(res, user) {
    const sessionId = crypto.randomBytes(24).toString("hex");

    setSession(sessionId, user.id);

    res.cookie("sessionId", sessionId, {
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 * 7
    });

    res.redirect("/");
}

app.get("/api/session/:sessionId", (req, res) => {
  const sessionId = req.params.sessionId;

  const userId = getSession(sessionId);

  if (!userId) {
    return res.json({
      id: 0,
      username: "Guest" + Math.floor(Math.random() * 10000)
    })
  }

  const stmt = users_DB.prepare(
    "SELECT id, username FROM users WHERE id = ?"
  );

  const user = stmt.get(userId);

  if (!user) {
    return res.status(404).json({
      error: "User not found"
    });
  }

  res.json(user);
});

app.post("/api/logout", (req, res) => {
    const sessionId = req.cookies.sessionId;

    if (sessionId) {
        sessions_DB.prepare(`
            DELETE FROM sessions WHERE session_id = ?
        `).run(sessionId);
    }

    res.clearCookie("sessionId");

    res.redirect("/");
});

app.post("/api/signup", (req, res) => {
    const { username, password } = req.body;

    const salt = crypto.randomBytes(16).toString("hex");
    const hash = Sha256text(password + salt);

    const stmt = users_DB.prepare(`
        INSERT INTO users (username, password_hash, salt)
        VALUES (?, ?, ?)
    `);

    try {
        const result = stmt.run(username, hash, salt);

        const user = {
            id: result.lastInsertRowid,
            username
        };

        login(res, user);

    } catch (err) {
        res.redirect(`/signup?error=${ERROR.USERNAME_TAKEN}`);
    }
});

app.post("/api/changepassword", (req, res) => {
  if (!req.user) {
    return res.redirect(`/settings?error=${ERROR.USER_NOT_FOUND}`)
  }
  
  const userId = req.user.id
  if (!userId) {
    return res.redirect(`/settings?error=${ERROR.USER_NOT_FOUND}`)
  }

  const { currentpassword, newpassword, newpasswordconfirm } = req.body;

  if (!currentpassword || !newpassword || !newpasswordconfirm) {
    return res.redirect(`/settings?error=${ERROR.MISSINGFIELDS}`)
  }

  if (newpassword !== newpasswordconfirm) {
    return res.redirect(`/settings?error=${ERROR.PASSWORD_NOT_MATCH}`)
  }

  const user = users_DB.prepare(`
    SELECT password_hash, salt FROM users WHERE id = ?
  `).get(userId);

  if (!user) {
    return res.status(404).send("User not found");
  }

  const currentHash = Sha256text(currentpassword + user.salt);

  if (currentHash !== user.password_hash) {
    return res.redirect(`/settings?error=${ERROR.WRONG_PASSWORD}`)
  }

  const newSalt = crypto.randomBytes(16).toString("hex");
  const newHash = Sha256text(newpassword + newSalt);

  users_DB.prepare(`
    UPDATE users
    SET password_hash = ?,
        salt = ?
    WHERE id = ?
  `).run(newHash, newSalt, userId);

  res.redirect("/settings");
});


app.post("/api/signin", (req, res) => {
    const { username, password } = req.body;

    const stmt = users_DB.prepare(`
        SELECT * FROM users WHERE username = ?
    `);

    const user = stmt.get(username);

    if (!user) {
        return res.redirect(`/signin?error=${ERROR.USER_NOT_FOUND}`);
    }

    const hashedAttempt = Sha256text(password + user.salt);

    if (hashedAttempt !== user.password_hash) {
        return res.redirect(`/signin?error=${ERROR.WRONG_PASSWORD}`);
    }

    login(res, user);
});
//games

function generateDefaultGameName() {
  const adjectives = [
    "Cool", "Epic", "Dark", "Bright", "Tiny", "Mega",
    "Neon", "Silent", "Wild", "Pixel", "Lost", "Ancient"
  ];

  const nouns = [
    "World", "Island", "City", "Adventure", "Zone",
    "Realm", "Project", "Game", "Build", "Lab", "Dimension"
  ];

  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];

  const num = Math.floor(Math.random() * 900 + 100); // 100–999

  return `${adj} ${noun} ${num}`;
}

const defaultgameSIZE = 8001

app.post("/api/games/create", (req, res) => {
  if (!req.user) {
    return res.status(401).send("Not logged in");
  }

  const userid = req.user.id;
  const now = Date.now();

  let defaultname = generateDefaultGameName();

  const result = games_DB.prepare(`
    INSERT INTO games (
      owner_id,
      name,
      description,
      data,
      data_size,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    userid,
    defaultname,
    "",
    null,
    defaultgameSIZE,
    now,
    now
  );

  res.json({
    id: result.lastInsertRowid,
    owner_id: userid,
    name: "Untitled Game",
    description: "",
    data: null,
    created_at: now,
    updated_at: now
  });
});

app.get("/api/games/list", (req, res) => {
  if (!req.user) {
    return res.status(401).json([]);
  }

  const games = games_DB.prepare(`
    SELECT id, name, description, is_public, thumbnail, data_size
    FROM games
    WHERE owner_id = ?
    ORDER BY id DESC
  `).all(req.user.id);

  res.json(games);
});


let discoverCache = [];

function rebuildDiscover() {
  const games = games_DB.prepare(`
    SELECT id, name, description, thumbnail, updated_at
    FROM games
    WHERE is_public = 1
  `).all();

  const enriched = games.map(g => {
    const votes = games_DB.prepare(`
      SELECT 
        SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END) as likes,
        SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END) as dislikes
      FROM game_votes
      WHERE game_id = ?
    `).get(g.id) || { likes: 0, dislikes: 0 };

    return {
      ...g,
      likes: votes.likes || 0,
      dislikes: votes.dislikes || 0,
      playerCount: Player_counts.get(g.id) || 0
    };
  });

  enriched.sort((a, b) => b.playerCount - a.playerCount);

  discoverCache = enriched;
}

setInterval(rebuildDiscover, 5000);

app.get("/api/games/discover", (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = 50;
  const offset = (page - 1) * limit;

  const start = offset;
  const end = offset + limit;

  const pageData = discoverCache.slice(start, end);

  res.json(pageData);
});


//important stuff


const tickets = new Map();
const Servers = {};

function consumeTicket(ticket) {
  const entry = tickets.get(ticket);
  if (!entry) return null;

  if (Date.now() > entry.expires) {
    tickets.delete(ticket);
    return null;
  }

  tickets.delete(ticket); // one-time use
  return entry;
}



const activeClients = new Map();
const lastGames = new Map();

app.get("/client", (req, res) => {
  console.log(Servers)

  const sessionId = req.cookies.sessionId;
  const ticket = req.query.ticket;

  // 🔁 FIRST ENTRY (with ?ticket=)
  if (ticket) {
    const sessionData = consumeTicket(ticket);

    if (!sessionData) {
      return res.status(403).send("Invalid or expired ticket");
    }

    // store active session
    activeClients.set(sessionId, sessionData);

    // ✅ store last game
    if (sessionData.gameId) {
      lastGames.set(sessionId, sessionData.gameId);
    }

    return res.redirect("/client");
  }

  // 🟢 SECOND ENTRY (clean URL)
  const sessionData = activeClients.get(sessionId);
  activeClients.delete(sessionId);

  // ❗ fallback if no session
  if (!sessionData) {
    const lastGameId = lastGames.get(sessionId);

    if (lastGameId) {
      return res.redirect(`/game/${lastGameId}`);
    }
  }

  const jobid = sessionData.JOBID;


  const port = Servers[jobid][1];

  res.render("client", {
    ...getViewData(req),
    jobid,
    port
  });
});

function generateJOBID() {
    return crypto.randomBytes(32).toString("hex");
}

function createTicket(SESHID, JOBID, gameId) {
  const ticket = crypto.randomBytes(32).toString("hex");

  tickets.set(ticket, {
    SESHID,
    JOBID,
    gameId,
    expires: Date.now() + 1000 * 60 * 5 // 5 minute expiry
  });

  return ticket;
}


function checkPort(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once("error", () => resolve(false))
      .once("listening", () => {
        tester.close();
        resolve(true);
      })
      .listen(port);
  });
}

async function getRandomFreePort(min = 8000, max = 65535) {
  while (true) {
    const port = Math.floor(Math.random() * (max - min)) + min;

    if (await checkPort(port)) {
      return port;
    }
  }
}

async function startVexlServer(vexlbuffer, jobid, gameid) {
    const FREE_PORT_FOR_ME = await getRandomFreePort();
    
    const child = spawn(
        "node",
        ["--max-old-space-size=512", "vexlserver.js"],
        {
        stdio: ["pipe", "inherit", "inherit", "ipc"]
        }
    );



    child.send({ type: "job", jobid });
    child.stdin.write(vexlbuffer);
    child.stdin.end();

    child.send({
        type: "init",
        port: FREE_PORT_FOR_ME
    });

    


    Servers[jobid] = [child, FREE_PORT_FOR_ME, gameid]

  child.on("exit", () => {
    console.log("VEXL server stopped");
    delete Servers[jobid]
  });

  return child;
}

function gunzipAsync(buffer) {
  return new Promise((resolve, reject) => {
    zlib.gunzip(buffer, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

async function is_vexl_file(buffer) {
  try {
    // ✅ 1. quick sanity checks (cheap)
    if (!buffer || buffer.length < 10) return false;

    // gzip magic number check
    if (buffer[0] !== 0x1f || buffer[1] !== 0x8b) return false;

    // prevent absurd payloads (extra safety)
    if (buffer.length > 10 * 1024 * 1024) return false; // 10MB

    // ✅ 2. decompress
    const ung = await gunzipAsync(buffer);

    if (!ung || ung.length === 0) return false;

    // prevent decompression bombs
    if (ung.length > 50 * 1024 * 1024) return false; // 50MB uncompressed cap

    // ✅ 3. parse JSON safely
    let parsed;
    try {
      parsed = JSON.parse(ung.toString());
    } catch {
      return false;
    }

    if (!parsed || typeof parsed !== "object") return false;

    // ✅ 4. root validation
    const root = parsed["GAME_MODEL_ID"];
    if (!root || typeof root !== "object") return false;

    if (!root.props || typeof root.props !== "object") return false;
    if (root.props.ClassName !== "game") return false;

    if (!Array.isArray(root.children)) return false;

    // ✅ 5. limit object count (anti JSON bomb)
    const keys = Object.keys(parsed);
    if (keys.length > 10000) return false;

    // ✅ 6. validate each instance (lightweight but strict)
    for (const id of keys) {
      const obj = parsed[id];

      if (!obj || typeof obj !== "object") return false;

      // props check
      if (!obj.props || typeof obj.props !== "object") return false;

      // ClassName must exist
      if (typeof obj.props.ClassName !== "string") return false;

      // children must be array
      if (!Array.isArray(obj.children)) return false;

      // optional: children must be valid ids
      for (const child of obj.children) {
        if (typeof child !== "string") return false;
      }
    }

    // ✅ passed all checks
    return true;

  } catch {
    return false;
  }
}



app.post("/api/studio/create_temp_vexl", express.raw({ type: "*/*", limit: "10mb" }), async (req, res) => {
    if (!req.user.id) {
        return res.redirect("/signin?error=1");
    }
    const sessionId = req.cookies.sessionId;
    
    const buffer = req.body; // this is a Buffer
    if (!buffer || buffer.length === 0) {
        return res.status(400).send("Empty upload");
    }
    if (!(await is_vexl_file(buffer))) {
        return res.status(400).send("File doesnt look right");
    }
  const jobid = generateJOBID()
    
  startVexlServer(buffer, jobid, "studio_server")

  const ticket = createTicket(sessionId, jobid, "studio_server")

  res.json({ ticket });
});

function findOpenServer(gameId) {
  for (const jobid in Servers) {
    const server = Servers[jobid];

    if (server[2] === gameId) {
      return { jobid, server };
    }
  }
  return null;
}

app.post("/api/games/join/:id", async (req, res) => {
  const gameId = Number(req.params.id);
  const sessionId = req.cookies.sessionId;

  const game = games_DB.prepare(`
    SELECT data, is_public FROM games WHERE id = ?
  `).get(gameId);

  if (!game) return res.status(404).send("Game not found");


  if (!isadmin(req)) {
    const userId = req.user?.id;

    const isOwner = userId && game.owner_id === userId;
    const isPublic = game.is_public;
    
    if (!isPublic && !isOwner) {
      return res.status(403).send("This game is private");
    }
  }


  let existing = findOpenServer(gameId);

  let jobid;

  if (existing) {
    jobid = existing.jobid;
  } else {
    jobid = generateJOBID();

    const buffer =
      game.data || fs.readFileSync("./public/Baseplate.vexl");

    await startVexlServer(buffer, jobid, gameId);
  }

  const ticket = createTicket(sessionId, jobid, gameId);

  res.json({ ticket });
});

app.post("/api/games/joinjobid/:id/:gameid", async (req, res) => {
  const jobid = req.params.id;
  const gameId = Number(req.params.gameid);
  const sessionId = req.cookies.sessionId;

  const game = games_DB.prepare(`
    SELECT data, is_public FROM games WHERE id = ?
  `).get(gameId);

  if (!game) return res.status(404).send("Game not found");


  if (!isadmin(req)) {
    const userId = req.user?.id;

    const isOwner = userId && game.owner_id === userId;
    const isPublic = game.is_public;
    
    if (!isPublic && !isOwner) {
      return res.status(403).send("This game is private");
    }
  }
  const ticket = createTicket(sessionId, jobid, gameId);

  res.json({ ticket });
});





app.post("/api/studio/publish/:id", express.raw({ type: "*/*", limit: "10mb" }), async (req, res) => {
  if (!req.user?.id) return res.status(401).send("Not logged in");

  const gameId = Number(req.params.id);
  const buffer = req.body;

  if (!buffer?.length) return res.status(400).send("Empty upload");
  if (!(await is_vexl_file(buffer))) return res.status(400).send("Invalid VEXL");

  const game = games_DB.prepare(`
    SELECT owner_id FROM games WHERE id = ?
  `).get(gameId);

  if (!game) return res.status(404).send("Game not found");

  if (!isadmin(req)) {
    if (game.owner_id !== req.user.id) return res.status(403).send("Not your game");
  }


  const now = Date.now();

games_DB.prepare(`
  UPDATE games
  SET 
    data = ?,
    data_size = ?,
    data_saved = ?,
    data_saved_size = ?,
    updated_at = ?
  WHERE id = ?
`).run(
  buffer,
  buffer.length,
  buffer,
  buffer.length,
  now,
  gameId
);

  res.json({
    success: true,
    mode: "publish",
    gameId
  });
});


app.post("/api/studio/save/:id", express.raw({ type: "*/*", limit: "10mb" }), async (req, res) => {
  if (!req.user?.id) return res.status(401).send("Not logged in");

  const gameId = Number(req.params.id);
  const buffer = req.body;

  if (!buffer?.length) return res.status(400).send("Empty upload");
  if (!(await is_vexl_file(buffer))) return res.status(400).send("Invalid VEXL");

  const game = games_DB.prepare(`
    SELECT owner_id FROM games WHERE id = ?
  `).get(gameId);

  if (!game) return res.status(404).send("Game not found");
  if (!isadmin(req)) {
    if (game.owner_id !== req.user.id) return res.status(403).send("Not your game");
  }
  

  const now = Date.now();

  games_DB.prepare(`
    UPDATE games
    SET data_saved = ?, data_saved_size = ?, updated_at = ?
    WHERE id = ?
  `).run(buffer, buffer.length, now, gameId);

  res.json({ success: true, mode: "save" });
});

app.get("/api/games/vexl/:id", (req, res) => {
  if (!req.user?.id) {
    return res.status(401).send("Not logged in");
  }

  const gameId = Number(req.params.id);

  const game = games_DB.prepare(`
    SELECT data_saved, owner_id
    FROM games
    WHERE id = ?
  `).get(gameId);

  if (!game) {
    return res.status(404).send("Game not found");
  }

  if (!isadmin(req)) {
  // 🔒 ownership check
  if (game.owner_id !== req.user.id) {
    return res.status(403).send("Not your game");
  }
  }



  let buffer;

  // ✅ fallback to baseplate OR saved data
  if (!game.data_saved) {
    buffer = fs.readFileSync("./public/Baseplate.vexl");
  } else {
    buffer = game.data_saved;
  }

  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Length", buffer.length);

  res.send(buffer);
});

app.post("/api/friends/request", (req, res) => {
  if (!req.user?.id) {
    return res.status(401).send("Not logged in");
  }

  const senderId = req.user.id;
  const receiverId = Number(req.body.friendId);

  if (!receiverId || receiverId === senderId) {
    return res.status(400).send("Invalid user");
  }

  // 1. Check if reverse request already exists
  const reverse = users_DB.prepare(`
    SELECT 1 FROM friend_requests
    WHERE sender_id = ? AND receiver_id = ?
  `).get(receiverId, senderId);

  if (reverse) {
    // 🔥 mutual request → auto accept friendship

    users_DB.prepare(`
      DELETE FROM friend_requests
      WHERE sender_id = ? AND receiver_id = ?
    `).run(receiverId, senderId);

    // create friendship both ways
    users_DB.prepare(`
      INSERT OR IGNORE INTO friends (user_id, friend_id)
      VALUES (?, ?)
    `).run(senderId, receiverId);

    users_DB.prepare(`
      INSERT OR IGNORE INTO friends (user_id, friend_id)
      VALUES (?, ?)
    `).run(receiverId, senderId);

    return res.json({ success: true, autoAccepted: true });
  }

  // 2. Otherwise just create request
  users_DB.prepare(`
    INSERT OR IGNORE INTO friend_requests (sender_id, receiver_id)
    VALUES (?, ?)
  `).run(senderId, receiverId);

  res.json({ success: true });
});

app.post("/api/friends/accept", (req, res) => {
  if (!req.user?.id) {
    return res.status(401).send("Not logged in");
  }

  const receiverId = req.user.id;
  const senderId = Number(req.body.friendId);

  if (!senderId) {
    return res.status(400).send("Invalid user");
  }

  // remove request
  users_DB.prepare(`
    DELETE FROM friend_requests
    WHERE sender_id = ? AND receiver_id = ?
  `).run(senderId, receiverId);

  // create friendship both ways
  users_DB.prepare(`
    INSERT OR IGNORE INTO friends (user_id, friend_id)
    VALUES (?, ?)
  `).run(senderId, receiverId);

  users_DB.prepare(`
    INSERT OR IGNORE INTO friends (user_id, friend_id)
    VALUES (?, ?)
  `).run(receiverId, senderId);

  res.json({ success: true });
});

app.post("/api/friends/remove", (req, res) => {
  if (!req.user?.id) {
    return res.status(401).send("Not logged in");
  }

  const userId = req.user.id;
  const friendId = Number(req.body.friendId);

  if (!friendId || friendId === userId) {
    return res.status(400).send("Invalid friend id");
  }

  // delete both directions of friendship
  users_DB.prepare(`
    DELETE FROM friends
    WHERE (user_id = ? AND friend_id = ?)
       OR (user_id = ? AND friend_id = ?)
  `).run(userId, friendId, friendId, userId);

  res.json({ success: true });
});


app.post("/api/friends/reject", (req, res) => {
  if (!req.user?.id) {
    return res.status(401).send("Not logged in");
  }

  const receiverId = req.user.id;
  const senderId = Number(req.body.friendId);

  users_DB.prepare(`
    DELETE FROM friend_requests
    WHERE sender_id = ? AND receiver_id = ?
  `).run(senderId, receiverId);

  res.json({ success: true });
});

app.get("/api/friends/requests", (req, res) => {
  if (!req.user?.id) {
    return res.status(401).send("Not logged in");
  }

  const userId = req.user.id;

  const requests = users_DB.prepare(`
    SELECT u.id, u.username
    FROM friend_requests fr
    JOIN users u ON u.id = fr.sender_id
    WHERE fr.receiver_id = ?
  `).all(userId);

  res.json({ requests });
});

app.get("/api/friends/list", (req, res) => {
  const userId = Number(req.query.userId);

  if (!userId || Number.isNaN(userId)) {
    return res.status(400).send("Invalid userId");
  }

  const friends = users_DB.prepare(`
    SELECT u.id, u.username, u.last_online
    FROM friends f
    JOIN users u ON u.id = f.friend_id
    WHERE f.user_id = ?
  `).all(userId);

  const now = Math.floor(Date.now() / 1000);

  // enrich friend data
  for (const friend of friends) {

    // default status
    friend.status = "";

    if (friend.last_online && (now - friend.last_online) < 30) {
      friend.status = "onlinestatus";
    }

    friend.playing = false;
    friend.gameid = null;
    friend.gamename = null;
    friend.gamethumb = null;
    friend.jobid = null;

    const ingame = Players_in_games.get(friend.id);

    if (ingame) {
      const game = games_DB.prepare(`
        SELECT id, name, thumbnail
        FROM games
        WHERE id = ?
      `).get(ingame.gameid);

      if (game) {
        friend.playing = true;
        friend.gameid = game.id;
        friend.gamename = game.name;
        friend.gamethumb = game.thumbnail;
        friend.jobid = ingame.jobid;

        // override online status
        friend.status = "gamestatus";
      }
    }
  }

  res.json({
    friends,
    now
  });
});



app.post("/api/user/online", (req, res) => {
  if (!req.user?.id) {
    return res.status(401).send("Not logged in");
  }

  const userId = req.user.id;

  users_DB.prepare(`
    UPDATE users
    SET last_online = strftime('%s','now')
    WHERE id = ?
  `).run(userId);

  res.json({ success: true });
});

const server = http.createServer(app);
const proxy = createProxyServer({ ws: true });


function waitForPort(port, cb) {
  const interval = setInterval(() => {
    const tester = net.createConnection(port);

    tester.once("connect", () => {
      tester.end();
      clearInterval(interval);
      cb();
    });

    tester.once("error", () => {});
  }, 100);
}

server.on("upgrade", (req, socket, head) => {
  const user = getUserFromReq(req)
  if (!req.url.startsWith("/gameserver")) return;

  try {
    const url = new URL(req.url, "http://localhost");
    const jobid = url.searchParams.get("jobid");

    if (!jobid || !Servers[jobid]) {
      socket.destroy();
      return;
    }

    const port = Servers[jobid][1];
    const GameID = Servers[jobid][2];

    
    waitForPort(port, () => {
      const proxyReq = proxy.ws(req, socket, head, {
        target: `ws://localhost:${port}`,
      });

      // increment ONLY when connection is accepted
      Player_counts.set(GameID, (Player_counts.get(GameID) || 0) + 1);

      if (user) {
        Players_in_games.set(user.id, {
          "gameid": GameID, 
          "jobid": jobid
        })
      }

      


      // decrement on close
      socket.on("close", () => {
        const current = Player_counts.get(GameID) || 0;
        Player_counts.set(GameID, Math.max(current - 1, 0));

        if (user) {
          Players_in_games.delete(user.id)
        }

      });
    });

  } catch (err) {
    socket.destroy();
  }
});

server.listen(3000, () => {
    console.log("http://localhost:3000");
});