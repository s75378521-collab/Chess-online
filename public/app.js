const pieceIcons = {
    white: { p: "\u2659", r: "\u2656", n: "\u2658", b: "\u2657", q: "\u2655", k: "\u2654" },
    black: { p: "\u265F", r: "\u265C", n: "\u265E", b: "\u265D", q: "\u265B", k: "\u265A" }
};

const difficultyDepth = { Easy: 0, Medium: 1, Hard: 2 };
const tokenKey = "chessplay-token";
const defaultPreferences = {
    hints: true,
    darkMode: false,
    difficulty: "Easy",
    preferredColor: "random",
    showCoordinates: true,
    boardTheme: "classic"
};

let currentUser = null;
let boardState = createEmptyBoard();
let selectedSquare = null;
let possibleMoves = [];
let playerColor = "white";
let botColor = "black";
let turn = "white";
let enPassantTarget = null;
let gameActive = false;
let pendingBotMove = false;
let matchHistory = [];
let gameMode = "bot";
let onlineRoom = null;
let onlinePollTimer = null;
let onlineSnapshotKey = "";
let lastMoveHighlight = null;

function createEmptyBoard() {
    return Array.from({ length: 8 }, () => Array(8).fill(null));
}

function normalizeUser(user) {
    return {
        ...user,
        preferences: {
            ...defaultPreferences,
            ...(user.preferences || {})
        }
    };
}

function currentPreferences() {
    return currentUser ? currentUser.preferences : defaultPreferences;
}

async function api(path, options = {}) {
    const token = localStorage.getItem(tokenKey);
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(path, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || "Request failed");
    }
    return data;
}

async function bootstrap() {
    lucide.createIcons();
    const token = localStorage.getItem(tokenKey);
    if (!token) {
        return;
    }

    try {
        const data = await api("/api/session");
        currentUser = normalizeUser(data.user);
        matchHistory = data.history || [];
        applyUserToUi();
        showView("lobby-view");
    } catch {
        localStorage.removeItem(tokenKey);
    }
}

function showLoginError(message) {
    const node = document.getElementById("login-error");
    node.textContent = message;
    node.classList.remove("hidden");
}

function setLobbyStatus(message, isError = false) {
    const node = document.getElementById("online-lobby-status");
    if (!node) {
        return;
    }
    node.textContent = message || "";
    node.classList.toggle("text-red-500", isError);
    node.classList.toggle("text-slate-500", !isError);
}

async function handleLogin() {
    const userNameInput = document.getElementById("login-user").value.trim();
    const passInput = document.getElementById("login-pass").value.trim();
    const button = document.getElementById("login-btn");
    const loginCard = document.querySelector("#login-view > div");

    document.getElementById("login-error").classList.add("hidden");
    button.disabled = true;

    try {
        const data = await api("/api/login", {
            method: "POST",
            body: JSON.stringify({ username: userNameInput, password: passInput })
        });

        localStorage.setItem(tokenKey, data.token);
        currentUser = normalizeUser(data.user);
        matchHistory = data.history || [];
        applyUserToUi();
        showView("lobby-view");
    } catch (error) {
        loginCard.classList.add("shake");
        showLoginError(error.message);
        setTimeout(() => loginCard.classList.remove("shake"), 400);
    } finally {
        button.disabled = false;
    }
}

async function handleLogout() {
    clearOnlinePolling();
    onlineRoom = null;

    try {
        await api("/api/logout", { method: "POST" });
    } catch {
        // Ignore logout errors and clear local session anyway.
    }
    localStorage.removeItem(tokenKey);
    currentUser = null;
    document.getElementById("login-view").classList.remove("hidden");
    document.getElementById("main-app").classList.add("hidden");
    toggleSidebar(true);
}

function showView(viewId) {
    if (!currentUser && viewId !== "login-view") {
        return;
    }

    document.getElementById("login-view").classList.add("hidden");
    document.getElementById("main-app").classList.remove("hidden");
    document.querySelectorAll(".view-content").forEach(view => view.classList.add("hidden"));
    document.getElementById(viewId).classList.remove("hidden");

    if (viewId === "history-view") {
        renderHistory();
    }
    if (viewId === "settings-view") {
        syncSettingsForm();
    }

    toggleSidebar(true);
    lucide.createIcons();
    updateDisplay();
}

function toggleSidebar(forceClose = false) {
    const sidebar = document.getElementById("sidebar");
    if (forceClose) {
        sidebar.classList.add("closed");
    } else {
        sidebar.classList.toggle("closed");
    }
}

function setDifficulty(level) {
    currentUser.preferences.difficulty = level;
    document.querySelectorAll(".difficulty-card").forEach(card => card.classList.remove("active"));
    document.getElementById(`diff-${level}`).classList.add("active");
}

function setColor(color) {
    currentUser.preferences.preferredColor = color;
    document.querySelectorAll(".color-card").forEach(card => card.classList.remove("active"));
    document.getElementById(`color-${color}`).classList.add("active");
}

function syncSettingsForm() {
    const prefs = currentPreferences();
    document.getElementById("pref-name").value = currentUser.name;
    document.getElementById("pref-hints").checked = prefs.hints;
    document.getElementById("pref-coords").checked = prefs.showCoordinates;
    document.getElementById("pref-dark").checked = prefs.darkMode;
    document.getElementById("pref-theme").value = prefs.boardTheme;
    document.querySelectorAll(".difficulty-card").forEach(card => card.classList.remove("active"));
    document.getElementById(`diff-${prefs.difficulty}`).classList.add("active");
    document.querySelectorAll(".color-card").forEach(card => card.classList.remove("active"));
    document.getElementById(`color-${prefs.preferredColor}`).classList.add("active");
}

async function savePreferences() {
    currentUser.name = document.getElementById("pref-name").value.trim() || currentUser.name;
    currentUser.preferences.hints = document.getElementById("pref-hints").checked;
    currentUser.preferences.showCoordinates = document.getElementById("pref-coords").checked;
    currentUser.preferences.darkMode = document.getElementById("pref-dark").checked;
    currentUser.preferences.boardTheme = document.getElementById("pref-theme").value;

    const data = await api("/api/me/preferences", {
        method: "PATCH",
        body: JSON.stringify({
            name: currentUser.name,
            preferences: currentUser.preferences
        })
    });

    currentUser = normalizeUser(data.user);
    applyUserToUi();
    showView("lobby-view");
}

function toggleDarkMode(isDark) {
    document.body.classList.toggle("dark-mode", isDark);
}

function updateDisplay() {
    if (!currentUser) {
        return;
    }
    document.getElementById("display-name").innerText = currentUser.name;
    document.getElementById("user-avatar").innerText = currentUser.avatar;
}

function applyBoardTheme(theme) {
    document.documentElement.dataset.boardTheme = theme || defaultPreferences.boardTheme;
}

function applyUserToUi() {
    updateDisplay();
    toggleDarkMode(currentPreferences().darkMode);
    applyBoardTheme(currentPreferences().boardTheme);
    syncSettingsForm();
    if (document.getElementById("game-view") && !document.getElementById("game-view").classList.contains("hidden")) {
        createBoard();
    }
}

function clearOnlinePolling() {
    if (onlinePollTimer) {
        window.clearInterval(onlinePollTimer);
        onlinePollTimer = null;
    }
}

function getOnlineSnapshotKey(room) {
    return JSON.stringify([
        room.boardState,
        room.turn,
        room.gameActive,
        room.waitingForOpponent,
        room.winnerColor,
        room.endedReason
    ]);
}

function updateOpponentCard(name, avatar, badgeText, roomCode = "") {
    document.getElementById("game-opponent-name").textContent = name;
    document.getElementById("game-opponent-avatar").textContent = avatar;
    document.getElementById("game-diff-label").textContent = badgeText;

    const roomNode = document.getElementById("room-code-display");
    if (roomCode) {
        roomNode.textContent = `Room ${roomCode}`;
        roomNode.classList.remove("hidden");
    } else {
        roomNode.textContent = "";
        roomNode.classList.add("hidden");
    }
}

function updateOnlineStatus() {
    if (!onlineRoom) {
        return;
    }

    if (onlineRoom.waitingForOpponent) {
        updateGameStatus("Waiting for opponent", `Share room code ${onlineRoom.roomId} so another player can join.`);
        return;
    }

    if (!onlineRoom.gameActive) {
        if (onlineRoom.endedReason === "stalemate") {
            updateGameStatus("Draw", "No legal moves remain.");
            return;
        }
        if (onlineRoom.endedReason === "resignation") {
            const youWon = onlineRoom.winnerColor === onlineRoom.playerColor;
            updateGameStatus(youWon ? "Opponent resigned" : "You resigned", youWon ? "The match ended in your favor." : "This online match has ended.");
            return;
        }
        const youWon = onlineRoom.winnerColor === onlineRoom.playerColor;
        updateGameStatus(youWon ? "Checkmate" : "Defeat", youWon ? "You beat the other player." : "Your king is trapped in check.");
        return;
    }

    if (onlineRoom.turn === onlineRoom.playerColor) {
        updateGameStatus("Your move", isKingInCheck(boardState, playerColor) ? "You are in check." : "Your opponent is waiting on your move.");
        return;
    }

    updateGameStatus("Opponent's move", isKingInCheck(boardState, playerColor) ? "You are in check while waiting." : "Waiting for the other player to move.");
}

function syncOnlineRoom(room, options = {}) {
    const snapshotKey = getOnlineSnapshotKey(room);
    const preserveSelection = options.preserveSelection && snapshotKey === onlineSnapshotKey;

    onlineSnapshotKey = snapshotKey;
    onlineRoom = room;
    gameMode = "online";
    playerColor = room.playerColor || "white";
    boardState = room.boardState;
    turn = room.turn;
    enPassantTarget = room.enPassantTarget;
    gameActive = room.gameActive;
    pendingBotMove = false;

    if (!preserveSelection) {
        selectedSquare = null;
        possibleMoves = [];
    }

    const opponentName = room.opponent ? room.opponent.name : "Waiting...";
    const opponentAvatar = room.opponent ? room.opponent.avatar : "\u23F3";
    updateOpponentCard(opponentName, opponentAvatar, "Online Match", room.roomId);
    updateOnlineStatus();
    createBoard();
}

function startOnlinePolling() {
    clearOnlinePolling();
    onlinePollTimer = window.setInterval(() => {
        refreshOnlineMatch(true);
    }, 1500);
}

async function refreshOnlineMatch(preserveSelection = false) {
    if (!onlineRoom) {
        return;
    }

    try {
        const data = await api(`/api/rooms/${onlineRoom.roomId}`);
        syncOnlineRoom(data.room, { preserveSelection });
    } catch (error) {
        clearOnlinePolling();
        updateGameStatus("Connection lost", error.message);
    }
}

async function createOnlineMatch() {
    setLobbyStatus("Creating room...");
    try {
        const data = await api("/api/rooms", {
            method: "POST",
            body: JSON.stringify({ preferredColor: currentPreferences().preferredColor })
        });
        syncOnlineRoom(data.room);
        startOnlinePolling();
        showView("game-view");
        setLobbyStatus(`Room ${data.room.roomId} is ready. Share the code with your friend.`);
    } catch (error) {
        setLobbyStatus(error.message, true);
    }
}

async function joinOnlineMatch() {
    const input = document.getElementById("room-code-input");
    const roomId = input.value.trim().toUpperCase();
    if (!roomId) {
        setLobbyStatus("Enter a room code first.", true);
        return;
    }

    setLobbyStatus(`Joining room ${roomId}...`);
    try {
        const data = await api("/api/rooms/join", {
            method: "POST",
            body: JSON.stringify({ roomId })
        });
        input.value = "";
        syncOnlineRoom(data.room);
        startOnlinePolling();
        showView("game-view");
        setLobbyStatus(`Joined room ${data.room.roomId}.`);
    } catch (error) {
        setLobbyStatus(error.message, true);
    }
}

function startMatch() {
    clearOnlinePolling();
    onlineRoom = null;
    onlineSnapshotKey = "";
    gameMode = "bot";
    lastMoveHighlight = null;

    const btn = document.getElementById("start-btn");
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader-2" class="w-6 h-6 spinner"></i> <span>Synchronizing Arena...</span>`;
    lucide.createIcons();

    setTimeout(async () => {
        initGameState();
        updateOpponentCard("Chessplay Bot", "\u{1F916}", currentPreferences().difficulty, "");
        showView("game-view");
        createBoard();
        btn.disabled = false;
        btn.innerHTML = "<span>Play Vs Bot</span>";
        lucide.createIcons();

        if (turn === botColor) {
            await runBotTurn();
        }
    }, 450);
}

function initGameState() {
    boardState = createEmptyBoard();
    selectedSquare = null;
    possibleMoves = [];
    turn = "white";
    enPassantTarget = null;
    gameActive = true;
    pendingBotMove = false;
    lastMoveHighlight = null;

    playerColor = currentPreferences().preferredColor === "random"
        ? (Math.random() > 0.5 ? "white" : "black")
        : currentPreferences().preferredColor;
    botColor = playerColor === "white" ? "black" : "white";

    const order = ["r", "n", "b", "q", "k", "b", "n", "r"];
    for (let c = 0; c < 8; c += 1) {
        boardState[0][c] = { type: order[c], color: "black", hasMoved: false };
        boardState[1][c] = { type: "p", color: "black", hasMoved: false };
        boardState[6][c] = { type: "p", color: "white", hasMoved: false };
        boardState[7][c] = { type: order[c], color: "white", hasMoved: false };
    }

    updateGameStatus("Match ready", `${playerColor === "white" ? "You move first." : "Bot opens as White."}`);
}

function addCoordinateLabels(square, row, col) {
    if (!currentPreferences().showCoordinates) {
        return;
    }

    const displayRows = playerColor === "white" ? [...Array(8).keys()] : [...Array(8).keys()].reverse();
    const displayCols = playerColor === "white" ? [...Array(8).keys()] : [...Array(8).keys()].reverse();
    const isBottom = row === displayRows[displayRows.length - 1];
    const isLeft = col === displayCols[0];

    if (isBottom) {
        const file = document.createElement("span");
        file.className = "coord-label coord-file";
        file.textContent = "abcdefgh"[col];
        square.appendChild(file);
    }
    if (isLeft) {
        const rank = document.createElement("span");
        rank.className = "coord-label coord-rank";
        rank.textContent = String(8 - row);
        square.appendChild(rank);
    }
}

function createBoard() {
    const board = document.getElementById("chess-board");
    board.innerHTML = "";
    const rows = playerColor === "white" ? [...Array(8).keys()] : [...Array(8).keys()].reverse();
    const cols = playerColor === "white" ? [...Array(8).keys()] : [...Array(8).keys()].reverse();
    const checkedKing = isKingInCheck(boardState, playerColor) ? findKing(boardState, playerColor) : null;

    for (const r of rows) {
        for (const c of cols) {
            const square = document.createElement("div");
            square.className = `square ${(r + c) % 2 === 0 ? "sq-light" : "sq-dark"}`;
            square.dataset.row = String(r);
            square.dataset.col = String(c);

            const piece = boardState[r][c];
            if (piece) {
                const pieceNode = document.createElement("div");
                pieceNode.className = `piece-symbol ${piece.color === "white" ? "piece-white" : "piece-black"}`;
                pieceNode.textContent = pieceIcons[piece.color][piece.type];
                square.appendChild(pieceNode);
            }

            if (lastMoveHighlight && (
                (lastMoveHighlight.from.r === r && lastMoveHighlight.from.c === c) ||
                (lastMoveHighlight.to.r === r && lastMoveHighlight.to.c === c)
            )) {
                square.classList.add("last-move-square");
            }

            if (selectedSquare && selectedSquare.r === r && selectedSquare.c === c) {
                square.classList.add("selected-square");
            }

            if (checkedKing && checkedKing.r === r && checkedKing.c === c) {
                square.classList.add("check-square");
            }

            if (currentPreferences().hints) {
                const move = possibleMoves.find(item => item.to.r === r && item.to.c === c);
                if (move) {
                    square.classList.add(move.capture ? "capture-move" : "possible-move");
                }
            }

            addCoordinateLabels(square, r, c);
            square.onclick = () => onSquareClick(r, c);
            board.appendChild(square);
        }
    }
}

async function onSquareClick(r, c) {
    if (!gameActive || pendingBotMove) {
        return;
    }

    if (gameMode === "online" && (!onlineRoom || onlineRoom.waitingForOpponent || turn !== playerColor)) {
        return;
    }

    if (gameMode === "bot" && turn !== playerColor) {
        return;
    }

    const clickedPiece = boardState[r][c];
    const moveTarget = possibleMoves.find(move => move.to.r === r && move.to.c === c);

    if (moveTarget && selectedSquare) {
        if (gameMode === "online") {
            await submitOnlineMove(moveTarget);
        } else {
            makeMove(moveTarget);
            selectedSquare = null;
            possibleMoves = [];
            createBoard();
            await postMoveFlow();
        }
        return;
    }

    if (clickedPiece && clickedPiece.color === playerColor) {
        selectedSquare = { r, c };
        possibleMoves = getLegalMoves(boardState, r, c, turn, enPassantTarget);
    } else {
        selectedSquare = null;
        possibleMoves = [];
    }

    createBoard();
}

async function submitOnlineMove(move) {
    if (!onlineRoom) {
        return;
    }

    pendingBotMove = true;
    try {
        lastMoveHighlight = {
            from: { ...move.from },
            to: { ...move.to }
        };

        const data = await api(`/api/rooms/${onlineRoom.roomId}/move`, {
            method: "POST",
            body: JSON.stringify({
                from: move.from,
                to: move.to
            })
        });
        selectedSquare = null;
        possibleMoves = [];
        syncOnlineRoom(data.room);
    } catch (error) {
        updateGameStatus("Move rejected", error.message);
        await refreshOnlineMatch(false);
    } finally {
        pendingBotMove = false;
    }
}

function getLegalMoves(board, r, c, activeColor, enPassant) {
    const piece = board[r][c];
    if (!piece || piece.color !== activeColor) {
        return [];
    }

    const pseudoMoves = getPseudoMoves(board, r, c, piece, enPassant, false);
    return pseudoMoves.filter(move => {
        const nextState = simulateMove({ board, turn: activeColor, enPassantTarget: enPassant }, move);
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
                if (r === startRow && !board[twoStep][c]) {
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

function makeMove(move) {
    const result = simulateMove({ board: boardState, enPassantTarget }, move);
    boardState = result.board;
    enPassantTarget = result.enPassantTarget;
    turn = oppositeColor(turn);
    lastMoveHighlight = {
        from: { ...move.from },
        to: { ...move.to }
    };
}

async function postMoveFlow() {
    createBoard();

    if (await finishGameIfOver()) {
        return;
    }

    if (turn === botColor) {
        await runBotTurn();
        return;
    }

    updateGameStatus("Your move", isKingInCheck(boardState, playerColor) ? "You are in check." : "Choose your next move.");
}

async function runBotTurn() {
    pendingBotMove = true;
    updateGameStatus("Bot thinking", `${currentPreferences().difficulty} mode is calculating...`);
    await new Promise(resolve => setTimeout(resolve, currentPreferences().difficulty === "Easy" ? 350 : 650));

    const move = chooseBotMove();
    if (!move) {
        pendingBotMove = false;
        await finishGameIfOver();
        return;
    }

    makeMove(move);
    createBoard();
    pendingBotMove = false;

    if (await finishGameIfOver()) {
        return;
    }

    updateGameStatus("Your move", isKingInCheck(boardState, playerColor) ? "Bot put you in check." : "Board updated. Your turn.");
}

function chooseBotMove() {
    const moves = getAllLegalMoves(boardState, botColor, enPassantTarget);
    if (!moves.length) {
        return null;
    }

    const difficulty = currentPreferences().difficulty;
    if (difficulty === "Easy") {
        return moves[Math.floor(Math.random() * moves.length)];
    }

    if (difficulty === "Medium") {
        return pickBestScoredMove(moves, botColor, 0.35);
    }

    return minimaxRoot(moves, difficultyDepth[difficulty]);
}

function pickBestScoredMove(moves, color, randomness = 0) {
    const ranked = moves
        .map(move => {
            const next = simulateMove({ board: boardState, enPassantTarget }, move);
            return {
                move,
                score: evaluateBoard(next.board, color)
                    + (move.capture ? 1.5 : 0)
                    + (move.promotion ? 8 : 0)
                    + (isKingInCheck(next.board, oppositeColor(color)) ? 1 : 0)
                    + Math.random() * randomness
            };
        })
        .sort((a, b) => b.score - a.score);

    return ranked[0].move;
}

function minimaxRoot(moves, depth) {
    let bestScore = -Infinity;
    let bestMove = moves[0];

    moves.forEach(move => {
        const next = simulateMove({ board: boardState, enPassantTarget }, move);
        const score = minimax(next.board, depth - 1, false, oppositeColor(botColor), next.enPassantTarget, -Infinity, Infinity);
        if (score > bestScore) {
            bestScore = score;
            bestMove = move;
        }
    });

    return bestMove;
}

function minimax(board, depth, maximizing, colorToMove, enPassant, alpha, beta) {
    const legalMoves = getAllLegalMoves(board, colorToMove, enPassant);
    if (depth < 0 || !legalMoves.length) {
        if (!legalMoves.length) {
            if (isKingInCheck(board, colorToMove)) {
                return colorToMove === botColor ? -9999 : 9999;
            }
            return 0;
        }
        return evaluateBoard(board, botColor);
    }

    if (maximizing) {
        let maxEval = -Infinity;
        legalMoves.forEach(move => {
            const next = simulateMove({ board, enPassantTarget: enPassant }, move);
            maxEval = Math.max(maxEval, minimax(next.board, depth - 1, false, oppositeColor(colorToMove), next.enPassantTarget, alpha, beta));
            alpha = Math.max(alpha, maxEval);
        });
        return maxEval;
    }

    let minEval = Infinity;
    legalMoves.forEach(move => {
        const next = simulateMove({ board, enPassantTarget: enPassant }, move);
        minEval = Math.min(minEval, minimax(next.board, depth - 1, true, oppositeColor(colorToMove), next.enPassantTarget, alpha, beta));
        beta = Math.min(beta, minEval);
    });
    return minEval;
}

function evaluateBoard(board, perspective) {
    const values = { p: 1, n: 3, b: 3.2, r: 5, q: 9, k: 100 };
    let score = 0;

    for (let r = 0; r < 8; r += 1) {
        for (let c = 0; c < 8; c += 1) {
            const piece = board[r][c];
            if (!piece) {
                continue;
            }
            const base = values[piece.type];
            const centerBonus = (3.5 - Math.abs(3.5 - r) + 3.5 - Math.abs(3.5 - c)) * 0.05;
            const directionBonus = piece.type === "p"
                ? ((piece.color === "white" ? 6 - r : r - 1) * 0.04)
                : 0;
            const total = base + centerBonus + directionBonus;
            score += piece.color === perspective ? total : -total;
        }
    }

    return score;
}

async function finishGameIfOver() {
    const legalMoves = getAllLegalMoves(boardState, turn, enPassantTarget);
    if (legalMoves.length) {
        return false;
    }

    gameActive = false;
    const checked = isKingInCheck(boardState, turn);
    let outcome = "Draw";
    let title = "Stalemate";
    let detail = "No legal moves remain.";

    if (checked) {
        const playerWon = turn === botColor;
        outcome = playerWon ? "Victory" : "Defeat";
        title = playerWon ? "Checkmate" : "Bot wins";
        detail = playerWon ? "You finished the bot with checkmate." : "Your king is trapped in check.";
    }

    updateGameStatus(title, detail);
    await recordHistory(outcome);
    return true;
}

async function resignMatch() {
    if (gameMode === "online" && onlineRoom) {
        try {
            await api(`/api/rooms/${onlineRoom.roomId}/resign`, { method: "POST" });
        } catch {
            // Best-effort resign.
        }
        clearOnlinePolling();
        setLobbyStatus(`You left room ${onlineRoom.roomId}.`);
        onlineRoom = null;
        onlineSnapshotKey = "";
        showView("lobby-view");
        return;
    }

    if (gameActive) {
        gameActive = false;
        updateGameStatus("Match ended", "You resigned this game.");
        await recordHistory("Resigned");
    }
    showView("lobby-view");
}

async function recordHistory(outcome) {
    const payload = {
        opponent: `Chessplay Bot (${currentPreferences().difficulty})`,
        result: outcome,
        playedAt: new Date().toISOString()
    };

    const data = await api("/api/me/history", {
        method: "POST",
        body: JSON.stringify(payload)
    });
    matchHistory = data.history || [];
}

function renderHistory() {
    const list = document.getElementById("match-history-list");
    if (!matchHistory.length) {
        list.innerHTML = `<div class="p-6 bg-slate-50 rounded-3xl"><p class="font-black text-sm uppercase">No games yet</p><p class="text-[10px] font-bold text-slate-400 uppercase">Your saved matches will appear here.</p></div>`;
        return;
    }

    list.innerHTML = matchHistory
        .slice()
        .reverse()
        .map(match => `
            <div class="p-6 bg-slate-50 rounded-3xl flex justify-between items-center gap-4">
                <div>
                    <p class="font-black text-sm uppercase">${match.opponent}</p>
                    <p class="text-[10px] font-bold text-slate-400 uppercase">${new Date(match.playedAt).toLocaleString()}</p>
                </div>
                <span class="px-4 py-2 ${match.result === "Victory" ? "bg-indigo-100 text-indigo-600" : match.result === "Defeat" ? "bg-red-100 text-red-500" : "bg-slate-200 text-slate-600"} rounded-xl text-[10px] font-bold uppercase">${match.result}</span>
            </div>
        `)
        .join("");
}

function updateGameStatus(title, text) {
    document.getElementById("game-status-title").textContent = title;
    document.getElementById("game-status-text").textContent = text;
}

function isValid(r, c) {
    return r >= 0 && r < 8 && c >= 0 && c < 8;
}

function oppositeColor(color) {
    return color === "white" ? "black" : "white";
}

window.handleLogin = handleLogin;
window.handleLogout = handleLogout;
window.toggleSidebar = toggleSidebar;
window.showView = showView;
window.setDifficulty = setDifficulty;
window.setColor = setColor;
window.startMatch = startMatch;
window.savePreferences = savePreferences;
window.toggleDarkMode = toggleDarkMode;
window.resignMatch = resignMatch;
window.createOnlineMatch = createOnlineMatch;
window.joinOnlineMatch = joinOnlineMatch;
window.onload = bootstrap;
