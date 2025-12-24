/**
 * 截图功能模块
 * 从 app.js 中提取的独立截图功能
 */
(function() {
    'use strict';
    
    // 截图相关变量
    let screenshotCounter = 0;
    const screenshots = [];
    
    // DOM 元素引用
    let screenshotButton = null;
    let screenshotThumbnailContainer = null;
    let screenshotsList = null;
    let screenshotCount = null;
    let clearAllScreenshots = null;
    
    // 初始化函数
    function init() {
        screenshotButton = document.getElementById('screenshotButton');
        screenshotThumbnailContainer = document.getElementById('screenshot-thumbnail-container');
        screenshotsList = document.getElementById('screenshots-list');
        screenshotCount = document.getElementById('screenshot-count');
        clearAllScreenshots = document.getElementById('clear-all-screenshots');
        
        if (!screenshotButton || !screenshotsList) {
            console.warn('[Screenshot] 必要的 DOM 元素未找到');
            return;
        }
        
        // 绑定事件
        bindEvents();
    }
    
    // 绑定事件
    function bindEvents() {
        // 截图按钮事件
        screenshotButton.addEventListener('click', captureScreenshot);
        
        // 清空所有截图
        if (clearAllScreenshots) {
            clearAllScreenshots.addEventListener('click', handleClearAll);
        }
    }
    
    // 检测移动设备
    function isMobile() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
            navigator.userAgent
        );
    }
    
    // 获取移动端摄像头流
    async function getMobileCameraStream() {
        return await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment' // 后置摄像头
            },
            audio: false
        });
    }
    
    // 捕获截图
    async function captureScreenshot() {
        try {
            // 临时禁用截图按钮，防止重复点击
            screenshotButton.disabled = true;
            
            // 显示状态提示（通过事件）
            window.dispatchEvent(new CustomEvent('app:status:show', {
                detail: {
                    message: window.t ? window.t('app.capturing') : '正在截图...',
                    duration: 2000
                }
            }));
            
            let captureStream;
            
            // 获取屏幕或摄像头流
            if (isMobile()) {
                // 移动端使用摄像头
                captureStream = await getMobileCameraStream();
            } else {
                // 桌面端使用屏幕共享
                captureStream = await navigator.mediaDevices.getDisplayMedia({
                    video: {
                        cursor: 'always',
                    },
                    audio: false,
                });
            }
            
            // 创建video元素来加载流
            const video = document.createElement('video');
            video.srcObject = captureStream;
            video.autoplay = true;
            video.muted = true;
            
            // 等待视频加载完成
            await video.play();
            
            // 创建canvas来捕获帧
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            
            // 捕获当前帧
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8); // base64 jpeg
            
            // 停止捕获流
            captureStream.getTracks().forEach(track => track.stop());
            
            // 添加截图到待发送列表
            addScreenshotToList(dataUrl);
            
            // 显示成功提示
            window.dispatchEvent(new CustomEvent('app:status:show', {
                detail: {
                    message: window.t ? window.t('app.screenshotAdded') : '截图已添加，点击发送一起发送',
                    duration: 3000
                }
            }));
            
            // 重新启用截图按钮
            screenshotButton.disabled = false;
            
        } catch (err) {
            console.error('截图失败:', err);
            
            // 根据错误类型显示不同提示
            let errorMsg = window.t ? window.t('app.screenshotFailed') : '截图失败';
            if (err.name === 'NotAllowedError') {
                errorMsg = window.t ? window.t('app.screenshotCancelled') : '用户取消了截图';
            } else if (err.name === 'NotFoundError') {
                errorMsg = window.t ? window.t('app.deviceNotFound') : '未找到可用的媒体设备';
            } else if (err.name === 'NotReadableError') {
                errorMsg = window.t ? window.t('app.deviceNotAccessible') : '无法访问媒体设备';
            } else if (err.message) {
                errorMsg = window.t ? window.t('app.screenshotFailed') + ': ' + err.message : `截图失败: ${err.message}`;
            }
            
            window.dispatchEvent(new CustomEvent('app:status:show', {
                detail: {
                    message: errorMsg,
                    duration: 5000
                }
            }));
            
            // 重新启用截图按钮
            screenshotButton.disabled = false;
        }
    }
    
    // 添加截图到列表
    function addScreenshotToList(dataUrl) {
        screenshotCounter++;
        
        // 创建截图项容器
        const item = document.createElement('div');
        item.className = 'screenshot-item';
        item.dataset.index = screenshotCounter;
        
        // 创建缩略图
        const img = document.createElement('img');
        img.className = 'screenshot-thumbnail';
        img.src = dataUrl;
        img.alt = window.t ? window.t('chat.screenshotAlt', {index: screenshotCounter}) : `截图 ${screenshotCounter}`;
        img.title = window.t ? window.t('chat.screenshotTitle', {index: screenshotCounter}) : `点击查看截图 ${screenshotCounter}`;
        
        // 点击缩略图可以在新标签页查看大图
        img.addEventListener('click', () => {
            window.open(dataUrl, '_blank');
        });
        
        // 创建删除按钮
        const removeBtn = document.createElement('button');
        removeBtn.className = 'screenshot-remove';
        removeBtn.innerHTML = '×';
        removeBtn.title = window.t ? window.t('chat.removeScreenshot') : '移除此截图';
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeScreenshotFromList(item);
        });
        
        // 创建索引标签
        const indexLabel = document.createElement('span');
        indexLabel.className = 'screenshot-index';
        indexLabel.textContent = `#${screenshotCounter}`;
        
        // 组装元素
        item.appendChild(img);
        item.appendChild(removeBtn);
        item.appendChild(indexLabel);
        
        // 添加到列表
        screenshotsList.appendChild(item);
        
        // 保存到数组（用于发送）
        screenshots.push(dataUrl);
        
        // 更新计数和显示容器
        updateScreenshotCount();
        if (screenshotThumbnailContainer) {
            screenshotThumbnailContainer.classList.add('show');
        }
        
        // 自动滚动到最新的截图
        setTimeout(() => {
            screenshotsList.scrollLeft = screenshotsList.scrollWidth;
        }, 100);
        
        // 通知其他模块截图已添加
        window.dispatchEvent(new CustomEvent('screenshot:added', {
            detail: {
                count: screenshots.length,
                dataUrl: dataUrl
            }
        }));
    }
    
    // 从列表中移除截图
    function removeScreenshotFromList(item) {
        const index = parseInt(item.dataset.index);
        item.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            item.remove();
            // 从数组中移除
            screenshots.splice(index - 1, 1);
            updateScreenshotCount();
            
            // 如果没有截图了，隐藏容器
            if (screenshotsList.children.length === 0) {
                if (screenshotThumbnailContainer) {
                    screenshotThumbnailContainer.classList.remove('show');
                }
            }
            
            // 通知其他模块截图已移除
            window.dispatchEvent(new CustomEvent('screenshot:removed', {
                detail: {
                    count: screenshots.length
                }
            }));
        }, 300);
    }
    
    // 更新截图计数
    function updateScreenshotCount() {
        if (screenshotCount) {
            screenshotCount.textContent = screenshotsList.children.length;
        }
    }
    
    // 清空所有截图
    async function handleClearAll() {
        if (screenshotsList.children.length === 0) return;
        
        // 使用全局的确认对话框函数（如果存在）
        const confirmed = window.showConfirm ? await window.showConfirm(
            window.t ? window.t('dialogs.clearScreenshotsConfirm') : '确定要清空所有待发送的截图吗？',
            window.t ? window.t('dialogs.clearScreenshots') : '清空截图',
            {danger: true}
        ) : confirm('确定要清空所有待发送的截图吗？');
        
        if (confirmed) {
            screenshotsList.innerHTML = '';
            screenshots.length = 0;
            screenshotCounter = 0;
            if (screenshotThumbnailContainer) {
                screenshotThumbnailContainer.classList.remove('show');
            }
            updateScreenshotCount();
            
            // 通知其他模块截图已清空
            window.dispatchEvent(new CustomEvent('screenshot:cleared'));
        }
    }
    
    // 获取所有截图（供发送使用）
    function getAllScreenshots() {
        return [...screenshots];
    }
    
    // 清空截图（供外部调用）
    function clearScreenshots() {
        screenshotsList.innerHTML = '';
        screenshots.length = 0;
        screenshotCounter = 0;
        if (screenshotThumbnailContainer) {
            screenshotThumbnailContainer.classList.remove('show');
        }
        updateScreenshotCount();
    }
    
    // 导出到全局
    window.ScreenshotManager = {
        init: init,
        capture: captureScreenshot,
        getAll: getAllScreenshots,
        clear: clearScreenshots,
        getCount: () => screenshots.length
    };
    
    // 自动初始化（DOM 加载完成后）
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        // DOM 已加载，延迟初始化确保其他脚本已执行
        setTimeout(init, 100);
    }
})();
