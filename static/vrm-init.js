/**
 * VRM Init - 全局导出和自动初始化
 */

// 全局路径配置对象 (带默认值作为保底)
window.VRM_PATHS = {
    user_vrm: '/user_vrm',
    static_vrm: '/static/vrm'
};

// 检查是否在模型管理页面（通过路径或特定元素判断）
const isModelManagerPage = window.location.pathname.includes('model_manager') || document.querySelector('#vrm-model-select') !== null;
// 创建全局 VRM 管理器实例（延迟创建，确保所有模块都已加载）
window.vrmManager = null;

/**
 * 从后端同步路径配置
 */
async function fetchVRMConfig() {
    try {
        const response = await fetch('/api/model/vrm/config');
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.paths) {
                // 更新全局配置
                window.VRM_PATHS = data.paths;
                console.log('[VRM Init] 路径配置已同步:', window.VRM_PATHS);
            }
        }
    } catch (error) {
        console.warn('[VRM Init] 无法获取路径配置，使用默认值:', error);
    }
}

function initializeVRMManager() {
    if (window.vrmManager) return;

    try {
        // 检查核心类是否存在
        if (typeof window.VRMManager !== 'undefined') {
            window.vrmManager = new VRMManager();
        }
    } catch (error) {
    }
}

// 替换掉原有的轮询，改用标准的事件监听
window.addEventListener('vrm-modules-ready', () => {
    initializeVRMManager();

    // 如果不是管理页面，尝试自动加载模型
    if (!isModelManagerPage) {
        initVRMModel();
    }
});

// 启动延迟初始化
// 自动初始化函数
async function initVRMModel() {
    // 防止重复进入：如果正在初始化或模型已加载，直接退出
    if (window._isVRMInitializing) {
        console.log('[VRM Init] 正在初始化中，跳过重复调用');
        return;
    }
    // 标记开始
    window._isVRMInitializing = true;
    
    // 1. 等待配置加载完成
    if (window.pageConfigReady && typeof window.pageConfigReady.then === 'function') {
        await window.pageConfigReady;
    }
    // 在此处同步后端路径配置 
    await fetchVRMConfig();

    // 2. 获取并确定模型路径
    let targetModelPath = window.vrmModel || (typeof vrmModel !== 'undefined' ? vrmModel : '');

    // 如果未指定路径，使用默认模型保底
    if (!targetModelPath) {
        // 获取当前是否应该处于 VRM 模式
        // (检查全局配置是否指定了 model_type: 'vrm')
        const isVRMMode = window.lanlan_config && window.lanlan_config.model_type === 'vrm';

        // 只有在 "存在 Live2D 对象" 且 "当前配置不是 VRM 模式" 时，才真的退出
        // 这样即使 window.cubism4Model 没销毁，只要配置切到了 vrm，就会继续往下走
        if (window.cubism4Model && !isVRMMode) {
            return; // Live2D 模式且未强制切换，跳过 VRM 默认加载
        }

        // 如果上面的 if 没拦截住（说明我们要加载 VRM），就会执行这一行，赋予默认模型
        targetModelPath = '/static/vrm/sister1.0.vrm';
    }
    
    if (!window.vrmManager) {
        console.warn('[VRM Init] VRM管理器未初始化，跳过加载');
        return;
    }

    try {
        // UI 切换逻辑 - 智能视觉切换
        const vrmContainer = document.getElementById('vrm-container');
        if (vrmContainer) vrmContainer.style.display = 'block';

        // 【关键修复】删除Live2D的浮动按钮和锁图标，而不是只隐藏
        const live2dFloatingButtons = document.getElementById('live2d-floating-buttons');
        if (live2dFloatingButtons) {
            live2dFloatingButtons.remove();
        }

        const live2dLockIcon = document.getElementById('live2d-lock-icon');
        if (live2dLockIcon) {
            live2dLockIcon.remove();
        }

        const live2dReturnBtn = document.getElementById('live2d-return-button-container');
        if (live2dReturnBtn) {
            live2dReturnBtn.remove();
        }

        // 初始化 Three.js 场景
        await window.vrmManager.initThreeJS('vrm-canvas', 'vrm-container');

        // 路径转换逻辑
        let modelUrl = targetModelPath;
        if (!modelUrl.startsWith('http') && !modelUrl.startsWith('/')) {
            // 使用动态获取的 user_vrm 路径
            modelUrl = `${window.VRM_PATHS.user_vrm}/${modelUrl}`;
        }
        modelUrl = modelUrl.replace(/\\/g, '/'); // 修正 Windows 风格路径

        // 执行加载
        await window.vrmManager.loadModel(modelUrl);

    } catch (error) {
        console.error('[VRM Init] 错误详情:', error.stack);
    }finally {
        // 无论成功还是失败，最后都释放锁
        window._isVRMInitializing = false;
    }
}

// 添加强制解锁函数
window.forceUnlockVRM = function() {
    if (window.vrmManager && window.vrmManager.interaction) {
        window.vrmManager.interaction.setLocked(false);

        // 清理可能残留的 CSS 样式
        if (window.vrmManager.canvas) {
            window.vrmManager.canvas.style.pointerEvents = 'auto';
        }
    }
};

// 手动触发主页VRM模型检查的函数
window.checkAndLoadVRM = async function() {
    try {
        // 确保配置已同步 (防止直接调用此函数时配置还没加载) 
        if (!window.VRM_PATHS.isLoaded) { 
            await fetchVRMConfig();
       }

        // 1. 获取当前角色名称
        let currentLanlanName = window.lanlan_config?.lanlan_name;
        if (!currentLanlanName) {
            return;
        }

        // 2. 获取角色配置
        const charResponse = await fetch('/api/characters');
        if (!charResponse.ok) {
            console.error('[VRM] 获取角色配置失败');
            return;
        }

        const charactersData = await charResponse.json();
        const catgirlConfig = charactersData['猫娘']?.[currentLanlanName];

        if (!catgirlConfig) {
            return;
        }

        const modelType = catgirlConfig.model_type || 'live2d';
        if (modelType !== 'vrm') {
            return;
        }

        // 3. 获取VRM路径
        const newModelPath = catgirlConfig.vrm || '';
        if (!newModelPath) {
            return;
        }

        // 4. 显示VRM容器，智能视觉切换
        const vrmContainer = document.getElementById('vrm-container');
        if (vrmContainer) {
            vrmContainer.style.display = 'block';
        }

        // 【关键修复】删除Live2D的浮动按钮和锁图标，而不是只隐藏
        const live2dFloatingButtons = document.getElementById('live2d-floating-buttons');
        if (live2dFloatingButtons) {
            live2dFloatingButtons.remove();
        }

        const live2dLockIcon = document.getElementById('live2d-lock-icon');
        if (live2dLockIcon) {
            live2dLockIcon.remove();
        }

        const live2dReturnBtn = document.getElementById('live2d-return-button-container');
        if (live2dReturnBtn) {
            live2dReturnBtn.remove();
        }

        // 5. 检查VRM管理器
        if (!window.vrmManager) {
            return;
        }

        // 6. 路径转换
        let modelUrl = newModelPath;

        // 处理Windows绝对路径，转换为Web路径
        if (modelUrl.includes('\\') || modelUrl.includes(':')) {
            const filename = modelUrl.split(/[\\/]/).pop();
            if (filename) {
                // 使用动态获取的 static_vrm 路径
                modelUrl = `${window.VRM_PATHS.static_vrm}/${filename}`;
            }
        } else if (!modelUrl.startsWith('http') && !modelUrl.startsWith('/')) {
            // 使用动态获取的 user_vrm 路径
            modelUrl = `${window.VRM_PATHS.user_vrm}/${modelUrl}`;
        }

        // 7. 初始化Three.js场景
        if (!window.vrmManager._isInitialized || !window.vrmManager.scene || !window.vrmManager.camera || !window.vrmManager.renderer) {
            await window.vrmManager.initThreeJS('vrm-canvas', 'vrm-container');
        }

        // 8. 加载VRM模型
        await window.vrmManager.loadModel(modelUrl);

        // 9. 应用角色的打光配置
        const lighting = catgirlConfig.lighting;

        if (lighting && window.vrmManager) {
            console.log('[VRM打光] 应用角色打光配置:', lighting);
            if (window.vrmManager.ambientLight) {
                window.vrmManager.ambientLight.intensity = lighting.ambient;
            }
            if (window.vrmManager.mainLight) {
                window.vrmManager.mainLight.intensity = lighting.main;
            }
            if (window.vrmManager.fillLight) {
                window.vrmManager.fillLight.intensity = lighting.fill;
            }
            if (window.vrmManager.rimLight) {
                window.vrmManager.rimLight.intensity = lighting.rim;
            }
        } else if (!lighting) {
            console.log('[VRM打光] 角色无打光配置，使用默认值');
        }

    } catch (error) {
        console.error('[主页VRM检查] VRM检查和加载失败:', error);
        console.error('[主页VRM检查] 错误详情:', error.stack);
    }
};

// VRM 系统初始化完成