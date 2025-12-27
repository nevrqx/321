// --- CONFIGURATION ---
// IMPORTANT: Replace these with your own values from Supabase Dashboard -> Project Settings -> API
const SUPABASE_URL = 'https://ooafgdgmpyzmudreiftw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vYWZnZGdtcHl6bXVkcmVpZnR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY4MjkyOTMsImV4cCI6MjA4MjQwNTI5M30.VyU9Im461l1XK1wl2hSVfQUvwIXpX00FfnAqrhHLuec';

// Use 'sb' to avoid conflict with global 'supabase' from CDN
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- STATE ---
let currentUser = null;
let currentChatId = null;
let messageSubscription = null;

// --- AUTHENTICATION ---

async function init() {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
        currentUser = session.user;
        showApp();
    } else {
        showAuth();
    }

    sb.auth.onAuthStateChange((_event, session) => {
        if (session) {
            currentUser = session.user;
            showApp();
        } else {
            currentUser = null;
            showAuth();
        }
    });
}

function showAuth() {
    document.getElementById('auth-overlay').classList.add('active');
}

async function showApp() {
    document.getElementById('auth-overlay').classList.remove('active');

    // Load my username
    const { data } = await sb
        .from('profiles')
        .select('username')
        .eq('id', currentUser.id)
        .single();

    if (data) {
        document.getElementById('current-username').innerText = '@' + data.username;
    }

    loadChats();
}

let isRegisterMode = false;
function toggleAuthMode() {
    isRegisterMode = !isRegisterMode;
    document.getElementById('username-group').classList.toggle('hidden');
    document.getElementById('storage-group').classList.toggle('hidden'); // Show/Hide Storage Selector
    document.getElementById('login-btn').innerText = isRegisterMode ? 'Зарегистрироваться' : 'Войти';
    document.getElementById('register-btn').innerText = isRegisterMode ? 'Уже есть аккаунт?' : 'Нет аккаунта?';
    document.querySelector('.subtitle').innerText = isRegisterMode ? 'Создайте новый аккаунт' : 'Войдите в аккаунт';
    document.getElementById('auth-error').innerText = '';
}

async function handleLogin() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const username = document.getElementById('username').value.toLowerCase();

    // Get Storage Type
    const storageType = document.querySelector('input[name="storage_type"]:checked').value;

    const errorEl = document.getElementById('auth-error');

    if (!email || !password) {
        errorEl.innerText = 'Введите email и пароль';
        return;
    }

    errorEl.innerText = 'Загрузка...';

    if (isRegisterMode) {
        // Registration
        if (!username || username.length > 9 || !/^[a-z]+$/.test(username)) {
            errorEl.innerText = 'Логин должен быть на английском, маленькими буквами, до 9 символов.';
            return;
        }

        // PRE-CHECK: Username taken?
        const { data: existingUser } = await sb
            .from('profiles')
            .select('id')
            .eq('username', username)
            .single();

        if (existingUser) {
            errorEl.innerText = 'Этот логин уже занят. Выберите другой.';
            return;
        }

        const { data, error } = await sb.auth.signUp({
            email: email,
            password: password,
        });

        if (error) {
            errorEl.innerText = error.message;
            return;
        }

        // Create profile with STORAGE TYPE
        const { error: profileError } = await sb
            .from('profiles')
            .insert([{
                id: data.user.id,
                username: username,
                storage_type: storageType // Save type
            }]);

        if (profileError) {
            errorEl.innerText = 'Ошибка создания профиля: ' + profileError.message;
            return;
        }

        // Auto-Login
        const { error: loginError } = await sb.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (loginError) errorEl.innerText = 'Авто-вход не удался: ' + loginError.message;

    } else {
        // Login
        const { error } = await sb.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) {
            errorEl.innerText = error.message;
            return;
        }
    }
}

async function signOut() {
    await sb.auth.signOut();
    window.location.reload();
}

// --- USER SEARCH ---

let searchTimeout;
async function searchUsers(query) {
    clearTimeout(searchTimeout);
    const resultsEl = document.getElementById('search-results');

    if (!query || query.length < 2) {
        resultsEl.classList.add('hidden');
        return;
    }

    searchTimeout = setTimeout(async () => {
        const { data } = await sb
            .from('profiles')
            .select('id, username')
            .ilike('username', `%${query}%`)
            .neq('id', currentUser.id)
            .limit(5);

        resultsEl.innerHTML = '';
        if (data && data.length > 0) {
            resultsEl.classList.remove('hidden');
            data.forEach(user => {
                const div = document.createElement('div');
                div.className = 'search-item';
                div.innerText = '@' + user.username;
                div.onclick = () => startChat(user.id, user.username);
                resultsEl.appendChild(div);
            });
        } else {
            const div = document.createElement('div');
            div.className = 'search-item';
            div.innerText = 'Никого не найдено';
            resultsEl.appendChild(div);
            resultsEl.classList.remove('hidden');
        }
    }, 300);
}

// --- CHATS LOGIC ---

async function startChat(otherUserId, otherUsername) {
    if (otherUserId === currentUser.id) return;

    const resultsEl = document.getElementById('search-results');
    resultsEl.innerHTML = 'Загрузка...';

    // Call the SQL function we just created to handle everything safely
    const { data: chatId, error } = await sb.rpc('get_or_create_conversation', {
        user_b: otherUserId
    });

    if (error) {
        console.error('Error starting chat:', error);
        alert('Ошибка: ' + error.message);
        resultsEl.innerHTML = '';
        return;
    }

    // Refresh list and open
    resultsEl.classList.add('hidden');
    document.getElementById('user-search').value = '';
    await loadChats();
    openChat(chatId, otherUsername);
}

async function loadChats() {
    const list = document.getElementById('chats-list');
    list.innerHTML = '<div style="padding:20px; text-align:center; color:#555">Загрузка...</div>';

    // Get my conversation IDs
    const { data: myConvs } = await sb
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', currentUser.id);

    if (!myConvs || myConvs.length === 0) {
        list.innerHTML = '<div style="padding:20px; text-align:center; color:#555">Нет чатов</div>';
        return;
    }

    const convIds = myConvs.map(c => c.conversation_id);

    // Get partners
    const { data: participants } = await sb
        .from('conversation_participants')
        .select('conversation_id, profiles(username)')
        .in('conversation_id', convIds)
        .neq('user_id', currentUser.id);

    list.innerHTML = '';

    // Map conversationID -> Partner Name
    const chatMap = {};
    participants.forEach(p => {
        chatMap[p.conversation_id] = p.profiles.username;
    });

    convIds.forEach(id => {
        const username = chatMap[id] || 'Пользователь';
        const el = document.createElement('div');
        el.className = 'chat-item';
        // Add ID so we can highlight active later
        el.dataset.chatId = id;

        el.innerHTML = `
            <div class="chat-avatar">${username[0].toUpperCase()}</div>
            <div class="chat-info">
                <div class="chat-name">@${username}</div>
                <div class="chat-last-msg">Нажмите, чтобы открыть</div>
            </div>
        `;
        el.onclick = () => openChat(id, username);
        list.appendChild(el);
    });
}

// --- INDEXED DB (LOCAL STORAGE) ---
const LocalDB = {
    dbName: 'DarkChatDB',
    version: 1,
    db: null,

    async open() {
        if (this.db) return this.db;
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('messages')) {
                    const store = db.createObjectStore('messages', { keyPath: 'id' });
                    store.createIndex('conversation_id', 'conversation_id', { unique: false });
                }
            };
            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve(this.db);
            };
            request.onerror = (e) => reject(e);
        });
    },

    async addMessage(msg) {
        await this.open();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('messages', 'readwrite');
            const store = tx.objectStore('messages');
            store.put(msg);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e);
        });
    },

    async getMessages(chatId) {
        await this.open();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('messages', 'readonly');
            const store = tx.objectStore('messages');
            const index = store.index('conversation_id');
            const request = index.getAll(chatId); // Simplified: fetch all for chat
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e);
        });
    }
};

// --- AUTH & INIT ---

async function init() {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
        // Fetch full profile including storage_type
        const { data: profile } = await sb
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .single();

        // Merge session user with profile data
        currentUser = { ...session.user, ...profile };
        showApp();
    } else {
        showAuth();
    }

    sb.auth.onAuthStateChange(async (_event, session) => {
        if (session) {
            const { data: profile } = await sb
                .from('profiles')
                .select('*')
                .eq('id', session.user.id)
                .single();
            currentUser = { ...session.user, ...profile };
            showApp();
        } else {
            currentUser = null;
            showAuth();
        }
    });
}

// --- OPEN CHAT (MAIN AREA) ---

let activeStatusSubscription = null;
let currentChatIsSecret = false;
let earliestMessageDate = null; // Pagination cursor
const MESSAGES_PER_PAGE = 50;

async function openChat(chatId, username) {
    currentChatId = chatId;
    earliestMessageDate = null; // Reset cursor

    // UI Updates
    document.querySelector('.placeholder-content').classList.add('hidden');
    document.getElementById('active-chat-container').classList.remove('hidden');
    document.getElementById('chat-partner-name').innerText = '@' + username;
    updateChatHeaderStatus(chatId);

    // Clear Messages (keep the button though? No, full clear is safer usually, then re-add button)
    const msgsContainer = document.getElementById('messages-container');
    msgsContainer.innerHTML = `
        <div id="load-more-container" class="load-more-container hidden">
            <button class="text-btn" onclick="loadOlderMessages()">⬆ Загрузить предыдущие</button>
        </div>
    `;

    // Highlight sidebar
    document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
    const activeItem = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
    if (activeItem) activeItem.classList.add('active');

    document.body.classList.add('mobile-chat-open');

    // 0. CHECK PARTNER STORAGE TYPE (Determine Secret Mode)
    const { data: participants } = await sb
        .from('conversation_participants')
        .select('user_id')
        .eq('conversation_id', chatId)
        .neq('user_id', currentUser.id)
        .single();

    currentChatIsSecret = false;
    let partnerId = null;

    if (participants) {
        partnerId = participants.user_id;
        const { data: partnerProfile } = await sb
            .from('profiles')
            .select('storage_type, last_seen')
            .eq('id', partnerId)
            .single();

        if (currentUser.storage_type === 'local' || (partnerProfile && partnerProfile.storage_type === 'local')) {
            currentChatIsSecret = true;
            document.getElementById('chat-partner-name').innerHTML = `@${username} <span style="font-size:12px; color:#4caf50; border:1px solid #4caf50; border-radius:4px; padding:1px 4px; margin-left:8px;">🔒 SECRET</span>`;
        }
    }

    // 1. INITIAL LOAD (Last 50)
    await loadMessagesBatch(MESSAGES_PER_PAGE, null, 'append');
    scrollToBottom();

    // 2. CHECK FOR BACKLOG (Local Users only)
    if (currentUser.storage_type === 'local') {
        checkBacklog(chatId);
    }

    // 3. Handle Incoming
    setupRealtime(chatId);

    // 4. Status
    setupStatus(partnerId);
}

// --- PAGINATION & LOADING ---

async function loadOlderMessages() {
    if (!currentChatId || !earliestMessageDate) return;

    // Save scroll position
    const container = document.getElementById('messages-container');
    const oldHeight = container.scrollHeight;

    const count = await loadMessagesBatch(MESSAGES_PER_PAGE, earliestMessageDate, 'prepend');

    // Restore scroll relative to bottom (so view doesn't jump)
    if (count > 0) {
        const newHeight = container.scrollHeight;
        container.scrollTop = newHeight - oldHeight;
    }
}

async function loadMessagesBatch(limit, beforeDate, method = 'append') {
    // 1. Local
    const localMsgs = await LocalDB.getMessagesPaged(currentChatId, limit, beforeDate);

    // 2. Cloud
    let query = sb
        .from('messages')
        .select('*')
        .eq('conversation_id', currentChatId)
        .order('created_at', { ascending: false }) // Get newest first
        .limit(limit);

    if (beforeDate) {
        query = query.lt('created_at', beforeDate);
    }

    const { data: cloudMsgs } = await query;

    // 3. Merge
    const all = [...localMsgs, ...(cloudMsgs || [])];

    // Dedup
    const unique = Array.from(new Map(all.map(m => [m.id, m])).values());

    // Sort: If we want "Last 50", we need them in time order [Old ... New]
    // But we fetched them "Desc" (Newest first) to get the *latest* ones.
    // So unique now contains [Newest ... Oldest] broadly.
    // We sort them by Date Ascending to display.

    unique.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    // Since we merged two sources of "limit 50", we might have 100 items.
    // We only want the *latest* 'limit' items that fit the 'beforeDate' criteria.
    // But since we are paginating backwards, we want the *Limit* items closest to beforeDate.
    // If we sort Asc, these are the *last* items in the array.

    const slice = unique.slice(-limit); // Take last 'limit' items

    if (slice.length > 0) {
        // Update Cursor (The oldest message in this batch)
        earliestMessageDate = slice[0].created_at;

        // Show Load More if we suspect there are more
        // (Simple heuristic: if we got full limit, maybe there is more)
        const loadMoreBtn = document.getElementById('load-more-container');
        if (slice.length >= limit) {
            loadMoreBtn.classList.remove('hidden');
        } else if (method === 'prepend') {
            // If we fetched less than limit during 'load older', usually means end of history
            loadMoreBtn.classList.add('hidden');
        }

        // Render
        slice.forEach(msg => appendMessage(msg, method));
    } else {
        if (method === 'prepend') {
            document.getElementById('load-more-container').classList.add('hidden');
        }
    }

    return slice.length;
}

// Separate backlog check to keep openChat clean
async function checkBacklog(chatId) {
    // We just fetch *all* cloud messages for this chat to be safe? 
    // Or just recent ones? "Backlog" implies *unread* stuff.
    // But we don't have 'read' status. 
    // Let's stick to the previous robust logic: Fetch ALL pending on server.
    // Since we delete them instantly, the count shouldn't be huge unless we were offline for years.

    const { data: cloudMsgs } = await sb
        .from('messages')
        .select('*')
        .eq('conversation_id', chatId);

    if (cloudMsgs && cloudMsgs.length > 0) {
        console.log('Securing backlog:', cloudMsgs.length);
        const idsToDelete = [];
        for (const msg of cloudMsgs) {
            if (msg.sender_id === currentUser.id) continue;

            if (msg.file_url && !msg.file_blob) {
                downloadAndSecureFile(msg);
            } else {
                await LocalDB.addMessage(msg); // IDB will dedupe by ID
                idsToDelete.push(msg.id);
            }
        }
        if (idsToDelete.length > 0) {
            await sb.rpc('delete_delivered_messages', { msg_ids: idsToDelete });
        }
    }
}

function setupRealtime(chatId) {
    if (messageSubscription) sb.removeChannel(messageSubscription);
    messageSubscription = sb
        .channel(`chat:${chatId}`)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `conversation_id=eq.${chatId}`
        }, async (payload) => {
            const newMsg = payload.new;
            appendMessage(newMsg);
            scrollToBottom();

            if (currentChatIsSecret && currentUser.storage_type === 'local') {
                await LocalDB.addMessage(newMsg);
                if (newMsg.sender_id !== currentUser.id) {
                    await sb.rpc('delete_delivered_messages', { msg_ids: [newMsg.id] });
                }
            }
        })
        .subscribe();
}

function setupStatus(partnerId) {
    // ... (existing status logic)
    if (activeStatusSubscription) sb.removeChannel(activeStatusSubscription);
    if (partnerId) {
        fetchStatus(partnerId);
        activeStatusSubscription = sb
            .channel(`status:${partnerId}`)
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'profiles',
                filter: `id=eq.${partnerId}`
            }, (payload) => updateStatusUI(payload.new.last_seen))
            .subscribe();
    }
}

async function updateChatHeaderStatus(chatId) {
    document.querySelector('.chat-header-info .status').innerText = 'Загрузка...';
}

async function fetchStatus(userId) {
    const { data } = await sb.from('profiles').select('last_seen').eq('id', userId).single();
    if (data) updateStatusUI(data.last_seen);
}

function updateStatusUI(lastSeenStr) {
    const statusEl = document.querySelector('.chat-header-info .status');
    if (!lastSeenStr) {
        statusEl.innerText = 'Был(а) давно';
        return;
    }

    const lastSeen = new Date(lastSeenStr);
    const now = new Date();
    const diffMin = (now - lastSeen) / 1000 / 60;

    if (diffMin < 5) {
        statusEl.innerText = 'В сети';
        statusEl.style.color = '#4caf50'; // Green
    } else {
        statusEl.innerText = 'Был(а) ' + formatTime(lastSeen);
        statusEl.style.color = 'var(--text-hint)';
    }
}

function formatTime(dateObj) {
    const d = new Date(dateObj);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function closeChatMobile() {
    document.body.classList.remove('mobile-chat-open');
    // Optional: Deselect chat?
    // currentChatId = null;
}

// --- FILE HANDLING ---

let selectedFile = null;
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

// Event Listener for File Input
document.getElementById('file-input').addEventListener('change', handleFileSelect);

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    // CHECK SIZE LIMIT
    if (file.size > MAX_FILE_SIZE) {
        alert('Файл слишком большой! Максимальный размер: 100 МБ.');
        this.value = ''; // Clear input
        return;
    }

    selectedFile = file;

    // Show Preview
    const previewEl = document.getElementById('file-preview');
    previewEl.classList.remove('hidden');
    previewEl.innerHTML = `
        <div class="file-preview-item" style="${file.type.startsWith('image/') ? `background-image: url(${URL.createObjectURL(file)})` : 'background: #444; color: white; padding: 5px; font-size: 10px; text-align: center;'}">
            ${file.type.startsWith('image/') ? '' : 'FILE'}
            <button class="remove-btn" onclick="clearFile()">×</button>
        </div>
    `;
}

function clearFile() {
    selectedFile = null;
    document.getElementById('file-input').value = '';
    document.getElementById('file-preview').innerHTML = '';
    document.getElementById('file-preview').classList.add('hidden');
}

// --- MEDIA MODAL ---

function openMediaModal(src, type) {
    const modal = document.getElementById('media-modal');
    const content = document.getElementById('media-content');

    // Clear previous
    content.innerHTML = '';

    if (type === 'image') {
        const img = document.createElement('img');
        img.src = src;
        content.appendChild(img);
    } else if (type === 'video') {
        const video = document.createElement('video');
        video.src = src;
        video.controls = true;
        video.autoplay = true;
        content.appendChild(video);
    }

    modal.classList.remove('hidden');
}

function closeMediaModal(e) {
    // Check if clicked exactly on background or close button
    // e.target is what was clicked
    // e.currentTarget is the element the listener is attached to (the overlay)

    // If clicked on close button or DIRECTLY on the overlay (outside content)
    if (e.target.classList.contains('close-modal') || e.target.id === 'media-modal') {
        const modal = document.getElementById('media-modal');
        modal.classList.add('hidden');

        // Stop video playback
        const video = modal.querySelector('video');
        if (video) {
            video.pause();
            video.src = '';
        }
    }
}

// --- MESSAGING ---

async function sendMessage() {
    const input = document.getElementById('message-input');
    const sendBtn = document.querySelector('.send-btn');
    const content = input.value.trim();

    if ((!content && !selectedFile) || !currentChatId) return;

    // UI Loading State
    const originalBtnContent = sendBtn.innerHTML;
    sendBtn.innerHTML = '<span class="loader">⏳</span>'; // Simple loader
    sendBtn.disabled = true;
    input.disabled = true;

    try {
        let fileData = null;

        // 1. UPLOAD FILE (if any)
        if (selectedFile) {
            const file = selectedFile;

            // Sanitize filename
            const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
            const filePath = `${currentChatId}/${Date.now()}_${cleanName}`;

            const { data, error } = await sb.storage
                .from('chat-attachments')
                .upload(filePath, file);

            if (error) {
                console.error('Upload Error:', error);
                throw new Error('Ошибка загрузки файла: ' + error.message);
            }

            // Get Public URL
            const { data: { publicUrl } } = sb.storage
                .from('chat-attachments')
                .getPublicUrl(filePath);

            let type = 'file';
            if (file.type.startsWith('image/')) type = 'image';
            if (file.type.startsWith('video/')) type = 'video';

            fileData = {
                url: publicUrl,
                path: filePath,
                type: type,
                name: file.name,
                size: file.size
            };

            clearFile();
        }

        input.value = '';

        // 2. SEND MESSAGE
        const msgPayload = {
            conversation_id: currentChatId,
            sender_id: currentUser.id,
            content: content || (fileData ? '' : ' '),
            file_url: fileData ? fileData.url : null,
            file_type: fileData ? fileData.type : null,
            file_name: fileData ? fileData.name : null,
            file_size: fileData ? fileData.size : null
        };

        const { data: sentMsgs, error } = await sb.from('messages').insert(msgPayload).select();

        if (error) throw error;

        // IF SECRET CHAT: Save my OWN sent message to LocalDB
        if (currentChatIsSecret && sentMsgs && sentMsgs[0]) {
            const msg = sentMsgs[0];
            if (fileData) {
                // CRITICAL FIX: Do NOT delete from server yet! The recipient needs it.
                // We just want to ensure WE have it in our LocalDB with the blob.
                // We already have the file in 'selectedFile' (variable is cleared though).
                // We can fetch it to save as Blob in our DB, but do NOT delete remote.
                await saveMyFileLocally(msg, fileData.url);
            } else {
                await LocalDB.addMessage(msg);
            }
        }

    } catch (err) {
        alert(err.message);
        console.error(err);
    } finally {
        // Restore UI
        sendBtn.innerHTML = originalBtnContent;
        sendBtn.disabled = false;
        input.disabled = false;
        input.focus();
    }
}

async function saveMyFileLocally(msg, url) {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        msg.file_blob = blob;
        // Keep file_url temporarily so we can sync? 
        // Actually for local sender, we can keep it null or keep it.
        // User A (Sender) has LocalDB copy. 
        // User B (Recipient) will delete it from server later.
        msg.file_url = null; // We prefer local blob.
        await LocalDB.addMessage(msg);
        console.log('Saved my own file locally.');
    } catch (e) {
        console.error('Error saving local file:', e);
    }
}

async function downloadAndSecureFile(msg) {
    // SECURITY CHECK: Only delete if I am NOT the sender.
    // If I sent it, I shouldn't be running this function usually, but safety first.
    if (msg.sender_id === currentUser.id) return;

    if (!msg.file_url) return;

    try {
        const url = msg.file_url;
        const response = await fetch(url);
        const blob = await response.blob();

        // Save to DB
        msg.file_blob = blob;
        msg.file_url = null; // Remove URL ref from local copy
        await LocalDB.addMessage(msg);

        // Delete from Server
        // Extract path. URL format: .../chat-attachments/folder/file
        // We need 'folder/file'
        const path = url.split('chat-attachments/')[1];

        if (path) {
            await sb.storage.from('chat-attachments').remove([path]);
            console.log('Secret file wiped from server:', path);
        }

    } catch (e) {
        console.error('Failed to secure file:', e);
    }
}

// Assuming LocalDB is an object defined elsewhere, adding new methods to it.
// This placement is based on the instruction's snippet structure.
Object.assign(LocalDB, {
    async getMessagesPaged(chatId, limit, beforeDate) {
        await this.open();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('messages', 'readonly');
            const store = tx.objectStore('messages');
            const index = store.index('conversation_id');
            const request = index.getAll(chatId);

            request.onsuccess = () => {
                let msgs = request.result;

                // Sort by Date DESC (Newest first) for easier slicing
                msgs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

                // Filter
                if (beforeDate) {
                    const beforeTime = new Date(beforeDate).getTime();
                    msgs = msgs.filter(m => new Date(m.created_at).getTime() < beforeTime);
                }

                // Slice
                resolve(msgs.slice(0, limit));
            };
            request.onerror = (e) => reject(e);
        });
    },

    async getMessages(chatId) {
        // Fallback or deprecated
        return this.getMessagesPaged(chatId, 1000, null);
    }
});


function appendMessage(msg, method = 'append') {
    const container = document.getElementById('messages-container');

    // Check dupe by data-id
    if (document.querySelector(`.message[data-id="${msg.id}"]`)) return;

    const div = document.createElement('div');
    div.dataset.id = msg.id; // Mark id

    const isMine = msg.sender_id === currentUser.id;
    div.className = `message ${isMine ? 'mine' : 'theirs'}`;

    // Time
    const time = formatTime(msg.created_at);

    // CONTENT BUILDER
    let contentHtml = '';

    // Handle File
    // Check if we have a Blob (Local) or URL (Cloud)
    // If we have a Blob in msg.file_blob, create ObjectURL
    let fileSrc = msg.file_url;
    if (msg.file_blob) {
        fileSrc = URL.createObjectURL(msg.file_blob); // Runtime URL
    } else if (currentChatId && !fileSrc && currentUser.storage_type === 'local' && !isMine) {
        // Backlog/Loading state
    }

    if (fileSrc) {
        if (msg.file_type === 'image') {
            // Using a safer onclick handling to prevent scope issues if functions aren't global? 
            // They are global here.
            contentHtml += `<img src="${fileSrc}" class="msg-attachment-img" style="cursor:zoom-in" onclick="openMediaModal('${fileSrc}', 'image')">`;
        } else if (msg.file_type === 'video') {
            // For video, we can show a thumbnail or a small player.
            // If the user clicks, we open modal?
            // Actually, HTML5 video usually plays inline.
            // Let's make it clickable to "Expand"
            contentHtml += `
                <div class="video-wrapper" onclick="openMediaModal('${fileSrc}', 'video')" style="cursor:pointer; position:relative; display:inline-block;">
                    <video src="${fileSrc}" class="msg-attachment-video"></video>
                    <div style="position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); color:white; font-size:24px; text-shadow:0 0 5px black;">▶</div>
                </div>`;
        } else {
            // Generic File
            contentHtml += `
                <a href="${fileSrc}" target="_blank" class="msg-attachment-file" download="${msg.file_name || 'file'}">
                    <div class="icon">📄</div>
                    <div class="info">
                        <div class="name">${msg.file_name || 'File'}</div>
                        <div class="size">${formatBytes(msg.file_size)}</div>
                    </div>
                </a>
            `;
        }
    }

    if (msg.content) {
        contentHtml += `<div class="msg-content">${msg.content}</div>`;
    }

    div.innerHTML = `
        ${contentHtml}
        <div class="msg-time">${time}</div>
    `;

    if (method === 'prepend') {
        // Insert after the load-more button
        const loadMoreBtn = document.getElementById('load-more-container');
        // We need to insert AFTER this button.
        // Actually, container has flex column.
        // If we use insertBefore on the *element after* button, or just appendChild.
        // wait, method='prepend' usually means top of visual list.
        // But the list starts with [Button] -> [Msg1] -> [Msg2].
        // So we want to insert Before [Msg1].

        let firstMsg = container.querySelector('.message');
        if (firstMsg) {
            container.insertBefore(div, firstMsg);
        } else {
            container.appendChild(div);
        }
    } else {
        container.appendChild(div);
    }

    // TRIGGER SECRET SECURING if needed (only for appended/new messages usually)
    if (method === 'append' && currentUser.storage_type === 'local' && msg.file_url && !msg.file_blob) {
        downloadAndSecureFile(msg);
    }
}

function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function scrollToBottom() {
    const container = document.getElementById('messages-container');
    container.scrollTop = container.scrollHeight;
}

function handleInputKey(e) {
    if (e.key === 'Enter') sendMessage();
}

// --- ACTIVITY HEARTBEAT ---
setInterval(async () => {
    if (currentUser) {
        await sb.from('profiles').update({ last_seen: new Date() }).eq('id', currentUser.id);
    }
}, 30000); // Every 30 sec active

// --- SETTINGS ---

function openSettings() {
    document.getElementById('settings-overlay').classList.add('active');
}

function closeSettings() {
    document.getElementById('settings-overlay').classList.remove('active');
    document.getElementById('new-password').value = '';
    document.getElementById('settings-msg').innerText = '';
}

async function changePassword() {
    const newPass = document.getElementById('new-password').value;
    const msgEl = document.getElementById('settings-msg');

    if (!newPass || newPass.length < 6) {
        msgEl.style.color = 'var(--danger)';
        msgEl.innerText = 'Пароль должен быть не менее 6 символов';
        return;
    }

    msgEl.style.color = 'var(--text-hint)';
    msgEl.innerText = 'Обновление...';

    const { error } = await sb.auth.updateUser({ password: newPass });

    if (error) {
        msgEl.style.color = 'var(--danger)';
        msgEl.innerText = 'Ошибка: ' + error.message;
    } else {
        msgEl.style.color = '#4caf50'; // Green
        msgEl.innerText = 'Пароль успешно изменен!';
        document.getElementById('new-password').value = '';
    }
}

// Start
init();
