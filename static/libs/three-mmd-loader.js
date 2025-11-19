// @moeru/three-mmd UMD 包装器
// 由于原库是 ES 模块格式，我们需要通过动态 import 加载
// 这个文件提供了一个简单的包装器来加载和使用 MMDLoader

(function() {
    'use strict';
    
    // 检查 THREE 是否已加载
    if (typeof THREE === 'undefined') {
        console.error('THREE.js 未加载，请先加载 three.js');
        return;
    }
    
    // 动态加载 @moeru/three-mmd
    let MMDLoaderModule = null;
    let isLoading = false;
    let loadPromise = null;
    
    // 加载函数
    async function loadMMDModule() {
        if (MMDLoaderModule) {
            return MMDLoaderModule;
        }
        
        if (isLoading && loadPromise) {
            return loadPromise;
        }
        
        isLoading = true;
        loadPromise = (async () => {
            try {
                // 使用动态 import 加载 ES 模块
                // 注意：这需要服务器支持 ES 模块，或者使用构建工具
                const module = await import('/static/libs/node_modules/@moeru/three-mmd/dist/index.js');
                MMDLoaderModule = module;
                window.MMDLoader = module.MMDLoader;
                window.MMDAnimationHelper = module.MMDAnimationHelper;
                window.MMDPhysics = module.MMDPhysics;
                console.log('@moeru/three-mmd 模块加载成功');
                return module;
            } catch (error) {
                console.error('加载 @moeru/three-mmd 模块失败:', error);
                // 尝试从 CDN 加载（如果可用）
                throw error;
            } finally {
                isLoading = false;
            }
        })();
        
        return loadPromise;
    }
    
    // 导出到全局
    window.loadMMDModule = loadMMDModule;
    
    // 自动尝试加载
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            loadMMDModule().catch(err => {
                console.warn('自动加载 MMD 模块失败，将在需要时重试');
            });
        });
    } else {
        loadMMDModule().catch(err => {
            console.warn('自动加载 MMD 模块失败，将在需要时重试');
        });
    }
})();

