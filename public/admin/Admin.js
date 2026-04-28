const adminTokenKey = "chessplay-admin-token";
let users = [];
let editingUserId = null;

async function adminApi(path, options = {}) {
    const token = localStorage.getItem(adminTokenKey);
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (token) {
        headers["X-Admin-Token"] = token;
    }

    const response = await fetch(path, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || "Request failed");
    }
    return data;
}

async function bootstrapAdmin() {
    lucide.createIcons();
    const token = localStorage.getItem(adminTokenKey);
    if (!token) {
        return;
    }

    try {
        await loadUsers();
        document.getElementById("admin-login").classList.add("hidden");
        document.getElementById("admin-app").classList.remove("hidden");
    } catch {
        localStorage.removeItem(adminTokenKey);
    }
}

async function adminLogin() {
    const username = document.getElementById("admin-user").value.trim();
    const password = document.getElementById("admin-pass").value.trim();
    const pin = document.getElementById("admin-pin").value.trim();

    try {
        const data = await adminApi("/api/admin/login", {
            method: "POST",
            body: JSON.stringify({ username, password, pin })
        });
        localStorage.setItem(adminTokenKey, data.token);
        document.getElementById("admin-login").classList.add("hidden");
        document.getElementById("admin-app").classList.remove("hidden");
        await loadUsers();
    } catch (error) {
        const node = document.getElementById("admin-login-error");
        node.textContent = error.message;
        node.classList.remove("hidden");
    }
}

function adminLogout() {
    localStorage.removeItem(adminTokenKey);
    window.location.reload();
}

async function loadUsers() {
    const data = await adminApi("/api/admin/users");
    users = data.users;
    renderUserList();
    lucide.createIcons();
}

async function createNewAccount() {
    const name = document.getElementById("new-user").value.trim();
    const password = document.getElementById("new-pass").value.trim();
    const avatar = document.getElementById("new-avatar").value;
    const isAdmin = document.getElementById("new-is-admin").checked;
    if (!name || !password) {
        return;
    }

    await adminApi("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ name, password, avatar, role: isAdmin ? "Admin" : "Player" })
    });

    document.getElementById("new-user").value = "";
    document.getElementById("new-pass").value = "";
    document.getElementById("new-is-admin").checked = false;
    await loadUsers();
}

async function changeAdminPin() {
    const pin = document.getElementById("admin-pin-change").value.trim();
    if (!/^\d{4}$/.test(pin)) {
        return;
    }

    await adminApi("/api/admin/pin", {
        method: "PATCH",
        body: JSON.stringify({ pin })
    });

    const input = document.getElementById("admin-pin-change");
    input.value = "";
    input.classList.add("bg-green-100");
    setTimeout(() => input.classList.remove("bg-green-100"), 1200);
}

function openUserModal(id) {
    const user = users.find(item => item.id === id);
    if (!user) {
        return;
    }
    editingUserId = id;
    document.getElementById("edit-user-name").value = user.name;
    document.getElementById("edit-user-pass").value = "";
    document.getElementById("edit-user-avatar").value = user.avatar;
    document.getElementById("edit-user-admin").checked = user.role === "Admin";
    document.getElementById("user-editor-modal").classList.remove("hidden");
    lucide.createIcons();
}

function closeUserModal() {
    document.getElementById("user-editor-modal").classList.add("hidden");
    editingUserId = null;
}

async function saveUserChanges() {
    const payload = {
        name: document.getElementById("edit-user-name").value.trim(),
        password: document.getElementById("edit-user-pass").value.trim(),
        avatar: document.getElementById("edit-user-avatar").value,
        role: document.getElementById("edit-user-admin").checked ? "Admin" : "Player"
    };

    await adminApi(`/api/admin/users/${editingUserId}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
    });

    closeUserModal();
    await loadUsers();
}

async function deleteUser() {
    await adminApi(`/api/admin/users/${editingUserId}`, { method: "DELETE" });
    closeUserModal();
    await loadUsers();
}

function renderUserList() {
    const list = document.getElementById("user-list");
    list.innerHTML = users.map(user => `
        <div onclick="openUserModal(${user.id})" class="p-4 bg-slate-50 hover:bg-slate-100 hover:scale-[1.02] cursor-pointer rounded-2xl flex justify-between items-center transition-all border border-transparent hover:border-indigo-100">
            <div class="flex items-center gap-4">
                <div class="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-xl shadow-sm">${user.avatar}</div>
                <div>
                    <p class="font-black text-xs uppercase text-[#1b254b]">${user.name}</p>
                    <p class="text-[8px] font-bold text-slate-400 uppercase tracking-widest">${user.role}</p>
                </div>
            </div>
            <i data-lucide="chevron-right" class="w-4 h-4 text-slate-300"></i>
        </div>
    `).join("");
    lucide.createIcons();
}

window.adminLogin = adminLogin;
window.adminLogout = adminLogout;
window.createNewAccount = createNewAccount;
window.changeAdminPin = changeAdminPin;
window.openUserModal = openUserModal;
window.closeUserModal = closeUserModal;
window.saveUserChanges = saveUserChanges;
window.deleteUser = deleteUser;
window.onload = bootstrapAdmin;
