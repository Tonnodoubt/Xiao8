/**
 * VRM Init - 全局导出和自动初始化
 */

// 创建全局 VRM 管理器实例
window.vrmManager = new VRMManager();

// 自动初始化函数（延迟执行，等待 vrmModel 设置）
async function initVRMModel() {
    // 等待配置加载完成（如果存在）
    if (window.pageConfigReady && typeof window.pageConfigReady.then === 'function') {
        await window.pageConfigReady;
    }
    
    // 获取模型路径
    const targetModelPath = (typeof vrmModel !== 'undefined' ? vrmModel : (window.vrmModel || ''));
    
    if (!targetModelPath) {
        console.log('未设置VRM模型路径，跳过VRM初始化');
        return;
    }
    
    try {
        console.log('开始初始化VRM模型，路径:', targetModelPath);
        
        // 初始化 Three.js 场景
        await window.vrmManager.initThreeJS('vrm-canvas', 'vrm-container');
        
        // 显示VRM容器，隐藏Live2D容器
        const vrmContainer = document.getElementById('vrm-container');
        const live2dContainer = document.getElementById('live2d-container');
        if (vrmContainer) {
            vrmContainer.style.display = 'block';
        }
        if (live2dContainer) {
            live2dContainer.style.display = 'none';
        }
        
        // 确保模型URL正确（如果是相对路径，转换为绝对路径）
        let modelUrl = targetModelPath;
        if (!modelUrl.startsWith('http://') && !modelUrl.startsWith('https://') && !modelUrl.startsWith('/')) {
            // 如果是文件名，假设在user_vrm目录下
            if (modelUrl.endsWith('.vrm')) {
                modelUrl = `/user_vrm/${modelUrl.split('/').pop()}`;
            } else {
                modelUrl = `/user_vrm/${modelUrl}`;
            }
        }
        
        // 加载模型
        await window.vrmManager.loadModel(modelUrl, {
            scale: { x: 1, y: 1, z: 1 }
        });
        
        console.log('✓ VRM 管理器自动初始化完成');
    } catch (error) {
        console.error('VRM 管理器自动初始化失败:', error);
        console.error('错误堆栈:', error.stack);
    }
}

// 自动初始化（如果存在 vrmModel 变量）
// 如果 pageConfigReady 存在，等待它完成；否则立即执行
if (window.pageConfigReady && typeof window.pageConfigReady.then === 'function') {
    window.pageConfigReady.then(() => {
        // 检查是否有VRM模型路径
        const targetModelPath = (typeof vrmModel !== 'undefined' ? vrmModel : (window.vrmModel || ''));
        if (targetModelPath) {
            initVRMModel();
        }
    }).catch(() => {
        // 即使配置加载失败，也尝试初始化（可能使用默认模型）
        const targetModelPath = (typeof vrmModel !== 'undefined' ? vrmModel : (window.vrmModel || ''));
        if (targetModelPath) {
            initVRMModel();
        }
    });
} else {
    // 如果没有 pageConfigReady，检查 vrmModel 是否已设置
    const targetModelPath = (typeof vrmModel !== 'undefined' ? vrmModel : (window.vrmModel || ''));
    if (targetModelPath) {
        initVRMModel();
    } else {
        // 如果还没有设置，等待一下再检查
        setTimeout(() => {
            initVRMModel();
        }, 1000);
    }
}

