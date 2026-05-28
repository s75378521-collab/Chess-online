const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, "public");
const storePath = path.join(__dirname, "data", "store.json");

const sessions = new Map();
const adminSessions = new Map();
const rooms = new Map();

const defaultStore = {
    config: {
        nextUserId: 3,
        adminPinHash: "9af15b336e6a9619928537df30b2e6a2376569fcf9d7e773eccede65606529a0"
    },
    users: [
        {
            id: 0,
            name: "Spencer",
            passwordHash: "65e84be33532fb784c48129675f9eff3a682b27168c0ea744b2cf58ee02337c5",
            role: "Admin",
            avatar: "👤",
            preferences: { hints: true, darkMode: false, difficulty: "Easy", preferredColor: "random" },
            history: []
        },
        {
            id: 1,
            name: "Grandmaster_01",
            passwordHash: "ac739dccd121f71261d87461256e9ca70d8e3b6dbbcc9076d5f3b50c73a5d22d",
            role: "Player",
            avatar: "👑",
            preferences: { hints: true, darkMode: false, difficulty: "Easy", preferredColor: "random" },
            history: []
        },
        {
            id: 2,
            name: "AlphaBot",
            passwordHash: "20f5691fd825a070a6c88d303a7a24087d07c3bc295fded4b6334e4929646c43",
            role: "Player",
            avatar: "🤖",
            preferences: { hints: true, darkMode: false, difficulty: "Easy", preferredColor: "random" },
            history: []
        }
    ]
};

const userById = new Map();
const userByNameLower = new Map();

ensureStore();

function ensureStore() {
    if (!fs.existsSync(storePath)) {
        fs.mkdirSync(path.dirname(storePath), { recursive: true });
        fs.writeFileSync(storePath, JSON.stringify(defaultStore, null, 2));
    }
}

function rebuildUserIndexes(users) {
    userById.clear();
    userByNameLower.clear();
    users.forEach(user => {
        userById.set(user.id, user);
        userByNameLower.set(user.name.toLowerCase(), user);
    });
}

function loadStore() {
    const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
    rebuildUserIndexes(store.users);
    return store;
}

function saveStore(store) {
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
    rebuildUserIndexes(store.users);
}

function hashValue(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function json(res, statusCode, payload) {
    res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload));
}

function notFound(res) {
    json(res, 404, { error: "Not found" });
}

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let raw = "";
        req.on("data", chunk => {
            raw += chunk;
            if (raw.length > 1e6) {
                req.destroy();
                reject(new Error("Payload too large"));
            }
        });
        req.on("end", () => {
            if (!raw) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(raw));
            } catch {
                reject(new Error("Invalid JSON"));
            }
        });
        req.on("error", reject);
    });
}

function safeUser(user) {
    return {
        id: user.id,
        name: user.name,
        role: user.role,
        avatar: user.avatar,
        preferences: user.preferences
    };
}

function readAuthToken(req) {
    const header = req.headers.authorization || "";
    return header.startsWith("Bearer ") ? header.slice(7) : null;
}

function requireUser(req, res, store) {
    const token = readAuthToken(req);
    const userId = token ? sessions.get(token) : null;
    const user = userId != null ? userById.get(userId) : undefined;
    if (!user) {
        json(res, 401, { error: "Unauthorized" });
        return null;
    }
    return { token, user };
}

function requireAdmin(req, res, store) {
    const token = req.headers["x-admin-token"];
    const userId = token ? adminSessions.get(token) : null;
    const user = userId != null ? userById.get(userId) : undefined;
    if (!user || user.role !== "Admin") {
        json(res, 401, { error: "Admin authorization required" });
        return null;
    }
    return { token, user };
}

function sendFile(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const types = {
        ".html": "text/html; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon"
    };

    fs.readFile(filePath, (error, content) => {
        if (error) {
            notFound(res);
            return;
        }
        res.writeHead(200, { "Content-Type": types[ext] || "text/plain; charset=utf-8" });
        res.end(content);
    });
}

function getNetworkUrls(port) {
    const interfaces = os.networkInterfaces();
    const urls = [];

    Object.values(interfaces).forEach(entries => {
        (entries || []).forEach(entry => {
            if (!entry || entry.internal) {
                return;
            }

            if (entry.family === "IPv4") {
                urls.push(`http://${entry.address}:${port}`);
            }
        });
    });

    return urls;
}

function createEmptyBoard() {
    return Array.from({ length: 8 }, () => Array(8).fill(null));
}

function createInitialBoard() {
    const board = createEmptyBoard();
    const order = ["r", "n", "b", "q", "k", "b", "n", "r"];

    for (let c = 0; c < 8; c += 1) {
        board[0][c] = { type: order[c], color: "black", hasMoved: false };
        board[1][c] = { type: "p", color: "black", hasMoved: false };
        board[6][c] = { type: "p", color: "white", hasMoved: false };
        board[7][c] = { type: order[c], color: "white", hasMoved: false };
    }

    return board;
}

function normalizeSeatPreference(value) {
    return value === "white" || value === "black" ? value : "random";
}

function generateRoomId() {
    let roomId = "";
    do {
        roomId = crypto.randomBytes(3).toString("hex").toUpperCase();
    } while (rooms.has(roomId));
    return roomId;
}

function summarizePlayer(user) {
    return user ? { id: user.id, name: user.name, avatar: user.avatar } : null;
}

function oppositeColor(color) {
    return color === "white" ? "black" : "white";
}

function isValid(r, c) {
    return r >= 0 && r < 8 && c >= 0 && c < 8;
}

function getPseudoMoves(board, r, c, piece, enPassant, attacksOnly) {
    const moves = [];
    const addSlidingMoves = directions => {
        directions.forEach(([dr, dc]) => {
            let nr = r + dr;
            let nc = c + dc;
            while (isValid(nr, nc)) {
                const target = board[nr][nc];
                if (!target) {
                    moves.push({ from: { r, c }, to: { r: nr, c: nc }, piece, capture: false });
                } else {
                    if (target.color !== piece.color) {
                        moves.push({ from: { r, c }, to: { r: nr, c: nc }, piece, capture: true });
                    }
                    break;
                }
                nr += dr;
                nc += dc;
            }
        });
    };

    if (piece.type === "p") {
        const direction = piece.color === "white" ? -1 : 1;
        const startRow = piece.color === "white" ? 6 : 1;
        const promotionRow = piece.color === "white" ? 0 : 7;

        if (!attacksOnly) {
            const oneStep = r + direction;
            if (isValid(oneStep, c) && !board[oneStep][c]) {
                moves.push({ from: { r, c }, to: { r: oneStep, c }, piece, capture: false, promotion: oneStep === promotionRow });
                const twoStep = r + direction * 2;
                if (r === startRow && isValid(twoStep, c) && !board[twoStep][c]) {
                    moves.push({ from: { r, c }, to: { r: twoStep, c }, piece, capture: false, doubleStep: true });
                }
            }
        }

        [-1, 1].forEach(dc => {
            const nr = r + direction;
            const nc = c + dc;
            if (!isValid(nr, nc)) {
                return;
            }
            const target = board[nr][nc];
            if (target && target.color !== piece.color) {
                moves.push({ from: { r, c }, to: { r: nr, c: nc }, piece, capture: true, promotion: nr === promotionRow });
                return;
            }
            if (!attacksOnly && enPassant && enPassant.r === nr && enPassant.c === nc) {
                moves.push({
                    from: { r, c },
                    to: { r: nr, c: nc },
                    piece,
                    capture: true,
                    enPassantCapture: { r, c: nc }
                });
            }
            if (attacksOnly) {
                moves.push({ from: { r, c }, to: { r: nr, c: nc }, piece, capture: false });
            }
        });
        return moves;
    }

    if (piece.type === "n") {
        [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]].forEach(([dr, dc]) => {
            const nr = r + dr;
            const nc = c + dc;
            if (!isValid(nr, nc)) {
                return;
            }
            const target = board[nr][nc];
            if (!target || target.color !== piece.color) {
                moves.push({ from: { r, c }, to: { r: nr, c: nc }, piece, capture: Boolean(target) });
            }
        });
        return moves;
    }

    if (piece.type === "b") {
        addSlidingMoves([[1, 1], [1, -1], [-1, 1], [-1, -1]]);
        return moves;
    }

    if (piece.type === "r") {
        addSlidingMoves([[0, 1], [0, -1], [1, 0], [-1, 0]]);
        return moves;
    }

    if (piece.type === "q") {
        addSlidingMoves([[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]);
        return moves;
    }

    [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([dr, dc]) => {
        const nr = r + dr;
        const nc = c + dc;
        if (!isValid(nr, nc)) {
            return;
        }
        const target = board[nr][nc];
        if (!target || target.color !== piece.color) {
            moves.push({ from: { r, c }, to: { r: nr, c: nc }, piece, capture: Boolean(target) });
        }
    });

    if (!attacksOnly && !piece.hasMoved && !isSquareAttacked(board, r, c, oppositeColor(piece.color))) {
        const castleOptions = [
            { rookCol: 7, path: [5, 6], kingTarget: 6, rookTarget: 5 },
            { rookCol: 0, path: [1, 2, 3], kingPath: [2, 3], kingTarget: 2, rookTarget: 3 }
        ];

        castleOptions.forEach(option => {
            const rook = board[r][option.rookCol];
            const betweenClear = option.path.every(col => !board[r][col]);
            const kingSquares = (option.kingPath || option.path).every(col => !isSquareAttacked(board, r, col, oppositeColor(piece.color)));
            if (rook && rook.type === "r" && rook.color === piece.color && !rook.hasMoved && betweenClear && kingSquares) {
                moves.push({
                    from: { r, c },
                    to: { r, c: option.kingTarget },
                    piece,
                    castle: { rookFrom: { r, c: option.rookCol }, rookTo: { r, c: option.rookTarget } }
                });
            }
        });
    }

    return moves;
}

function simulateMove(state, move) {
    const board = state.board.map(row => row.map(square => square ? { ...square } : null));
    const movingPiece = { ...board[move.from.r][move.from.c], hasMoved: true };

    board[move.from.r][move.from.c] = null;
    if (move.enPassantCapture) {
        board[move.enPassantCapture.r][move.enPassantCapture.c] = null;
    }
    board[move.to.r][move.to.c] = move.promotion ? { ...movingPiece, type: "q" } : movingPiece;

    if (move.castle) {
        const rook = { ...board[move.castle.rookFrom.r][move.castle.rookFrom.c], hasMoved: true };
        board[move.castle.rookFrom.r][move.castle.rookFrom.c] = null;
        board[move.castle.rookTo.r][move.castle.rookTo.c] = rook;
    }

    const nextEnPassant = move.doubleStep
        ? { r: (move.from.r + move.to.r) / 2, c: move.from.c, color: movingPiece.color }
        : null;

    return { board, enPassantTarget: nextEnPassant };
}

function isSquareAttacked(board, r, c, byColor) {
    for (let row = 0; row < 8; row += 1) {
        for (let col = 0; col < 8; col += 1) {
            const piece = board[row][col];
            if (!piece || piece.color !== byColor) {
                continue;
            }
            const attacks = getPseudoMoves(board, row, col, piece, null, true);
            if (attacks.some(move => move.to.r === r && move.to.c === c)) {
                return true;
            }
        }
    }
    return false;
}

function findKing(board, color) {
    for (let r = 0; r < 8; r += 1) {
        for (let c = 0; c < 8; c += 1) {
            const piece = board[r][c];
            if (piece && piece.type === "k" && piece.color === color) {
                return { r, c };
            }
        }
    }
    return null;
}

function isKingInCheck(board, color) {
    const king = findKing(board, color);
    return king ? isSquareAttacked(board, king.r, king.c, oppositeColor(color)) : false;
}

function getLegalMoves(board, r, c, activeColor, enPassant) {
    const piece = board[r][c];
    if (!piece || piece.color !== activeColor) {
        return [];
    }

    const pseudoMoves = getPseudoMoves(board, r, c, piece, enPassant, false);
    return pseudoMoves.filter(move => {
        const nextState = simulateMove({ board, enPassantTarget: enPassant }, move);
        return !isKingInCheck(nextState.board, activeColor, nextState.enPassantTarget);
    });
}

function getAllLegalMoves(board, activeColor, enPassant) {
    const moves = [];
    for (let r = 0; r < 8; r += 1) {
        for (let c = 0; c < 8; c += 1) {
            const piece = board[r][c];
            if (piece && piece.color === activeColor) {
                moves.push(...getLegalMoves(board, r, c, activeColor, enPassant));
            }
        }
    }
    return moves;
}

function findMoveFromRequest(room, moveRequest) {
    const from = moveRequest && moveRequest.from;
    const to = moveRequest && moveRequest.to;
    if (!from || !to) {
        return null;
    }

    const legalMoves = getLegalMoves(room.boardState, Number(from.r), Number(from.c), room.turn, room.enPassantTarget);
    return legalMoves.find(move => move.to.r === Number(to.r) && move.to.c === Number(to.c)) || null;
}

function buildRoomSummary(room, user, store) {
    const whiteUser = userById.get(room.whiteUserId) || null;
    const blackUser = userById.get(room.blackUserId) || null;
    const playerColor = room.whiteUserId === user.id ? "white" : room.blackUserId === user.id ? "black" : null;
    const opponent = playerColor === "white" ? blackUser : playerColor === "black" ? whiteUser : null;

    return {
        roomId: room.id,
        boardState: room.boardState,
        turn: room.turn,
        enPassantTarget: room.enPassantTarget,
        gameActive: room.gameActive,
        waitingForOpponent: room.whiteUserId == null || room.blackUserId == null,
        winnerColor: room.winnerColor,
        endedReason: room.endedReason,
        playerColor,
        opponent: summarizePlayer(opponent),
        players: {
            white: summarizePlayer(whiteUser),
            black: summarizePlayer(blackUser)
        }
    };
}

function recordRoomResult(store, room) {
    if (room.historyRecorded || room.gameActive || room.whiteUserId == null || room.blackUserId == null) {
        return;
    }

    const whiteUser = userById.get(room.whiteUserId);
    const blackUser = userById.get(room.blackUserId);
    if (!whiteUser || !blackUser) {
        return;
    }

    const whiteResult = room.endedReason === "stalemate"
        ? "Draw"
        : room.winnerColor === "white"
            ? "Victory"
            : "Defeat";
    const blackResult = room.endedReason === "stalemate"
        ? "Draw"
        : room.winnerColor === "black"
            ? "Victory"
            : "Defeat";
    const playedAt = new Date().toISOString();

    whiteUser.history = whiteUser.history || [];
    blackUser.history = blackUser.history || [];
    whiteUser.history.push({ opponent: blackUser.name, result: whiteResult, playedAt });
    blackUser.history.push({ opponent: whiteUser.name, result: blackResult, playedAt });
    room.historyRecorded = true;
    saveStore(store);
}

function finalizeRoomIfOver(store, room) {
    if (room.whiteUserId == null || room.blackUserId == null) {
        return;
    }

    const legalMoves = getAllLegalMoves(room.boardState, room.turn, room.enPassantTarget);
    if (legalMoves.length) {
        return;
    }

    room.gameActive = false;
    if (isKingInCheck(room.boardState, room.turn)) {
        room.winnerColor = oppositeColor(room.turn);
        room.endedReason = "checkmate";
    } else {
        room.winnerColor = null;
        room.endedReason = "stalemate";
    }
    recordRoomResult(store, room);
}

async function handleApi(req, res, store) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (pathname === "/api/login" && req.method === "POST") {
        const body = await parseBody(req);
        const user = userByNameLower.get(String(body.username || "").toLowerCase());
        if (!user || user.passwordHash !== hashValue(String(body.password || ""))) {
            json(res, 401, { error: "Invalid username or password" });
            return;
        }
        const token = crypto.randomUUID();
        sessions.set(token, user.id);
        json(res, 200, { token, user: safeUser(user), history: user.history || [] });
        return;
    }

    if (pathname === "/api/session" && req.method === "GET") {
        const auth = requireUser(req, res, store);
        if (!auth) {
            return;
        }
        json(res, 200, { user: safeUser(auth.user), history: auth.user.history || [] });
        return;
    }

    if (pathname === "/api/logout" && req.method === "POST") {
        const token = readAuthToken(req);
        if (token) {
            sessions.delete(token);
        }
        json(res, 200, { ok: true });
        return;
    }

    if (pathname === "/api/me/preferences" && req.method === "PATCH") {
        const auth = requireUser(req, res, store);
        if (!auth) {
            return;
        }
        const body = await parseBody(req);
        auth.user.name = String(body.name || auth.user.name).trim() || auth.user.name;
        auth.user.preferences = {
            ...auth.user.preferences,
            ...(body.preferences || {})
        };
        saveStore(store);
        json(res, 200, { user: safeUser(auth.user) });
        return;
    }

    if (pathname === "/api/me/history" && req.method === "POST") {
        const auth = requireUser(req, res, store);
        if (!auth) {
            return;
        }
        const body = await parseBody(req);
        const entry = {
            opponent: String(body.opponent || "Chessplay Bot"),
            result: String(body.result || "Draw"),
            playedAt: String(body.playedAt || new Date().toISOString())
        };
        auth.user.history = auth.user.history || [];
        auth.user.history.push(entry);
        saveStore(store);
        json(res, 200, { history: auth.user.history });
        return;
    }

    if (pathname === "/api/rooms" && req.method === "POST") {
        const auth = requireUser(req, res, store);
        if (!auth) {
            return;
        }

        const body = await parseBody(req);
        const preferredSeat = normalizeSeatPreference(body.preferredColor);
        const assignedColor = preferredSeat === "random"
            ? (Math.random() > 0.5 ? "white" : "black")
            : preferredSeat;
        const room = {
            id: generateRoomId(),
            whiteUserId: assignedColor === "white" ? auth.user.id : null,
            blackUserId: assignedColor === "black" ? auth.user.id : null,
            boardState: createInitialBoard(),
            turn: "white",
            enPassantTarget: null,
            gameActive: true,
            winnerColor: null,
            endedReason: null,
            historyRecorded: false
        };
        rooms.set(room.id, room);
        json(res, 201, { room: buildRoomSummary(room, auth.user, store) });
        return;
    }

    if (pathname === "/api/rooms/join" && req.method === "POST") {
        const auth = requireUser(req, res, store);
        if (!auth) {
            return;
        }

        const body = await parseBody(req);
        const roomId = String(body.roomId || "").trim().toUpperCase();
        const room = rooms.get(roomId);
        if (!room) {
            json(res, 404, { error: "That room was not found" });
            return;
        }

        if (room.whiteUserId === auth.user.id || room.blackUserId === auth.user.id) {
            json(res, 200, { room: buildRoomSummary(room, auth.user, store) });
            return;
        }

        if (room.whiteUserId == null) {
            room.whiteUserId = auth.user.id;
        } else if (room.blackUserId == null) {
            room.blackUserId = auth.user.id;
        } else {
            json(res, 400, { error: "That room is already full" });
            return;
        }

        json(res, 200, { room: buildRoomSummary(room, auth.user, store) });
        return;
    }

    if (pathname.startsWith("/api/rooms/") && pathname.endsWith("/move") && req.method === "POST") {
        const auth = requireUser(req, res, store);
        if (!auth) {
            return;
        }

        const roomId = pathname.split("/")[3];
        const room = rooms.get(roomId);
        if (!room) {
            json(res, 404, { error: "Room not found" });
            return;
        }

        const playerColor = room.whiteUserId === auth.user.id ? "white" : room.blackUserId === auth.user.id ? "black" : null;
        if (!playerColor) {
            json(res, 403, { error: "You are not part of this room" });
            return;
        }
        if (!room.gameActive || room.whiteUserId == null || room.blackUserId == null) {
            json(res, 400, { error: "This room is not ready for moves" });
            return;
        }
        if (room.turn !== playerColor) {
            json(res, 400, { error: "It is not your turn" });
            return;
        }

        const body = await parseBody(req);
        const move = findMoveFromRequest(room, body);
        if (!move) {
            json(res, 400, { error: "That move is not legal" });
            return;
        }

        const next = simulateMove({ board: room.boardState, enPassantTarget: room.enPassantTarget }, move);
        room.boardState = next.board;
        room.enPassantTarget = next.enPassantTarget;
        room.turn = oppositeColor(room.turn);
        finalizeRoomIfOver(store, room);

        json(res, 200, { room: buildRoomSummary(room, auth.user, store) });
        return;
    }

    if (pathname.startsWith("/api/rooms/") && pathname.endsWith("/resign") && req.method === "POST") {
        const auth = requireUser(req, res, store);
        if (!auth) {
            return;
        }

        const roomId = pathname.split("/")[3];
        const room = rooms.get(roomId);
        if (!room) {
            json(res, 404, { error: "Room not found" });
            return;
        }

        const playerColor = room.whiteUserId === auth.user.id ? "white" : room.blackUserId === auth.user.id ? "black" : null;
        if (!playerColor) {
            json(res, 403, { error: "You are not part of this room" });
            return;
        }

        room.gameActive = false;
        room.winnerColor = oppositeColor(playerColor);
        room.endedReason = "resignation";
        recordRoomResult(store, room);
        json(res, 200, { room: buildRoomSummary(room, auth.user, store) });
        return;
    }

    if (pathname.startsWith("/api/rooms/") && req.method === "GET") {
        const auth = requireUser(req, res, store);
        if (!auth) {
            return;
        }

        const roomId = pathname.split("/")[3];
        const room = rooms.get(roomId);
        if (!room) {
            json(res, 404, { error: "Room not found" });
            return;
        }

        if (room.whiteUserId !== auth.user.id && room.blackUserId !== auth.user.id) {
            json(res, 403, { error: "You are not part of this room" });
            return;
        }

        json(res, 200, { room: buildRoomSummary(room, auth.user, store) });
        return;
    }

    if (pathname === "/api/admin/login" && req.method === "POST") {
        const body = await parseBody(req);
        const user = userByNameLower.get(String(body.username || "").toLowerCase());
        const validPin = /^\d{4}$/.test(String(body.pin || "")) && store.config.adminPinHash === hashValue(String(body.pin));
        if (!user || user.role !== "Admin" || user.passwordHash !== hashValue(String(body.password || "")) || !validPin) {
            json(res, 401, { error: "Invalid admin credentials or PIN" });
            return;
        }
        const token = crypto.randomUUID();
        adminSessions.set(token, user.id);
        json(res, 200, { token, user: safeUser(user) });
        return;
    }

    if (pathname === "/api/admin/users" && req.method === "GET") {
        if (!requireAdmin(req, res, store)) {
            return;
        }
        json(res, 200, {
            users: store.users.map(user => ({
                id: user.id,
                name: user.name,
                role: user.role,
                avatar: user.avatar
            }))
        });
        return;
    }

    if (pathname === "/api/admin/users" && req.method === "POST") {
        if (!requireAdmin(req, res, store)) {
            return;
        }
        const body = await parseBody(req);
        const name = String(body.name || "").trim();
        const password = String(body.password || "").trim();
        if (!name || !password) {
            json(res, 400, { error: "Username and password are required" });
            return;
        }
        const exists = userByNameLower.has(name.toLowerCase());
        if (exists) {
            json(res, 400, { error: "That username already exists" });
            return;
        }
        const user = {
            id: store.config.nextUserId++,
            name,
            passwordHash: hashValue(password),
            role: body.role === "Admin" ? "Admin" : "Player",
            avatar: body.avatar || "👤",
            preferences: { hints: true, darkMode: false, difficulty: "Easy", preferredColor: "random" },
            history: []
        };
        store.users.push(user);
        saveStore(store);
        json(res, 201, { user: safeUser(user) });
        return;
    }

    if (pathname.startsWith("/api/admin/users/") && req.method === "PATCH") {
        const auth = requireAdmin(req, res, store);
        if (!auth) {
            return;
        }
        const userId = Number(pathname.split("/").pop());
        const user = userById.get(userId);
        if (!user) {
            notFound(res);
            return;
        }
        const body = await parseBody(req);
        user.name = String(body.name || user.name).trim() || user.name;
        user.avatar = body.avatar || user.avatar;
        user.role = body.role === "Admin" ? "Admin" : "Player";
        if (body.password) {
            user.passwordHash = hashValue(String(body.password));
        }
        saveStore(store);
        json(res, 200, { user: safeUser(user) });
        return;
    }

    if (pathname.startsWith("/api/admin/users/") && req.method === "DELETE") {
        const auth = requireAdmin(req, res, store);
        if (!auth) {
            return;
        }
        const userId = Number(pathname.split("/").pop());
        if (userId === auth.user.id) {
            json(res, 400, { error: "You cannot delete your own admin account" });
            return;
        }
        if (!userById.has(userId)) {
            notFound(res);
            return;
        }
        store.users = store.users.filter(user => user.id !== userId);
        saveStore(store);
        json(res, 200, { ok: true });
        return;
    }

    if (pathname === "/api/admin/pin" && req.method === "PATCH") {
        if (!requireAdmin(req, res, store)) {
            return;
        }
        const body = await parseBody(req);
        const pin = String(body.pin || "");
        if (!/^\d{4}$/.test(pin)) {
            json(res, 400, { error: "PIN must be exactly 4 digits" });
            return;
        }
        store.config.adminPinHash = hashValue(pin);
        saveStore(store);
        json(res, 200, { ok: true });
        return;
    }

    notFound(res);
}

const server = http.createServer(async (req, res) => {
    try {
        const store = loadStore();
        const url = new URL(req.url, `http://${req.headers.host}`);

        if (url.pathname.startsWith("/api/")) {
            await handleApi(req, res, store);
            return;
        }

        let filePath;
        if (url.pathname === "/" || url.pathname === "/index.html") {
            filePath = path.join(publicDir, "index.html");
        } else if (url.pathname === "/admin" || url.pathname === "/admin/") {
            filePath = path.join(publicDir, "admin", "index.html");
        } else {
            filePath = path.join(publicDir, decodeURIComponent(url.pathname));
        }

        const normalized = path.normalize(filePath);
        if (!normalized.startsWith(publicDir)) {
            notFound(res);
            return;
        }
        sendFile(res, normalized);
    } catch (error) {
        json(res, 500, { error: error.message || "Server error" });
    }
});

server.on("error", error => {
    if (error && error.code === "EADDRINUSE") {
        console.error(`Port ${PORT} is already in use. Stop the other Chessplay server or set a different PORT and try again.`);
        process.exitCode = 1;
        return;
    }

    console.error(error);
    process.exitCode = 1;
});

server.listen(PORT, () => {
    console.log(`Chessplay server running at http://localhost:${PORT}`);
    const networkUrls = getNetworkUrls(PORT);
    networkUrls.forEach(url => {
        console.log(`Network access: ${url}`);
    });
});
