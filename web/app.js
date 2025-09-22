// Global state and utilities
const state = {
    data: {},
    tab: 'items',
    selectedKey: null,
    format: 'json',
    findMatches: [],
    currentMatch: -1,
    isOpen: false
};

// Field order for different entities
const fieldOrder = {
    weapons: ['name', 'label', 'weapontype', 'ammotype', 'damagereason'],
    items: ['name', 'label', 'weight', 'type', 'image', 'unique', 'useable', 'shouldClose', 'description'],
    jobs: ['label', 'defaultDuty', 'grades'],
    gangs: ['label', 'grades'],
    vehicles: ['name', 'brand', 'model', 'price', 'category', 'hash']
};

// Helper functions
const el = (selector) => document.querySelector(selector);
const els = (selector) => document.querySelectorAll(selector);

// NUI Bridge
const sendNui = (action, data) => {
    fetch(`https://${GetParentResourceName()}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
};

// Toast notifications
const showToast = (message, type = 'info') => {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    el('#toastContainer').appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 4000);
};

// Update line numbers
const updateLineNumbers = () => {
    const editor = el('#codeEditor');
    const lineNumbers = el('#lineNumbers');
    const lines = editor.value.split('\n').length;
    
    let numbersHtml = '';
    for (let i = 1; i <= lines; i++) {
        numbersHtml += i + '\n';
    }
    lineNumbers.textContent = numbersHtml.slice(0, -1);
};

// Update cursor position in status bar
const updateCursorPosition = () => {
    const editor = el('#codeEditor');
    const pos = editor.selectionStart;
    const text = editor.value.substring(0, pos);
    const lines = text.split('\n');
    const line = lines.length;
    const col = lines[lines.length - 1].length + 1;
    
    el('#statusPos').textContent = `Ln ${line}, Col ${col}`;
};

// Convert object to Lua format
const toLuaEntry = (entity, key, value) => {
    let luaKey = key;
    
    // Special handling for weapons - use value.name as key if available
    if (entity === 'weapons' && value && value.name) {
        luaKey = `['${value.name}']`;
    } else if (/^[a-zA-Z_]\w*$/.test(key)) {
        luaKey = key; // Valid identifier
    } else if (!isNaN(key)) {
        luaKey = `[${key}]`; // Numeric key
    } else {
        luaKey = `['${key}']`; // String key
    }
    
    const luaValue = objectToLua(value, 1);
    return `${luaKey} = ${luaValue}`;
};

// Convert JavaScript object to Lua table syntax
const objectToLua = (obj, indent = 0) => {
    if (obj === null || obj === undefined) return 'nil';
    if (typeof obj === 'string') return `'${obj.replace(/'/g, "\\'")}'`;
    if (typeof obj === 'number') return obj.toString();
    if (typeof obj === 'boolean') return obj.toString();
    
    if (Array.isArray(obj)) {
        if (obj.length === 0) return '{}';
        const items = obj.map(item => objectToLua(item, indent + 1));
        return `{ ${items.join(', ')} }`;
    }
    
    if (typeof obj === 'object') {
        const spaces = '    '.repeat(indent);
        const nextSpaces = '    '.repeat(indent + 1);
        
        if (Object.keys(obj).length === 0) return '{}';
        
        const pairs = [];
        const fields = fieldOrder[state.tab] || Object.keys(obj);
        
        // Add ordered fields first
        fields.forEach(field => {
            if (obj.hasOwnProperty(field)) {
                const key = /^[a-zA-Z_]\w*$/.test(field) ? field : `['${field}']`;
                pairs.push(`${nextSpaces}${key} = ${objectToLua(obj[field], indent + 1)}`);
            }
        });
        
        // Add remaining fields
        Object.keys(obj).forEach(field => {
            if (!fields.includes(field)) {
                const key = /^[a-zA-Z_]\w*$/.test(field) ? field : `['${field}']`;
                pairs.push(`${nextSpaces}${key} = ${objectToLua(obj[field], indent + 1)}`);
            }
        });
        
        return `{\n${pairs.join(',\n')}\n${spaces}}`;
    }
    
    return 'nil';
};

// Simple Lua to JSON parser (basic implementation)
const luaToJson = (luaStr) => {
    try {
        // Remove key = prefix and clean up
        let cleaned = luaStr.replace(/^\s*\[?['"]?(\w+)['"]?\]?\s*=\s*/, '');
        
        // Replace Lua syntax with JSON
        cleaned = cleaned
            .replace(/'/g, '"')           // Single to double quotes
            .replace(/\bnil\b/g, 'null')  // nil to null
            .replace(/\btrue\b/g, 'true') // boolean true
            .replace(/\bfalse\b/g, 'false') // boolean false
            .replace(/,(\s*[}\]])/g, '$1') // Remove trailing commas
            .replace(/([{,]\s*)(\w+)(\s*=)/g, '$1"$2":'); // Object keys
        
        return JSON.parse(cleaned);
    } catch (e) {
        throw new Error(`Lua parse error: ${e.message}`);
    }
};

// Set editor text and update UI
const setText = (text) => {
    el('#codeEditor').value = text;
    updateLineNumbers();
    updateCursorPosition();
};

// Render key list
const renderList = () => {
    const list = el('#list');
    const search = el('#searchInput').value.toLowerCase();
    const currentData = state.data[state.tab] || {};
    
    const keys = Object.keys(currentData)
        .filter(key => key.toLowerCase().includes(search))
        .sort();
    
    list.innerHTML = '';
    
    keys.forEach(key => {
        const item = document.createElement('div');
        item.className = 'key-item';
        item.textContent = key;
        
        // Show weapon name if available
        if (state.tab === 'weapons' && currentData[key] && currentData[key].name) {
            item.textContent = `${key} (${currentData[key].name})`;
        }
        
        if (key === state.selectedKey) {
            item.classList.add('selected');
        }
        
        item.addEventListener('click', () => selectKey(key));
        list.appendChild(item);
    });
};

// Select a key and load its data
const selectKey = (key) => {
    state.selectedKey = key;
    const currentData = state.data[state.tab] || {};
    const value = currentData[key];
    
    // Update breadcrumb
    el('#breadcrumb').innerHTML = `${state.tab}/${key}<span id="fileExt">${state.format === 'lua' ? '.lua' : '.json'}</span>`;
    
    // Update editor
    if (value !== undefined) {
        const text = state.format === 'lua' 
            ? toLuaEntry(state.tab, key, value)
            : JSON.stringify(value, null, 2);
        setText(text);
    } else {
        setText(state.format === 'lua' ? "['new_key'] = { }" : '{}');
    }
    
    renderList();
    renderInspector();
    updateStatus();
};

// Render inspector panel
const renderInspector = () => {
    const details = el('#details');
    const editor = el('#codeEditor');
    
    try {
        let obj;
        if (state.format === 'lua') {
            obj = luaToJson(editor.value);
        } else {
            obj = JSON.parse(editor.value);
        }
        
        if (typeof obj !== 'object' || obj === null) {
            details.innerHTML = '<div class="no-data">Invalid object</div>';
            return;
        }
        
        const fields = fieldOrder[state.tab] || Object.keys(obj);
        let html = '';
        
        // Show ordered fields first
        fields.forEach(field => {
            if (obj.hasOwnProperty(field)) {
                const value = typeof obj[field] === 'object' 
                    ? JSON.stringify(obj[field]) 
                    : String(obj[field]);
                html += `<div class="detail-item">
                    <span class="detail-key">${field}:</span>
                    <span class="detail-value">${value}</span>
                </div>`;
            }
        });
        
        // Show remaining fields
        Object.keys(obj).forEach(field => {
            if (!fields.includes(field)) {
                const value = typeof obj[field] === 'object' 
                    ? JSON.stringify(obj[field]) 
                    : String(obj[field]);
                html += `<div class="detail-item">
                    <span class="detail-key">${field}:</span>
                    <span class="detail-value">${value}</span>
                </div>`;
            }
        });
        
        details.innerHTML = html || '<div class="no-data">No fields</div>';
        
    } catch (e) {
        details.innerHTML = '<div class="no-data">Invalid content</div>';
    }
};

// Update status bar
const updateStatus = () => {
    el('#statusFormat').textContent = state.format.toUpperCase();
    
    if (state.currentMatch >= 0) {
        el('#statusMessage').textContent = `Find: Match ${state.currentMatch + 1} of ${state.findMatches.length}`;
    } else {
        el('#statusMessage').textContent = state.selectedKey ? 'Editing' : 'Ready';
    }
};

// Find functionality
const performFind = () => {
    const query = el('#findInput').value;
    const editor = el('#codeEditor');
    const text = editor.value;
    
    if (!query) {
        state.findMatches = [];
        state.currentMatch = -1;
        el('#findCounter').textContent = '0/0';
        updateStatus();
        return;
    }
    
    state.findMatches = [];
    let index = 0;
    
    while (index < text.length) {
        const found = text.indexOf(query, index);
        if (found === -1) break;
        
        state.findMatches.push({
            start: found,
            end: found + query.length,
            line: text.substring(0, found).split('\n').length
        });
        
        index = found + 1;
    }
    
    el('#findCounter').textContent = `${state.findMatches.length > 0 ? 1 : 0}/${state.findMatches.length}`;
    
    if (state.findMatches.length > 0) {
        state.currentMatch = 0;
        highlightMatch();
    } else {
        state.currentMatch = -1;
    }
    
    updateStatus();
};

const highlightMatch = () => {
    if (state.currentMatch < 0 || state.currentMatch >= state.findMatches.length) return;
    
    const editor = el('#codeEditor');
    const match = state.findMatches[state.currentMatch];
    
    editor.focus();
    editor.setSelectionRange(match.start, match.end);
    
    el('#findCounter').textContent = `${state.currentMatch + 1}/${state.findMatches.length}`;
    updateStatus();
};

// Action handlers
const doAction = (action) => {
    const entity = state.tab;
    let key = state.selectedKey || 'new_key';
    const editor = el('#codeEditor');
    
    if (action === 'remove') {
        if (!state.selectedKey) {
            showToast('No item selected for removal', 'error');
            return;
        }
        
        if (confirm(`Remove ${state.selectedKey} from ${entity}?`)) {
            sendNui('perform', { entity, action, key: state.selectedKey });
        }
        return;
    }
    
    // Parse editor content
    let value;
    try {
        if (state.format === 'lua') {
            value = luaToJson(editor.value);
        } else {
            value = JSON.parse(editor.value);
        }
    } catch (e) {
        showToast(`${state.format === 'lua' ? 'Lua' : 'JSON'} parse error: ${e.message}`, 'error');
        return;
    }
    
    // For weapons, use value.name as key if available
    if (entity === 'weapons' && value && value.name && typeof value.name === 'string') {
        key = value.name;
    }
    
    sendNui('perform', { entity, action, key, value });
};

// Fill item template
const fillItemTemplate = () => {
    const template = {
        name: 'new_item',
        label: 'New Item',
        weight: 0,
        type: 'item',
        image: 'new_item.png',
        unique: false,
        useable: false,
        shouldClose: false,
        description: 'A new item'
    };
    
    setText(state.format === 'lua' 
        ? toLuaEntry('items', 'new_item', template)
        : JSON.stringify(template, null, 2));
    
    renderInspector();
};

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    // Tab switching
    els('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            els('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            state.tab = tab.dataset.tab;
            state.selectedKey = null;
            
            // Update breadcrumb
            el('#breadcrumb').innerHTML = `${state.tab}/new_key<span id="fileExt">${state.format === 'lua' ? '.lua' : '.json'}</span>`;
            
            renderList();
            setText(state.format === 'lua' ? "['new_key'] = { }" : '{}');
            renderInspector();
            updateStatus();
        });
    });
    
    // Format selector
    el('#fmtSelect').addEventListener('change', (e) => {
        state.format = e.target.value;
        el('#fileExt').textContent = state.format === 'lua' ? '.lua' : '.json';
        
        const obj = state.data[state.tab] || {};
        const k = state.selectedKey;
        
        if (k && obj[k] !== undefined) {
            const val = obj[k];
            setText(state.format === 'lua' ? toLuaEntry(state.tab, k, val) : JSON.stringify(val, null, 2));
        } else {
            setText(state.format === 'lua' ? "['new_key'] = { }" : '{}');
        }
        
        renderInspector();
        updateStatus();
    });
    
    // Search input
    el('#searchInput').addEventListener('input', renderList);
    
    // Editor events
    const editor = el('#codeEditor');
    editor.addEventListener('input', () => {
        updateLineNumbers();
        renderInspector();
    });
    
    editor.addEventListener('keyup', updateCursorPosition);
    editor.addEventListener('click', updateCursorPosition);
    
    // Action buttons
    el('#addBtn').addEventListener('click', () => doAction('add'));
    el('#updateBtn').addEventListener('click', () => doAction('update'));
    el('#removeBtn').addEventListener('click', () => doAction('remove'));
    
    // Close buttons
    el('#closeBtn').addEventListener('click', () => sendNui('close', {}));
    el('#closeBtnAlt').addEventListener('click', () => sendNui('close', {}));
    
    // Refresh button
    el('#refreshBtn').addEventListener('click', () => sendNui('fetchAll', {}));
    
    // Helper buttons
    el('#fillTemplateBtn').addEventListener('click', fillItemTemplate);
    
    // Find functionality
    el('#findInput').addEventListener('input', performFind);
    el('#findNext').addEventListener('click', () => {
        if (state.findMatches.length === 0) return;
        state.currentMatch = (state.currentMatch + 1) % state.findMatches.length;
        highlightMatch();
    });
    
    el('#findPrev').addEventListener('click', () => {
        if (state.findMatches.length === 0) return;
        state.currentMatch = state.currentMatch <= 0 ? state.findMatches.length - 1 : state.currentMatch - 1;
        highlightMatch();
    });
    
    el('#findClose').addEventListener('click', () => {
        el('#findBar').style.display = 'none';
        state.findMatches = [];
        state.currentMatch = -1;
        updateStatus();
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'f') {
            e.preventDefault();
            const findBar = el('#findBar');
            findBar.style.display = findBar.style.display === 'none' ? 'flex' : 'none';
            if (findBar.style.display !== 'none') {
                el('#findInput').focus();
            }
        }
        
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            doAction('update');
        }
        
        if (e.key === 'Delete' && !e.target.matches('input, textarea')) {
            e.preventDefault();
            doAction('remove');
        }
        
        if (e.key === 'Enter' && e.target === el('#findInput')) {
            e.preventDefault();
            if (e.shiftKey) {
                el('#findPrev').click();
            } else {
                el('#findNext').click();
            }
        }
    });
});

// NUI Message Handler
window.addEventListener('message', (event) => {
    const data = event.data;
    
    switch (data.type) {
        case 'open':
            el('#panel').style.display = 'flex';
            state.isOpen = true;
            sendNui('fetchAll', {});
            break;
            
        case 'close':
            el('#panel').style.display = 'none';
            state.isOpen = false;
            break;
            
        case 'populate':
            state.data = data.data;

            console.log("state.data", JSON.stringify(state.data))
            renderList();
            
            // Reset to new_key if current selection doesn't exist
            if (!state.selectedKey || !state.data[state.tab] || !state.data[state.tab][state.selectedKey]) {
                state.selectedKey = null;
                el('#breadcrumb').innerHTML = `${state.tab}/new_key<span id="fileExt">${state.format === 'lua' ? '.lua' : '.json'}</span>`;
                setText(state.format === 'lua' ? "['new_key'] = { }" : '{}');
            }
            
            renderInspector();
            updateStatus();
            break;
            
        case 'result':
            const result = data.data;
            showToast(result.message, result.ok ? 'success' : 'error');
            break;
    }
});
