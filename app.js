// ========================================
// 全局状态管理
// ========================================

let scripts = [];
let videos = [];
let selectedScriptIndex = -1;
let selectedVideoIndex = -1;
let editingScriptIndex = -1;
let editingScriptDraft = '';
let currentScriptPage = 1;
let currentVideoPage = 1;
const SCRIPTS_PER_PAGE = 10;
const VIDEOS_PER_PAGE = 12;
let apiKeyLocks = { llm: false, video: false };
let isGenerating = false;
let isCancelled = false;
let videoFilter = 'all';
let selectedVideoIds = new Set();
let selectedScriptIds = new Set();
let isScriptBatchMode = false;
let isVideoBatchMode = false;

const CONFIG_KEY = 'batch_video_config';
const LLM_PROXY_API = '/api/llm-proxy';
const VIDEO_PROXY_API = '/api/video-proxy';

// ========================================
// 配置管理
// ========================================

const DEFAULT_CONFIG = {
    llm: {
        provider: 'openai',
        apiKey: '',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        model: 'gpt-3.5-turbo',
        profile: '',
        promptTemplate: '你是一个专业的广告文案师。请根据以下信息生成3条吸引人的买量视频文案，每条不超过50字：\n{product_info}\n\n要求：突出卖点，语言简洁有力，适合短视频平台。'
    },
    video: {
        provider: 'ark',
        apiKey: '',
        endpoint: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',
        model: 'doubao-seedance-1-5-pro-251215',
        duration: 5,
        resolution: '720p',
        ratio: 'adaptive',
        generateAudio: true,
        watermark: true,
        cameraFixed: false,
        imageUrl: '',
        promptTemplate: '{script}'
    }
};

let config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

// ========================================
// 页面初始化
// ========================================

window.addEventListener('beforeunload', (e) => {
    if (isGenerating) {
        e.preventDefault();
        e.returnValue = '视频正在生成中，离开页面将中断任务，确定要离开吗？';
    }
});

document.addEventListener('DOMContentLoaded', () => {
    loadConfig();
    loadFromStorage();
    renderScriptList();
    renderVideoList();
    updateStats();
    
    document.getElementById('llm-provider')?.addEventListener('change', handleLlmProviderChange);
    document.getElementById('video-provider')?.addEventListener('change', handleVideoProviderChange);
    
    // 全局键盘快捷键
    document.addEventListener('keydown', handleGlobalKeydown);
});

function handleGlobalKeydown(e) {
    // Ctrl/Cmd + Enter 保存文案编辑
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && editingScriptIndex >= 0) {
        e.preventDefault();
        saveScriptEdit(editingScriptIndex);
    }
    // Escape 取消编辑或关闭弹窗
    if (e.key === 'Escape') {
        if (editingScriptIndex >= 0) {
            cancelScriptEdit();
        }
        if (document.getElementById('settings-modal')?.classList.contains('active')) {
            closeSettings();
        }
        if (document.getElementById('import-modal')?.classList.contains('active')) {
            closeImportModal();
        }
    }
    // Ctrl/Cmd + S 保存配置
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        if (document.getElementById('settings-modal')?.classList.contains('active')) {
            e.preventDefault();
            saveSettings();
        }
    }
}

function loadConfig() {
    const saved = localStorage.getItem(CONFIG_KEY);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            config = {
                llm: { ...DEFAULT_CONFIG.llm, ...(parsed.llm || {}) },
                video: { ...DEFAULT_CONFIG.video, ...(parsed.video || {}) }
            };
        } catch (error) {
            config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        }
    }
    updateConfigUI();
}

function saveConfig() {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

function updateConfigUI() {
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
    };
    const setCheck = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.checked = Boolean(val);
    };
    
    setVal('llm-provider', config.llm.provider);
    setVal('llm-endpoint', config.llm.endpoint);
    setVal('llm-model', config.llm.model);
    setVal('llm-profile', config.llm.profile || '');
    setVal('llm-prompt', config.llm.promptTemplate);
    setVal('video-provider', config.video.provider);
    setVal('video-endpoint', config.video.endpoint);
    setVal('video-model', config.video.model);
    setVal('video-duration', config.video.duration);
    setVal('video-resolution', config.video.resolution);
    setVal('video-ratio', config.video.ratio);
    setCheck('video-generate-audio', config.video.generateAudio);
    setCheck('video-watermark', config.video.watermark);
    setCheck('video-camera-fixed', config.video.cameraFixed);
    setVal('video-image-url', config.video.imageUrl || '');
    setVal('video-prompt', config.video.promptTemplate);
    
    syncApiKeyLockUI('llm');
    syncApiKeyLockUI('video');
}

function getApiKeyInput(type) { return document.getElementById(`${type}-api-key`); }
function getApiKeyLockCheckbox(type) { return document.getElementById(`${type}-api-key-locked`); }
function getStoredApiKey(type) { return type === 'llm' ? config.llm.apiKey : config.video.apiKey; }

function maskApiKey(value) {
    const text = String(value || '');
    if (!text) return '';
    if (text.length <= 8) return '•'.repeat(text.length);
    return `${text.slice(0, 4)}${'•'.repeat(Math.min(8, text.length - 8))}${text.slice(-4)}`;
}

function syncApiKeyLockUI(type) {
    const input = getApiKeyInput(type);
    const checkbox = getApiKeyLockCheckbox(type);
    if (!input || !checkbox) return;

    const locked = apiKeyLocks[type];
    const storedKey = getStoredApiKey(type);

    checkbox.checked = locked;
    input.disabled = locked;
    input.value = storedKey;
    input.title = locked ? (storedKey ? `已锁定，当前 Key：${maskApiKey(storedKey)}` : '已锁定，当前未设置 Key') : '已解锁，可编辑 Key';
}

function toggleApiKeyLock(type) {
    const checkbox = getApiKeyLockCheckbox(type);
    if (!checkbox) return;
    apiKeyLocks[type] = checkbox.checked;
    syncApiKeyLockUI(type);
    if (!apiKeyLocks[type]) {
        const input = getApiKeyInput(type);
        if (input) { input.focus(); input.select(); }
    }
}

function getApiKeyValue(type) {
    const input = getApiKeyInput(type);
    const locked = apiKeyLocks[type];
    const currentValue = getStoredApiKey(type);
    if (!input) return currentValue;
    if (locked) return currentValue;
    const nextValue = input.value.trim();
    return nextValue || currentValue;
}

function handleLlmProviderChange() {
    const presets = {
        openai: { endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-3.5-turbo' },
        deepseek: { endpoint: 'https://api.deepseek.com', model: 'deepseek-chat' },
        claude: { endpoint: 'https://api.anthropic.com/v1/messages', model: 'claude-3-5-sonnet-latest' }
    };
    const preset = presets[document.getElementById('llm-provider')?.value];
    if (preset) {
        document.getElementById('llm-endpoint').value = preset.endpoint;
        document.getElementById('llm-model').value = preset.model;
    }
}

function handleVideoProviderChange() {
    const presets = {
        ark: { endpoint: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks', model: 'doubao-seedance-1-5-pro-251215', resolution: '720p', ratio: 'adaptive' },
        custom: { endpoint: '', model: '', resolution: '720p', ratio: '16:9' }
    };
    const preset = presets[document.getElementById('video-provider')?.value];
    if (preset) {
        document.getElementById('video-endpoint').value = preset.endpoint;
        document.getElementById('video-model').value = preset.model;
        document.getElementById('video-resolution').value = preset.resolution;
        document.getElementById('video-ratio').value = preset.ratio;
    }
}

function loadFromStorage() {
    const savedScripts = localStorage.getItem('batch_scripts');
    const savedVideos = localStorage.getItem('batch_videos');
    if (savedScripts) scripts = JSON.parse(savedScripts);
    if (savedVideos) videos = JSON.parse(savedVideos);
}

function saveToStorage() {
    localStorage.setItem('batch_scripts', JSON.stringify(scripts));
    localStorage.setItem('batch_videos', JSON.stringify(videos));
}

// ========================================
// 界面交互
// ========================================

function openSettings() {
    updateConfigUI();
    document.getElementById('settings-modal').classList.add('active');
}

function closeSettings() {
    if (document.getElementById('settings-modal').classList.contains('active')) {
        saveSettings(true);
    }
    document.getElementById('settings-modal').classList.remove('active');
}

function saveSettings(silent = false) {
    config.llm = {
        provider: document.getElementById('llm-provider').value,
        apiKey: getApiKeyValue('llm'),
        endpoint: document.getElementById('llm-endpoint').value,
        model: document.getElementById('llm-model').value,
        profile: document.getElementById('llm-profile').value,
        promptTemplate: document.getElementById('llm-prompt').value
    };
    config.video = {
        provider: document.getElementById('video-provider').value,
        apiKey: getApiKeyValue('video'),
        endpoint: document.getElementById('video-endpoint').value,
        model: document.getElementById('video-model').value,
        duration: parseInt(document.getElementById('video-duration').value),
        resolution: document.getElementById('video-resolution').value,
        ratio: document.getElementById('video-ratio').value,
        generateAudio: document.getElementById('video-generate-audio').checked,
        watermark: document.getElementById('video-watermark').checked,
        cameraFixed: document.getElementById('video-camera-fixed').checked,
        imageUrl: document.getElementById('video-image-url').value.trim(),
        promptTemplate: document.getElementById('video-prompt').value
    };
    saveConfig();
    syncApiKeyLockUI('llm');
    syncApiKeyLockUI('video');
    if (!silent) {
        showToast('配置已保存', 'success');
        closeSettings();
    }
}

function importScripts() {
    document.getElementById('import-modal').classList.add('active');
}

function closeImportModal() {
    document.getElementById('import-modal').classList.remove('active');
    document.getElementById('text-import-area').style.display = 'none';
    document.getElementById('import-text').value = '';
}

function importFromText() {
    document.getElementById('text-import-area').style.display = 'block';
}

function processTextImport() {
    const text = document.getElementById('import-text').value.trim();
    if (!text) { showToast('请输入文案内容', 'error'); return; }

    const lines = text.split('\n').filter(line => line.trim());
    const newScripts = lines.map(line => ({
        id: Date.now() + Math.random(),
        originalText: line.trim(),
        text: line.trim(),
        status: 'pending',
        createdAt: new Date().toISOString()
    }));

    scripts = [...scripts, ...newScripts];
    currentScriptPage = Math.ceil(scripts.length / SCRIPTS_PER_PAGE);
    saveToStorage();
    renderScriptList();
    updateStats();
    closeImportModal();
    showToast(`成功导入 ${newScripts.length} 条文案`, 'success');
}

function handleFileImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const content = e.target.result;
        const lines = content.split('\n').filter(line => line.trim());
        const newScripts = lines.map(line => ({
            id: Date.now() + Math.random(),
            originalText: file.name.endsWith('.csv') ? (line.split(',')[0] || line.trim()) : line.trim(),
            text: file.name.endsWith('.csv') ? (line.split(',')[0] || line.trim()) : line.trim(),
            status: 'pending',
            createdAt: new Date().toISOString()
        }));

        scripts = [...scripts, ...newScripts];
        currentScriptPage = Math.ceil(scripts.length / SCRIPTS_PER_PAGE);
        saveToStorage();
        renderScriptList();
        updateStats();
        closeImportModal();
        showToast(`成功导入 ${newScripts.length} 条文案`, 'success');
    };
    reader.readAsText(file);
    event.target.value = '';
}

// 上传产品设定文档
function handleProfileFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        const content = e.target.result;
        document.getElementById('llm-profile').value = content;
        document.getElementById('profile-file-name').textContent = `已上传: ${file.name}`;
        showToast(`已加载设定文档: ${file.name}`, 'success');
    };
    reader.onerror = () => {
        showToast('读取文件失败，请重试', 'error');
    };
    reader.readAsText(file);
    event.target.value = '';
}

// ========================================
// 文案管理
// ========================================

function renderScriptList() {
    const container = document.getElementById('script-list');
    
    if (scripts.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon-wrapper">
                    <svg viewBox="0 0 64 64" width="72" height="72" xmlns="http://www.w3.org/2000/svg">
                        <rect x="8" y="8" width="48" height="48" rx="8" fill="#3b82f6"/>
                        <path d="M20 16h24v32H20z" fill="#f8fafc"/>
                        <path d="M24 24h16M24 32h16M24 40h10" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round"/>
                        <path d="M38 48l12-12 4 4-12 12-6 2 2-6z" fill="#f97316" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>
                    </svg>
                </div>
                <p class="empty-title">暂无文案</p>
                <p class="empty-desc">导入文案后会在此显示</p>
            </div>`;
        renderScriptPagination();
        return;
    }

    const totalPages = Math.ceil(scripts.length / SCRIPTS_PER_PAGE);
    if (currentScriptPage > totalPages) currentScriptPage = totalPages;
    if (currentScriptPage < 1) currentScriptPage = 1;

    const startIndex = (currentScriptPage - 1) * SCRIPTS_PER_PAGE;
    const endIndex = Math.min(startIndex + SCRIPTS_PER_PAGE, scripts.length);
    const paginatedScripts = scripts.slice(startIndex, endIndex);

    container.innerHTML = paginatedScripts.map((script, indexOnPage) => {
        const index = startIndex + indexOnPage;
        const isEditing = editingScriptIndex === index;
        const isChecked = selectedScriptIds.has(index);

        return `
            <div class="script-item ${selectedScriptIndex === index ? 'selected' : ''} ${isEditing ? 'editing' : ''}" 
                 onclick="selectScript(${index})">
                ${isEditing ? `
                    <div class="script-edit-panel" onclick="event.stopPropagation()">
                        <textarea class="script-inline-editor" data-script-editor="${index}"
                            oninput="updateEditingScript(this.value)"
                            onkeydown="handleScriptEditorKeydown(event, ${index})"
                            placeholder="请输入文案内容...">${escapeHtml(editingScriptDraft)}</textarea>
                        <div class="script-edit-actions">
                            <button class="btn-primary" onclick="saveScriptEdit(${index}); event.stopPropagation();">保存</button>
                            <button class="btn-secondary" onclick="cancelScriptEdit(); event.stopPropagation();">取消</button>
                        </div>
                        <div class="script-edit-tip">按 Ctrl/⌘ + Enter 保存，Esc 取消</div>
                    </div>
                ` : `
                    ${isScriptBatchMode ? `<input type="checkbox" class="script-checkbox" ${isChecked ? 'checked' : ''} onclick="toggleScriptSelection(event, ${index})">` : ''}
                    <div class="script-image-uploader" onclick="event.stopPropagation(); document.getElementById('script-img-upload-${index}').click();" title="点击上传此文案专属首帧图">
                        ${script.image ? `<img src="${script.image}">` : `<span class="upload-icon"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></span>`}
                        <input type="file" id="script-img-upload-${index}" accept="image/*" style="display:none" onchange="handleScriptImageUpload(event, ${index})">
                    </div>
                    <div class="script-content-wrapper">
                        <div class="script-text">${escapeHtml(script.text)}</div>
                        
                        <div class="script-meta">
                            <span class="script-status ${script.status}">${getStatusText(script.status)}</span>
                            <span>${formatTime(script.createdAt)}</span>
                        </div>
                    </div>
                    <div class="script-actions">
                        ${script.image ? `<button class="delete-btn" onclick="event.stopPropagation(); removeScriptImage(${index})" title="移除专属图">🚫</button>` : ''}
                        <button class="edit-btn" onclick="event.stopPropagation(); editScript(${index})">✏️</button>
                        <button class="delete-btn" onclick="event.stopPropagation(); deleteScript(${index})">🗑️</button>
                    </div>
                `}
            </div>`;
    }).join('');

    renderScriptPagination();
    
    const selectAllCheckbox = document.getElementById('select-all-scripts');
    if (selectAllCheckbox) selectAllCheckbox.checked = scripts.length > 0 && scripts.length === selectedScriptIds.size;

    if (editingScriptIndex >= 0) {
        requestAnimationFrame(() => {
            const editor = document.querySelector(`[data-script-editor="${editingScriptIndex}"]`);
            if (editor) { editor.focus(); editor.setSelectionRange(editor.value.length, editor.value.length); }
        });
    }
}

function renderScriptPagination() {
    const container = document.getElementById('script-pagination');
    if (!container) return;
    
    const totalPages = Math.ceil(scripts.length / SCRIPTS_PER_PAGE);
    
    // 无内容或多于1页才显示分页
    if (scripts.length === 0 || totalPages <= 1) { 
        container.style.display = 'none'; 
        return; 
    }
    
    container.style.display = 'flex';
    container.innerHTML = `
        <button class="pagination-btn" ${currentScriptPage === 1 ? 'disabled' : ''} onclick="changeScriptPage(${currentScriptPage - 1})">上一页</button>
        <span class="pagination-info">${currentScriptPage} / ${totalPages}</span>
        <button class="pagination-btn" ${currentScriptPage === totalPages ? 'disabled' : ''} onclick="changeScriptPage(${currentScriptPage + 1})">下一页</button>`;
}

function changeScriptPage(page) {
    const totalPages = Math.ceil(scripts.length / SCRIPTS_PER_PAGE);
    if (page >= 1 && page <= totalPages) { currentScriptPage = page; renderScriptList(); }
}

function toggleScriptSelection(event, index) { event.stopPropagation(); selectedScriptIds.has(index) ? selectedScriptIds.delete(index) : selectedScriptIds.add(index); renderScriptList(); }
function toggleSelectAllScripts() {
    const isChecked = document.getElementById('select-all-scripts').checked;
    isChecked ? scripts.forEach((_, i) => selectedScriptIds.add(i)) : selectedScriptIds.clear();
    renderScriptList();
}

function toggleScriptBatchMode() {
    isScriptBatchMode = !isScriptBatchMode;
    const btn = document.getElementById('btn-batch-scripts');
    const toolbar = document.getElementById('script-list-toolbar');
    if (btn) { btn.innerHTML = isScriptBatchMode ? '❌ 取消' : '☑️ 批量操作'; btn.classList.toggle('active', isScriptBatchMode); }
    if (toolbar) toolbar.style.display = isScriptBatchMode ? 'flex' : 'none';
    if (!isScriptBatchMode) selectedScriptIds.clear();
    renderScriptList();
}

function deleteSelectedScripts() {
    if (selectedScriptIds.size === 0) { showToast('请先勾选需要删除的文案', 'warning'); return; }
    if (!confirm(`确定要删除选中的 ${selectedScriptIds.size} 条文案及关联的视频吗？`)) return;
    
    Array.from(selectedScriptIds).sort((a, b) => b - a).forEach(index => { scripts.splice(index, 1); videos.splice(index, 1); });
    selectedScriptIds.clear();
    selectedScriptIndex = -1; editingScriptIndex = -1; selectedVideoIndex = -1;
    previewVideo(-1);
    currentScriptPage = Math.max(1, Math.ceil(scripts.length / SCRIPTS_PER_PAGE));
    
    saveToStorage();
    if (isScriptBatchMode) toggleScriptBatchMode();
    else renderScriptList();
    renderVideoList();
    updateStats();
    showToast('批量删除完成', 'success');
}

function clearAllScripts() {
    if (confirm('确定要清空所有文案和视频吗？')) {
        scripts = []; videos = [];
        selectedScriptIndex = -1; selectedVideoIndex = -1; editingScriptIndex = -1;
        selectedScriptIds.clear(); selectedVideoIds.clear();
        previewVideo(-1);
        currentScriptPage = 1; currentVideoPage = 1;
        saveToStorage();
        renderScriptList();
        renderVideoList();
        updateStats();
        showToast('已清空全部数据', 'info');
    }
}

function selectScript(index) { selectedScriptIndex = index; renderScriptList(); }

function editScript(index) { selectedScriptIndex = index; editingScriptIndex = index; editingScriptDraft = scripts[index].text; renderScriptList(); }
function updateEditingScript(value) { editingScriptDraft = value; }

function saveScriptEdit(index) {
    const newText = editingScriptDraft.trim();
    if (!newText) { showToast('请输入内容', 'error'); return; }
    scripts[index].text = newText;
    if (scripts[index].status === 'pending') scripts[index].originalText = newText;
    editingScriptIndex = -1;
    editingScriptDraft = '';
    saveToStorage();
    renderScriptList();
    updateStats();
    showToast('内容已更新', 'success');
}

function cancelScriptEdit() { editingScriptIndex = -1; editingScriptDraft = ''; renderScriptList(); }

function handleScriptEditorKeydown(event, index) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); saveScriptEdit(index); return; }
    if (event.key === 'Escape') { event.preventDefault(); cancelScriptEdit(); }
}

function handleScriptImageUpload(event, index) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_DIMENSION = 1920;
            let width = img.width, height = img.height;
            if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
                if (width > height) { height = (height / width) * MAX_DIMENSION; width = MAX_DIMENSION; }
                else { width = (width / height) * MAX_DIMENSION; height = MAX_DIMENSION; }
            }
            canvas.width = width; canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            scripts[index].image = canvas.toDataURL('image/jpeg', 0.85);
            saveToStorage();
            renderScriptList();
            showToast('专属首帧图像已设置', 'success');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
    event.target.value = '';
}

function removeScriptImage(index) { if (scripts[index].image) { delete scripts[index].image; saveToStorage(); renderScriptList(); } }

function deleteScript(index) {
    if (confirm('确定要删除这条文案吗？')) {
        scripts.splice(index, 1);
        videos.splice(index, 1);
        if (selectedScriptIndex === index) selectedScriptIndex = -1;
        else if (selectedScriptIndex > index) selectedScriptIndex -= 1;
        if (editingScriptIndex === index) { editingScriptIndex = -1; editingScriptDraft = ''; }
        else if (editingScriptIndex > index) editingScriptIndex -= 1;
        saveToStorage();
        renderScriptList();
        renderVideoList();
        updateStats();
    }
}

// ========================================
// 视频生成
// ========================================

function renderVideoList() {
    updateVideoFilterCounts();
    const container = document.getElementById('video-list');
    
    if (videos.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1/-1;" class="empty-state">
                <div class="empty-icon-wrapper">
                    <svg viewBox="0 0 64 64" width="72" height="72" xmlns="http://www.w3.org/2000/svg">
                        <rect x="8" y="8" width="48" height="48" rx="8" fill="#8b5cf6"/>
                        <path d="M16 20h32v24H16z" fill="#f8fafc"/>
                        <path d="M28 26v12l10-6z" fill="#8b5cf6"/>
                    </svg>
                </div>
                <p class="empty-title">暂无视频</p>
                <p class="empty-desc">导入文案后点击生成视频</p>
            </div>`;
        renderVideoPagination(0);
        return;
    }

    const filteredIndices = videos.map((v, i) => shouldShowVideo(v, i) ? i : null).filter(i => i !== null);
    const totalPages = Math.ceil(filteredIndices.length / VIDEOS_PER_PAGE);
    if (currentVideoPage > totalPages) currentVideoPage = totalPages;
    if (currentVideoPage < 1) currentVideoPage = 1;

    const startIndex = (currentVideoPage - 1) * VIDEOS_PER_PAGE;
    const endIndex = Math.min(startIndex + VIDEOS_PER_PAGE, filteredIndices.length);
    const paginatedIndices = filteredIndices.slice(startIndex, endIndex);

    if (paginatedIndices.length === 0) {
        container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">无匹配的视频</div>`;
    } else {
        container.innerHTML = paginatedIndices.map(index => {
            const video = videos[index];
            const isChecked = selectedVideoIds.has(index);
            return `
                <div class="video-item ${selectedVideoIndex === index ? 'selected' : ''}" onclick="selectVideo(${index})">
                    ${isVideoBatchMode ? `<input type="checkbox" class="video-checkbox" ${isChecked ? 'checked' : ''} onclick="toggleVideoSelection(event, ${index})">` : ''}
                    <div class="video-thumbnail">
                        ${video.status === 'completed' && video.url ? 
                            `<video src="${video.url}" muted></video><span class="play-icon"><svg viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M8 5v14l11-7z"/></svg></span>` :
                            `<span class="play-icon"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" class="loading-spinner"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></span>`
                        }
                        <span class="video-status ${video.status}">${getVideoStatusText(video.status)}</span>
                        <div class="video-single-actions" onclick="event.stopPropagation()">
                            ${video.status === 'completed' ? 
                                `<button onclick="generateSingleVideo(${index})" title="重新生成">🔄 重做</button>` :
                                `<button onclick="generateSingleVideo(${index})" title="单独生成">▶️ 生成</button>`
                            }
                        </div>
                    </div>
                    <div class="video-info">
                        <h4>视频 ${index + 1}</h4>
                        <span>${video.script ? (video.script.substring(0, 20) + '...') : '无关联文案'}</span>
                        ${video.status === 'failed' && video.error ? `<div class="video-error" title="${video.error}">${video.error}</div>` : ''}
                    </div>
                </div>`;
        }).join('');
    }
    
    renderVideoPagination(filteredIndices.length);
    
    const selectAllCheckbox = document.getElementById('select-all-videos');
    if (selectAllCheckbox) selectAllCheckbox.checked = paginatedIndices.length > 0 && paginatedIndices.every(i => selectedVideoIds.has(i));
}

function renderVideoPagination(totalItems) {
    const container = document.getElementById('video-pagination');
    if (!container) return;
    
    const totalPages = Math.ceil(totalItems / VIDEOS_PER_PAGE);
    
    // 无内容或多于1页才显示分页
    if (totalItems === 0 || totalPages <= 1) { 
        container.style.display = 'none'; 
        return; 
    }
    
    container.style.display = 'flex';
    container.innerHTML = `
        <button class="pagination-btn" ${currentVideoPage === 1 ? 'disabled' : ''} onclick="changeVideoPage(${currentVideoPage - 1})">上一页</button>
        <span class="pagination-info">${currentVideoPage} / ${totalPages}</span>
        <button class="pagination-btn" ${currentVideoPage === totalPages ? 'disabled' : ''} onclick="changeVideoPage(${currentVideoPage + 1})">下一页</button>`;
}

function changeVideoPage(page) {
    const filteredIndices = videos.map((v, i) => shouldShowVideo(v, i) ? i : null).filter(i => i !== null);
    const totalPages = Math.ceil(filteredIndices.length / VIDEOS_PER_PAGE);
    if (page >= 1 && page <= totalPages) { currentVideoPage = page; renderVideoList(); }
}

function setVideoFilter(filter) {
    videoFilter = filter;
    currentVideoPage = 1;
    document.querySelectorAll('.filter-tab').forEach(el => el.classList.remove('active'));
    document.getElementById(`filter-${filter}`)?.classList.add('active');
    renderVideoList();
}

function toggleSelectAllVideos() {
    const isChecked = document.getElementById('select-all-videos').checked;
    if (isChecked) videos.forEach((v, i) => { if (shouldShowVideo(v, i)) selectedVideoIds.add(i); });
    else selectedVideoIds.clear();
    renderVideoList();
}

function toggleVideoBatchMode() {
    isVideoBatchMode = !isVideoBatchMode;
    const btn = document.getElementById('btn-batch-videos');
    const batchActions = document.getElementById('video-batch-actions');
    if (btn) { btn.innerHTML = isVideoBatchMode ? '❌ 取消' : '☑️ 批量操作'; btn.classList.toggle('active', isVideoBatchMode); }
    if (batchActions) batchActions.style.display = isVideoBatchMode ? 'flex' : 'none';
    if (!isVideoBatchMode) selectedVideoIds.clear();
    renderVideoList();
}

function toggleVideoSelection(event, index) { event.stopPropagation(); selectedVideoIds.has(index) ? selectedVideoIds.delete(index) : selectedVideoIds.add(index); renderVideoList(); }

function shouldShowVideo(video) {
    if (videoFilter === 'all') return true;
    if (videoFilter === 'pending') return video.status === 'pending';
    if (videoFilter === 'generating') return ['queued', 'running', 'generating'].includes(video.status);
    if (videoFilter === 'completed') return video.status === 'completed';
    if (videoFilter === 'failed') return ['failed', 'expired'].includes(video.status);
    return true;
}

function updateVideoFilterCounts() {
    const counts = { all: 0, pending: 0, generating: 0, completed: 0, failed: 0 };
    videos.forEach(v => {
        counts.all++;
        if (v.status === 'pending') counts.pending++;
        else if (['queued', 'running', 'generating'].includes(v.status)) counts.generating++;
        else if (v.status === 'completed') counts.completed++;
        else if (['failed', 'expired'].includes(v.status)) counts.failed++;
    });
    
    ['all', 'pending', 'generating', 'completed', 'failed'].forEach(f => {
        const el = document.getElementById(`filter-${f}`);
        if (el) el.textContent = `${f === 'all' ? '全部' : f === 'pending' ? '待生成' : f === 'generating' ? '生成中' : f === 'completed' ? '成功' : '失败'} (${counts[f]})`;
    });
}

function selectVideo(index) { selectedVideoIndex = index; renderVideoList(); previewVideo(index); }

function previewVideo(index) {
    const videoPreviewContainer = document.getElementById('video-preview');
    const videoActions = document.getElementById('video-actions');

    if (index < 0 || !videos[index]) {
        videoPreviewContainer.style.display = 'none';
        videoActions.style.display = 'none';
        return;
    }

    videoPreviewContainer.style.display = 'block';
    videoActions.style.display = 'grid';

    const video = videos[index];
    const videoEl = document.getElementById('preview-video');
    const placeholder = document.getElementById('preview-placeholder');

    if (video.url) {
        videoEl.src = video.url;
        placeholder.style.display = 'none';
        videoEl.style.display = 'block';
    } else {
        videoEl.src = '';
        videoEl.style.display = 'none';
        placeholder.style.display = 'flex';
    }
}

function stopGeneration() { if (isGenerating) { isCancelled = true; showToast('正在停止任务，请稍候...', 'warning'); } }

function updateActionButtons(type, generating) {
    const genBtn = document.getElementById(`btn-generate-${type}`);
    const stopBtn = document.getElementById(`btn-stop-${type}`);
    if (genBtn) genBtn.style.display = generating ? 'none' : 'inline-flex';
    if (stopBtn) stopBtn.style.display = generating ? 'inline-flex' : 'none';
}

// 批量生成文案
async function generateAllScripts() {
    if (!config.llm.apiKey) { showToast('请先配置 LLM API', 'error'); return; }
    if (scripts.length === 0) { showToast('请先导入信息', 'error'); return; }
    if (isGenerating) { showToast('当前有任务正在后台生成中，请耐心等待', 'warning'); return; }

    const pendingCount = scripts.filter(s => s.status !== 'generated').length;
    if (pendingCount === 0) {
        if (!confirm('所有文案均已生成过。是否要应用当前的"提示词模板"重新生成全部？\n(将会清除此前的生成结果)')) return;
        for (let i = scripts.length - 1; i >= 0; i--) {
            if (scripts[i].isDerived) { scripts.splice(i, 1); videos.splice(i, 1); }
        }
        scripts.forEach(s => {
            s.status = 'pending';
            if (s.originalText) s.text = s.originalText;
        });
        saveToStorage();
        renderScriptList();
        renderVideoList();
        updateStats();
    }

    isGenerating = true;
    isCancelled = false;
    updateActionButtons('scripts', true);
    showToast('开始在后台批量生成文案...', 'info');

    (async () => {
        try {
            for (let i = 0; i < scripts.length; i++) {
                if (isCancelled) { showToast('已手动停止文案生成', 'info'); break; }
                if (scripts[i].status === 'generated') continue;

                updateProgress(i + 1, scripts.length, `生成文案 ${i + 1}/${scripts.length}`);

                try {
                    const promptInput = scripts[i].originalText || scripts[i].text;
                    const generated = await generateScriptWithLLM(promptInput);
                    
                    let parsedScripts = [];
                    const lines = generated.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                    
                    for (const line of lines) {
                        if (line.startsWith('好的') || line.includes('以下是') || line.startsWith('当然') || line.startsWith('没问题')) continue;
                        const cleanLine = line.replace(/^([★☆]*\s*[(（]?\d+[\.\)）、:：]\s*|[-•*]\s*)/, '').replace(/^文案\d+[:：\s]/, '').trim();
                        if (cleanLine) parsedScripts.push(cleanLine);
                    }

                    if (parsedScripts.length === 0) parsedScripts = [generated];

                    scripts[i].text = parsedScripts[0];
                    scripts[i].status = 'generated';

                    if (parsedScripts.length > 1) {
                        const newScripts = parsedScripts.slice(1).map(text => ({
                            id: Date.now() + Math.random(),
                            originalText: scripts[i].originalText || scripts[i].text,
                            text: text,
                            status: 'generated',
                            createdAt: new Date().toISOString(),
                            image: scripts[i].image,
                            isDerived: true
                        }));
                        const newVideos = parsedScripts.slice(1).map(() => ({ status: 'pending', url: null, script: null }));
                        
                        scripts.splice(i + 1, 0, ...newScripts);
                        videos.splice(i + 1, 0, ...newVideos);
                        i += newScripts.length;
                    }

                    saveToStorage();
                    renderScriptList();
                } catch (error) {
                    showToast(`第 ${i + 1} 条文案生成失败: ${error.message}`, 'error');
                }

                await new Promise(resolve => setTimeout(resolve, 500));
            }

            if (!isCancelled) showToast('文案生成完成', 'success');

        } catch (error) {
            showToast('生成失败: ' + error.message, 'error');
        } finally {
            isGenerating = false;
            isCancelled = false;
            updateActionButtons('scripts', false);
            resetProgress();
            renderScriptList();
            updateStats();
        }
    })();
}

async function generateScriptWithLLM(text) {
    // 拼接设定文档和产品信息
    let fullPromptInput = text;
    if (config.llm.profile && config.llm.profile.trim()) {
        fullPromptInput = `【产品设定文档】\n${config.llm.profile.trim()}\n\n【本次产品信息】\n${text}`;
    }
    const prompt = config.llm.promptTemplate.replaceAll('{product_info}', fullPromptInput);

    // 统一通过代理调用所有 LLM API（解决 CORS 跨域问题）
    const data = await callLlmProxy({ 
        provider: config.llm.provider, 
        apiKey: config.llm.apiKey, 
        endpoint: config.llm.endpoint, 
        model: config.llm.model, 
        prompt 
    });
    return data.content;
}

async function generateAllVideos() {
    if (scripts.length === 0) { showToast('请先导入文案', 'error'); return; }
    if (config.video.provider !== 'local' && !config.video.apiKey) { showToast('请先配置视频 API Key', 'error'); return; }
    if (isGenerating) { showToast('当前有任务正在后台生成中，请耐心等待', 'warning'); return; }

    isGenerating = true;
    isCancelled = false;
    updateActionButtons('videos', true);
    showToast('开始在后台批量生成视频...', 'info');

    while (videos.length < scripts.length) videos.push({ status: 'pending', url: null, script: null });

    const pendingIndices = scripts.map((_, i) => i).filter(i => videos[i].status !== 'completed' && videos[i].status !== 'generating' && videos[i].status !== 'running');

    if (pendingIndices.length === 0) {
        showToast('没有需要生成的视频', 'info');
        isGenerating = false;
        updateActionButtons('videos', false);
        return;
    }

    (async () => {
        try {
            let completedCount = 0;
            const totalToGenerate = pendingIndices.length;
            updateProgress(0, totalToGenerate, `生成视频 0/${totalToGenerate}`);

            const promises = pendingIndices.map(async (scriptIndex, idx) => {
                if (isCancelled) return;
                await new Promise(resolve => setTimeout(resolve, idx * 2000));
                if (isCancelled) return;

                videos[scriptIndex].status = 'generating';
                videos[scriptIndex].script = scripts[scriptIndex].text;
                videos[scriptIndex].taskId = '';
                videos[scriptIndex].error = '';
                renderVideoList();

                try {
                    const scriptImage = scripts[scriptIndex]?.image;
                    const result = await generateVideoWithAPI(scripts[scriptIndex].text, scriptImage, (statusInfo) => {
                        videos[scriptIndex].status = normalizeVideoStatus(statusInfo.status);
                        videos[scriptIndex].taskId = statusInfo.taskId || videos[scriptIndex].taskId || '';
                        renderVideoList();
                    });
                    videos[scriptIndex].url = result.videoUrl;
                    videos[scriptIndex].status = 'completed';
                    videos[scriptIndex].taskId = result.taskId || videos[scriptIndex].taskId || '';
                } catch (error) {
                    if (error.message === '任务被手动取消') videos[scriptIndex].status = 'pending';
                    else { videos[scriptIndex].status = 'failed'; videos[scriptIndex].error = error.message; showToast(`第 ${scriptIndex + 1} 条视频生成失败: ${error.message}`, 'error'); }
                }

                completedCount++;
                updateProgress(completedCount, totalToGenerate, `生成视频 ${completedCount}/${totalToGenerate}`);
                saveToStorage();
                renderVideoList();
            });

            await Promise.all(promises);
            showToast(isCancelled ? '视频生成已手动停止' : '视频批量生成任务处理完成', isCancelled ? 'info' : 'success');
        } finally {
            isGenerating = false;
            isCancelled = false;
            updateActionButtons('videos', false);
            setTimeout(() => resetProgress(), 2000);
            renderVideoList();
        }
    })();
}

async function generateVideoWithAPI(script, scriptImage, onStatusChange) {
    const prompt = (config.video.promptTemplate || '{script}').replaceAll('{script}', script);

    if (config.video.provider === 'ark') {
        const imageUrlToUse = scriptImage || config.video.imageUrl;
        const createResult = await callVideoProxy({
            provider: 'ark', action: 'create', apiKey: config.video.apiKey, endpoint: config.video.endpoint,
            model: config.video.model, prompt, duration: config.video.duration, resolution: config.video.resolution,
            ratio: config.video.ratio, generateAudio: config.video.generateAudio, watermark: config.video.watermark,
            cameraFixed: config.video.cameraFixed, imageUrl: imageUrlToUse
        });
        if (typeof onStatusChange === 'function') onStatusChange({ taskId: createResult.taskId, status: 'queued' });
        return waitForArkVideoTask(createResult.taskId, onStatusChange);
    }

    if (!config.video.endpoint || !config.video.apiKey) throw new Error('请配置视频 API');

    const response = await fetch(config.video.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.video.apiKey}` },
        body: JSON.stringify({ prompt, duration: config.video.duration, resolution: config.video.resolution, ratio: config.video.ratio, model: config.video.model })
    });
    if (!response.ok) throw new Error(`API 请求失败: ${response.status}`);

    const data = await response.json();
    const videoUrl = data.video_url || data.url || data.output || data.result;
    if (!videoUrl) throw new Error('API 未返回视频地址');
    return { taskId: data.taskId || '', videoUrl };
}

function downloadCurrentVideo() {
    if (selectedVideoIndex < 0 || !videos[selectedVideoIndex].url) { showToast('请先选择一个已生成的视频', 'error'); return; }
    const link = document.createElement('a');
    link.href = videos[selectedVideoIndex].url;
    link.download = `video_${selectedVideoIndex + 1}.mp4`;
    link.click();
}

function generateSingleVideo(index) {
    if (isGenerating) { showToast('当前有批量任务正在执行，请稍后', 'warning'); return; }
    if (config.video.provider !== 'local' && !config.video.apiKey) { showToast('请先配置视频 API Key', 'error'); return; }
    
    videos[index].status = 'generating';
    videos[index].script = scripts[index].text;
    videos[index].taskId = '';
    videos[index].error = '';
    renderVideoList();
    showToast(`开始生成单条视频...`, 'info');

    (async () => {
        try {
            const result = await generateVideoWithAPI(scripts[index].text, scripts[index].image, (statusInfo) => {
                videos[index].status = normalizeVideoStatus(statusInfo.status);
                videos[index].taskId = statusInfo.taskId || videos[index].taskId || '';
                renderVideoList();
            });
            videos[index].url = result.videoUrl;
            videos[index].status = 'completed';
            videos[index].taskId = result.taskId || videos[index].taskId || '';
            showToast(`视频生成成功`, 'success');
        } catch (error) {
            videos[index].status = 'failed';
            videos[index].error = error.message;
            showToast(`视频生成失败: ${error.message}`, 'error');
        } finally {
            saveToStorage();
            renderVideoList();
        }
    })();
}

function regenerateCurrentVideo() {
    if (selectedVideoIndex < 0) { showToast('请先选择一个视频', 'error'); return; }
    videos[selectedVideoIndex].status = 'pending';
    videos[selectedVideoIndex].url = null;
    saveToStorage();
    renderVideoList();
    generateAllVideos();
}

function editCurrentVideoScript() {
    if (selectedVideoIndex < 0) { showToast('请先选择一个视频', 'error'); return; }
    const video = videos[selectedVideoIndex];
    const newScript = prompt('请输入新的文案：', video.script || '');
    if (newScript !== null && newScript.trim() !== '') {
        video.script = newScript.trim();
        if (scripts[selectedVideoIndex]) scripts[selectedVideoIndex].text = video.script;
        saveToStorage();
        renderScriptList();
        renderVideoList();
        showToast('文案已修改，您可以点击重新生成', 'success');
    }
}

function deleteCurrentVideo() {
    if (selectedVideoIndex < 0) { showToast('请先选择一个视频', 'error'); return; }
    if (confirm('确定要删除当前视频及关联文案吗？')) {
        videos.splice(selectedVideoIndex, 1);
        scripts.splice(selectedVideoIndex, 1);
        selectedVideoIndex = -1;
        previewVideo(-1);
        saveToStorage();
        renderScriptList();
        renderVideoList();
        updateStats();
        showToast('已删除', 'success');
    }
}

function clearAllVideos() {
    if (confirm('确定要清空所有视频吗？')) {
        videos = [];
        selectedVideoIndex = -1;
        saveToStorage();
        renderVideoList();
        previewVideo(-1);
        showToast('已清空所有视频', 'info');
    }
}

function retrySelectedScripts() {
    if (selectedScriptIds.size === 0) { showToast('请先勾选需要重新生成的文案', 'warning'); return; }
    selectedScriptIds.forEach(i => {
        scripts[i].status = 'pending';
        if (scripts[i].originalText) scripts[i].text = scripts[i].originalText;
    });
    saveToStorage();
    renderScriptList();
    generateAllScripts();
}

function batchSetScriptImage() {
    if (selectedScriptIds.size === 0) { showToast('请先勾选需要设置首帧图的文案', 'warning'); return; }
    // 创建一个隐藏的文件输入框
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        showLoading(`正在处理 ${selectedScriptIds.size} 条文案的首帧图...`);
        
        const reader = new FileReader();
        reader.onload = (evt) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_DIMENSION = 1920;
                let width = img.width, height = img.height;
                if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
                    if (width > height) { height = (height / width) * MAX_DIMENSION; width = MAX_DIMENSION; }
                    else { width = (width / height) * MAX_DIMENSION; height = MAX_DIMENSION; }
                }
                canvas.width = width; canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                const imageDataUrl = canvas.toDataURL('image/jpeg', 0.85);
                
                // 应用到所有选中的文案
                selectedScriptIds.forEach(index => {
                    scripts[index].image = imageDataUrl;
                });
                
                saveToStorage();
                renderScriptList();
                hideLoading();
                showToast(`已为 ${selectedScriptIds.size} 条文案设置首帧图`, 'success');
            };
            img.src = evt.target.result;
        };
        reader.readAsDataURL(file);
        input.remove();
    };
    input.click();
}

function clearSelectedScriptImages() {
    if (selectedScriptIds.size === 0) { showToast('请先勾选需要清除首帧图的文案', 'warning'); return; }
    selectedScriptIds.forEach(index => {
        delete scripts[index].image;
    });
    saveToStorage();
    renderScriptList();
    showToast(`已清除 ${selectedScriptIds.size} 条文案的首帧图`, 'success');
}

// ========================================
// 文案变体自动生成
// ========================================

function openVariantModal() {
    if (selectedScriptIds.size === 0) { showToast('请先勾选需要生成变体的文案', 'warning'); return; }
    document.getElementById('variant-modal').classList.add('active');
}

function closeVariantModal() {
    document.getElementById('variant-modal').classList.remove('active');
}

async function generateVariants() {
    if (selectedScriptIds.size === 0) { showToast('请先勾选需要生成变体的文案', 'warning'); return; }
    
    const variantCount = parseInt(document.getElementById('variant-count').value) || 5;
    const useLLM = document.getElementById('variant-use-llm').checked;
    
    closeVariantModal();
    showLoading(`正在生成 ${selectedScriptIds.size} 条文案的 ${variantCount} 个变体...`);

    try {
        const variantRules = {
            synonymReplace: document.getElementById('rule-synonym').checked,
            orderSwap: document.getElementById('rule-order').checked,
            numberRandom: document.getElementById('rule-number').checked,
            toneChange: document.getElementById('rule-tone').checked,
            customTemplate: document.getElementById('variant-template').value.trim()
        };

        let generatedCount = 0;
        
        for (const index of selectedScriptIds) {
            const script = scripts[index];
            let variants = [];

            if (useLLM && config.llm.apiKey) {
                // 使用 LLM 生成变体
                const prompt = buildVariantPrompt(script.text, variantCount, variantRules);
                try {
                    const data = await callLlmProxy({
                        provider: config.llm.provider,
                        apiKey: config.llm.apiKey,
                        endpoint: config.llm.endpoint,
                        model: config.llm.model,
                        prompt
                    });
                    variants = parseVariants(data.content);
                } catch (e) {
                    console.error('LLM 变体生成失败，回退规则模式', e);
                    variants = generateRuleBasedVariants(script.text, variantCount, variantRules);
                }
            } else {
                // 使用规则生成变体
                variants = generateRuleBasedVariants(script.text, variantCount, variantRules);
            }

            // 添加变体文案
            for (const text of variants) {
                if (scripts.some(s => s.text === text)) continue; // 避免重复
                scripts.splice(index + 1, 0, {
                    id: Date.now() + Math.random(),
                    originalText: script.originalText || script.text,
                    text: text,
                    status: 'generated',
                    createdAt: new Date().toISOString(),
                    image: script.image,
                    isDerived: true,
                    variantParentId: script.id
                });
                generatedCount++;
            }
        }

        saveToStorage();
        renderScriptList();
        renderVideoList();
        updateStats();
        hideLoading();
        showToast(`成功生成 ${generatedCount} 个文案变体`, 'success');
    } catch (error) {
        hideLoading();
        showToast(`变体生成失败: ${error.message}`, 'error');
    }
}

function buildVariantPrompt(originalText, count, rules) {
    let rulesText = '请生成以下文案的变体版本，要求：\n';
    if (rules.synonymReplace) rulesText += '1. 同义词替换（如"免费"→"0元"、"限时"→"此刻"）\n';
    if (rules.orderSwap) rulesText += '2. 调整语序结构\n';
    if (rules.numberRandom) rulesText += '3. 数字随机化（如"999元"→"699元"、"仅限前100名"→"仅限前50名"）\n';
    if (rules.toneChange) rulesText += '4. 语气转换（陈述句↔反问句↔感叹句）\n';
    if (rules.customTemplate) rulesText += `5. 参考模板风格：${rules.customTemplate}\n`;
    rulesText += `\n原文：${originalText}\n请直接输出 ${count} 个变体，每行一个，不要加编号或前缀。`;

    return rulesText;
}

function parseVariants(content) {
    const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 5);
    return lines.map(line => line.replace(/^[-*\d.、]+/, '').trim()).filter(l => l);
}

function generateRuleBasedVariants(text, count, rules) {
    const variants = new Set();
    
    // 基础变体：原文本
    variants.add(text);
    
    // 同义词替换规则
    const synonyms = {
        '免费': ['0元', '不要钱', '白送', '免费送'],
        '限时': ['此刻', '现在', '今天', '仅此一天'],
        '爆款': ['热销', '爆火', '抢手', '畅销'],
        '推荐': ['必选', '强推', '种草', '安利的'],
        '超值': ['划算', '实惠', '便宜', '巨划算'],
        '新品': ['新款', '新上', '刚刚上线'],
        '热卖': ['抢疯', '卖爆', '疯抢', '爆单']
    };
    
    let variant = text;
    for (const [word, replacements] of Object.entries(synonyms)) {
        if (variants.size >= count) break;
        for (const replacement of replacements.slice(0, 3)) {
            if (variant.includes(word)) {
                const newVariant = variant.replace(word, replacement);
                if (newVariant !== text && !variants.has(newVariant)) {
                    variants.add(newVariant);
                    if (variants.size >= count) break;
                }
            }
        }
    }
    
    // 数字随机化
    if (rules.numberRandom) {
        const numberMatches = text.match(/\d+/g);
        if (numberMatches) {
            for (const num of numberMatches) {
                const numInt = parseInt(num);
                if (numInt > 10) {
                    const variations = [
                        numInt * 0.7,
                        numInt * 0.8,
                        numInt * 0.9,
                        Math.round(numInt * 0.5),
                        Math.round(numInt * 1.2)
                    ].map(n => Math.round(n));
                    
                    for (const v of variations) {
                        if (v > 0 && v !== numInt) {
                            const newVariant = text.replace(new RegExp(`\\b${num}\\b`, 'g'), String(v));
                            if (!variants.has(newVariant)) {
                                variants.add(newVariant);
                                if (variants.size >= count) break;
                            }
                        }
                    }
                }
            }
        }
    }
    
    // 语序调整
    if (rules.orderSwap && variants.size < count) {
        const parts = text.split(/[，,、]/);
        if (parts.length >= 2) {
            // 颠倒顺序
            const reversed = [...parts].reverse().join('，');
            if (!variants.has(reversed)) variants.add(reversed);
            
            // 提取卖点后置
            if (parts.length >= 3) {
                const last = parts[parts.length - 1];
                const first = parts[0];
                const middle = parts.slice(1, -1);
                const reordered = `${last}，${first}，${middle.join('，')}`;
                if (!variants.has(reordered)) variants.add(reordered);
            }
        }
    }
    
    // 语气转换
    if (rules.toneChange && variants.size < count) {
        // 陈述句 → 反问句
        const questionVariant = text + '，你还不来？';
        if (!variants.has(questionVariant)) variants.add(questionVariant);
        
        // 添加感叹
        const exclamVariant = text.replace(/[。！？]$/, '') + '！快抢！';
        if (!variants.has(exclamVariant)) variants.add(exclamVariant);
        
        // 添加紧迫感
        const urgentVariant = '手慢无！' + text;
        if (!variants.has(urgentVariant)) variants.add(urgentVariant);
    }
    
    // 填充到指定数量
    const result = Array.from(variants).slice(0, count);
    while (result.length < count) {
        const idx = result.length % result.length || result.length;
        result.push(result[idx] + '🔥');
    }
    
    return result.slice(0, count);
}

// ========================================
// 数字人库 / 首帧图库管理
// ========================================

// 首帧图库数据（持久化存储）
const FRAME_LIBRARY_KEY = 'frame_library';
let frameLibrary = [];

function loadFrameLibrary() {
    const saved = localStorage.getItem(FRAME_LIBRARY_KEY);
    if (saved) {
        try {
            frameLibrary = JSON.parse(saved);
        } catch {
            frameLibrary = [];
        }
    }
}

function saveFrameLibrary() {
    localStorage.setItem(FRAME_LIBRARY_KEY, JSON.stringify(frameLibrary));
}

function openFrameLibraryModal() {
    loadFrameLibrary();
    renderFrameLibrary();
    document.getElementById('frame-library-modal').classList.add('active');
}

function closeFrameLibraryModal() {
    document.getElementById('frame-library-modal').classList.remove('active');
}

function renderFrameLibrary() {
    const container = document.getElementById('frame-library-list');
    if (!container) return;
    
    if (frameLibrary.length === 0) {
        container.innerHTML = `
            <div class="frame-library-empty">
                <p>暂无首帧图</p>
                <p style="font-size: 12px; color: var(--text-muted);">上传数字人或首帧图，用于批量分配</p>
            </div>`;
        return;
    }
    
    container.innerHTML = frameLibrary.map((frame, index) => `
        <div class="frame-library-item ${frame.isDefault ? 'default' : ''}">
            <img src="${frame.image}" alt="首帧图 ${index + 1}">
            <div class="frame-library-info">
                <span>${frame.name || `图 ${index + 1}`}</span>
                <span class="frame-ratio">${frame.usageCount || 0} 次使用</span>
            </div>
            <div class="frame-library-actions">
                <button onclick="setDefaultFrame(${index})" title="设为默认">⭐</button>
                <button onclick="deleteFrame(${index})" title="删除">🗑️</button>
            </div>
            ${frame.isDefault ? '<span class="default-badge">默认</span>' : ''}
        </div>
    `).join('');
}

function addFrameToLibrary(imageData, name = '') {
    frameLibrary.push({
        id: Date.now() + Math.random(),
        image: imageData,
        name: name || `图 ${frameLibrary.length + 1}`,
        isDefault: frameLibrary.length === 0,
        usageCount: 0,
        tags: []
    });
    saveFrameLibrary();
    renderFrameLibrary();
    showToast('首帧图已添加到图库', 'success');
}

function uploadFrameImage(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    let uploaded = 0;
    for (const file of files) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_DIMENSION = 1920;
                let width = img.width, height = img.height;
                if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
                    if (width > height) { height = (height / width) * MAX_DIMENSION; width = MAX_DIMENSION; }
                    else { width = (width / height) * MAX_DIMENSION; height = MAX_DIMENSION; }
                }
                canvas.width = width; canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                const imageDataUrl = canvas.toDataURL('image/jpeg', 0.85);
                addFrameToLibrary(imageDataUrl, file.name.replace(/\.[^.]+$/, ''));
                uploaded++;
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }
    event.target.value = '';
}

function setDefaultFrame(index) {
    frameLibrary.forEach((f, i) => f.isDefault = (i === index));
    saveFrameLibrary();
    renderFrameLibrary();
    showToast('已设为默认首帧图', 'success');
}

function deleteFrame(index) {
    if (confirm('确定要删除这张首帧图吗？')) {
        frameLibrary.splice(index, 1);
        if (frameLibrary.length > 0 && !frameLibrary.some(f => f.isDefault)) {
            frameLibrary[0].isDefault = true;
        }
        saveFrameLibrary();
        renderFrameLibrary();
    }
}

function applyFrameToSelected() {
    if (selectedScriptIds.size === 0) { showToast('请先勾选需要设置首帧图的文案', 'warning'); return; }
    if (frameLibrary.length === 0) { showToast('首帧图库为空，请先上传图片', 'warning'); return; }
    
    const distributeMode = document.getElementById('frame-distribute-mode')?.value || 'random';
    const indices = Array.from(selectedScriptIds).sort((a, b) => a - b);
    
    if (distributeMode === 'random') {
        // 随机分配
        indices.forEach(index => {
            const randomFrame = frameLibrary[Math.floor(Math.random() * frameLibrary.length)];
            scripts[index].image = randomFrame.image;
            randomFrame.usageCount++;
        });
    } else if (distributeMode === 'equal') {
        // 平均分配
        indices.forEach((index, i) => {
            const frameIndex = i % frameLibrary.length;
            scripts[index].image = frameLibrary[frameIndex].image;
            frameLibrary[frameIndex].usageCount++;
        });
    } else if (distributeMode === 'ratio') {
        // 按比例分配
        const weights = frameLibrary.map(f => f.weight || 1);
        const totalWeight = weights.reduce((a, b) => a + b, 0);
        let currentWeight = 0;
        
        indices.forEach(index => {
            const random = Math.random() * totalWeight;
            let cumulative = 0;
            for (let i = 0; i < frameLibrary.length; i++) {
                cumulative += weights[i];
                if (random < cumulative) {
                    scripts[index].image = frameLibrary[i].image;
                    frameLibrary[i].usageCount++;
                    break;
                }
            }
        });
    }
    
    saveFrameLibrary();
    saveToStorage();
    renderScriptList();
    showToast(`已为 ${indices.length} 条文案分配首帧图`, 'success');
}

function retrySelectedVideos() {
    if (selectedVideoIds.size === 0) { showToast('请先勾选需要重试的视频', 'warning'); return; }
    selectedVideoIds.forEach(i => { videos[i].status = 'pending'; videos[i].error = ''; });
    selectedVideoIds.clear();
    saveToStorage();
    renderVideoList();
    generateAllVideos();
}

function deleteSelectedVideos() {
    if (selectedVideoIds.size === 0) { showToast('请先勾选需要删除的视频', 'warning'); return; }
    if (!confirm(`确定要删除选中的 ${selectedVideoIds.size} 个视频及其关联文案吗？`)) return;
    
    Array.from(selectedVideoIds).sort((a, b) => b - a).forEach(index => { videos.splice(index, 1); scripts.splice(index, 1); });
    selectedVideoIds.clear();
    selectedScriptIndex = -1;
    selectedVideoIndex = -1;
    previewVideo(-1);
    
    saveToStorage();
    renderScriptList();
    if (isVideoBatchMode) toggleVideoBatchMode();
    else renderVideoList();
    updateStats();
    showToast('批量删除完成', 'success');
}

async function exportAllVideos() {
    const completedVideos = videos.filter(v => v.status === 'completed' && v.url);
    if (completedVideos.length === 0) { showToast('没有可导出的视频', 'error'); return; }

    if (typeof JSZip === 'undefined') {
        showToast('JSZip 库加载失败，回退逐个下载模式', 'warning');
        completedVideos.forEach((video, index) => {
            setTimeout(() => {
                const link = document.createElement('a');
                link.href = video.url;
                link.download = `video_${index + 1}.mp4`;
                link.click();
            }, index * 500);
        });
        return;
    }

    showLoading(`正在打包 ${completedVideos.length} 个视频为 ZIP...`);

    try {
        const zip = new JSZip();
        let successCount = 0, failCount = 0;

        for (let i = 0; i < completedVideos.length; i++) {
            const video = completedVideos[i];
            const realIndex = videos.indexOf(video);
            const scriptText = video.script ? video.script.substring(0, 15).replace(/[\\/:*?"<>|]/g, '_') : '';
            const fileName = `视频${String(realIndex + 1).padStart(3, '0')}${scriptText ? '_' + scriptText : ''}.mp4`;

            try {
                const response = await fetch(video.url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                zip.file(fileName, await response.blob());
                successCount++;
            } catch (err) {
                failCount++;
            }
        }

        if (successCount === 0) { hideLoading(); showToast('所有视频下载均失败，请检查网络或视频链接有效性', 'error'); return; }

        const content = await zip.generateAsync({ type: 'blob' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(content);
        link.download = `批量视频_${new Date().toISOString().slice(0, 10)}.zip`;
        link.click();
        URL.revokeObjectURL(link.href);

        hideLoading();
        showToast(failCount > 0 ? `导出完成：${successCount} 个成功，${failCount} 个失败` : `已成功打包导出 ${successCount} 个视频`, failCount > 0 ? 'warning' : 'success');
    } catch (error) {
        hideLoading();
        showToast(`打包导出失败: ${error.message}`, 'error');
    }
}

// ========================================
// 辅助功能
// ========================================

function updateProgress(current, total, text) {
    document.getElementById('current-task').textContent = text;
    document.getElementById('progress-text').textContent = `${current}/${total}`;
    document.getElementById('progress-fill').style.width = `${(current / total) * 100}%`;
}

function resetProgress() {
    document.getElementById('current-task').textContent = '-';
    document.getElementById('progress-text').textContent = '0/0';
    document.getElementById('progress-fill').style.width = '0%';
}

function updateStats() {
    document.getElementById('total-scripts').textContent = scripts.length;
    document.getElementById('pending-scripts').textContent = scripts.filter(s => s.status === 'pending').length;
    document.getElementById('completed-scripts').textContent = scripts.filter(s => s.status === 'generated').length;
}

function showLoading(text = '处理中...') {
    document.getElementById('loading-text').textContent = text;
    document.getElementById('loading-overlay').style.display = 'flex';
}

function hideLoading() { document.getElementById('loading-overlay').style.display = 'none'; }

function showToast(message, type = 'info') {
    document.querySelectorAll('.my-custom-toast, #toast-container > div').forEach(el => el.remove());
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    while (container.children.length >= 5) container.firstElementChild.remove();
    container.appendChild(toast);

    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => { if (toast.parentElement) toast.remove(); }, 300);
    }, 3000);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatTime(isoString) {
    const date = new Date(isoString);
    return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getStatusText(status) { return { pending: '待处理', generated: '已生成' }[status] || status; }
function getVideoStatusText(status) { return { pending: '待生成', queued: '排队中', running: '生成中', generating: '生成中', completed: '已完成', failed: '失败', expired: '已过期' }[status] || status; }

function normalizeVideoStatus(status) {
    const normalized = String(status || '').trim().toLowerCase();
    return { queued: 'queued', pending: 'pending', submitted: 'queued', running: 'running', processing: 'running', generating: 'generating', succeeded: 'completed', success: 'completed', completed: 'completed', failed: 'failed', error: 'failed', expired: 'expired' }[normalized] || 'generating';
}

async function callLlmProxy({ provider, apiKey, endpoint, model, prompt }) {
    const response = await fetch(LLM_PROXY_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey, endpoint, model, prompt })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `代理请求失败: ${response.status}`);
    if (!data.content) throw new Error('代理返回内容为空');
    return data;
}

async function callVideoProxy(payload) {
    const response = await fetch(VIDEO_PROXY_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `视频代理请求失败: ${response.status}`);
    return data;
}

async function waitForArkVideoTask(taskId, onStatusChange) {
    const maxAttempts = 120;
    const intervalMs = 5000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (isCancelled) throw new Error('任务被手动取消');

        const task = await callVideoProxy({ provider: 'ark', action: 'status', apiKey: config.video.apiKey, endpoint: config.video.endpoint, taskId });
        if (typeof onStatusChange === 'function') onStatusChange(task);

        const status = String(task.status || '').trim().toLowerCase();
        if (['succeeded', 'success', 'completed'].includes(status)) {
            if (!task.videoUrl) throw new Error('任务已完成，但未返回视频地址');
            return { taskId, videoUrl: task.videoUrl, raw: task.raw };
        }
        if (['failed', 'expired', 'error'].includes(status)) throw new Error(`任务状态异常：${task.status || 'failed'}`);

        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    throw new Error('视频生成超时，请稍后重试');
}

async function testLlmApi() {
    saveSettings(true);
    const provider = document.getElementById('llm-provider').value;
    const apiKey = getApiKeyValue('llm');
    const endpoint = document.getElementById('llm-endpoint').value;
    const model = document.getElementById('llm-model').value;
    const promptTemplate = document.getElementById('llm-prompt').value || '{product_info}';
    const testPrompt = promptTemplate.replaceAll('{product_info}', '测试产品：智能保温杯，24小时恒温');

    if (!apiKey) { showToast('请输入文案 API Key', 'error'); return; }

    showLoading('正在测试文案 API...');

    try {
        // 统一通过代理调用所有 LLM API
        const data = await callLlmProxy({ provider, apiKey, endpoint, model, prompt: testPrompt });
        hideLoading();
        alert(`✅ API 连接成功！\n\n生成结果示例：\n${data.content}`);
    } catch (error) {
        hideLoading();
        showToast(`❌ 文案 API 错误: ${error.message}`, 'error');
    }
}

async function testVideoApi() {
    saveSettings(true);
    const provider = document.getElementById('video-provider').value;
    const apiKey = getApiKeyValue('video');
    const endpoint = document.getElementById('video-endpoint').value;

    if (provider === 'local') { showToast('✅ 本地视频模式无需网络测试', 'success'); return; }
    if (!apiKey) { showToast('请输入视频 API Key', 'error'); return; }

    showLoading('正在测试视频 API...');

    try {
        if (provider === 'ark') {
            await callVideoProxy({ provider: 'ark', action: 'status', apiKey, endpoint, taskId: 'test_connection' })
                .catch(e => {
                    if (e.message.includes('Auth') || e.message.includes('auth') || e.message.includes('鉴权') || e.message.includes('无效的') || e.message.includes('401')) throw new Error('鉴权失败，请检查 API Key');
                    if (e.message.includes('404')) throw new Error('请求地址有误或模型不存在');
                    return { ok: true };
                });
            hideLoading();
            showToast('✅ 视频 API 连接测试通过！', 'success');
        } else {
            hideLoading();
            showToast('✅ 视频 API 测试暂时仅支持火山方舟', 'info');
        }
    } catch (error) {
        hideLoading();
        showToast(`❌ 视频 API 错误: ${error.message}`, 'error');
    }
}
