/**
 * TELEGRAPH PLUS - Core Engine
 * Arquitectura Vanilla JS + Telegram WebApp SDK + Telegraph API + Supabase Ready
 */

const CONFIG = {
    TELEGRAPH_API: 'https://api.telegra.ph',
    MAX_ACCOUNTS: 5,
    MAX_PAGES: 10,
    // Configura tus credenciales de Supabase aquí para persistencia en la nube:
    SUPABASE_URL: '', // Ej: 'https://xyzcompany.supabase.co'
    SUPABASE_ANON_KEY: '' // Ej: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
};

// 1. GESTIÓN DE IDENTIDAD DE TELEGRAM (Con Fallback Local)
const TelegramIdentity = {
    getUser() {
        const tg = window.Telegram?.WebApp;
        if (tg) {
            tg.ready();
            tg.expand();
        }

        const user = tg?.initDataUnsafe?.user;
        if (user && user.id) {
            return {
                id: user.id,
                first_name: user.first_name || 'Usuario',
                last_name: user.last_name || '',
                username: user.username || '',
                language_code: user.language_code || 'es',
                is_telegram: true
            };
        }

        // Objeto de respaldo para pruebas locales fuera de Telegram
        return {
            id: 999000111,
            first_name: 'Mateo',
            last_name: 'Local',
            username: 'mateo_dev',
            language_code: 'es',
            is_telegram: false
        };
    }
};

// 2. GESTIÓN DE TEMA (Claro / Oscuro)
const ThemeManager = {
    init() {
        const savedTheme = localStorage.getItem('tp_theme');
        const tgScheme = window.Telegram?.WebApp?.colorScheme;
        const initialTheme = savedTheme || tgScheme || 'light';
        this.apply(initialTheme);
    },
    apply(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('tp_theme', theme);
        const btn = document.getElementById('themeToggleBtn');
        if (btn) {
            btn.innerHTML = theme === 'dark' ? '☀️ Modo Claro' : '🌙 Modo Oscuro';
        }
    },
    toggle() {
        const current = document.documentElement.getAttribute('data-theme');
        this.apply(current === 'dark' ? 'light' : 'dark');
    }
};

// 3. CAPA DE PERSISTENCIA (Supabase + LocalStorage Sync)
const StorageService = {
    _localKey(tgId) {
        return `tp_accounts_${tgId}`;
    },

    async getAccounts(tgId) {
        // Si Supabase está configurado, sincroniza desde la nube
        if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) {
            try {
                const res = await fetch(
                    `${CONFIG.SUPABASE_URL}/rest/v1/telegraph_accounts?telegram_user_id=eq.${tgId}&order=created_at.asc`,
                    {
                        headers: {
                            'apikey': CONFIG.SUPABASE_ANON_KEY,
                            'Authorization': `Bearer ${CONFIG.SUPABASE_ANON_KEY}`
                        }
                    }
                );
                if (res.ok) {
                    const data = await res.json();
                    localStorage.setItem(this._localKey(tgId), JSON.stringify(data));
                    return data;
                }
            } catch (e) {
                console.warn('Fallback a almacenamiento local:', e);
            }
        }
        return JSON.parse(localStorage.getItem(this._localKey(tgId)) || '[]');
    },

    async saveAccount(tgUser, accountData) {
        const accounts = await this.getAccounts(tgUser.id);
        
        // Verificar si el token ya existe
        const existingIndex = accounts.findIndex(a => a.access_token === accountData.access_token);
        if (existingIndex !== -1) {
            accounts[existingIndex] = { ...accounts[existingIndex], ...accountData };
        } else {
            if (accounts.length >= CONFIG.MAX_ACCOUNTS) {
                throw new Error(`Límite alcanzado: Máximo ${CONFIG.MAX_ACCOUNTS} cuentas por usuario.`);
            }
            const isMaster = accounts.length === 0; // La primera cuenta es la maestra
            const newRecord = {
                telegram_user_id: tgUser.id,
                telegram_username: tgUser.username,
                telegram_first_name: tgUser.first_name,
                access_token: accountData.access_token,
                short_name: accountData.short_name,
                author_name: accountData.author_name || '',
                author_url: accountData.author_url || '',
                is_master: isMaster,
                created_at: new Date().toISOString()
            };
            accounts.push(newRecord);

            if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) {
                await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/telegraph_accounts`, {
                    method: 'POST',
                    headers: {
                        'apikey': CONFIG.SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'return=minimal'
                    },
                    body: JSON.stringify(newRecord)
                });
            }
        }

        localStorage.setItem(this._localKey(tgUser.id), JSON.stringify(accounts));
        return accounts;
    },

    async updateAccountTokenOrMeta(tgId, oldToken, updatedFields) {
        let accounts = await this.getAccounts(tgId);
        accounts = accounts.map(acc => acc.access_token === oldToken ? { ...acc, ...updatedFields } : acc);
        localStorage.setItem(this._localKey(tgId), JSON.stringify(accounts));

        if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) {
            await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/telegraph_accounts?access_token=eq.${oldToken}`, {
                method: 'PATCH',
                headers: {
                    'apikey': CONFIG.SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updatedFields)
            });
        }
        return accounts;
    },

    async removeAccount(tgId, token) {
        let accounts = await this.getAccounts(tgId);
        accounts = accounts.filter(acc => acc.access_token !== token);
        if (accounts.length > 0 && !accounts.some(a => a.is_master)) {
            accounts[0].is_master = true;
        }
        localStorage.setItem(this._localKey(tgId), JSON.stringify(accounts));

        if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) {
            await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/telegraph_accounts?access_token=eq.${token}`, {
                method: 'DELETE',
                headers: {
                    'apikey': CONFIG.SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${CONFIG.SUPABASE_ANON_KEY}`
                }
            });
        }
        return accounts;
    },

    setActiveSession(token) {
        sessionStorage.setItem('tp_active_token', token);
        localStorage.setItem('tp_last_active_token', token);
    },

    getActiveSession() {
        return sessionStorage.getItem('tp_active_token') || localStorage.getItem('tp_last_active_token');
    },

    clearSession() {
        sessionStorage.removeItem('tp_active_token');
        localStorage.removeItem('tp_last_active_token');
    }
};

// 4. CLIENTE OFICIAL DE LA API DE TELEGRAPH
const TelegraphAPI = {
    async request(endpoint, params = {}) {
        const url = new URL(`${CONFIG.TELEGRAPH_API}/${endpoint}`);
        Object.keys(params).forEach(key => {
            if (params[key] !== undefined && params[key] !== null) {
                url.searchParams.append(key, typeof params[key] === 'object' ? JSON.stringify(params[key]) : params[key]);
            }
        });

        const response = await fetch(url.toString());
        const data = await response.json();
        if (!data.ok) {
            throw new Error(data.error || 'Error en la API de Telegraph');
        }
        return data.result;
    },

    createAccount(short_name, author_name = '', author_url = '') {
        return this.request('createAccount', { short_name, author_name, author_url });
    },

    getAccountInfo(access_token) {
        return this.request('getAccountInfo', {
            access_token,
            fields: JSON.stringify(['short_name', 'author_name', 'author_url', 'auth_url', 'page_count'])
        });
    },

    editAccountInfo(access_token, short_name, author_name, author_url) {
        return this.request('editAccountInfo', { access_token, short_name, author_name, author_url });
    },

    revokeAccessToken(access_token) {
        return this.request('revokeAccessToken', { access_token });
    },

    getPageList(access_token, limit = CONFIG.MAX_PAGES) {
        return this.request('getPageList', { access_token, limit });
    },

    getPage(path) {
        return this.request(`getPage/${path}`, { return_content: true });
    },

    createPage(access_token, title, author_name, contentNodes) {
        return this.request('createPage', {
            access_token,
            title,
            author_name,
            content: JSON.stringify(contentNodes),
            return_content: true
        });
    },

    editPage(access_token, path, title, author_name, contentNodes) {
        return this.request('editPage', {
            access_token,
            path,
            title,
            author_name,
            content: JSON.stringify(contentNodes),
            return_content: true
        });
    }
};

// 5. UTILIDADES UI Y DOM PARSER PARA TELEGRAPH NODES
const UI = {
    toast(msg, duration = 3500) {
        let el = document.getElementById('globalToast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'globalToast';
            el.className = 'toast';
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.classList.add('show');
        if (duration > 0) {
            clearTimeout(this._timer);
            this._timer = setTimeout(() => el.classList.remove('show'), duration);
        }
    },

    downloadTxt(filename, content) {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
    },

    // Convierte texto plano en párrafos compatibles con Node[] de Telegraph
    textToNodes(text) {
        const lines = text.split('\n').filter(l => l.trim() !== '');
        if (lines.length === 0) return [{ tag: 'p', children: [' '] }];
        return lines.map(line => ({ tag: 'p', children: [line] }));
    },

    // Extrae texto editable desde Node[] de Telegraph
    nodesToText(nodes) {
        if (!Array.isArray(nodes)) return '';
        return nodes.map(node => {
            if (typeof node === 'string') return node;
            if (node.children) return this.nodesToText(node.children);
            return '';
        }).join('\n\n');
    }
};

document.addEventListener('DOMContentLoaded', () => {
    ThemeManager.init();
    const themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => ThemeManager.toggle());
    }
});
