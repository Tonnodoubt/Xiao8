// ==================== OGG OPUS 流式解码器 (WASM) ====================
// 使用 @wasm-audio-decoders/ogg-opus-decoder
// https://github.com/eshaz/wasm-audio-decoders/tree/main/src/ogg-opus-decoder
// 库已在 index.html 中预加载，全局变量为 window["ogg-opus-decoder"]
let oggOpusDecoder = null;
let oggOpusDecoderReady = null;

async function getOggOpusDecoder() {
    if (oggOpusDecoder) return oggOpusDecoder;
    if (oggOpusDecoderReady) return oggOpusDecoderReady;

    oggOpusDecoderReady = (async () => {
        const module = window["ogg-opus-decoder"];
        if (!module || !module.OggOpusDecoder) {
            console.error('ogg-opus-decoder 未加载，请检查 index.html');
            return null;
        }

        try {
            const decoder = new module.OggOpusDecoder();
            await decoder.ready;
            console.log('OGG OPUS WASM 解码器已就绪');
            oggOpusDecoder = decoder;
            return decoder;
        } catch (e) {
            console.error('创建 OGG OPUS 解码器失败:', e);
            return null;
        }
    })();

    return oggOpusDecoderReady;
}

// 重置解码器（在新的音频流开始时调用）
async function resetOggOpusDecoder() {
    if (oggOpusDecoder) {
        try {
            oggOpusDecoder.free();
        } catch (e) { }
        oggOpusDecoder = null;
        oggOpusDecoderReady = null;
    }
}

async function decodeOggOpusChunk(uint8Array) {
    const decoder = await getOggOpusDecoder();
    if (!decoder) {
        throw new Error('OGG OPUS 解码器不可用');
    }

    // decode() 用于流式解码
    const { channelData, samplesDecoded, sampleRate } = await decoder.decode(uint8Array);
    if (channelData && channelData[0] && channelData[0].length > 0) {
        return { float32Data: channelData[0], sampleRate: sampleRate || 48000 };
    }
    return null; // 数据不足，等待更多
}

// ==================== 全局窗口管理函数 ====================
// 关闭所有已打开的设置窗口（弹窗）
window.closeAllSettingsWindows = function () {
    // 关闭 app.js 中跟踪的窗口
    if (window._openSettingsWindows) {
        Object.keys(window._openSettingsWindows).forEach(url => {
            const winRef = window._openSettingsWindows[url];
            try {
                if (winRef && !winRef.closed) {
                    winRef.close();
                }
            } catch (_) {
                // 忽略跨域导致的 close 异常
            }
            delete window._openSettingsWindows[url];
        });
    }

    // 关闭 live2d-ui-popup.js 中跟踪的窗口（如果有 Live2DManager 实例）
    if (window.live2dManager && window.live2dManager._openSettingsWindows) {
        Object.keys(window.live2dManager._openSettingsWindows).forEach(url => {
            const winRef = window.live2dManager._openSettingsWindows[url];
            try {
                if (winRef && !winRef.closed) {
                    winRef.close();
                }
            } catch (_) {
                // 忽略跨域导致的 close 异常
            }
            delete window.live2dManager._openSettingsWindows[url];
        });
    }
};

// ==================== 应用初始化 ====================
function init_app() {
    const micButton = document.getElementById('micButton');
    const muteButton = document.getElementById('muteButton');
    const screenButton = document.getElementById('screenButton');
    const stopButton = document.getElementById('stopButton');
    const resetSessionButton = document.getElementById('resetSessionButton');
    const returnSessionButton = document.getElementById('returnSessionButton');
    const statusElement = document.getElementById('status');
    const statusToast = document.getElementById('status-toast');

    // Status 气泡框显示函数
    let statusToastTimeout = null;
    function showStatusToast(message, duration = 3000) {
        console.log('[Status Toast] 显示消息:', message, '持续时间:', duration);

        if (!message || message.trim() === '') {
            // 如果消息为空，隐藏气泡框
            if (statusToast) {
                statusToast.classList.remove('show');
                statusToast.classList.add('hide');
                setTimeout(() => {
                    statusToast.textContent = '';
                }, 300);
            }
            return;
        }

        if (!statusToast) {
            console.error('[Status Toast] statusToast 元素不存在！');
            return;
        }

        // 清除之前的定时器
        if (statusToastTimeout) {
            clearTimeout(statusToastTimeout);
            statusToastTimeout = null;
        }

        // 更新内容
        statusToast.textContent = message;

        // 确保元素可见
        statusToast.style.display = 'block';
        statusToast.style.visibility = 'visible';

        // 显示气泡框
        statusToast.classList.remove('hide');
        // 使用 setTimeout 确保样式更新
        setTimeout(() => {
            statusToast.classList.add('show');
            console.log('[Status Toast] 已添加 show 类，元素:', statusToast, '类列表:', statusToast.classList);
        }, 10);

        // 自动隐藏
        statusToastTimeout = setTimeout(() => {
            statusToast.classList.remove('show');
            statusToast.classList.add('hide');
            setTimeout(() => {
                statusToast.textContent = '';
            }, 300);
        }, duration);

        // 同时更新隐藏的 status 元素（保持兼容性）
        if (statusElement) {
            statusElement.textContent = message || '';
        }
    }

    // 将 showStatusToast 暴露到全局作用域，方便调试和测试
    window.showStatusToast = showStatusToast;
    const chatContainer = document.getElementById('chatContainer');
    const textInputBox = document.getElementById('textInputBox');
    const textSendButton = document.getElementById('textSendButton');
    const screenshotButton = document.getElementById('screenshotButton');
    const screenshotThumbnailContainer = document.getElementById('screenshot-thumbnail-container');
    const screenshotsList = document.getElementById('screenshots-list');
    const screenshotCount = document.getElementById('screenshot-count');
    const clearAllScreenshots = document.getElementById('clear-all-screenshots');

    let audioContext;
    let workletNode;
    let stream;
    let isRecording = false;
    // 暴露 isRecording 到全局，供其他模块检查
    window.isRecording = false;
    // 麦克风启动中标志，用于区分"正在启动"和"已录音"两个阶段
    window.isMicStarting = false;
    let socket;
    // 将 currentGeminiMessage 改为全局变量，供字幕模块使用
    window.currentGeminiMessage = null;
    let audioPlayerContext = null;
    let videoTrack, videoSenderInterval;
    let audioBufferQueue = [];
    let screenshotCounter = 0; // 截图计数器
    let isPlaying = false;
    let audioStartTime = 0;
    let scheduledSources = [];
    let animationFrameId;
    let seqCounter = 0;
    let globalAnalyser = null;
    let lipSyncActive = false;
    let screenCaptureStream = null; // 暂存屏幕共享stream，不再需要每次都弹窗选择共享区域，方便自动重连
    // 新增：当前选择的麦克风设备ID
    let selectedMicrophoneId = null;

    // Speech ID 精确打断控制相关变量
    let interruptedSpeechId = null;      // 被打断的 speech_id
    let currentPlayingSpeechId = null;   // 当前正在播放的 speech_id
    let pendingDecoderReset = false;     // 是否需要在下一个新 speech_id 时重置解码器
    let skipNextAudioBlob = false;       // 是否跳过下一个音频 blob（被打断的旧音频）

    // 麦克风静音检测相关变量
    let silenceDetectionTimer = null;
    let hasSoundDetected = false;
    let inputAnalyser = null;

    // 模式管理
    let isTextSessionActive = false;
    let isSwitchingMode = false; // 新增：模式切换标志
    let sessionStartedResolver = null; // 用于等待 session_started 消息

    // 主动搭话功能相关
    let proactiveChatEnabled = false;
    let proactiveVisionEnabled = false;
    let proactiveChatTimer = null;
    let proactiveChatBackoffLevel = 0; // 退避级别：0=30s, 1=75s, 2=187.5s, etc.
    let isProactiveChatRunning = false; // 锁：防止主动搭话执行期间重复触发
    const PROACTIVE_CHAT_BASE_DELAY = 30000; // 30秒基础延迟
    // 主动视觉在语音时的单帧推送（当同时开启主动视觉 && 语音对话时，每15秒推送一帧）
    let proactiveVisionFrameTimer = null;
    const PROACTIVE_VISION_FRAME_INTERVAL = 15000; // 15秒

    // 截图最大尺寸（720p，用于节流数据传输）
    const MAX_SCREENSHOT_WIDTH = 1280;
    const MAX_SCREENSHOT_HEIGHT = 720;

    /**
     * 统一的截图辅助函数：从video元素捕获一帧到canvas，统一720p节流和JPEG压缩
     * @param {HTMLVideoElement} video - 视频源元素
     * @param {number} jpegQuality - JPEG压缩质量 (0-1)，默认0.8
     * @returns {{dataUrl: string, width: number, height: number}} 返回dataUrl和实际尺寸
     */
    function captureCanvasFrame(video, jpegQuality = 0.8) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // 计算缩放后的尺寸（保持宽高比，限制到720p）
        let targetWidth = video.videoWidth;
        let targetHeight = video.videoHeight;

        if (targetWidth > MAX_SCREENSHOT_WIDTH || targetHeight > MAX_SCREENSHOT_HEIGHT) {
            const widthRatio = MAX_SCREENSHOT_WIDTH / targetWidth;
            const heightRatio = MAX_SCREENSHOT_HEIGHT / targetHeight;
            const scale = Math.min(widthRatio, heightRatio);
            targetWidth = Math.round(targetWidth * scale);
            targetHeight = Math.round(targetHeight * scale);
        }

        canvas.width = targetWidth;
        canvas.height = targetHeight;

        // 绘制视频帧到canvas（缩放绘制）并转换为JPEG
        ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
        const dataUrl = canvas.toDataURL('image/jpeg', jpegQuality);

        return { dataUrl, width: targetWidth, height: targetHeight };
    }

    // Focus模式为true时，AI播放语音时会自动静音麦克风（不允许打断）
    let focusModeEnabled = false;

    // 暴露到全局作用域，供 live2d.js 等其他模块访问和修改
    window.proactiveChatEnabled = proactiveChatEnabled;
    window.proactiveVisionEnabled = proactiveVisionEnabled;
    window.focusModeEnabled = focusModeEnabled;

    // WebSocket心跳保活
    let heartbeatInterval = null;
    const HEARTBEAT_INTERVAL = 30000; // 30秒发送一次心跳

    // WebSocket自动重连定时器ID（用于在切换角色时取消之前的重连）
    let autoReconnectTimeoutId = null;

    function isMobile() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
            navigator.userAgent
        );
    }

    // 建立WebSocket连接
    function connectWebSocket() {
        const protocol = window.location.protocol === "https:" ? "wss" : "ws";
        const wsUrl = `${protocol}://${window.location.host}/ws/${lanlan_config.lanlan_name}`;
        console.log('[WebSocket] 正在连接，猫娘名称:', lanlan_config.lanlan_name, 'URL:', wsUrl);
        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            console.log('WebSocket连接已建立');

            // 启动心跳保活机制
            if (heartbeatInterval) {
                clearInterval(heartbeatInterval);
            }
            heartbeatInterval = setInterval(() => {
                if (socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({
                        action: 'ping'
                    }));
                }
            }, HEARTBEAT_INTERVAL);
            console.log('心跳保活机制已启动');
        };

        socket.onmessage = (event) => {
            if (event.data instanceof Blob) {
                // 处理二进制音频数据
                console.log("收到新的音频块")
                handleAudioBlob(event.data);
                return;
            }

            try {
                const response = JSON.parse(event.data);
                // 调试：记录所有收到的WebSocket消息类型
                if (response.type === 'catgirl_switched') {
                    console.log('[WebSocket] 📨 收到catgirl_switched消息:', response);
                }


                if (response.type === 'gemini_response') {
                    // 检查是否是新消息的开始
                    const isNewMessage = response.isNewMessage || false;
                    appendMessage(response.text, 'gemini', isNewMessage);
                } else if (response.type === 'user_transcript') {
                    // 处理用户语音转录，显示在聊天界面
                    appendMessage(response.text, 'user', true);
                } else if (response.type === 'user_activity') {
                    // 精确打断控制：记录被打断的 speech_id，延迟重置解码器
                    interruptedSpeechId = response.interrupted_speech_id || null;
                    pendingDecoderReset = true;  // 标记需要在新 speech_id 到来时重置
                    skipNextAudioBlob = false;   // 重置跳过标志
                    
                    // 只清空播放队列，不重置解码器（避免丢失新音频的头信息）
                    clearAudioQueueWithoutDecoderReset();
                } else if (response.type === 'audio_chunk') {
                    // 精确打断控制：根据 speech_id 决定是否接收此音频
                    const speechId = response.speech_id;
                    
                    // 检查是否是被打断的旧音频，如果是则丢弃
                    if (speechId && interruptedSpeechId && speechId === interruptedSpeechId) {
                        console.log('丢弃被打断的旧音频:', speechId);
                        skipNextAudioBlob = true;  // 标记跳过后续的二进制数据
                        return;
                    }
                    
                    // 检查是否是新的 speech_id（新轮对话开始）
                    if (speechId && speechId !== currentPlayingSpeechId) {
                        // 新轮对话开始，在此时重置解码器（确保有新的头信息）
                        if (pendingDecoderReset) {
                            console.log('新轮对话开始，重置解码器:', speechId);
                            resetOggOpusDecoder();
                            pendingDecoderReset = false;
                        }
                        currentPlayingSpeechId = speechId;
                        interruptedSpeechId = null;  // 清除旧的打断记录
                    }
                    
                    skipNextAudioBlob = false;  // 允许接收后续的二进制数据
                } else if (response.type === 'cozy_audio') {
                    // 处理音频响应
                    console.log("收到新的音频头")
                    const isNewMessage = response.isNewMessage || false;

                    if (isNewMessage) {
                        // 如果是新消息，清空当前音频队列
                        clearAudioQueue();
                    }

                    // 根据数据格式选择处理方法
                    if (response.format === 'base64') {
                        handleBase64Audio(response.audioData, isNewMessage);
                    }
                } else if (response.type === 'screen_share_error') {
                    // 屏幕分享/截图错误，复位按钮状态
                    const translatedMessage = window.translateStatusMessage ? window.translateStatusMessage(response.message) : response.message;
                    showStatusToast(translatedMessage, 4000);

                    // 停止屏幕分享
                    stopScreening();

                    // 清理屏幕捕获流
                    if (screenCaptureStream) {
                        screenCaptureStream.getTracks().forEach(track => track.stop());
                        screenCaptureStream = null;
                    }

                    // 复位按钮状态
                    if (isRecording) {
                        // 在语音模式下（屏幕分享）
                        micButton.disabled = true;
                        muteButton.disabled = false;
                        screenButton.disabled = false;
                        stopButton.disabled = true;
                        resetSessionButton.disabled = false;
                    } else if (isTextSessionActive) {
                        // 在文本模式下（截图）
                        screenshotButton.disabled = false;
                    }
                } else if (response.type === 'catgirl_switched') {
                    // 处理猫娘切换通知（从后端WebSocket推送）
                    const newCatgirl = response.new_catgirl;
                    const oldCatgirl = response.old_catgirl;
                    console.log('[WebSocket] ✅ 收到猫娘切换通知，从', oldCatgirl, '切换到', newCatgirl);
                    console.log('[WebSocket] 当前前端猫娘:', lanlan_config.lanlan_name);
                    handleCatgirlSwitch(newCatgirl, oldCatgirl);
                } else if (response.type === 'status') {
                    // 如果正在切换模式且收到"已离开"消息，则忽略
                    if (isSwitchingMode && response.message.includes('已离开')) {
                        console.log('模式切换中，忽略"已离开"状态消息');
                        return;
                    }

                    // 检测严重错误，自动隐藏准备提示（兜底机制）
                    const criticalErrorKeywords = ['连续失败', '已停止', '自动重试', '崩溃', '欠费', 'API Key被'];
                    if (criticalErrorKeywords.some(keyword => response.message.includes(keyword))) {
                        console.log('检测到严重错误，隐藏准备提示');
                        hideVoicePreparingToast();
                    }

                    // 翻译后端发送的状态消息
                    const translatedMessage = window.translateStatusMessage ? window.translateStatusMessage(response.message) : response.message;
                    showStatusToast(translatedMessage, 4000);
                    if (response.message === `${lanlan_config.lanlan_name}失联了，即将重启！`) {
                        if (isRecording === false && !isTextSessionActive) {
                            showStatusToast(window.t ? window.t('app.catgirlResting', { name: lanlan_config.lanlan_name }) : `${lanlan_config.lanlan_name}正在打盹...`, 5000);
                        } else if (isTextSessionActive) {
                            showStatusToast(window.t ? window.t('app.textChatting') : `正在文本聊天中...`, 5000);
                        } else {
                            stopRecording();
                            // 同步浮动按钮状态
                            syncFloatingMicButtonState(false);
                            syncFloatingScreenButtonState(false);
                            if (socket.readyState === WebSocket.OPEN) {
                                socket.send(JSON.stringify({
                                    action: 'end_session'
                                }));
                            }
                            hideLive2d();
                            micButton.disabled = true;
                            muteButton.disabled = true;
                            screenButton.disabled = true;
                            stopButton.disabled = true;
                            resetSessionButton.disabled = true;
                            returnSessionButton.disabled = true;

                            setTimeout(async () => {
                                try {
                                    // 创建一个 Promise 来等待 session_started 消息
                                    let autoRestartTimeoutId = null;
                                    const sessionStartPromise = new Promise((resolve, reject) => {
                                        sessionStartedResolver = resolve;
                                    });

                                    // 发送start session事件
                                    socket.send(JSON.stringify({
                                        action: 'start_session',
                                        input_type: 'audio'
                                    }));
                                    
                                    // 在发送消息后才开始超时计时（自动重启场景）
                                    autoRestartTimeoutId = setTimeout(() => {
                                        if (sessionStartedResolver) {
                                            sessionStartedResolver = null;
                                            
                                            // 超时时向后端发送 end_session 消息
                                            if (socket.readyState === WebSocket.OPEN) {
                                                socket.send(JSON.stringify({
                                                    action: 'end_session'
                                                }));
                                                console.log('[Auto Restart Timeout] 已向后端发送 end_session 消息');
                                            }
                                            
                                            reject(new Error(window.t ? window.t('app.sessionTimeout') : 'Session启动超时'));
                                        }
                                    }, 10000);

                                    // 等待session真正启动成功
                                    await sessionStartPromise;

                                    showLive2d();
                                    await startMicCapture();
                                    if (screenCaptureStream != null) {
                                        await startScreenSharing();
                                    }
                                    
                                    // 同步更新Live2D浮动按钮状态
                                    if (window.live2dManager && window.live2dManager._floatingButtons) {
                                        // 更新麦克风按钮状态
                                        syncFloatingMicButtonState(true);
                                        
                                        // 更新屏幕分享按钮状态（如果屏幕共享已开启）
                                        if (screenCaptureStream != null) {
                                            syncFloatingScreenButtonState(true);
                                        }
                                    }
                                    
                                    showStatusToast(window.t ? window.t('app.restartComplete', { name: lanlan_config.lanlan_name }) : `重启完成，${lanlan_config.lanlan_name}回来了！`, 4000);
                                } catch (error) {
                                    console.error("重启时出错:", error);
                                    
                                    // 重启失败时向后端发送 end_session 消息
                                    if (socket.readyState === WebSocket.OPEN) {
                                        socket.send(JSON.stringify({
                                            action: 'end_session'
                                        }));
                                        console.log('[Auto Restart Failed] 已向后端发送 end_session 消息');
                                    }
                                    
                                    hideVoicePreparingToast(); // 确保重启失败时隐藏准备提示
                                    showStatusToast(window.t ? window.t('app.restartFailed', { error: error.message }) : `重启失败: ${error.message}`, 5000);
                                    
                                    // 完整的状态清理逻辑：确保重启失败时正确恢复到待机状态
                                    // 1. 移除按钮状态类
                                    micButton.classList.remove('recording');
                                    micButton.classList.remove('active');
                                    screenButton.classList.remove('active');
                                    
                                    // 2. 重置录音标志
                                    isRecording = false;
                                    window.isRecording = false;
                                    
                                    // 3. 同步Live2D浮动按钮状态
                                    syncFloatingMicButtonState(false);
                                    syncFloatingScreenButtonState(false);
                                    
                                    // 4. 重新启用基本输入按钮（切换到文本模式）
                                    micButton.disabled = false;
                                    textSendButton.disabled = false;
                                    textInputBox.disabled = false;
                                    screenshotButton.disabled = false;
                                    resetSessionButton.disabled = false;
                                    
                                    // 5. 禁用语音控制按钮
                                    muteButton.disabled = true;
                                    screenButton.disabled = true;
                                    stopButton.disabled = true;
                                    
                                    // 6. 显示文本输入区
                                    const textInputArea = document.getElementById('text-input-area');
                                    if (textInputArea) {
                                        textInputArea.classList.remove('hidden');
                                    }
                                }
                            }, 7500); // 7.5秒后执行
                        }
                    }
                } else if (response.type === 'expression') {
                    const lanlan = window.LanLan1;
                    const registry = lanlan && lanlan.registered_expressions;
                    const fn = registry && registry[response.message];
                    if (typeof fn === 'function') {
                        fn();
                    } else {
                        console.warn('未知表情指令或表情系统未初始化:', response.message);
                    }
                } else if (response.type === 'system' && response.data === 'turn end') {
                    console.log('收到turn end事件，开始情感分析和翻译');
                    // 消息完成时进行情感分析和翻译
                    if (window.currentGeminiMessage &&
                        window.currentGeminiMessage.nodeType === Node.ELEMENT_NODE &&
                        window.currentGeminiMessage.isConnected &&
                        typeof window.currentGeminiMessage.textContent === 'string') {
                        const fullText = window.currentGeminiMessage.textContent.replace(/^\[\d{2}:\d{2}:\d{2}\] 🎀 /, '');
                        
                        if (!fullText || !fullText.trim()) {
                            return;
                        }
                        
                        // 情感分析（5秒超时保护）
                        setTimeout(async () => {
                            try {
                                const emotionPromise = analyzeEmotion(fullText);
                                const timeoutPromise = new Promise((_, reject) => 
                                    setTimeout(() => reject(new Error('情感分析超时')), 5000)
                                );
                                
                                const emotionResult = await Promise.race([emotionPromise, timeoutPromise]);
                                if (emotionResult && emotionResult.emotion) {
                                    console.log('消息完成，情感分析结果:', emotionResult);
                                    applyEmotion(emotionResult.emotion);
                                }
                            } catch (error) {
                                if (error.message === '情感分析超时') {
                                    console.warn('情感分析超时（5秒），已跳过');
                                } else {
                                    console.warn('情感分析失败:', error);
                                }
                            }
                        }, 100);
                        
                        // 前端翻译处理
                        (async () => {
                            try {
                                if (userLanguage === null) {
                                    await getUserLanguage();
                                }
                                
                                // 用户要求：不要自动翻译聊天框内的文本
                                // if (userLanguage && userLanguage !== 'zh') {
                                //     await translateMessageBubble(fullText, window.currentGeminiMessage);
                                // }
                                
                                // 用户要求：只在开启字幕翻译开关后才进行翻译
                                if (subtitleEnabled) {
                                    await translateAndShowSubtitle(fullText);
                                }
                            } catch (error) {
                                console.error('翻译处理失败:', {
                                    error: error.message,
                                    stack: error.stack,
                                    fullText: fullText.substring(0, 50) + '...',
                                    userLanguage: userLanguage
                                });
                                if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                                    console.warn('💡 提示：翻译功能暂时不可用，但对话可以正常进行');
                                }
                            }
                        })();
                    }

                    // AI回复完成后，重置主动搭话计时器（如果已开启且在文本模式）
                    if ((proactiveChatEnabled || proactiveVisionEnabled) && !isRecording) {
                        resetProactiveChatBackoff();
                    }
                } else if (response.type === 'session_preparing') {
                    console.log('收到session_preparing事件，模式:', response.input_mode);
                    // 显示持续性的准备中提示
                    const preparingMessage = response.input_mode === 'text'
                        ? (window.t ? window.t('app.textSystemPreparing') : '文本系统准备中，请稍候...')
                        : (window.t ? window.t('app.voiceSystemPreparing') : '语音系统准备中，请稍候...');
                    showVoicePreparingToast(preparingMessage);
                } else if (response.type === 'session_started') {
                    console.log('收到session_started事件，模式:', response.input_mode);
                    // 延迟 500ms 以确保准备中提示不会消失得太快
                    setTimeout(() => {
                        // 隐藏准备中提示
                        hideVoicePreparingToast();
                        // 解析 session_started Promise
                        if (sessionStartedResolver) {
                            // 清除可能存在的超时定时器（通过全局变量）
                            if (window.sessionTimeoutId) {
                                clearTimeout(window.sessionTimeoutId);
                                window.sessionTimeoutId = null;
                            }
                            sessionStartedResolver(response.input_mode);
                            sessionStartedResolver = null;
                        }
                    }, 500);
                } else if (response.type === 'reload_page') {
                    console.log('收到reload_page事件：', response.message);
                    // 显示提示信息
                    showStatusToast(response.message || (window.t ? window.t('app.configUpdated') : '配置已更新，页面即将刷新'), 3000);

                    // 延迟2.5秒后刷新页面，让后端有足够时间完成session关闭和配置重新加载
                    setTimeout(() => {
                        console.log('开始刷新页面...');
                        // 在刷新前关闭所有已打开的设置窗口，避免窗口引用丢失导致重复打开
                        if (window.closeAllSettingsWindows) {
                            window.closeAllSettingsWindows();
                        }
                        window.location.reload();
                    }, 2500);
                } else if (response.type === 'auto_close_mic') {
                    console.log('收到auto_close_mic事件，自动关闭麦克风');
                    // 长时间无语音输入，模拟用户手动关闭语音会话
                    if (isRecording) {
                        // 直接触发闭麦按钮点击，走完整的关闭流程（包括通知后端）
                        muteButton.click();

                        // 显示提示信息
                        showStatusToast(response.message || (window.t ? window.t('app.autoMuteTimeout') : '长时间无语音输入，已自动关闭麦克风'), 4000);
                    }
                } else if (response.type === 'repetition_warning') {
                    // 处理高重复度对话警告
                    console.log('[WebSocket] 收到repetition_warning事件，角色:', response.name);
                    const warningMessage = window.t
                        ? window.t('app.repetitionDetected', { name: response.name })
                        : `检测到高重复度对话。建议您终止对话，让${response.name}休息片刻。`;
                    showStatusToast(warningMessage, 8000);
                }
            } catch (error) {
                console.error('处理消息失败:', error);
            }
        };

        socket.onclose = () => {
            console.log('WebSocket连接已关闭');

            // 清理心跳定时器
            if (heartbeatInterval) {
                clearInterval(heartbeatInterval);
                heartbeatInterval = null;
                console.log('心跳保活机制已停止');
            }

            // 重置文本session状态，因为后端会清理session
            if (isTextSessionActive) {
                isTextSessionActive = false;
                console.log('WebSocket断开，已重置文本session状态');
            }

            // 如果不是正在切换猫娘，才自动重连（避免与手动重连冲突）
            if (!isSwitchingCatgirl) {
                // 保存 setTimeout ID，以便在 handleCatgirlSwitch 中取消
                autoReconnectTimeoutId = setTimeout(connectWebSocket, 3000);
            }
        };

        socket.onerror = (error) => {
            console.error('WebSocket错误:', error);
        };
    }

    // 初始化连接
    connectWebSocket();

    // 监听记忆编辑通知（从 memory_browser iframe 发送）
    window.addEventListener('message', function (event) {
        if (event.data && event.data.type === 'memory_edited') {
            console.log('记忆已编辑，刷新上下文:', event.data.catgirl_name);
            // 停止当前语音捕获，用户再次开麦时会自动刷新上下文
            if (isRecording) {
                stopMicCapture();
            }
            // 显示提示
            showStatusToast(window.t ? window.t('memory.refreshed') : '记忆已更新，下次对话将使用新记忆', 4000);
        }
    });

    // 添加消息到聊天界面
    function appendMessage(text, sender, isNewMessage = true) {
        function getCurrentTimeString() {
            return new Date().toLocaleTimeString('en-US', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
        }

        if (sender === 'gemini' && !isNewMessage && window.currentGeminiMessage &&
            window.currentGeminiMessage.nodeType === Node.ELEMENT_NODE &&
            window.currentGeminiMessage.isConnected) {
            // 追加到现有消息（使用 textContent 避免 XSS 风险）
            window.currentGeminiMessage.textContent += text;
            
            // 防抖机制优化流式输出时的语言检测
            if (subtitleCheckDebounceTimer) {
                clearTimeout(subtitleCheckDebounceTimer);
            }
            
            subtitleCheckDebounceTimer = setTimeout(() => {
                if (!window.currentGeminiMessage ||
                    window.currentGeminiMessage.nodeType !== Node.ELEMENT_NODE ||
                    !window.currentGeminiMessage.isConnected) {
                    subtitleCheckDebounceTimer = null;
                    return;
                }
                
                const fullText = window.currentGeminiMessage.textContent.replace(/^\[\d{2}:\d{2}:\d{2}\] 🎀 /, '');
                if (fullText && fullText.trim()) {
                    if (userLanguage === null) {
                        getUserLanguage().then(() => {
                            if (window.currentGeminiMessage &&
                                window.currentGeminiMessage.nodeType === Node.ELEMENT_NODE &&
                                window.currentGeminiMessage.isConnected) {
                                const detectedLang = detectLanguage(fullText);
                                if (detectedLang !== 'unknown' && detectedLang !== userLanguage) {
                                    showSubtitlePrompt();
                                }
                            }
                        }).catch(err => {
                            console.warn('获取用户语言失败（流式检测）:', err);
                        });
                    } else {
                        const detectedLang = detectLanguage(fullText);
                        if (detectedLang !== 'unknown' && detectedLang !== userLanguage) {
                            showSubtitlePrompt();
                        }
                    }
                }
                subtitleCheckDebounceTimer = null;
            }, 300);
        } else {
            // 创建新消息
            const messageDiv = document.createElement('div');
            messageDiv.classList.add('message', sender);

            // 根据sender设置不同的图标
            const icon = sender === 'user' ? '💬' : '🎀';
            messageDiv.textContent = "[" + getCurrentTimeString() + "] " + icon + " " + text;
            chatContainer.appendChild(messageDiv);

            // 如果是Gemini消息，更新当前消息引用
            if (sender === 'gemini') {
                window.currentGeminiMessage = messageDiv;

                // 检测AI消息的语言，如果与用户语言不同，显示字幕提示框
                checkAndShowSubtitlePrompt(text);
                
                // 注意：翻译现在在消息完成时（turn end事件）立即执行，不再使用延迟机制

                // 如果是AI第一次回复，更新状态并检查成就
                if (isFirstAIResponse) {
                    isFirstAIResponse = false;
                    console.log('检测到AI第一次回复');
                    checkAndUnlockFirstDialogueAchievement();
                }
            }
        }
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }


    // 全局变量用于缓存麦克风列表和缓存时间戳
    let cachedMicrophones = null;
    let cacheTimestamp = 0;
    const CACHE_DURATION = 30000; // 缓存30秒

    // 首次交互跟踪
    let isFirstUserInput = true; // 跟踪是否为用户第一次输入
    let isFirstAIResponse = true; // 跟踪是否为AI第一次回复

    // 检查并解锁首次对话成就
    async function checkAndUnlockFirstDialogueAchievement() {
        // 当用户和AI都完成首次交互后调用API
        if (!isFirstUserInput && !isFirstAIResponse) {
            try {
                console.log('首次对话完成，尝试解锁成就');
                const response = await fetch('/api/steam/set-achievement-status/ACH_FIRST_DIALOGUE', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });

                if (response.ok) {
                    console.log('成就解锁API调用成功');
                } else {
                    console.error('成就解锁API调用失败');
                }
            } catch (error) {
                console.error('成就解锁过程中发生错误:', error);
            }
        }
    }

    // 麦克风选择器UI已移除（旧sidebar系统），保留核心函数供live2d.js浮动按钮系统使用

    // 选择麦克风
    async function selectMicrophone(deviceId) {
        selectedMicrophoneId = deviceId;

        // 获取设备名称用于状态提示
        let deviceName = '系统默认麦克风';
        if (deviceId) {
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                const audioInputs = devices.filter(device => device.kind === 'audioinput');
                const selectedDevice = audioInputs.find(device => device.deviceId === deviceId);
                if (selectedDevice) {
                    deviceName = selectedDevice.label || `麦克风 ${audioInputs.indexOf(selectedDevice) + 1}`;
                }
            } catch (error) {
                console.error('获取设备名称失败:', error);
            }
        }

        // 更新UI选中状态
        const options = document.querySelectorAll('.mic-option');
        options.forEach(option => {
            if ((option.classList.contains('default') && deviceId === null) ||
                (option.dataset.deviceId === deviceId && deviceId !== null)) {
                option.classList.add('selected');
            } else {
                option.classList.remove('selected');
            }
        });

        // 保存选择到服务器
        await saveSelectedMicrophone(deviceId);

        // 如果正在录音，先显示选择提示，然后延迟重启录音
        if (isRecording) {
            const wasRecording = isRecording;
            // 先显示选择提示
            showStatusToast(window.t ? window.t('app.deviceSelected', { device: deviceName }) : `已选择 ${deviceName}`, 3000);
            // 延迟重启录音，让用户看到选择提示
            await stopMicCapture();
            // 等待一小段时间，确保选择提示显示出来
            await new Promise(resolve => setTimeout(resolve, 500));
            if (wasRecording) {
                await startMicCapture();
            }
        } else {
            // 如果不在录音，直接显示选择提示
            showStatusToast(window.t ? window.t('app.deviceSelected', { device: deviceName }) : `已选择 ${deviceName}`, 3000);
        }
    }

    // 保存选择的麦克风到服务器
    async function saveSelectedMicrophone(deviceId) {
        try {
            const response = await fetch('/api/characters/set_microphone', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    microphone_id: deviceId
                })
            });

            if (!response.ok) {
                console.error('保存麦克风选择失败');
            }
        } catch (err) {
            console.error('保存麦克风选择时发生错误:', err);
        }
    }

    // 加载上次选择的麦克风
    async function loadSelectedMicrophone() {
        try {
            const response = await fetch('/api/characters/get_microphone');
            if (response.ok) {
                const data = await response.json();
                selectedMicrophoneId = data.microphone_id || null;
            }
        } catch (err) {
            console.error('加载麦克风选择失败:', err);
            selectedMicrophoneId = null;
        }
    }

    // 开麦，按钮on click
    async function startMicCapture() {
        try {
            // 开始录音前添加录音状态类到两个按钮
            micButton.classList.add('recording');

            if (!audioPlayerContext) {
                audioPlayerContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            if (audioPlayerContext.state === 'suspended') {
                await audioPlayerContext.resume();
            }

            // 获取麦克风流，使用选择的麦克风设备ID
            // 注意：不在此处指定 sampleRate，因为 getUserMedia 的 sampleRate 只是偏好设置
            // 实际采样率由 AudioContext 强制为 48kHz（见 startAudioWorklet）
            const baseAudioConstraints = {
                noiseSuppression: false,
                echoCancellation: true,
                autoGainControl: true,
                channelCount: 1
            };

            const constraints = {
                audio: selectedMicrophoneId
                    ? { ...baseAudioConstraints, deviceId: { exact: selectedMicrophoneId } }
                    : baseAudioConstraints
            };


            stream = await navigator.mediaDevices.getUserMedia(constraints);

            // 检查音频轨道状态
            const audioTracks = stream.getAudioTracks();
            console.log("音频轨道数量:", audioTracks.length);
            console.log("音频轨道状态:", audioTracks.map(track => ({
                label: track.label,
                enabled: track.enabled,
                muted: track.muted,
                readyState: track.readyState
            })));

            if (audioTracks.length === 0) {
                console.error("没有可用的音频轨道");
                showStatusToast(window.t ? window.t('app.micAccessDenied') : '无法访问麦克风', 4000);
                // 移除已添加的类
                micButton.classList.remove('recording');
                micButton.classList.remove('active');
                // 抛出错误，让外层 catch 块处理按钮状态恢复
                throw new Error('没有可用的音频轨道');
            }

            await startAudioWorklet(stream);

            micButton.disabled = true;
            muteButton.disabled = false;
            screenButton.disabled = false;
            stopButton.disabled = true;
            resetSessionButton.disabled = false;
            showStatusToast(window.t ? window.t('app.speaking') : '正在语音...', 2000);

            // 确保active类存在（已经在点击时添加，这里确保存在）
            if (!micButton.classList.contains('active')) {
                micButton.classList.add('active');
            }

            // 开始录音时，停止主动搭话定时器
            stopProactiveChatSchedule();
        } catch (err) {
            console.error('获取麦克风权限失败:', err);
            showStatusToast(window.t ? window.t('app.micAccessDenied') : '无法访问麦克风', 4000);
            // 失败时移除录音状态类
            micButton.classList.remove('recording');
            // 移除active类
            micButton.classList.remove('active');
            // 抛出错误，让外层 catch 块处理按钮状态恢复
            throw err;
        }
    }

    async function stopMicCapture() { // 闭麦，按钮on click
        isSwitchingMode = true; // 开始模式切换（从语音切换到待机/文本模式）

        // 停止录音时移除录音状态类
        micButton.classList.remove('recording');

        // 移除active类
        micButton.classList.remove('active');
        screenButton.classList.remove('active');

        // 同步浮动按钮状态
        syncFloatingMicButtonState(false);
        syncFloatingScreenButtonState(false);

        stopRecording();
        micButton.disabled = false;
        muteButton.disabled = true;
        screenButton.disabled = true;
        stopButton.disabled = true;
        resetSessionButton.disabled = false;

        // 显示文本输入区
        const textInputArea = document.getElementById('text-input-area');
        textInputArea.classList.remove('hidden');

        // 停止录音后，重置主动搭话退避级别并开始定时
        if (proactiveChatEnabled || proactiveVisionEnabled) {
            lastUserInputTime = Date.now();
            resetProactiveChatBackoff();
        }

        // 如果是从语音模式切换回来，显示待机状态
        showStatusToast(window.t ? window.t('app.standby', { name: lanlan_config.lanlan_name }) : `${lanlan_config.lanlan_name}待机中...`, 2000);

        // 延迟重置模式切换标志，确保"已离开"消息已经被忽略
        setTimeout(() => {
            isSwitchingMode = false;
        }, 500);
    }

    async function getMobileCameraStream() {
        const makeConstraints = (facing) => ({
            video: {
                facingMode: facing,
                frameRate: { ideal: 1, max: 1 },
            },
            audio: false,
        });

        const attempts = [
            { label: 'rear', constraints: makeConstraints({ ideal: 'environment' }) },
            { label: 'front', constraints: makeConstraints('user') },
            { label: 'any', constraints: { video: { frameRate: { ideal: 1, max: 1 } }, audio: false } },
        ];

        let lastError;

        for (const attempt of attempts) {
            try {
                console.log(`Trying ${attempt.label} camera @ ${1}fps…`);
                return await navigator.mediaDevices.getUserMedia(attempt.constraints);
            } catch (err) {
                console.warn(`${attempt.label} failed →`, err);
                lastError = err;
            }
        }

        if (lastError) {
            showStatusToast(lastError.toString(), 4000);
            throw lastError;
        }
    }

    async function startScreenSharing() { // 分享屏幕，按钮on click
        // 检查是否在录音状态
        if (!isRecording) {
            showStatusToast(window.t ? window.t('app.micRequired') : '请先开启麦克风录音！', 3000);
            return;
        }

        try {
            // 初始化音频播放上下文
            showLive2d();
            if (!audioPlayerContext) {
                audioPlayerContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            // 如果上下文被暂停，则恢复它
            if (audioPlayerContext.state === 'suspended') {
                await audioPlayerContext.resume();
            }

            if (screenCaptureStream == null) {
                if (isMobile()) {
                    // 移动端使用摄像头
                    const tmp = await getMobileCameraStream();
                    if (tmp instanceof MediaStream) {
                        screenCaptureStream = tmp;
                    } else {
                        // 保持原有错误处理路径：让 catch 去接手
                        throw (tmp instanceof Error ? tmp : new Error('无法获取摄像头流'));
                    }
                } else {

                    // Desktop/laptop: capture the user's chosen screen / window / tab.
                    screenCaptureStream = await navigator.mediaDevices.getDisplayMedia({
                        video: {
                            cursor: 'always',
                            frameRate: 1,
                        },
                        audio: false,
                    });
                }
            }
            startScreenVideoStreaming(screenCaptureStream, isMobile() ? 'camera' : 'screen');

            micButton.disabled = true;
            muteButton.disabled = false;
            screenButton.disabled = true;
            stopButton.disabled = false;
            resetSessionButton.disabled = false;

            // 添加active类以保持激活状态的颜色
            screenButton.classList.add('active');

            // 手动开始屏幕共享时，重置/停止语音期间的主动视觉定时，避免双重触发
            try {
                stopProactiveVisionDuringSpeech();
            } catch (e) {
                console.warn('停止语音期间主动视觉失败:', e);
            }

            // 当用户停止共享屏幕时
            screenCaptureStream.getVideoTracks()[0].onended = () => {
                stopScreening();
                screenButton.classList.remove('active');
                syncFloatingScreenButtonState(false);
            };

            // 获取麦克风流
            if (!isRecording) showStatusToast(window.t ? window.t('app.micNotOpen') : '没开麦啊喂！', 3000);
        } catch (err) {
            console.error(isMobile() ? '摄像头访问失败:' : '屏幕共享失败:', err);
            console.error('启动失败 →', err);
            let hint = '';
            switch (err.name) {
                case 'NotAllowedError':
                    hint = '请检查 iOS 设置 → Safari → 摄像头 权限是否为"允许"';
                    break;
                case 'NotFoundError':
                    hint = '未检测到摄像头设备';
                    break;
                case 'NotReadableError':
                case 'AbortError':
                    hint = '摄像头被其它应用占用？关闭扫码/拍照应用后重试';
                    break;
            }
            showStatusToast(`${err.name}: ${err.message}${hint ? `\n${hint}` : ''}`, 5000);
        }
    }

    async function stopScreenSharing() { // 停止共享，按钮on click
        stopScreening();
        micButton.disabled = true;
        muteButton.disabled = false;
        screenButton.disabled = false;
        stopButton.disabled = true;
        resetSessionButton.disabled = false;
        screenCaptureStream = null;
        showStatusToast(window.t ? window.t('app.speaking') : '正在语音...', 2000);

        // 移除active类
        screenButton.classList.remove('active');
        syncFloatingScreenButtonState(false);

        // 停止手动屏幕共享后，如果满足条件则恢复语音期间主动视觉定时
        try {
            if (proactiveVisionEnabled && isRecording) {
                startProactiveVisionDuringSpeech();
            }
        } catch (e) {
            console.warn('恢复语音期间主动视觉失败:', e);
        }
    }

    window.switchMicCapture = async () => {
        if (muteButton.disabled) {
            await startMicCapture();
        } else {
            await stopMicCapture();
        }
    }
    window.switchScreenSharing = async () => {
        if (stopButton.disabled) {
            // 检查是否在录音状态
            if (!isRecording) {
                showStatusToast(window.t ? window.t('app.micRequired') : '请先开启麦克风录音！', 3000);
                return;
            }
            await startScreenSharing();
        } else {
            await stopScreenSharing();
        }
    }

    // 显示语音准备提示框
    function showVoicePreparingToast(message) {
        // 检查是否已存在提示框，避免重复创建
        let toast = document.getElementById('voice-preparing-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'voice-preparing-toast';
            document.body.appendChild(toast);
        }

        // 确保样式始终一致（每次更新时都重新设置）
        toast.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background-image: url('/static/icons/reminder_blue.png');
            background-size: 100% 100%;
            background-position: center;
            background-repeat: no-repeat;
            background-color: transparent;
            color: white;
            padding: 20px 32px;
            border-radius: 16px;
            font-size: 16px;
            font-weight: 600;
            z-index: 10000;
            display: flex;
            align-items: center;
            gap: 12px;
            animation: voiceToastFadeIn 0.3s ease;
            pointer-events: none;
            width: 320px;
            box-sizing: border-box;
            justify-content: center;
        `;

        // 添加动画样式（只添加一次）
        if (!document.querySelector('style[data-voice-toast-animation]')) {
            const style = document.createElement('style');
            style.setAttribute('data-voice-toast-animation', 'true');
            style.textContent = `
                @keyframes voiceToastFadeIn {
                    from {
                        opacity: 0;
                        transform: translate(-50%, -50%) scale(0.8);
                    }
                    to {
                        opacity: 1;
                        transform: translate(-50%, -50%) scale(1);
                    }
                }
                @keyframes voiceToastPulse {
                    0%, 100% {
                        transform: scale(1);
                    }
                    50% {
                        transform: scale(1.1);
                    }
                }
            `;
            document.head.appendChild(style);
        }

        // 更新消息内容
        toast.innerHTML = `
            <div style="
                width: 20px;
                height: 20px;
                border: 3px solid rgba(255, 255, 255, 0.3);
                border-top-color: white;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            "></div>
            <span>${message}</span>
        `;

        // 添加旋转动画
        const spinStyle = document.createElement('style');
        spinStyle.textContent = `
            @keyframes spin {
                to { transform: rotate(360deg); }
            }
        `;
        if (!document.querySelector('style[data-spin-animation]')) {
            spinStyle.setAttribute('data-spin-animation', 'true');
            document.head.appendChild(spinStyle);
        }

        toast.style.display = 'flex';
    }

    // 隐藏语音准备提示框
    function hideVoicePreparingToast() {
        const toast = document.getElementById('voice-preparing-toast');
        if (toast) {
            toast.style.animation = 'voiceToastFadeIn 0.3s ease reverse';
            setTimeout(() => {
                toast.style.display = 'none';
            }, 300);
        }
    }

    // 显示"可以说话了"提示
    function showReadyToSpeakToast() {
        let toast = document.getElementById('voice-ready-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'voice-ready-toast';
            document.body.appendChild(toast);
        }

        // 确保样式始终一致（和前两个弹窗一样的大小）
        toast.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background-image: url('/static/icons/reminder_midori.png');
            background-size: 100% 100%;
            background-position: center;
            background-repeat: no-repeat;
            background-color: transparent;
            color: white;
            padding: 20px 32px;
            border-radius: 16px;
            font-size: 16px;
            font-weight: 600;
            box-shadow: none;
            z-index: 10000;
            display: flex;
            align-items: center;
            gap: 12px;
            animation: voiceToastFadeIn 0.3s ease;
            pointer-events: none;
            width: 320px;
            box-sizing: border-box;
            justify-content: center;
        `;

        toast.innerHTML = `
            <img src="/static/icons/ready_to_talk.png" style="width: 36px; height: 36px; object-fit: contain; display: block; flex-shrink: 0;" alt="ready">
            <span style="display: flex; align-items: center;">${window.t ? window.t('app.readyToSpeak') : '可以开始说话了！'}</span>
        `;

        // 2秒后自动消失
        setTimeout(() => {
            toast.style.animation = 'voiceToastFadeIn 0.3s ease reverse';
            setTimeout(() => {
                toast.style.display = 'none';
            }, 300);
        }, 2000);
    }

    // 同步浮动麦克风按钮状态的辅助函数
    function syncFloatingMicButtonState(isActive) {
        if (window.live2dManager && window.live2dManager._floatingButtons && window.live2dManager._floatingButtons.mic) {
            const floatingMicBtn = window.live2dManager._floatingButtons.mic.button;
            if (floatingMicBtn) {
                floatingMicBtn.dataset.active = isActive ? 'true' : 'false';
                const imgOff = window.live2dManager._floatingButtons.mic.imgOff;
                const imgOn = window.live2dManager._floatingButtons.mic.imgOn;
                if (imgOff && imgOn) {
                    imgOff.style.opacity = isActive ? '0' : '1';
                    imgOn.style.opacity = isActive ? '1' : '0';
                }
            }
        }
    }

    // 同步浮动屏幕分享按钮状态的辅助函数
    function syncFloatingScreenButtonState(isActive) {
        if (window.live2dManager && window.live2dManager._floatingButtons && window.live2dManager._floatingButtons.screen) {
            const floatingScreenBtn = window.live2dManager._floatingButtons.screen.button;
            if (floatingScreenBtn) {
                floatingScreenBtn.dataset.active = isActive ? 'true' : 'false';
                const imgOff = window.live2dManager._floatingButtons.screen.imgOff;
                const imgOn = window.live2dManager._floatingButtons.screen.imgOn;
                if (imgOff && imgOn) {
                    imgOff.style.opacity = isActive ? '0' : '1';
                    imgOn.style.opacity = isActive ? '1' : '0';
                }
            }
        }
    }

    // 开始麦克风录音
    micButton.addEventListener('click', async () => {
        // 如果按钮已禁用或正在录音，直接返回
        if (micButton.disabled || isRecording) {
            return;
        }

        // 如果已经有 active 类，说明正在处理中，直接返回（防止重复点击）
        if (micButton.classList.contains('active')) {
            return;
        }

        // 立即添加激活状态类，保持常亮状态
        micButton.classList.add('active');

        // 同步更新浮动按钮状态，防止浮动按钮状态不同步导致图标变灰
        syncFloatingMicButtonState(true);

        // 标记麦克风正在启动中
        window.isMicStarting = true;

        // 立即禁用按钮，锁定直到连接成功或失败
        micButton.disabled = true;

        // 立即显示准备提示
        showVoicePreparingToast(window.t ? window.t('app.voiceSystemPreparing') : '语音系统准备中...');

        // 如果有活跃的文本会话，先结束它
        if (isTextSessionActive) {
            isSwitchingMode = true; // 开始模式切换
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({
                    action: 'end_session'
                }));
            }
            isTextSessionActive = false;
            showStatusToast(window.t ? window.t('app.switchingToVoice') : '正在切换到语音模式...', 3000);
            showVoicePreparingToast(window.t ? window.t('app.switchingToVoice') : '正在切换到语音模式...');
            // 增加等待时间，确保后端完全清理资源
            await new Promise(resolve => setTimeout(resolve, 1500)); // 从500ms增加到1500ms
        }

        // 隐藏文本输入区（仅非移动端）
        const textInputArea = document.getElementById('text-input-area');
        if (!isMobile()) {
            textInputArea.classList.add('hidden');
        }

        // 禁用所有语音按钮（micButton 已在函数开始处禁用）
        muteButton.disabled = true;
        screenButton.disabled = true;
        stopButton.disabled = true;
        resetSessionButton.disabled = true;
        returnSessionButton.disabled = true;

        showStatusToast(window.t ? window.t('app.initializingVoice') : '正在初始化语音对话...', 3000);
        showVoicePreparingToast(window.t ? window.t('app.connectingToServer') : '正在连接服务器...');

        try {
            // 创建一个 Promise 来等待 session_started 消息
            let timeoutId = null; // 在外部作用域定义，以便清除
            const sessionStartPromise = new Promise((resolve, reject) => {
                sessionStartedResolver = resolve;

                // 清除之前的超时定时器（如果存在）
                if (window.sessionTimeoutId) {
                    clearTimeout(window.sessionTimeoutId);
                }
            });

            // 发送start session事件
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({
                    action: 'start_session',
                    input_type: 'audio'
                }));
                
                // 设置超时（10秒），如果超时则拒绝
                timeoutId = setTimeout(() => {
                    if (sessionStartedResolver) {
                        const resolver = sessionStartedResolver;
                        sessionStartedResolver = null; // 先清除，防止重复触发
                        window.sessionTimeoutId = null; // 清除全局定时器ID
                        
                        // 超时时向后端发送 end_session 消息
                        if (socket.readyState === WebSocket.OPEN) {
                            socket.send(JSON.stringify({
                                action: 'end_session'
                            }));
                            console.log('[Session Timeout] 已向后端发送 end_session 消息');
                        }
                        
                        // 更新提示信息，显示超时
                        showVoicePreparingToast(window.t ? window.t('app.sessionTimeout') || '连接超时' : '连接超时，请检查网络连接');
                        reject(new Error(window.t ? window.t('app.sessionTimeout') : 'Session启动超时'));
                    } else {
                        window.sessionTimeoutId = null; // 即使 resolver 不存在也清除
                    }
                }, 10000); // 10秒超时

                // 保存到全局变量，以便在 session_started 事件中清除
                window.sessionTimeoutId = timeoutId;
            } else {
                // WebSocket未连接，清除超时定时器和状态
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                if (window.sessionTimeoutId) {
                    clearTimeout(window.sessionTimeoutId);
                    window.sessionTimeoutId = null;
                }
                if (sessionStartedResolver) {
                    sessionStartedResolver = null;
                }
                throw new Error(window.t ? window.t('app.websocketNotConnectedError') : 'WebSocket未连接');
            }

            // 等待session真正启动成功 AND 麦克风初始化完成（并行执行以减少等待时间）
            // 并行执行：
            // 1. 等待后端Session准备就绪 (sessionStartPromise)
            // 2. 初始化前端麦克风 (startMicCapture)
            try {
                // 显示Live2D (提前显示，优化观感)
                showLive2d();
                
                showStatusToast(window.t ? window.t('app.initializingMic') : '正在初始化麦克风...', 3000);
                
                // 并行等待
                await Promise.all([
                    sessionStartPromise,
                    startMicCapture()
                ]);
                
                // 成功时清除超时定时器
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
            } catch (error) {
                // 超时或错误时清除超时定时器
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                throw error; // 重新抛出错误，让外层 catch 处理
            }

            // 启动语音期间的主动视觉定时（如果已开启主动视觉）
            try {
                if (proactiveVisionEnabled) {
                    startProactiveVisionDuringSpeech();
                }
            } catch (e) {
                console.warn('启动语音期间主动视觉失败:', e);
            }

            // 录音启动成功后，隐藏准备提示，显示"可以说话了"提示
            hideVoicePreparingToast();

            // 延迟1秒显示"可以说话了"提示，确保系统真正准备好
            // 同时启动麦克风静音检测，此时服务器已准备就绪
            setTimeout(() => {
                showReadyToSpeakToast();
                // 服务器准备就绪后才启动静音检测，避免过早计时
                startSilenceDetection();
                monitorInputVolume();
            }, 1000);

            // 麦克风启动完成
            window.isMicStarting = false;
            isSwitchingMode = false; // 模式切换完成
        } catch (error) {
            console.error('启动语音会话失败:', error);

            // 清除所有超时定时器和状态
            if (window.sessionTimeoutId) {
                clearTimeout(window.sessionTimeoutId);
                window.sessionTimeoutId = null;
            }
            if (sessionStartedResolver) {
                sessionStartedResolver = null;
            }
            
            // 确保后端清理资源，避免前后端状态不一致
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({
                    action: 'end_session'
                }));
                console.log('[Session Start Failed] 已向后端发送 end_session 消息');
            }

            // 隐藏准备提示
            hideVoicePreparingToast();

            // 失败时：移除激活状态（按钮变暗），恢复按钮（允许再次点击）
            micButton.classList.remove('active');

            // 同步更新浮动按钮状态，确保浮动按钮也变灰
            syncFloatingMicButtonState(false);
            syncFloatingScreenButtonState(false);

            micButton.disabled = false;
            muteButton.disabled = true;
            screenButton.disabled = true;
            stopButton.disabled = true;
            resetSessionButton.disabled = false;
            textInputArea.classList.remove('hidden');
            showStatusToast(window.t ? window.t('app.startFailed', { error: error.message }) : `启动失败: ${error.message}`, 5000);
            // 麦克风启动失败，重置标志
            window.isMicStarting = false;
            isSwitchingMode = false; // 切换失败，重置标志

            // 移除其他按钮的active类
            screenButton.classList.remove('active');
        }
    });

    // 开始屏幕共享
    screenButton.addEventListener('click', startScreenSharing);

    // 停止屏幕共享
    stopButton.addEventListener('click', stopScreenSharing);

    // 停止对话
    muteButton.addEventListener('click', stopMicCapture);

    resetSessionButton.addEventListener('click', () => {
        console.log('[App] resetSessionButton 被点击！当前 isGoodbyeMode 检查');
        isSwitchingMode = true; // 开始重置会话（也是一种模式切换）

        // 检查是否是"请她离开"触发的
        const isGoodbyeMode = window.live2dManager && window.live2dManager._goodbyeClicked;
        console.log('[App] 检测 isGoodbyeMode =', isGoodbyeMode, 'goodbyeClicked =', window.live2dManager ? window.live2dManager._goodbyeClicked : 'undefined');

        // 检查 hideLive2d 前的容器状态
        const live2dContainer = document.getElementById('live2d-container');
        console.log('[App] hideLive2d 前容器状态:', {
            存在: !!live2dContainer,
            当前类: live2dContainer ? live2dContainer.className : 'undefined',
            classList: live2dContainer ? live2dContainer.classList.toString() : 'undefined',
            display: live2dContainer ? getComputedStyle(live2dContainer).display : 'undefined'
        });

        hideLive2d()

        // 检查 hideLive2d 后的容器状态
        console.log('[App] hideLive2d 后容器状态:', {
            存在: !!live2dContainer,
            当前类: live2dContainer ? live2dContainer.className : 'undefined',
            classList: live2dContainer ? live2dContainer.classList.toString() : 'undefined',
            display: live2dContainer ? getComputedStyle(live2dContainer).display : 'undefined'
        });
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                action: 'end_session'
            }));
        }
        stopRecording();
        clearAudioQueue();

        // 重置所有状态
        isTextSessionActive = false;

        // 移除所有按钮的active类
        micButton.classList.remove('active');
        screenButton.classList.remove('active');

        // 清除所有截图
        screenshotsList.innerHTML = '';
        screenshotThumbnailContainer.classList.remove('show');
        updateScreenshotCount();
        screenshotCounter = 0;

        // 根据模式执行不同逻辑
        console.log('[App] 执行分支判断，isGoodbyeMode =', isGoodbyeMode);
        if (!isGoodbyeMode) {
            // 非"请她离开"模式：显示文本输入区并启用按钮
            console.log('[App] 执行普通结束会话逻辑');

            // 结束会话后，重置主动搭话计时器（如果已开启）
            if (proactiveChatEnabled || proactiveVisionEnabled) {
                resetProactiveChatBackoff();
            }
            // 显示文本输入区
            const textInputArea = document.getElementById('text-input-area');
            textInputArea.classList.remove('hidden');

            // 启用所有输入
            micButton.disabled = false;
            textSendButton.disabled = false;
            textInputBox.disabled = false;
            screenshotButton.disabled = false;

            // 禁用语音控制按钮
            muteButton.disabled = true;
            screenButton.disabled = true;
            stopButton.disabled = true;
            resetSessionButton.disabled = true;
            returnSessionButton.disabled = true;  // 禁用"请她回来"按钮

            showStatusToast(window.t ? window.t('app.sessionEnded') : '会话已结束', 3000);
        } else {
            // "请她离开"模式：隐藏所有内容
            console.log('[App] 执行"请她离开"模式逻辑');

            // 重置 goodbyeClicked 标志（在处理完成后）
            if (window.live2dManager) {
                window.live2dManager._goodbyeClicked = false;
            }
            console.log('[App] 已重置 goodbyeClicked 标志为 false');

            // "请她离开"模式：隐藏所有内容
            const textInputArea = document.getElementById('text-input-area');
            textInputArea.classList.add('hidden');

            // 禁用所有按钮
            micButton.disabled = true;
            textSendButton.disabled = true;
            textInputBox.disabled = true;
            screenshotButton.disabled = true;
            muteButton.disabled = true;
            screenButton.disabled = true;
            stopButton.disabled = true;
            resetSessionButton.disabled = true;
            returnSessionButton.disabled = false;  // 启用"请她回来"按钮

            // "请她离开"时，停止主动搭话定时器
            stopProactiveChatSchedule();

            showStatusToast('', 0);
        }

        // 延迟重置模式切换标志，确保"已离开"消息已经被忽略
        setTimeout(() => {
            isSwitchingMode = false;
        }, 500);
    });

    // "请她回来"按钮事件
    returnSessionButton.addEventListener('click', () => {
        isSwitchingMode = true; // 开始模式切换

        // 显示Live2D模型
        showLive2d();

        // 清除所有语音相关的状态类（确保按钮不会显示为激活状态）
        micButton.classList.remove('recording');
        micButton.classList.remove('active');
        screenButton.classList.remove('active');

        // 确保停止录音状态
        isRecording = false;
        window.isRecording = false;

        // 同步更新Live2D浮动按钮的状态
        if (window.live2dManager && window.live2dManager._floatingButtons) {
            // 更新麦克风和屏幕分享按钮状态
            ['mic', 'screen'].forEach(buttonId => {
                const buttonData = window.live2dManager._floatingButtons[buttonId];
                if (buttonData && buttonData.button) {
                    buttonData.button.dataset.active = 'false';
                    // 更新图标显示：显示off图标，隐藏on图标
                    if (buttonData.imgOff) {
                        buttonData.imgOff.style.opacity = '1';
                    }
                    if (buttonData.imgOn) {
                        buttonData.imgOn.style.opacity = '0';
                    }
                }
            });
        }

        // 启用所有基本输入按钮
        micButton.disabled = false;
        textSendButton.disabled = false;
        textInputBox.disabled = false;
        screenshotButton.disabled = false;
        resetSessionButton.disabled = false;

        // 禁用语音控制按钮（文本模式下不需要）
        muteButton.disabled = true;
        screenButton.disabled = true;
        stopButton.disabled = true;

        // 显示文本输入区
        const textInputArea = document.getElementById('text-input-area');
        textInputArea.classList.remove('hidden');

        // 如果是"请她离开"后返回，需要重新建立会话
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                action: 'start_session',
                input_type: 'text',
                new_session: true  // 开始新会话
            }));

            // 标记文本会话为活跃状态
            isTextSessionActive = true;

            showStatusToast(window.t ? window.t('app.returning', { name: lanlan_config.lanlan_name }) : `🫴 ${lanlan_config.lanlan_name}回来了！正在重新连接...`, 3000);

            // 重置主动搭话定时器（如果已开启）
            if (proactiveChatEnabled || proactiveVisionEnabled) {
                resetProactiveChatBackoff();
            }
        } else {
            showStatusToast(window.t ? window.t('app.websocketNotConnected') : 'WebSocket未连接！', 4000);
        }

        // 延迟重置模式切换标志
        setTimeout(() => {
            isSwitchingMode = false;
        }, 500);
    });

    // 文本发送按钮事件
    textSendButton.addEventListener('click', async () => {
        const text = textInputBox.value.trim();
        const hasScreenshots = screenshotsList.children.length > 0;

        // 如果既没有文本也没有截图，静默返回
        if (!text && !hasScreenshots) {
            return;
        }

        // 用户主动发送文本时，记录时间戳并重置主动搭话计时器
        lastUserInputTime = Date.now();
        resetProactiveChatBackoff();

        // 如果还没有启动session，先启动
        if (!isTextSessionActive) {
            // 临时禁用文本输入
            textSendButton.disabled = true;
            textInputBox.disabled = true;
            screenshotButton.disabled = true;
            resetSessionButton.disabled = false;

            showStatusToast(window.t ? window.t('app.initializingText') : '正在初始化文本对话...', 3000);

            try {
                // 创建一个 Promise 来等待 session_started 消息
                const sessionStartPromise = new Promise((resolve, reject) => {
                    sessionStartedResolver = resolve;

                    // 设置超时（15秒），如果超时则拒绝
                    setTimeout(() => {
                        if (sessionStartedResolver) {
                            sessionStartedResolver = null;
                            reject(new Error(window.t ? window.t('app.sessionTimeout') : 'Session启动超时'));
                        }
                    }, 15000);
                });

                // 启动文本session
                if (socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({
                        action: 'start_session',
                        input_type: 'text',
                        new_session: false
                    }));
                } else {
                    throw new Error(window.t ? window.t('app.websocketNotConnectedError') : 'WebSocket未连接');
                }

                // 等待session真正启动成功
                await sessionStartPromise;

                isTextSessionActive = true;
                showLive2d();

                // 重新启用文本输入
                textSendButton.disabled = false;
                textInputBox.disabled = false;
                screenshotButton.disabled = false;

                showStatusToast(window.t ? window.t('app.textChattingShort') : '正在文本聊天中', 2000);
            } catch (error) {
                console.error('启动文本session失败:', error);
                hideVoicePreparingToast(); // 确保失败时隐藏准备提示
                showStatusToast(window.t ? window.t('app.startFailed', { error: error.message }) : `启动失败: ${error.message}`, 5000);

                // 重新启用按钮，允许用户重试
                textSendButton.disabled = false;
                textInputBox.disabled = false;
                screenshotButton.disabled = false;

                return; // 启动失败，不继续发送消息
            }
        }

        // 发送消息
        if (socket.readyState === WebSocket.OPEN) {
            // 先发送所有截图
            if (hasScreenshots) {
                const screenshotItems = Array.from(screenshotsList.children);
                for (const item of screenshotItems) {
                    const img = item.querySelector('.screenshot-thumbnail');
                    if (img && img.src) {
                        socket.send(JSON.stringify({
                            action: 'stream_data',
                            data: img.src,
                            input_type: isMobile() ? 'camera' : 'screen'
                        }));
                    }
                }

                // 在聊天界面显示截图提示
                const screenshotCount = screenshotItems.length;
                appendMessage(`📸 [已发送${screenshotCount}张截图]`, 'user', true);

                // 清空截图列表
                screenshotsList.innerHTML = '';
                screenshotThumbnailContainer.classList.remove('show');
                updateScreenshotCount();
            }

            // 再发送文本（如果有）
            if (text) {
                socket.send(JSON.stringify({
                    action: 'stream_data',
                    data: text,
                    input_type: 'text'
                }));

                // 清空输入框
                textInputBox.value = '';

                // 在聊天界面显示用户消息
                appendMessage(text, 'user', true);

                // 如果是用户第一次输入，更新状态并检查成就
                if (isFirstUserInput) {
                    isFirstUserInput = false;
                    console.log('检测到用户第一次输入');
                    checkAndUnlockFirstDialogueAchievement();
                }
            }

            // 文本聊天后，重置主动搭话计时器（如果已开启）
            if (proactiveChatEnabled || proactiveVisionEnabled) {
                resetProactiveChatBackoff();
            }

            showStatusToast(window.t ? window.t('app.textChattingShort') : '正在文本聊天中', 2000);
        } else {
            showStatusToast(window.t ? window.t('app.websocketNotConnected') : 'WebSocket未连接！', 4000);
        }
    });

    // 支持Enter键发送（Shift+Enter换行）
    textInputBox.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            textSendButton.click();
        }
    });

    // 截图按钮事件
    screenshotButton.addEventListener('click', async () => {
        let captureStream = null;

        try {
            // 临时禁用截图按钮，防止重复点击
            screenshotButton.disabled = true;
            showStatusToast(window.t ? window.t('app.capturing') : '正在截图...', 2000);

            // 获取屏幕或摄像头流
            if (isMobile()) {
                // 移动端使用摄像头
                captureStream = await getMobileCameraStream();
            } else {
                // API 兼容性检测（桌面端）
                if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
                    throw new Error('UNSUPPORTED_API');
                }
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

            // 使用统一的截图辅助函数进行截取
            const { dataUrl, width, height } = captureCanvasFrame(video);

            // 清理 video 元素释放资源
            video.srcObject = null;
            video.remove();

            console.log(`截图成功，尺寸: ${width}x${height}`);

            // 添加截图到待发送列表（不立即发送）
            addScreenshotToList(dataUrl);

            showStatusToast(window.t ? window.t('app.screenshotAdded') : '截图已添加，点击发送一起发送', 3000);

        } catch (err) {
            console.error('截图失败:', err);

            // 根据错误类型显示不同提示
            let errorMsg = window.t ? window.t('app.screenshotFailed') : '截图失败';
            if (err.message === 'UNSUPPORTED_API') {
                errorMsg = window.t ? window.t('app.screenshotUnsupported') : '当前浏览器不支持屏幕截图功能';
            } else if (err.name === 'NotAllowedError') {
                errorMsg = window.t ? window.t('app.screenshotCancelled') : '用户取消了截图';
            } else if (err.name === 'NotFoundError') {
                errorMsg = window.t ? window.t('app.deviceNotFound') : '未找到可用的媒体设备';
            } else if (err.name === 'NotReadableError') {
                errorMsg = window.t ? window.t('app.deviceNotAccessible') : '无法访问媒体设备';
            } else if (err.message) {
                errorMsg = window.t ? window.t('app.screenshotFailed') + ': ' + err.message : `截图失败: ${err.message}`;
            }

            showStatusToast(errorMsg, 5000);
        } finally {
            // 确保流被正确关闭，防止资源泄漏
            if (captureStream instanceof MediaStream) {
                captureStream.getTracks().forEach(track => track.stop());
            }
            // 重新启用截图按钮
            screenshotButton.disabled = false;
        }
    });

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
        img.alt = window.t ? window.t('chat.screenshotAlt', { index: screenshotCounter }) : `截图 ${screenshotCounter}`;
        img.title = window.t ? window.t('chat.screenshotTitle', { index: screenshotCounter }) : `点击查看截图 ${screenshotCounter}`;

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

        // 更新计数和显示容器
        updateScreenshotCount();
        screenshotThumbnailContainer.classList.add('show');

        // 自动滚动到最新的截图
        setTimeout(() => {
            screenshotsList.scrollLeft = screenshotsList.scrollWidth;
        }, 100);
    }

    // 从列表中移除截图
    function removeScreenshotFromList(item) {
        item.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            item.remove();
            updateScreenshotCount();

            // 如果没有截图了，隐藏容器
            if (screenshotsList.children.length === 0) {
                screenshotThumbnailContainer.classList.remove('show');
            }
        }, 300);
    }

    // 更新截图计数
    function updateScreenshotCount() {
        const count = screenshotsList.children.length;
        screenshotCount.textContent = count;
    }

    // 清空所有截图
    clearAllScreenshots.addEventListener('click', async () => {
        if (screenshotsList.children.length === 0) return;

        if (await showConfirm(
            window.t ? window.t('dialogs.clearScreenshotsConfirm') : '确定要清空所有待发送的截图吗？',
            window.t ? window.t('dialogs.clearScreenshots') : '清空截图',
            { danger: true }
        )) {
            screenshotsList.innerHTML = '';
            screenshotThumbnailContainer.classList.remove('show');
            updateScreenshotCount();
        }
    });

    // 情感分析功能
    async function analyzeEmotion(text) {
        console.log('analyzeEmotion被调用，文本:', text);
        try {
            const response = await fetch('/api/emotion/analysis', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    text: text,
                    lanlan_name: lanlan_config.lanlan_name
                })
            });

            if (!response.ok) {
                console.warn('情感分析请求失败:', response.status);
                return null;
            }

            const result = await response.json();
            console.log('情感分析API返回结果:', result);

            if (result.error) {
                console.warn('情感分析错误:', result.error);
                return null;
            }

            return result;
        } catch (error) {
            console.error('情感分析请求异常:', error);
            return null;
        }
    }

    // 应用情感到Live2D模型
    function applyEmotion(emotion) {
        if (window.LanLan1 && window.LanLan1.setEmotion) {
            console.log('调用window.LanLan1.setEmotion:', emotion);
            window.LanLan1.setEmotion(emotion);
        } else {
            console.warn('情感功能未初始化');
        }
    }

    // 启动麦克风静音检测
    function startSilenceDetection() {
        // 重置检测状态
        hasSoundDetected = false;

        // 清除之前的定时器(如果有)
        if (silenceDetectionTimer) {
            clearTimeout(silenceDetectionTimer);
        }

        // 启动5秒定时器
        silenceDetectionTimer = setTimeout(() => {
            if (!hasSoundDetected && isRecording) {
                showStatusToast(window.t ? window.t('app.micNoSound') : '⚠️ 麦克风无声音，请检查麦克风设置', 5000);
                console.warn('麦克风静音检测：5秒内未检测到声音');
            }
        }, 5000);
    }

    // 停止麦克风静音检测
    function stopSilenceDetection() {
        if (silenceDetectionTimer) {
            clearTimeout(silenceDetectionTimer);
            silenceDetectionTimer = null;
        }
        hasSoundDetected = false;
    }

    // 监测音频输入音量
    function monitorInputVolume() {
        if (!inputAnalyser || !isRecording) {
            return;
        }

        const dataArray = new Uint8Array(inputAnalyser.fftSize);
        inputAnalyser.getByteTimeDomainData(dataArray);

        // 计算音量(RMS)
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            const val = (dataArray[i] - 128) / 128.0;
            sum += val * val;
        }
        const rms = Math.sqrt(sum / dataArray.length);

        // 如果音量超过阈值(0.01),认为检测到声音
        if (rms > 0.01) {
            if (!hasSoundDetected) {
                hasSoundDetected = true;
                console.log('麦克风静音检测：检测到声音，RMS =', rms);

                // 如果之前显示了无声音警告，现在检测到声音了，恢复正常状态显示
                // 检查隐藏的 status 元素是否包含无声音警告（保持兼容性）
                const noSoundText = window.t ? window.t('voiceControl.noSound') : '麦克风无声音';
                if (statusElement && statusElement.textContent.includes(noSoundText)) {
                    showStatusToast(window.t ? window.t('app.speaking') : '正在语音...', 2000);
                    console.log('麦克风静音检测：检测到声音，已清除警告');
                }
            }
        }

        // 持续监测
        if (isRecording) {
            requestAnimationFrame(monitorInputVolume);
        }
    }

    // 使用AudioWorklet开始音频处理
    async function startAudioWorklet(stream) {
        // 先清理旧的音频上下文，防止多个 worklet 同时发送数据导致 QPS 超限
        if (audioContext) {
            // 只有在未关闭状态下才尝试关闭
            if (audioContext.state !== 'closed') {
                try {
                    await audioContext.close();
                } catch (e) {
                    console.warn('关闭旧音频上下文时出错:', e);
                    // 强制复位所有状态，防止状态不一致
                    micButton.classList.remove('recording', 'active');
                    syncFloatingMicButtonState(false);
                    syncFloatingScreenButtonState(false);
                    micButton.disabled = false;
                    muteButton.disabled = true;
                    screenButton.disabled = true;
                    stopButton.disabled = true;
                    showStatusToast(window.t ? window.t('app.audioContextError') : '音频系统异常，请重试', 3000);
                    throw e; // 重新抛出错误，阻止后续执行
                }
            }
            audioContext = null;
            workletNode = null;
        }

        // 创建音频上下文，强制使用 48kHz 采样率
        // 这确保无论设备原生采样率如何，RNNoise 都能正确处理
        // Chromium 会在必要时进行软件重采样
        audioContext = new AudioContext({ sampleRate: 48000 });
        console.log("音频上下文采样率 (强制48kHz):", audioContext.sampleRate);

        // 创建媒体流源
        const source = audioContext.createMediaStreamSource(stream);

        // 创建analyser节点用于监测输入音量
        inputAnalyser = audioContext.createAnalyser();
        inputAnalyser.fftSize = 2048;
        inputAnalyser.smoothingTimeConstant = 0.8;

        // 连接source到analyser(用于音量检测)
        source.connect(inputAnalyser);

        try {
            // 加载AudioWorklet处理器
            await audioContext.audioWorklet.addModule('/static/audio-processor.js');

            // 根据连接类型确定目标采样率：
            // - 手机端直连API服务器：16kHz（API要求）
            // - 电脑端本地浏览：48kHz（RNNoise处理后后端降采样）
            // - 手机端连接电脑端：使用WebRTC（浏览器处理）
            const targetSampleRate = isMobile() ? 16000 : 48000;
            console.log(`音频采样率配置: 原始=${audioContext.sampleRate}Hz, 目标=${targetSampleRate}Hz, 移动端=${isMobile()}`);

            // 创建AudioWorkletNode
            workletNode = new AudioWorkletNode(audioContext, 'audio-processor', {
                processorOptions: {
                    originalSampleRate: audioContext.sampleRate,
                    targetSampleRate: targetSampleRate
                }
            });

            // 监听处理器发送的消息
            workletNode.port.onmessage = (event) => {
                const audioData = event.data;

                // Focus模式：focusModeEnabled为true且AI正在播放语音时，自动静音麦克风（不回传麦克风音频）
                if (focusModeEnabled === true && isPlaying === true) {
                    // 处于focus模式且AI语音播放中，跳过回传麦克风音频，实现自动静音
                    return;
                }

                if (isRecording && socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({
                        action: 'stream_data',
                        data: Array.from(audioData),
                        input_type: 'audio'
                    }));
                }
            };

            // 连接节点
            source.connect(workletNode);
            // 不需要连接到destination，因为我们不需要听到声音
            // workletNode.connect(audioContext.destination);
            // 所有初始化成功后，才标记为录音状态
            isRecording = true;
            window.isRecording = true;

        } catch (err) {
            console.error('加载AudioWorklet失败:', err);
            console.dir(err); // <--- 使用 console.dir()
            showStatusToast(window.t ? window.t('app.audioWorkletFailed') : 'AudioWorklet加载失败', 5000);
            stopSilenceDetection();
        }
    }


    // 停止录屏
    function stopScreening() {
        if (videoSenderInterval) clearInterval(videoSenderInterval);
    }

    // 停止录音
    function stopRecording() {
        // 停止语音期间主动视觉定时
        stopProactiveVisionDuringSpeech();

        stopScreening();
        if (!isRecording) return;

        isRecording = false;
        window.isRecording = false;
        window.currentGeminiMessage = null;

        // 停止静音检测
        stopSilenceDetection();

        // 清理输入analyser
        inputAnalyser = null;

        // 停止所有轨道
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }

        // 关闭AudioContext
        if (audioContext) {
            // 只有在未关闭状态下才关闭，防止重复关闭导致错误
            if (audioContext.state !== 'closed') {
                audioContext.close();
            }
            audioContext = null;
            workletNode = null;
        }

        // 通知服务器暂停会话
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                action: 'pause_session'
            }));
        }
        // statusElement.textContent = '录制已停止';
    }

    // 清空音频队列并停止所有播放
    function clearAudioQueue() {
        // 停止所有计划的音频源
        scheduledSources.forEach(source => {
            try {
                source.stop();
            } catch (e) {
                // 忽略已经停止的源
            }
        });

        // 清空队列和计划源列表
        scheduledSources = [];
        audioBufferQueue = [];
        isPlaying = false;
        audioStartTime = 0;
        nextStartTime = 0; // 新增：重置预调度时间

        // 重置 OGG OPUS 流式解码器
        resetOggOpusDecoder();
    }

    // 清空音频队列但不重置解码器（用于精确打断控制）
    // 解码器将在收到新 speech_id 的第一个音频包时才重置
    function clearAudioQueueWithoutDecoderReset() {
        // 停止所有计划的音频源
        scheduledSources.forEach(source => {
            try {
                source.stop();
            } catch (e) {
                // 忽略已经停止的源
            }
        });

        // 清空队列和计划源列表
        scheduledSources = [];
        audioBufferQueue = [];
        isPlaying = false;
        audioStartTime = 0;
        nextStartTime = 0;

        // 注意：不调用 resetOggOpusDecoder()！
        // 解码器将在收到新 speech_id 时才重置，避免丢失头信息
    }


    function scheduleAudioChunks() {
        const scheduleAheadTime = 5;

        initializeGlobalAnalyser();
        // 若初始化仍失败，兜底直接将后续 source 连接到 destination，避免静音
        const hasAnalyser = !!globalAnalyser;

        // 关键：预调度所有在lookahead时间内的chunk
        while (nextChunkTime < audioPlayerContext.currentTime + scheduleAheadTime) {
            if (audioBufferQueue.length > 0) {
                const { buffer: nextBuffer } = audioBufferQueue.shift();
                console.log('ctx', audioPlayerContext.sampleRate,
                    'buf', nextBuffer.sampleRate);

                const source = audioPlayerContext.createBufferSource();
                source.buffer = nextBuffer;
<<<<<<< HEAD
                
                // 确保 globalAnalyser 已初始化
                initializeGlobalAnalyser();
                
                if (!globalAnalyser) {
                    console.warn('[App] globalAnalyser 未初始化，无法进行口型同步');
                    source.connect(audioPlayerContext.destination);
                } else {
                    source.connect(globalAnalyser);

                    // 启动口型同步（根据当前模型类型）
                    const currentModelType = localStorage.getItem('modelType') || 'live2d';
                    if (!lipSyncActive) {
                        if (currentModelType === 'vrm' && window.vrmManager && window.vrmManager.vrm) {
                            // VRM 模式
                            console.log('[App] 启动 VRM 口型同步');
                            window.vrmManager.startLipSync(globalAnalyser);
                            lipSyncActive = true;
                        } else if (window.LanLan1 && window.LanLan1.live2dModel) {
                            // Live2D 模式
                            startLipSync(window.LanLan1.live2dModel, globalAnalyser);
                            lipSyncActive = true;
                        } else {
                            console.warn('[App] 无法启动口型同步:', {
                                modelType: currentModelType,
                                hasVRMManager: !!window.vrmManager,
                                hasVRM: !!(window.vrmManager && window.vrmManager.vrm),
                                hasLive2D: !!(window.LanLan1 && window.LanLan1.live2dModel)
                            });
                        }
                    }
                }

                // 精确时间调度
                source.start(nextChunkTime);
                // console.log(`调度chunk在时间: ${nextChunkTime.toFixed(3)}`);

                // 设置结束回调处理lipSync停止
                source.onended = () => {
                    // if (window.LanLan1 && window.LanLan1.live2dModel) {
                    //     stopLipSync(window.LanLan1.live2dModel);
                    // }
                    const index = scheduledSources.indexOf(source);
                    if (index !== -1) {
                        scheduledSources.splice(index, 1);
                    }

                    // 延迟停止口型同步，避免在音频块间隙时停止
                    setTimeout(() => {
                        if (scheduledSources.length === 0 && audioBufferQueue.length === 0) {
                            // 停止口型同步（会根据当前模型类型自动选择Live2D或VRM）
                            stopLipSync(window.LanLan1?.live2dModel);
                            lipSyncActive = false;
                            isPlaying = false; // 新增：所有音频播放完毕，重置isPlaying
                        }
                    }, 200); // 延迟200ms，避免在音频块间隙时误停止
                };

                // // 更新下一个chunk的时间
                nextChunkTime += nextBuffer.duration;

                scheduledSources.push(source);
            } else {
                break;
            }
        }

        // 继续调度循环
        setTimeout(scheduleAudioChunks, 25); // 25ms间隔检查
    }


    async function handleAudioBlob(blob) {
        // 精确打断控制：检查是否应跳过此音频（属于被打断的旧音频）
        if (skipNextAudioBlob) {
            console.log('跳过被打断的音频 blob');
            return;
        }

        const arrayBuffer = await blob.arrayBuffer();
        if (!arrayBuffer || arrayBuffer.byteLength === 0) {
            console.warn('收到空的音频数据，跳过处理');
            return;
        }

        if (!audioPlayerContext) {
            audioPlayerContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        if (audioPlayerContext.state === 'suspended') {
            await audioPlayerContext.resume();
        }

        // 检测是否是 OGG 格式 (魔数 "OggS" = 0x4F 0x67 0x67 0x53)
        const header = new Uint8Array(arrayBuffer, 0, 4);
        const isOgg = header[0] === 0x4F && header[1] === 0x67 && header[2] === 0x67 && header[3] === 0x53;

        let float32Data;
        let sampleRate = 48000;

        if (isOgg) {
            // OGG OPUS 格式，用 WASM 流式解码
            try {
                const result = await decodeOggOpusChunk(new Uint8Array(arrayBuffer));
                if (!result) {
                    // 数据不足，等待更多
                    return;
                }
                float32Data = result.float32Data;
                sampleRate = result.sampleRate;
            } catch (e) {
                console.error('OGG OPUS 解码失败:', e);
                return;
            }
        } else {
            // PCM Int16 格式，直接转换
            const int16Array = new Int16Array(arrayBuffer);
            float32Data = new Float32Array(int16Array.length);
            for (let i = 0; i < int16Array.length; i++) {
                float32Data[i] = int16Array[i] / 32768.0;
            }
        }

        if (!float32Data || float32Data.length === 0) {
            return;
        }

        const audioBuffer = audioPlayerContext.createBuffer(1, float32Data.length, sampleRate);
        audioBuffer.copyToChannel(float32Data, 0);

        const bufferObj = { seq: seqCounter++, buffer: audioBuffer };
        audioBufferQueue.push(bufferObj);

        let i = audioBufferQueue.length - 1;
        while (i > 0 && audioBufferQueue[i].seq < audioBufferQueue[i - 1].seq) {
            [audioBufferQueue[i], audioBufferQueue[i - 1]] =
                [audioBufferQueue[i - 1], audioBufferQueue[i]];
            i--;
        }

        // 如果是第一次，初始化调度
        if (!isPlaying) {
            nextChunkTime = audioPlayerContext.currentTime + 0.1;
            isPlaying = true;
            scheduleAudioChunks(); // 开始调度循环
        } else {
            // 若已经在播放，立即尝试补调度，避免卡住
            setTimeout(() => {
                try {
                    scheduleAudioChunks();
                } catch (e) {
                    // 静默兜底，避免控制台噪声
                }
            }, 0);
        }
    }

    function startScreenVideoStreaming(stream, input_type) {
        const video = document.createElement('video');
        // console.log('Ready for sharing 1')

        video.srcObject = stream;
        video.autoplay = true;
        video.muted = true;
        // console.log('Ready for sharing 2')

        videoTrack = stream.getVideoTracks()[0];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // 定时抓取当前帧并编码为jpeg
        video.play().then(() => {
            // 计算缩放后的尺寸（保持宽高比，限制到720p）
            let targetWidth = video.videoWidth;
            let targetHeight = video.videoHeight;

            if (targetWidth > MAX_SCREENSHOT_WIDTH || targetHeight > MAX_SCREENSHOT_HEIGHT) {
                const widthRatio = MAX_SCREENSHOT_WIDTH / targetWidth;
                const heightRatio = MAX_SCREENSHOT_HEIGHT / targetHeight;
                const scale = Math.min(widthRatio, heightRatio);
                targetWidth = Math.round(targetWidth * scale);
                targetHeight = Math.round(targetHeight * scale);
                console.log(`屏幕共享：原尺寸 ${video.videoWidth}x${video.videoHeight} -> 缩放到 ${targetWidth}x${targetHeight}`);
            }

            canvas.width = targetWidth;
            canvas.height = targetHeight;

            videoSenderInterval = setInterval(() => {
                ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.8); // base64 jpeg

                if (socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({
                        action: 'stream_data',
                        data: dataUrl,
                        input_type: input_type,
                    }));
                }
            }, 1000);
        } // 每1000ms一帧
        )
    }

    function initializeGlobalAnalyser() {
        if (!globalAnalyser && audioPlayerContext) {
            globalAnalyser = audioPlayerContext.createAnalyser();
            globalAnalyser.fftSize = 2048;
            globalAnalyser.connect(audioPlayerContext.destination);
        }
    }

    function startLipSync(model, analyser) {
        // Live2D 模式：使用原有的口型同步逻辑
        const dataArray = new Uint8Array(analyser.fftSize);

        function animate() {
            analyser.getByteTimeDomainData(dataArray);
            // 简单求音量（RMS 或最大振幅）
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                const val = (dataArray[i] - 128) / 128; // 归一化到 -1~1
                sum += val * val;
            }
            const rms = Math.sqrt(sum / dataArray.length);
            // 这里可以调整映射关系
            const mouthOpen = Math.min(1, rms * 8); // 放大到 0~1
            // 通过统一通道设置嘴巴开合，屏蔽 motion 对嘴巴的控制
            if (window.LanLan1 && typeof window.LanLan1.setMouth === 'function') {
                window.LanLan1.setMouth(mouthOpen);
            }

            animationFrameId = requestAnimationFrame(animate);
        }

        animate();
    }

    function stopLipSync(model) {
        const currentModelType = localStorage.getItem('modelType') || 'live2d';
        
        if (currentModelType === 'vrm' && window.vrmManager) {
            // VRM 模式
            window.vrmManager.stopLipSync();
        } else {
            // Live2D 模式：使用原有的停止逻辑
            cancelAnimationFrame(animationFrameId);
            if (window.LanLan1 && typeof window.LanLan1.setMouth === 'function') {
                window.LanLan1.setMouth(0);
            } else if (model && model.internalModel && model.internalModel.coreModel) {
                // 兜底
                try { model.internalModel.coreModel.setParameterValueById("ParamMouthOpenY", 0); } catch (_) {}
            }
        }
    }

    // 隐藏live2d函数
    function hideLive2d() {
        console.log('[App] hideLive2d函数被调用');
        
        // 检查当前模型类型，如果是VRM模式，不隐藏Live2D（因为可能根本没显示）
        const currentModelType = localStorage.getItem('modelType') || 'live2d';
        if (currentModelType === 'vrm') {
            console.log('[App] hideLive2d: 当前为VRM模式，跳过Live2D隐藏逻辑');
            return;
        }
        
        const container = document.getElementById('live2d-container');
        console.log('[App] hideLive2d调用前，容器类列表:', container.classList.toString());

        // 首先清除任何可能干扰动画的强制显示样式
        container.style.removeProperty('visibility');
        container.style.removeProperty('display');
        container.style.removeProperty('opacity');

        // 添加minimized类，触发CSS过渡动画
        container.classList.add('minimized');
        console.log('[App] hideLive2d调用后，容器类列表:', container.classList.toString());

        // 添加一个延迟检查，确保类被正确添加
        setTimeout(() => {
            console.log('[App] 延迟检查容器类列表:', container.classList.toString());
        }, 100);
    }

    // 显示live2d函数
    function showLive2d() {
        console.log('[App] showLive2d函数被调用');
        
        // 检查当前模型类型，如果是VRM模式，不显示Live2D
        const currentModelType = localStorage.getItem('modelType') || 'live2d';
        if (currentModelType === 'vrm') {
            console.log('[App] showLive2d: 当前为VRM模式，跳过Live2D显示逻辑');
            return;
        }
        
        // 检查是否处于"请她离开"状态，如果是则直接返回，不执行显示逻辑
        if (window.live2dManager && window.live2dManager._goodbyeClicked) {
            console.log('[App] showLive2d: 当前处于"请她离开"状态，跳过显示逻辑');
            return;
        }

        const container = document.getElementById('live2d-container');
        console.log('[App] showLive2d调用前，容器类列表:', container.classList.toString());

        // 确保浮动按钮显示（使用 !important 强制显示，覆盖所有其他逻辑）
        const floatingButtons = document.getElementById('live2d-floating-buttons');
        if (floatingButtons) {
            // 直接设置 !important 样式，不先清除（避免被鼠标跟踪逻辑覆盖）
            floatingButtons.style.setProperty('display', 'flex', 'important');
            floatingButtons.style.setProperty('visibility', 'visible', 'important');
            floatingButtons.style.setProperty('opacity', '1', 'important');
        }

        const lockIcon = document.getElementById('live2d-lock-icon');
        if (lockIcon) {
            lockIcon.style.removeProperty('display');
            lockIcon.style.removeProperty('visibility');
            lockIcon.style.removeProperty('opacity');
        }

        // 原生按钮和status栏应该永不出现，保持隐藏状态
        const sidebar = document.getElementById('sidebar');
        const sidebarbox = document.getElementById('sidebarbox');

        if (sidebar) {
            sidebar.style.setProperty('display', 'none', 'important');
            sidebar.style.setProperty('visibility', 'hidden', 'important');
            sidebar.style.setProperty('opacity', '0', 'important');
        }

        if (sidebarbox) {
            sidebarbox.style.setProperty('display', 'none', 'important');
            sidebarbox.style.setProperty('visibility', 'hidden', 'important');
            sidebarbox.style.setProperty('opacity', '0', 'important');
        }

        const sideButtons = document.querySelectorAll('.side-btn');
        sideButtons.forEach(btn => {
            btn.style.setProperty('display', 'none', 'important');
            btn.style.setProperty('visibility', 'hidden', 'important');
            btn.style.setProperty('opacity', '0', 'important');
        });

        const statusElement = document.getElementById('status');
        if (statusElement) {
            statusElement.style.setProperty('display', 'none', 'important');
            statusElement.style.setProperty('visibility', 'hidden', 'important');
            statusElement.style.setProperty('opacity', '0', 'important');
        }

        // 强制显示live2d容器
        container.style.visibility = 'visible';
        container.style.display = 'block';
        container.style.opacity = '1';

        // 强制浏览器重新计算样式，确保过渡效果正常
        void container.offsetWidth;

        // 移除minimized类，触发过渡动画
        container.classList.remove('minimized');

        // 如果容器没有其他类，完全移除class属性以避免显示为class=""
        if (container.classList.length === 0) {
            container.removeAttribute('class');
        }

        console.log('[App] showLive2d调用后，容器类列表:', container.classList.toString());
    }
    window.startScreenSharing = startScreenSharing;
    window.stopScreenSharing = stopScreenSharing;
    window.screen_share = startScreenSharing;

    // ========== 连接浮动按钮到原有功能 ==========

    // 麦克风按钮（toggle模式）
    window.addEventListener('live2d-mic-toggle', async (e) => {
        if (e.detail.active) {
            // 想要开启语音：如果 micButton 已经有 active 类，说明正在处理中或已激活，直接返回
            if (micButton.classList.contains('active')) {
                return;
            }
            // 开始语音
            micButton.click(); // 触发原有的麦克风按钮点击
        } else {
            // 想要关闭语音：允许执行，即使 micButton 有 active 类（因为这是正常的退出操作）
            muteButton.click(); // 触发原有的停止按钮点击
        }
    });

    // 屏幕分享按钮（toggle模式）
    window.addEventListener('live2d-screen-toggle', async (e) => {
        if (e.detail.active) {
            // 开启屏幕分享
            screenButton.click();
        } else {
            // 关闭屏幕分享
            stopButton.click();
        }
    });

    // Agent工具按钮（只展开弹出框，不执行操作）
    window.addEventListener('live2d-agent-click', () => {
        // 不执行任何操作，只是展开弹出框
        console.log('Agent工具按钮被点击，显示弹出框');
    });

    // 睡觉按钮（请她离开）
    window.addEventListener('live2d-goodbye-click', () => {
        console.log('[App] 请她离开按钮被点击，开始隐藏所有按钮');
        console.log('[App] 当前 goodbyeClicked 状态:', window.live2dManager ? window.live2dManager._goodbyeClicked : 'undefined');

        // 第一步：立即设置标志位，防止任何后续逻辑显示按钮
        if (window.live2dManager) {
            window.live2dManager._goodbyeClicked = true;
        }
        console.log('[App] 设置 goodbyeClicked 为 true，当前状态:', window.live2dManager ? window.live2dManager._goodbyeClicked : 'undefined');

        // 【修复】立即关闭所有弹窗，防止遗留的弹窗区域阻塞鼠标事件
        // 这里直接操作 DOM，不使用动画延迟，确保弹窗立即完全隐藏
        const allPopups = document.querySelectorAll('[id^="live2d-popup-"]');
        allPopups.forEach(popup => {
            popup.style.setProperty('display', 'none', 'important');
            popup.style.setProperty('visibility', 'hidden', 'important');
            popup.style.setProperty('opacity', '0', 'important');
            popup.style.setProperty('pointer-events', 'none', 'important');
        });
        // 同时清除所有弹窗定时器
        if (window.live2dManager && window.live2dManager._popupTimers) {
            Object.values(window.live2dManager._popupTimers).forEach(timer => {
                if (timer) clearTimeout(timer);
            });
            window.live2dManager._popupTimers = {};
        }
        console.log('[App] 已关闭所有弹窗，数量:', allPopups.length);

        // 【改进】使用统一的状态管理方法重置所有浮动按钮
        if (window.live2dManager && typeof window.live2dManager.resetAllButtons === 'function') {
            window.live2dManager.resetAllButtons();
        }

        // 【改进】使用统一的 setLocked 方法设置锁定状态（同时更新图标和 canvas）
        if (window.live2dManager && typeof window.live2dManager.setLocked === 'function') {
            window.live2dManager.setLocked(true, { updateFloatingButtons: false });
        }

        // 【修复】隐藏 Live2D canvas，使 Electron 的 alpha 检测认为该区域完全透明
        // 仅设置 pointer-events: none 不够，因为 Electron 根据像素 alpha 值来决定事件转发
        // 必须设置 visibility: hidden 来确保 canvas 不渲染任何像素
        const live2dCanvas = document.getElementById('live2d-canvas');
        if (live2dCanvas) {
            live2dCanvas.style.setProperty('visibility', 'hidden', 'important');
            live2dCanvas.style.setProperty('pointer-events', 'none', 'important');
            console.log('[App] 已隐藏 live2d-canvas（visibility: hidden），Electron 将认为该区域透明');
        }

        // 在隐藏 DOM 之前先读取 "请她离开" 按钮的位置（避免隐藏后 getBoundingClientRect 返回异常）
        const goodbyeButton = document.getElementById('live2d-btn-goodbye');
        let savedGoodbyeRect = null;
        if (goodbyeButton) {
            try {
                savedGoodbyeRect = goodbyeButton.getBoundingClientRect();
            } catch (e) {
                savedGoodbyeRect = null;
            }
        }

        // 第二步：立即隐藏所有浮动按钮和锁按钮（设置为 !important 防止其他代码覆盖）
        const floatingButtons = document.getElementById('live2d-floating-buttons');
        if (floatingButtons) {
            floatingButtons.style.setProperty('display', 'none', 'important');
            floatingButtons.style.setProperty('visibility', 'hidden', 'important');
            floatingButtons.style.setProperty('opacity', '0', 'important');
        }

        const lockIcon = document.getElementById('live2d-lock-icon');
        if (lockIcon) {
            lockIcon.style.setProperty('display', 'none', 'important');
            lockIcon.style.setProperty('visibility', 'hidden', 'important');
            lockIcon.style.setProperty('opacity', '0', 'important');
        }

        // 第三步：显示独立的"请她回来"按钮（显示在原来"请她离开"按钮的位置）
        const returnButtonContainer = document.getElementById('live2d-return-button-container');
        if (returnButtonContainer) {
            // 如果我们之前成功读取到原按钮的位置，就基于该矩形进行居中定位
            if (savedGoodbyeRect) {
                // 获取返回容器尺寸，兼容尚未加入DOM或display:none的情况
                const containerWidth = returnButtonContainer.offsetWidth || 64;
                const containerHeight = returnButtonContainer.offsetHeight || 64;

                // 将返回按钮居中放在原按钮位置
                const left = Math.round(savedGoodbyeRect.left + (savedGoodbyeRect.width - containerWidth) / 2 + window.scrollX);
                const top = Math.round(savedGoodbyeRect.top + (savedGoodbyeRect.height - containerHeight) / 2 + window.scrollY);

                returnButtonContainer.style.left = `${Math.max(0, Math.min(left, window.innerWidth - containerWidth))}px`;
                returnButtonContainer.style.top = `${Math.max(0, Math.min(top, window.innerHeight - containerHeight))}px`;
                returnButtonContainer.style.transform = 'none'; // 移除居中transform
            } else {
                // 回退：如果无法读取原按钮位置，则将返回按钮放在右下角上方的预设位置
                const fallbackRight = 16;
                const fallbackBottom = 116;
                returnButtonContainer.style.right = `${fallbackRight}px`;
                returnButtonContainer.style.bottom = `${fallbackBottom}px`;
                // 清除 left/top/transform 以避免冲突
                returnButtonContainer.style.left = '';
                returnButtonContainer.style.top = '';
                returnButtonContainer.style.transform = 'none';
            }

            returnButtonContainer.style.display = 'flex';
            returnButtonContainer.style.pointerEvents = 'auto';
        }

        // 第四步：立即隐藏所有 side-btn 按钮和侧边栏
        const sidebar = document.getElementById('sidebar');
        const sidebarbox = document.getElementById('sidebarbox');

        if (sidebar) {
            sidebar.style.setProperty('display', 'none', 'important');
            sidebar.style.setProperty('visibility', 'hidden', 'important');
            sidebar.style.setProperty('opacity', '0', 'important');
        }

        if (sidebarbox) {
            sidebarbox.style.setProperty('display', 'none', 'important');
            sidebarbox.style.setProperty('visibility', 'hidden', 'important');
            sidebarbox.style.setProperty('opacity', '0', 'important');
        }

        const sideButtons = document.querySelectorAll('.side-btn');
        sideButtons.forEach(btn => {
            btn.style.setProperty('display', 'none', 'important');
            btn.style.setProperty('visibility', 'hidden', 'important');
            btn.style.setProperty('opacity', '0', 'important');
        });

        // 第五步：自动折叠对话区
        const chatContainerEl = document.getElementById('chat-container');
        const toggleChatBtn = document.getElementById('toggle-chat-btn');
        if (chatContainerEl && !chatContainerEl.classList.contains('minimized')) {
            // 如果对话区当前是展开的，模拟点击折叠按钮
            if (toggleChatBtn) {
                toggleChatBtn.click();
            }
        }

        // 第六步：触发原有的离开逻辑（关闭会话并让live2d消失）
        if (resetSessionButton) {
            // 延迟一点点执行，确保隐藏操作已经生效
            setTimeout(() => {
                console.log('[App] 触发 resetSessionButton.click()，当前 goodbyeClicked 状态:', window.live2dManager ? window.live2dManager._goodbyeClicked : 'undefined');
                resetSessionButton.click();
            }, 10);
        } else {
            console.error('[App] ❌ resetSessionButton 未找到！');
        }
    });

    // 请她回来按钮
    window.addEventListener('live2d-return-click', () => {
        console.log('[App] 请她回来按钮被点击，开始恢复所有界面');

        // 第一步：同步 window 中的设置值到局部变量（防止从 l2d 页面返回时值丢失）
        if (typeof window.focusModeEnabled !== 'undefined') {
            focusModeEnabled = window.focusModeEnabled;
            console.log('[App] 同步 focusModeEnabled:', focusModeEnabled);
        }
        if (typeof window.proactiveChatEnabled !== 'undefined') {
            proactiveChatEnabled = window.proactiveChatEnabled;
            console.log('[App] 同步 proactiveChatEnabled:', proactiveChatEnabled);
        }

        // 第二步：清除"请她离开"标志
        if (window.live2dManager) {
            window.live2dManager._goodbyeClicked = false;
        }
        if (window.live2d) {
            window.live2d._goodbyeClicked = false;
        }

        // 第三步：隐藏独立的"请她回来"按钮
        const returnButtonContainer = document.getElementById('live2d-return-button-container');
        if (returnButtonContainer) {
            returnButtonContainer.style.display = 'none';
            returnButtonContainer.style.pointerEvents = 'none';
        }

        // 第四步：恢复live2d容器（移除minimized类）
        const live2dContainer = document.getElementById('live2d-container');
        if (live2dContainer) {
            console.log('[App] 移除minimized类前，容器类列表:', live2dContainer.classList.toString());
            live2dContainer.classList.remove('minimized');

            // 如果容器没有其他类，完全移除class属性以避免显示为class=""
            if (live2dContainer.classList.length === 0) {
                live2dContainer.removeAttribute('class');
            }

            console.log('[App] 移除minimized类后，容器类列表:', live2dContainer.classList.toString());
            live2dContainer.style.removeProperty('display');
            live2dContainer.style.removeProperty('visibility');
            live2dContainer.style.removeProperty('opacity');
        }

        // 【修复】恢复 Live2D canvas 的可见性和鼠标事件
        const live2dCanvas = document.getElementById('live2d-canvas');
        if (live2dCanvas) {
            // 恢复 visibility，使 Electron 能够检测到 canvas 像素
            live2dCanvas.style.removeProperty('visibility');
            live2dCanvas.style.visibility = 'visible';

            // 根据当前锁定状态恢复 pointerEvents
            const isLocked = window.live2dManager ? window.live2dManager.isLocked : true;
            live2dCanvas.style.removeProperty('pointer-events');
            live2dCanvas.style.pointerEvents = isLocked ? 'none' : 'auto';
            console.log('[App] 已恢复 live2d-canvas 的可见性和鼠标事件，isLocked:', isLocked);
        }

        // 第五步：恢复锁按钮，并设置为解锁状态（用户可以拖动模型）
        const lockIcon = document.getElementById('live2d-lock-icon');
        if (lockIcon) {
            lockIcon.style.display = 'block';
            lockIcon.style.removeProperty('visibility');
            lockIcon.style.removeProperty('opacity');
        }
        // 【改进】使用统一的 setLocked 方法设置解锁状态（同时更新图标和 canvas）
        if (window.live2dManager && typeof window.live2dManager.setLocked === 'function') {
            window.live2dManager.setLocked(false, { updateFloatingButtons: false });
        }

        // 第六步：恢复浮动按钮系统（使用 !important 强制显示，覆盖之前的隐藏样式）
        const floatingButtons = document.getElementById('live2d-floating-buttons');
        if (floatingButtons) {
            // 先清除所有可能的隐藏样式
            floatingButtons.style.removeProperty('display');
            floatingButtons.style.removeProperty('visibility');
            floatingButtons.style.removeProperty('opacity');

            // 使用 !important 强制显示，确保覆盖之前的隐藏样式
            floatingButtons.style.setProperty('display', 'flex', 'important');
            floatingButtons.style.setProperty('visibility', 'visible', 'important');
            floatingButtons.style.setProperty('opacity', '1', 'important');

            // 恢复所有按钮的显示状态（清除之前"请她离开"时设置的 display: 'none'）
            if (window.live2dManager && window.live2dManager._floatingButtons) {
                Object.keys(window.live2dManager._floatingButtons).forEach(btnId => {
                    const buttonData = window.live2dManager._floatingButtons[btnId];
                    if (buttonData && buttonData.button) {
                        // 清除 display 样式，让按钮正常显示
                        buttonData.button.style.removeProperty('display');
                    }
                });
            }

            // 【修复】恢复所有弹窗的交互能力（清除"请她离开"时设置的 pointer-events: none 等样式）
            const allPopups = document.querySelectorAll('[id^="live2d-popup-"]');
            allPopups.forEach(popup => {
                // 清除之前设置的 !important 样式
                popup.style.removeProperty('pointer-events');
                popup.style.removeProperty('visibility');
                // 恢复正常的 pointer-events，弹窗应当能够接收鼠标事件
                popup.style.pointerEvents = 'auto';
                // display 和 opacity 保持隐藏状态，等待用户点击按钮时再显示
            });
            console.log('[App] 已恢复所有弹窗的交互能力，数量:', allPopups.length);
        }

        // 第七步：恢复对话区
        const chatContainerEl = document.getElementById('chat-container');
        const toggleChatBtn = document.getElementById('toggle-chat-btn');
        if (chatContainerEl && chatContainerEl.classList.contains('minimized')) {
            // 如果对话区当前是折叠的，模拟点击展开按钮
            if (toggleChatBtn) {
                toggleChatBtn.click();
            }
        }

        // 第八步：恢复基本的按钮状态（但不自动开始新会话）
        // 注意：不再触发 returnSessionButton.click()，因为那会自动发送 start_session 消息
        // 用户只是想让形象回来，不需要自动开始语音或文本对话

        // 设置模式切换标志
        isSwitchingMode = true;

        // 清除所有语音相关的状态类（确保按钮不会显示为激活状态）
        micButton.classList.remove('recording');
        micButton.classList.remove('active');
        screenButton.classList.remove('active');

        // 确保停止录音状态
        isRecording = false;
        window.isRecording = false;

        // 同步更新Live2D浮动按钮的状态
        if (window.live2dManager && window.live2dManager._floatingButtons) {
            ['mic', 'screen'].forEach(buttonId => {
                const buttonData = window.live2dManager._floatingButtons[buttonId];
                if (buttonData && buttonData.button) {
                    buttonData.button.dataset.active = 'false';
                    if (buttonData.imgOff) {
                        buttonData.imgOff.style.opacity = '1';
                    }
                    if (buttonData.imgOn) {
                        buttonData.imgOn.style.opacity = '0';
                    }
                }
            });
        }

        // 启用所有基本输入按钮
        micButton.disabled = false;
        textSendButton.disabled = false;
        textInputBox.disabled = false;
        screenshotButton.disabled = false;
        resetSessionButton.disabled = false;

        // 禁用语音控制按钮（文本模式下不需要）
        muteButton.disabled = true;
        screenButton.disabled = true;
        stopButton.disabled = true;

        // 显示文本输入区
        const textInputArea = document.getElementById('text-input-area');
        if (textInputArea) {
            textInputArea.classList.remove('hidden');
        }

        // 标记文本会话为非活跃状态（用户需要手动发送消息才会开始会话）
        isTextSessionActive = false;

        // 显示欢迎消息，提示用户可以开始对话
        showStatusToast(window.t ? window.t('app.welcomeBack', { name: lanlan_config.lanlan_name }) : `🫴 ${lanlan_config.lanlan_name}回来了！`, 3000);

        // 恢复主动搭话与主动视觉调度（即使不自动开启会话）
        try {
            const currentProactiveChat = typeof window.proactiveChatEnabled !== 'undefined'
                ? window.proactiveChatEnabled
                : proactiveChatEnabled;
            const currentProactiveVision = typeof window.proactiveVisionEnabled !== 'undefined'
                ? window.proactiveVisionEnabled
                : proactiveVisionEnabled;

            if (currentProactiveChat || currentProactiveVision) {
                // 重置退避并安排下一次（scheduleProactiveChat 会检查 isRecording）
                resetProactiveChatBackoff();
            }
        } catch (e) {
            console.warn('恢复主动搭话/主动视觉失败:', e);
        }

        // 延迟重置模式切换标志
        setTimeout(() => {
            isSwitchingMode = false;
        }, 500);

        console.log('[App] 请她回来完成，未自动开始会话，等待用户主动发起对话');
    });

    // ========== Agent控制逻辑 ==========

    // ===== Agent弹窗状态机 =====
    // 状态定义：
    // - IDLE: 空闲状态，弹窗未打开
    // - CHECKING: 正在检查服务器状态（弹窗刚打开或用户操作后）
    // - ONLINE: 服务器在线，可交互
    // - OFFLINE: 服务器离线
    // - PROCESSING: 正在处理用户操作（开关切换中）
    const AgentPopupState = {
        IDLE: 'IDLE',
        CHECKING: 'CHECKING',
        ONLINE: 'ONLINE',
        OFFLINE: 'OFFLINE',
        PROCESSING: 'PROCESSING'
    };

    // 状态机实例
    const agentStateMachine = {
        _state: AgentPopupState.IDLE,
        _operationSeq: 0,           // 操作序列号，用于取消过期操作
        _checkSeq: 0,               // 检查序列号，用于防止轮询竞态
        _lastCheckTime: 0,          // 上次检查时间
        _cachedServerOnline: null,  // 缓存服务器在线状态
        _cachedFlags: null,         // 缓存的flags状态
        _popupOpen: false,          // 弹窗是否打开
        _checkLock: false,          // 防止并发检查

        // 最小检查间隔（毫秒）- 严格限制请求频率
        MIN_CHECK_INTERVAL: 3000,

        // 获取当前状态
        getState() { return this._state; },

        // 获取新的操作序列号
        nextSeq() { return ++this._operationSeq; },

        // 检查操作是否过期
        isSeqExpired(seq) { return seq !== this._operationSeq; },

        // 获取新的检查序列号
        nextCheckSeq() { return ++this._checkSeq; },

        // 获取当前检查序列号
        getCheckSeq() { return this._checkSeq; },

        // 检查检查序列号是否过期
        isCheckSeqExpired(seq) { return seq !== this._checkSeq; },

        // 状态转换（带日志）
        transition(newState, reason) {
            const oldState = this._state;
            if (oldState === newState) return;
            this._state = newState;
            console.log(`[AgentStateMachine] ${oldState} -> ${newState} (${reason})`);
            this._updateUI();
        },

        // 标记弹窗打开
        openPopup() {
            this._popupOpen = true;
            // 弹窗打开时从IDLE转为CHECKING
            if (this._state === AgentPopupState.IDLE) {
                this.transition(AgentPopupState.CHECKING, 'popup opened');
            }
        },

        // 标记弹窗关闭
        closePopup() {
            this._popupOpen = false;
            // 弹窗关闭时，如果不在处理中且总开关未开启，回到IDLE
            const masterCheckbox = document.getElementById('live2d-agent-master');
            if (this._state !== AgentPopupState.PROCESSING && (!masterCheckbox || !masterCheckbox.checked)) {
                this.transition(AgentPopupState.IDLE, 'popup closed');
                window.stopAgentAvailabilityCheck();
            }
        },

        // 开始用户操作
        startOperation() {
            this.transition(AgentPopupState.PROCESSING, 'user operation started');
            return this.nextSeq();
        },

        // 结束用户操作
        endOperation(success, serverOnline = true) {
            if (this._state !== AgentPopupState.PROCESSING) return;
            if (serverOnline) {
                this.transition(AgentPopupState.ONLINE, success ? 'operation success' : 'operation failed');
            } else {
                this.transition(AgentPopupState.OFFLINE, 'server offline');
            }
        },

        // 检查是否可以发起请求（节流）
        canCheck() {
            if (this._checkLock) return false;
            const now = Date.now();
            return (now - this._lastCheckTime) >= this.MIN_CHECK_INTERVAL;
        },

        // 记录检查时间并加锁
        recordCheck() {
            this._checkLock = true;
            this._lastCheckTime = Date.now();
        },

        // 释放检查锁
        releaseCheckLock() {
            this._checkLock = false;
        },

        // 更新缓存
        updateCache(serverOnline, flags) {
            this._cachedServerOnline = serverOnline;
            if (flags) this._cachedFlags = flags;
        },

        // 根据状态更新所有按钮UI
        _updateUI() {
            const master = document.getElementById('live2d-agent-master');
            const keyboard = document.getElementById('live2d-agent-keyboard');
            const mcp = document.getElementById('live2d-agent-mcp');
            const userPlugin = document.getElementById('live2d-agent-user-plugin');
            const status = document.getElementById('live2d-agent-status');

            const syncUI = (cb) => {
                if (cb && typeof cb._updateStyle === 'function') cb._updateStyle();
            };

            switch (this._state) {
                case AgentPopupState.IDLE:
                    // 空闲：所有按钮禁用
                    if (master) { master.disabled = true; master.title = ''; syncUI(master); }
                    if (keyboard) { keyboard.disabled = true; keyboard.checked = false; keyboard.title = ''; syncUI(keyboard); }
                    if (mcp) { mcp.disabled = true; mcp.checked = false; mcp.title = ''; syncUI(mcp); }
                    if (userPlugin) { userPlugin.disabled = true; userPlugin.checked = false; userPlugin.title = ''; syncUI(userPlugin); }
                    break;

                case AgentPopupState.CHECKING:
                    // 检查中：所有按钮禁用，显示查询中
                    if (master) {
                        master.disabled = true;
                        master.title = window.t ? window.t('settings.toggles.checking') : '查询中...';
                        syncUI(master);
                    }
                    if (keyboard) {
                        keyboard.disabled = true;
                        keyboard.title = window.t ? window.t('settings.toggles.checking') : '查询中...';
                        syncUI(keyboard);
                    }
                    if (mcp) {
                        mcp.disabled = true;
                        mcp.title = window.t ? window.t('settings.toggles.checking') : '查询中...';
                        syncUI(mcp);
                    }
                    if (userPlugin) {
                        userPlugin.disabled = true;
                        userPlugin.title = window.t ? window.t('settings.toggles.checking') : '查询中...';
                        syncUI(userPlugin);
                    }
                    if (status) status.textContent = window.t ? window.t('agent.status.connecting') : 'Agent服务器连接中...';
                    break;

                case AgentPopupState.ONLINE:
                    // 在线：总开关可用，子开关根据总开关和能力可用性决定
                    if (master) {
                        master.disabled = false;
                        master.title = window.t ? window.t('settings.toggles.agentMaster') : 'Agent总开关';
                        syncUI(master);
                    }
                    // 子开关状态由专门的函数更新
                    break;

                case AgentPopupState.OFFLINE:
                    // 离线：总开关禁用并取消选中，子开关禁用
                    if (master) {
                        master.disabled = true;
                        master.checked = false;
                        master.title = window.t ? window.t('settings.toggles.serverOffline') : 'Agent服务器未启动';
                        syncUI(master);
                    }
                    if (keyboard) { keyboard.disabled = true; keyboard.checked = false; syncUI(keyboard); }
                    if (mcp) { mcp.disabled = true; mcp.checked = false; syncUI(mcp); }
                    if (status) status.textContent = window.t ? window.t('settings.toggles.serverOffline') : 'Agent服务器未启动';
                    if (userPlugin) { userPlugin.disabled = true; userPlugin.checked = false; syncUI(userPlugin); }
                    break;

                case AgentPopupState.PROCESSING:
                    // 处理中：所有按钮禁用，防止重复操作
                    if (master) { master.disabled = true; syncUI(master); }
                    if (keyboard) { keyboard.disabled = true; syncUI(keyboard); }
                    if (mcp) { mcp.disabled = true; syncUI(mcp); }
                    if (userPlugin) { userPlugin.disabled = true; syncUI(userPlugin); }
                    break;
            }
        }
    };

    // 暴露状态机给外部使用
    window.agentStateMachine = agentStateMachine;

    // Agent 定时检查器（暴露到 window 供 live2d-ui-hud.js 调用）
    let agentCheckInterval = null;
    let lastFlagsSyncTime = 0;
    const FLAGS_SYNC_INTERVAL = 3000; // 3秒同步一次后端flags状态
    let connectionFailureCount = 0; // 连接失败计数

    // 【改用状态机】追踪 Agent 弹窗是否打开
    let isAgentPopupOpen = false;

    // 检查 Agent 能力（供轮询使用）- 使用状态机控制
    const checkAgentCapabilities = async () => {
        const agentMasterCheckbox = document.getElementById('live2d-agent-master');
        const agentKeyboardCheckbox = document.getElementById('live2d-agent-keyboard');
        const agentMcpCheckbox = document.getElementById('live2d-agent-mcp');
        const agentUserPluginCheckbox = document.getElementById('live2d-agent-user-plugin');

        // 【状态机控制】如果正在处理用户操作，跳过轮询
        if (agentStateMachine.getState() === AgentPopupState.PROCESSING) {
            console.log('[App] 状态机处于PROCESSING状态，跳过轮询');
            return;
        }

        // 【改进1】只有当总开关关闭 且 弹窗未打开时，才停止轮询
        if (!agentMasterCheckbox || (!agentMasterCheckbox.checked && !agentStateMachine._popupOpen)) {
            console.log('[App] Agent总开关未开启且弹窗已关闭，停止可用性轮询');
            window.stopAgentAvailabilityCheck();
            return;
        }

        // 【改进2】如果总开关未开启，跳过能力检查和flags同步，只在需要时进行连通性检查
        if (!agentMasterCheckbox.checked) {
            // 弹窗打开但总开关未开启时，使用状态机缓存判断，减少请求
            if (!agentStateMachine.canCheck()) {
                // 使用缓存状态通过状态机统一更新UI
                if (agentStateMachine._cachedServerOnline === true) {
                    agentStateMachine.transition(AgentPopupState.ONLINE, 'cached online');
                } else if (agentStateMachine._cachedServerOnline === false) {
                    agentStateMachine.transition(AgentPopupState.OFFLINE, 'cached offline');
                }
                return;
            }

            // 执行连通性检查
            agentStateMachine.recordCheck();
            try {
                const healthOk = await checkToolServerHealth();
                agentStateMachine.updateCache(healthOk, null);

                // 【竞态保护】检查完成后，如果弹窗已关闭，跳过UI更新
                if (!agentStateMachine._popupOpen) {
                    console.log('[App] 轮询检查完成但弹窗已关闭，跳过UI更新');
                    return;
                }

                // 通过状态机统一更新UI
                if (healthOk) {
                    const wasOffline = agentStateMachine.getState() !== AgentPopupState.ONLINE;
                    agentStateMachine.transition(AgentPopupState.ONLINE, 'server online');
                    if (wasOffline) {
                        setFloatingAgentStatus(window.t ? window.t('agent.status.ready') : 'Agent服务器就绪');
                    }
                    // 连接恢复，重置失败计数
                    connectionFailureCount = 0;
                } else {
                    setFloatingAgentStatus(window.t ? window.t('settings.toggles.serverOffline') : 'Agent服务器未启动');
                    agentStateMachine.transition(AgentPopupState.OFFLINE, 'server offline');
                }
            } catch (e) {
                agentStateMachine.updateCache(false, null);
                // 【竞态保护】弹窗已关闭时不更新UI，通过状态机统一更新
                if (agentStateMachine._popupOpen) {
                    agentStateMachine.transition(AgentPopupState.OFFLINE, 'check failed');
                }
            } finally {
                // 确保释放检查锁
                agentStateMachine.releaseCheckLock();
            }
            return;
        }

        // 存储能力检查结果，用于后续 flags 同步时的判断
        const capabilityResults = {};
        let capabilityCheckFailed = false;

        // 【减少能力检查频率】只在必要时检查子功能可用性
        const checks = [
            { id: 'live2d-agent-keyboard', capability: 'computer_use', flagKey: 'computer_use_enabled', nameKey: 'keyboardControl' },
            { id: 'live2d-agent-mcp', capability: 'mcp', flagKey: 'mcp_enabled', nameKey: 'mcpTools' },
            { id: 'live2d-agent-user-plugin', capability: 'user_plugin', flagKey: 'user_plugin_enabled', nameKey: 'userPlugin' }
        ];
        for (const { id, capability, flagKey, nameKey } of checks) {
            const cb = document.getElementById(id);
            if (!cb) continue;

            const name = window.t ? window.t(`settings.toggles.${nameKey}`) : nameKey;

            // 如果在处理中，跳过
            if (cb._processing) continue;

            // 再次检查总开关
            if (!agentMasterCheckbox.checked) {
                cb.disabled = true;
                if (typeof cb._updateStyle === 'function') cb._updateStyle();
                continue;
            }

            try {
                const available = await checkCapability(capability, false);
                capabilityResults[flagKey] = available;

                // 检查完成后再次确认总开关仍然开启
                if (!agentMasterCheckbox.checked) {
                    cb.disabled = true;
                    if (typeof cb._updateStyle === 'function') cb._updateStyle();
                    continue;
                }

                cb.disabled = !available;
                cb.title = available ? name : (window.t ? window.t('settings.toggles.unavailable', { name: name }) : `${name}不可用`);
                if (typeof cb._updateStyle === 'function') cb._updateStyle();

                // 如果不可用但开关是开的，需要关闭它并通知后端
                if (!available && cb.checked) {
                    console.log(`[App] ${name}变为不可用，自动关闭`);
                    cb.checked = false;
                    cb._autoDisabled = true;
                    cb.dispatchEvent(new Event('change', { bubbles: true }));
                    cb._autoDisabled = false;
                    try {
                        await fetch('/api/agent/flags', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                lanlan_name: lanlan_config.lanlan_name,
                                flags: { [flagKey]: false }
                            })
                        });
                    } catch (e) {
                        console.warn(`[App] 通知后端关闭${name}失败:`, e);
                    }
                    setFloatingAgentStatus(`${name}已断开`);
                }
            } catch (e) {
                capabilityCheckFailed = true;
                console.warn(`[App] 检查${name}能力失败:`, e);
            }
        }

        // 如果能力检查因网络问题失败，增加失败计数
        if (capabilityCheckFailed) {
            connectionFailureCount++;
        }

        // 【严格节流】定期从后端同步 flags 状态
        // 【修复竞态】将 flag 同步移到能力检查之后，并结合能力检查结果
        const now = Date.now();
        if (now - lastFlagsSyncTime >= FLAGS_SYNC_INTERVAL) {
            lastFlagsSyncTime = now;
            try {
                const resp = await fetch('/api/agent/flags');
                if (resp.ok) {
                    // 连接成功，重置失败计数
                    connectionFailureCount = 0;

                    const data = await resp.json();
                    if (data.success) {
                        const analyzerEnabled = data.analyzer_enabled || false;
                        const flags = data.agent_flags || {};
                        // 处理后端推送的通知（如果有）
                        const notification = data.notification;
                        if (notification) {
                            console.log('[App] 收到后端通知:', notification);
                            setFloatingAgentStatus(notification);
                            // 如果是错误通知，也可以考虑弹窗
                            if (notification.includes('失败') || notification.includes('断开') || notification.includes('错误')) {
                                showStatusToast(notification, 3000);
                            }
                        }

                        agentStateMachine.updateCache(true, flags);

                        // 如果后端 analyzer 被关闭，同步关闭前端总开关
                        if (!analyzerEnabled && agentMasterCheckbox.checked && !agentMasterCheckbox._processing) {
                            console.log('[App] 后端 analyzer 已关闭，同步关闭前端总开关');
                            agentMasterCheckbox.checked = false;
                            agentMasterCheckbox._autoDisabled = true;
                            agentMasterCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
                            agentMasterCheckbox._autoDisabled = false;
                            if (typeof agentMasterCheckbox._updateStyle === 'function') agentMasterCheckbox._updateStyle();
                            [agentKeyboardCheckbox, agentMcpCheckbox, agentUserPluginCheckbox].forEach(cb => {
                                if (cb) {
                                    cb.checked = false;
                                    cb.disabled = true;
                                    if (typeof cb._updateStyle === 'function') cb._updateStyle();
                                }
                            });
                            // 如果有特定通知则显示，否则显示默认关闭消息
                            if (!notification) {
                                setFloatingAgentStatus(window.t ? window.t('agent.status.disabled') : 'Agent模式已关闭');
                            }

                            if (!agentStateMachine._popupOpen) {
                                window.stopAgentAvailabilityCheck();
                            }
                            window.stopAgentTaskPolling();
                            return;
                        }

                        // 同步子开关的 checked 状态（如果后端状态与前端不一致且不在处理中）
                        // 【修复竞态】只有当功能实际可用时，才允许根据 flag 自动开启
                        if (agentKeyboardCheckbox && !agentKeyboardCheckbox._processing) {
                            const flagEnabled = flags.computer_use_enabled || false;
                            // 如果未检查(undefined)或可用(true)则允许，但此处已确保检查过
                            // 注意：如果 capabilityCheckFailed 为 true，capabilityResults 可能不完整，保守起见不改变状态
                            const isAvailable = capabilityCheckFailed ? agentKeyboardCheckbox.checked : (capabilityResults['computer_use_enabled'] !== false);
                            const shouldBeChecked = flagEnabled && isAvailable;

                            if (agentKeyboardCheckbox.checked !== shouldBeChecked) {
                                // 只在确实需要改变状态时操作
                                if (shouldBeChecked) {
                                    // 开启
                                    agentKeyboardCheckbox.checked = true;
                                    agentKeyboardCheckbox._autoDisabled = true;
                                    agentKeyboardCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
                                    agentKeyboardCheckbox._autoDisabled = false;
                                    if (typeof agentKeyboardCheckbox._updateStyle === 'function') agentKeyboardCheckbox._updateStyle();
                                } else if (!flagEnabled) {
                                    // 仅当 flag 明确为 false 时才关闭（flag=true但unavailable的情况已在能力检查循环中处理）
                                    agentKeyboardCheckbox.checked = false;
                                    agentKeyboardCheckbox._autoDisabled = true;
                                    agentKeyboardCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
                                    agentKeyboardCheckbox._autoDisabled = false;
                                    if (typeof agentKeyboardCheckbox._updateStyle === 'function') agentKeyboardCheckbox._updateStyle();
                                }
                            }
                        }

                        if (agentMcpCheckbox && !agentMcpCheckbox._processing) {
                            const flagEnabled = flags.mcp_enabled || false;
                            const isAvailable = capabilityCheckFailed ? agentMcpCheckbox.checked : (capabilityResults['mcp_enabled'] !== false);
                            const shouldBeChecked = flagEnabled && isAvailable;

                            if (agentMcpCheckbox.checked !== shouldBeChecked) {
                                if (shouldBeChecked) {
                                    agentMcpCheckbox.checked = true;
                                    agentMcpCheckbox._autoDisabled = true;
                                    agentMcpCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
                                    agentMcpCheckbox._autoDisabled = false;
                                    if (typeof agentMcpCheckbox._updateStyle === 'function') agentMcpCheckbox._updateStyle();
                                } else if (!flagEnabled) {
                                    agentMcpCheckbox.checked = false;
                                    agentMcpCheckbox._autoDisabled = true;
                                    agentMcpCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
                                    agentMcpCheckbox._autoDisabled = false;
                                    if (typeof agentMcpCheckbox._updateStyle === 'function') agentMcpCheckbox._updateStyle();
                                }
                            }
                        }

                        // 用户插件 flag 同步独立处理，避免依赖 MCP 分支
                        if (agentUserPluginCheckbox && !agentUserPluginCheckbox._processing) {
                            const flagEnabled = flags.user_plugin_enabled || false;
                            const isAvailable = capabilityCheckFailed
                                ? agentUserPluginCheckbox.checked
                                : (capabilityResults['user_plugin_enabled'] !== false);
                            const shouldBeChecked = flagEnabled && isAvailable;

                            if (agentUserPluginCheckbox.checked !== shouldBeChecked) {
                                if (shouldBeChecked) {
                                    agentUserPluginCheckbox.checked = true;
                                    agentUserPluginCheckbox._autoDisabled = true;
                                    agentUserPluginCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
                                    agentUserPluginCheckbox._autoDisabled = false;
                                    if (typeof agentUserPluginCheckbox._updateStyle === 'function') agentUserPluginCheckbox._updateStyle();
                                } else if (!flagEnabled) {
                                    agentUserPluginCheckbox.checked = false;
                                    agentUserPluginCheckbox._autoDisabled = true;
                                    agentUserPluginCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
                                    agentUserPluginCheckbox._autoDisabled = false;
                                    if (typeof agentUserPluginCheckbox._updateStyle === 'function') agentUserPluginCheckbox._updateStyle();
                                }
                            }
                        }
                    }
                } else {
                    // 响应不OK，视为连接失败
                    throw new Error(`Status ${resp.status}`);
                }
            } catch (e) {
                console.warn('[App] 轮询同步 flags 失败:', e);
                connectionFailureCount++;
            }
        }

        // 如果连续多次连接失败，判定为服务器失联，主动关闭总开关
        if (connectionFailureCount >= 3) {
            console.error('[App] Agent服务器连续连接失败，判定为失联，自动关闭');
            if (agentMasterCheckbox.checked && !agentMasterCheckbox._processing) {
                agentMasterCheckbox.checked = false;
                agentMasterCheckbox._autoDisabled = true;
                agentMasterCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
                agentMasterCheckbox._autoDisabled = false;
                if (typeof agentMasterCheckbox._updateStyle === 'function') agentMasterCheckbox._updateStyle();

                [agentKeyboardCheckbox, agentMcpCheckbox, agentUserPluginCheckbox].forEach(cb => {
                    if (cb) {
                        cb.checked = false;
                        cb.disabled = true;
                        if (typeof cb._updateStyle === 'function') cb._updateStyle();
                    }
                });

                setFloatingAgentStatus(window.t ? window.t('agent.status.disconnected') : '服务器连接已断开');
                showStatusToast(window.t ? window.t('agent.status.agentDisconnected') : 'Agent 服务器连接已断开', 3000);

                agentStateMachine.transition(AgentPopupState.OFFLINE, 'connection lost');
                window.stopAgentTaskPolling();

                // 重置计数，避免重复触发
                connectionFailureCount = 0;
            }
        }
    };

    // 启动 Agent 可用性定时检查（由 Agent 总开关打开时调用）
    window.startAgentAvailabilityCheck = function () {
        // 清除之前的定时器
        if (agentCheckInterval) {
            clearInterval(agentCheckInterval);
        }

        // 重置 flags 同步时间，确保立即同步一次
        lastFlagsSyncTime = 0;
        // 重置连接失败计数
        connectionFailureCount = 0;

        // 立即检查一次
        checkAgentCapabilities();

        // 每1秒检查一次
        agentCheckInterval = setInterval(checkAgentCapabilities, 1000);
    };

    // 停止 Agent 可用性定时检查（由 Agent 总开关关闭时调用）
    window.stopAgentAvailabilityCheck = function () {
        if (agentCheckInterval) {
            clearInterval(agentCheckInterval);
            agentCheckInterval = null;
        }
    };

    // 浮动Agent status更新函数
    function setFloatingAgentStatus(msg) {
        const statusEl = document.getElementById('live2d-agent-status');
        if (statusEl) {
            statusEl.textContent = msg || '';
        }
    }

    // 检查Agent服务器健康状态
    async function checkToolServerHealth() {
        try {
            const resp = await fetch(`/api/agent/health`);
            if (!resp.ok) throw new Error('not ok');
            return true;
        } catch (e) {
            return false;
        }
    }

    // 检查Agent能力
    async function checkCapability(kind, showError = true) {
        const apis = {
            computer_use: { url: '/api/agent/computer_use/availability', nameKey: 'keyboardControl' },
            mcp: { url: '/api/agent/mcp/availability', nameKey: 'mcpTools' },
            user_plugin: { url: '/api/agent/user_plugin/availability', nameKey: 'userPlugin' }
        };
        const config = apis[kind];
        if (!config) return false;

        try {
            const r = await fetch(config.url);
            if (!r.ok) return false;
            const j = await r.json();
            if (!j.ready) {
                if (showError) {
                    const name = window.t ? window.t(`settings.toggles.${config.nameKey}`) : config.nameKey;
                    setFloatingAgentStatus(j.reasons?.[0] || (window.t ? window.t('settings.toggles.unavailable', { name }) : `${name}不可用`));
                }
                return false;
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    // 连接Agent弹出框中的开关到Agent控制逻辑
    // 使用事件监听替代固定延迟，确保在浮动按钮创建完成后才绑定事件
    const setupAgentCheckboxListeners = () => {
        const agentMasterCheckbox = document.getElementById('live2d-agent-master');
        const agentKeyboardCheckbox = document.getElementById('live2d-agent-keyboard');
        const agentMcpCheckbox = document.getElementById('live2d-agent-mcp');
        const agentUserPluginCheckbox = document.getElementById('live2d-agent-user-plugin');

        if (!agentMasterCheckbox) {
            console.warn('[App] Agent开关元素未找到，跳过绑定');
            return;
        }

        console.log('[App] Agent开关元素已找到，开始绑定事件监听器');

        // 【状态机】操作序列号由状态机管理，子开关保留独立序列号
        let keyboardOperationSeq = 0;
        let mcpOperationSeq = 0;
        let userPluginOperationSeq = 0;

        // 标记这些 checkbox 有外部处理器
        agentMasterCheckbox._hasExternalHandler = true;
        if (agentKeyboardCheckbox) agentKeyboardCheckbox._hasExternalHandler = true;
        if (agentMcpCheckbox) agentMcpCheckbox._hasExternalHandler = true;
        if (agentUserPluginCheckbox) agentUserPluginCheckbox._hasExternalHandler = true;


        // 辅助函数：同步更新 checkbox 的 UI 样式
        const syncCheckboxUI = (checkbox) => {
            if (checkbox && typeof checkbox._updateStyle === 'function') {
                checkbox._updateStyle();
            }
        };

        // 辅助函数：重置子开关状态和 UI
        const resetSubCheckboxes = () => {
            const names = {
                'live2d-agent-keyboard': window.t ? window.t('settings.toggles.keyboardControl') : '键鼠控制',
                'live2d-agent-mcp': window.t ? window.t('settings.toggles.mcpTools') : 'MCP工具',
                'live2d-agent-user-plugin': window.t ? window.t('settings.toggles.userPlugin') : '用户插件'
            };
            [agentKeyboardCheckbox, agentMcpCheckbox, agentUserPluginCheckbox].forEach(cb => {
                if (cb) {
                    cb.disabled = true;
                    cb.checked = false;
                    const name = names[cb.id] || '';
                    cb.title = window.t ? window.t('settings.toggles.masterRequired', { name: name }) : `请先开启Agent总开关`;
                    syncCheckboxUI(cb);
                }
            });
        };

        // 初始化时，确保键鼠控制和MCP工具默认禁用（除非Agent总开关已开启）
        if (!agentMasterCheckbox.checked) {
            resetSubCheckboxes();
        }

        // Agent总开关逻辑 - 使用状态机控制
        agentMasterCheckbox.addEventListener('change', async () => {
            // 【状态机控制】开始用户操作
            const currentSeq = agentStateMachine.startOperation();
            const isChecked = agentMasterCheckbox.checked;
            console.log('[App] Agent总开关状态变化:', isChecked, '序列号:', currentSeq);

            // 辅助函数：检查当前操作是否已过期
            const isExpired = () => {
                if (agentStateMachine.isSeqExpired(currentSeq)) {
                    console.log('[App] 总开关操作已过期，序列号:', currentSeq, '当前:', agentStateMachine._operationSeq);
                    return true;
                }
                return false;
            };

            // _processing 标志已在 live2d-ui-popup.js 的点击处理中设置
            if (!agentMasterCheckbox._processing) {
                agentMasterCheckbox._processing = true;
            }

            try {
                if (isChecked) {
                    // 【状态机】保持PROCESSING状态，所有按钮已被禁用
                    setFloatingAgentStatus(window.t ? window.t('agent.status.connecting') : 'Agent服务器连接中...');

                    let healthOk = false;
                    try {
                        healthOk = await checkToolServerHealth();
                        if (!healthOk) throw new Error('tool server down');
                        agentStateMachine.updateCache(true, null);
                    } catch (e) {
                        if (isExpired()) return;
                        agentStateMachine.updateCache(false, null);
                        agentStateMachine.endOperation(false, false);
                        setFloatingAgentStatus(window.t ? window.t('settings.toggles.serverOffline') : 'Agent服务器未启动');
                        agentMasterCheckbox.checked = false;
                        agentMasterCheckbox.disabled = false;
                        agentMasterCheckbox.title = window.t ? window.t('settings.toggles.agentMaster') : 'Agent总开关';
                        syncCheckboxUI(agentMasterCheckbox);
                        return;
                    }

                    if (isExpired()) return;

                    // 查询成功，恢复总开关可交互状态
                    agentMasterCheckbox.disabled = false;
                    agentMasterCheckbox.title = window.t ? window.t('settings.toggles.agentMaster') : 'Agent总开关';
                    syncCheckboxUI(agentMasterCheckbox);
                    setFloatingAgentStatus(window.t ? window.t('agent.status.enabled') : 'Agent模式已开启');

                    // 【状态机】子开关保持禁用，等待能力检查
                    if (agentKeyboardCheckbox) {
                        agentKeyboardCheckbox.disabled = true;
                        agentKeyboardCheckbox.title = window.t ? window.t('settings.toggles.checking') : '检查中...';
                        syncCheckboxUI(agentKeyboardCheckbox);
                    }
                    if (agentMcpCheckbox) {
                        agentMcpCheckbox.disabled = true;
                        agentMcpCheckbox.title = window.t ? window.t('settings.toggles.checking') : '检查中...';
                        syncCheckboxUI(agentMcpCheckbox);
                    }
                    if (agentUserPluginCheckbox) {
                        agentUserPluginCheckbox.disabled = true;
                        agentUserPluginCheckbox.title = window.t ? window.t('settings.toggles.checking') : '检查中...';
                        syncCheckboxUI(agentUserPluginCheckbox);
                    }

                    // 检查键鼠控制和MCP工具的可用性
                    await Promise.all([
                        (async () => {
                            if (!agentKeyboardCheckbox) return;
                            const available = await checkCapability('computer_use', false);
                            if (isExpired() || !agentMasterCheckbox.checked) {
                                agentKeyboardCheckbox.disabled = true;
                                agentKeyboardCheckbox.checked = false;
                                syncCheckboxUI(agentKeyboardCheckbox);
                                return;
                            }
                            agentKeyboardCheckbox.disabled = !available;
                            agentKeyboardCheckbox.title = available ? (window.t ? window.t('settings.toggles.keyboardControl') : '键鼠控制') : (window.t ? window.t('settings.toggles.unavailable', { name: window.t('settings.toggles.keyboardControl') }) : '键鼠控制不可用');
                            syncCheckboxUI(agentKeyboardCheckbox);
                        })(),
                        (async () => {
                            if (!agentMcpCheckbox) return;
                            const available = await checkCapability('mcp', false);
                            // 【防竞态】检查操作序列号和总开关状态
                            if (isExpired() || !agentMasterCheckbox.checked) {
                                agentMcpCheckbox.disabled = true;
                                agentMcpCheckbox.checked = false;
                                syncCheckboxUI(agentMcpCheckbox);
                                return;
                            }
                            agentMcpCheckbox.disabled = !available;
                            agentMcpCheckbox.title = available ? (window.t ? window.t('settings.toggles.mcpTools') : 'MCP工具') : (window.t ? window.t('settings.toggles.unavailable', { name: window.t('settings.toggles.mcpTools') }) : 'MCP工具不可用');
                            syncCheckboxUI(agentMcpCheckbox);

                        })(),
                        (async () => {
                            if (!agentUserPluginCheckbox) return;
                            const available = await checkCapability('user_plugin', false);
                            // 【防竞态】检查操作序列号和总开关状态
                            if (isExpired() || !agentMasterCheckbox.checked) {
                                agentUserPluginCheckbox.disabled = true;
                                agentUserPluginCheckbox.checked = false;
                                syncCheckboxUI(agentUserPluginCheckbox);
                                return;
                            }
                            agentUserPluginCheckbox.disabled = !available;
                            agentUserPluginCheckbox.title = available ? (window.t ? window.t('settings.toggles.userPlugin') : '用户插件') : (window.t ? window.t('settings.toggles.unavailable', { name: window.t('settings.toggles.userPlugin') }) : '用户插件不可用');
                            syncCheckboxUI(agentUserPluginCheckbox);
                        })()
                    ]);

                    if (isExpired()) return;

                    try {
                        const r = await fetch('/api/agent/flags', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                lanlan_name: lanlan_config.lanlan_name,
                                flags: { agent_enabled: true, computer_use_enabled: false, mcp_enabled: false, user_plugin_enabled: false }
                            })
                        });
                        if (!r.ok) throw new Error('main_server rejected');

                        if (isExpired()) {
                            console.log('[App] flags API 完成后操作已过期');
                            return;
                        }

                        // 启用 analyzer
                        await fetch('/api/agent/admin/control', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'enable_analyzer' })
                        });

                        if (isExpired() || !agentMasterCheckbox.checked) {
                            console.log('[App] API请求完成后操作已过期或总开关已关闭，不启动轮询');
                            resetSubCheckboxes();
                            return;
                        }

                        // 【状态机】操作成功完成，转换到ONLINE状态
                        agentStateMachine.endOperation(true, true);

                        // 启动定时检查器
                        window.startAgentAvailabilityCheck();
                    } catch (e) {
                        if (isExpired()) return;
                        agentStateMachine.endOperation(false, true);
                        agentMasterCheckbox.checked = false;
                        agentMasterCheckbox.disabled = false;
                        agentMasterCheckbox.title = window.t ? window.t('settings.toggles.agentMaster') : 'Agent总开关';
                        syncCheckboxUI(agentMasterCheckbox);
                        resetSubCheckboxes();
                        window.stopAgentTaskPolling();
                        setFloatingAgentStatus(window.t ? window.t('agent.status.enableFailed') : '开启失败');
                    }
                } else {
                    // 关闭操作：立即停止相关检查和轮询
                    window.stopAgentAvailabilityCheck();
                    window.stopAgentTaskPolling();
                    resetSubCheckboxes();
                    setFloatingAgentStatus(window.t ? window.t('agent.status.disabled') : 'Agent模式已关闭');
                    syncCheckboxUI(agentMasterCheckbox);

                    // 禁用 analyzer 并停止所有任务
                    try {
                        await fetch('/api/agent/admin/control', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'disable_analyzer' })
                        });

                        if (isExpired()) {
                            console.log('[App] 关闭操作已过期，跳过后续API调用');
                            return;
                        }

                        await fetch('/api/agent/flags', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                lanlan_name: lanlan_config.lanlan_name,
                                flags: { agent_enabled: false, computer_use_enabled: false, mcp_enabled: false, user_plugin_enabled: false }
                            })
                        });

                        // 【防竞态】检查操作序列号，防止过期操作覆盖新状态
                        if (isExpired()) {
                            console.log('[App] 关闭flags API完成后操作已过期，跳过状态转换');
                            return;
                        }

                        // 【状态机】关闭操作成功完成
                        agentStateMachine.endOperation(true, true);
                    } catch (e) {
                        if (!isExpired()) {
                            agentStateMachine.endOperation(false, true);
                            setFloatingAgentStatus(window.t ? window.t('agent.status.disabledError') : 'Agent模式已关闭（部分清理失败）');
                        }
                    }
                }
            } finally {
                // 清除处理中标志
                agentMasterCheckbox._processing = false;
            }
        });

        // 子开关通用处理函数（使用闭包捕获对应的序列号变量）
        const setupSubCheckbox = (checkbox, capability, flagKey, nameKey, getSeq, setSeq) => {
            if (!checkbox) return;
            checkbox.addEventListener('change', async () => {
                // 【修复频繁开关竞态】每次操作递增序列号
                const currentSeq = setSeq();
                const isChecked = checkbox.checked;

                // 获取翻译后的名称
                const getName = () => window.t ? window.t(`settings.toggles.${nameKey}`) : nameKey;
                const name = getName();

                // 辅助函数：检查当前操作是否已过期
                const isExpired = () => {
                    if (currentSeq !== getSeq()) {
                        console.log(`[App] ${name}开关操作已过期，序列号:`, currentSeq, '当前:', getSeq());
                        return true;
                    }
                    return false;
                };

                // 如果是自动禁用触发的change事件，跳过处理（避免重复发送请求）
                if (checkbox._autoDisabled) {
                    console.log(`[App] ${name}开关自动关闭，跳过change处理`);
                    return;
                }

                console.log(`[App] ${name}开关状态变化:`, isChecked, '序列号:', currentSeq);
                if (!agentMasterCheckbox?.checked) {
                    checkbox.checked = false;
                    syncCheckboxUI(checkbox);
                    checkbox._processing = false;
                    return;
                }

                // 确保处理中标志存在
                if (!checkbox._processing) {
                    checkbox._processing = true;
                }

                try {
                    const enabled = isChecked;
                    if (enabled) {
                        const ok = await checkCapability(capability);

                        // 【防竞态】检查操作序列号和总开关状态
                        if (isExpired() || !agentMasterCheckbox?.checked) {
                            console.log(`[App] ${name}检查期间操作已过期或总开关已关闭，取消操作`);
                            checkbox.checked = false;
                            checkbox.disabled = true;
                            syncCheckboxUI(checkbox);
                            return;
                        }

                        if (!ok) {
                            setFloatingAgentStatus(window.t ? window.t('settings.toggles.unavailable', { name }) : `${name}不可用`);
                            checkbox.checked = false;
                            syncCheckboxUI(checkbox);
                            return;
                        }
                    }
                    // 注：enabled=true时上面已检查；enabled=false时无await，入口检查已足够

                    try {
                        const r = await fetch('/api/agent/flags', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                lanlan_name: lanlan_config.lanlan_name,
                                flags: { [flagKey]: enabled }
                            })
                        });
                        if (!r.ok) throw new Error('main_server rejected');

                        // 【防竞态】请求完成后检查操作序列号和总开关状态
                        if (isExpired() || !agentMasterCheckbox?.checked) {
                            console.log(`[App] ${name}请求完成后操作已过期或总开关已关闭，强制关闭`);
                            checkbox.checked = false;
                            checkbox.disabled = true;
                            syncCheckboxUI(checkbox);
                            return;
                        }

                        if (window.t) {
                            setFloatingAgentStatus(enabled ? window.t('settings.toggles.enabled', { name }) : window.t('settings.toggles.disabled', { name }));
                        } else {
                            setFloatingAgentStatus(enabled ? `${name}已开启` : `${name}已关闭`);
                        }
                        // 关闭成功时也需要同步 UI
                        if (!enabled) {
                            syncCheckboxUI(checkbox);
                        }
                    } catch (e) {
                        // 【竞态检查】错误处理前检查操作是否过期
                        if (isExpired()) return;
                        if (enabled) {
                            checkbox.checked = false;
                            syncCheckboxUI(checkbox);
                            setFloatingAgentStatus(window.t ? window.t('settings.toggles.enableFailed', { name }) : `${name}开启失败`);
                        }
                    }
                } finally {
                    // 清除处理中标志
                    checkbox._processing = false;
                    checkbox._processingChangeId = null;
                }
            });
        };

        // 键鼠控制开关逻辑（传入序列号的getter和setter）
        setupSubCheckbox(
            agentKeyboardCheckbox,
            'computer_use',
            'computer_use_enabled',
            'keyboardControl',
            () => keyboardOperationSeq,
            () => ++keyboardOperationSeq
        );

        // MCP工具开关逻辑（传入序列号的getter和setter）
        setupSubCheckbox(
            agentMcpCheckbox,
            'mcp',
            'mcp_enabled',
            'mcpTools',
            () => mcpOperationSeq,
            () => ++mcpOperationSeq
        );
        // 用户插件开关逻辑（传入序列号的getter和setter）
        setupSubCheckbox(
            agentUserPluginCheckbox,
            'user_plugin',
            'user_plugin_enabled',
            'userPlugin',
            () => userPluginOperationSeq,
            () => ++userPluginOperationSeq
        );

        // 从后端同步 flags 状态到前端开关（完整同步，处理所有情况）
        // 【重要】此函数只同步总开关状态，子开关保持禁用等待能力检查
        async function syncFlagsFromBackend() {
            try {
                const resp = await fetch('/api/agent/flags');
                if (!resp.ok) return false;
                const data = await resp.json();
                if (!data.success) return false;

                const flags = data.agent_flags || {};
                const analyzerEnabled = data.analyzer_enabled || false;

                console.log('[App] 从后端获取 flags 状态:', { analyzerEnabled, flags });

                // 缓存后端flags供后续能力检查使用
                agentStateMachine.updateCache(true, flags);

                // 同步总开关状态
                if (agentMasterCheckbox) {
                    // 强制根据后端状态更新前端，确保同步
                    if (agentMasterCheckbox.checked !== analyzerEnabled && !agentMasterCheckbox._processing) {
                        console.log('[App] 强制同步总开关状态:', analyzerEnabled);
                        agentMasterCheckbox.checked = analyzerEnabled;

                        // 如果总开关被动开启，需要触发相关逻辑（如显示HUD）
                        if (analyzerEnabled) {
                            // 只有在非弹窗操作期间才自动启动检查
                            if (!agentStateMachine._popupOpen) {
                                window.startAgentAvailabilityCheck();
                            }
                        } else {
                            // 如果总开关被动关闭，停止所有活动
                            window.stopAgentAvailabilityCheck();
                            window.stopAgentTaskPolling();
                        }
                    }

                    agentMasterCheckbox.disabled = false;
                    agentMasterCheckbox.title = window.t ? window.t('settings.toggles.agentMaster') : 'Agent总开关';
                    syncCheckboxUI(agentMasterCheckbox);
                }

                // 【修复竞态】子开关不在这里设置 checked 状态
                // 子开关保持禁用和未选中，由 checkAgentCapabilities 根据能力检查结果来设置
                if (agentKeyboardCheckbox) {
                    if (analyzerEnabled) {
                        // Agent 已开启，但子开关保持禁用等待能力检查
                        agentKeyboardCheckbox.checked = false;
                        agentKeyboardCheckbox.disabled = true;
                        agentKeyboardCheckbox.title = window.t ? window.t('settings.toggles.checking') : '检查中...';
                    } else {
                        // Agent 未开启，复位子开关
                        agentKeyboardCheckbox.checked = false;
                        agentKeyboardCheckbox.disabled = true;
                        agentKeyboardCheckbox.title = window.t ? window.t('settings.toggles.masterRequired', { name: window.t ? window.t('settings.toggles.keyboardControl') : '键鼠控制' }) : '请先开启Agent总开关';
                    }
                    syncCheckboxUI(agentKeyboardCheckbox);
                }
                // 同步 用户插件子开关
                if (agentUserPluginCheckbox) {
                    if (analyzerEnabled) {
                        // Agent 已开启，根据后端状态设置
                        agentUserPluginCheckbox.checked = flags.user_plugin_enabled || false;
                        agentUserPluginCheckbox.disabled = true; // 先设为可用，后续可用性检查会更新
                        agentUserPluginCheckbox.title = window.t ? window.t('settings.toggles.checking') : '检查中...';
                    } else {
                        // Agent 未开启，复位子开关
                        agentUserPluginCheckbox.checked = false;
                        agentUserPluginCheckbox.disabled = true;
                        agentUserPluginCheckbox.title = window.t ? window.t('settings.toggles.masterRequired', { name: window.t ? window.t('settings.toggles.userPlugin') : '用户插件' }) : '请先开启Agent总开关';
                    }
                    syncCheckboxUI(agentUserPluginCheckbox);
                }
                if (agentMcpCheckbox) {
                    if (analyzerEnabled) {
                        // Agent 已开启，但子开关保持禁用等待能力检查
                        agentMcpCheckbox.checked = false;
                        agentMcpCheckbox.disabled = true;
                        agentMcpCheckbox.title = window.t ? window.t('settings.toggles.checking') : '检查中...';
                    } else {
                        // Agent 未开启，复位子开关
                        agentMcpCheckbox.checked = false;
                        agentMcpCheckbox.disabled = true;
                        agentMcpCheckbox.title = window.t ? window.t('settings.toggles.masterRequired', { name: window.t ? window.t('settings.toggles.mcpTools') : 'MCP工具' }) : '请先开启Agent总开关';
                    }
                    syncCheckboxUI(agentMcpCheckbox);
                }

                return analyzerEnabled;
            } catch (e) {
                console.warn('[App] 同步 flags 状态失败:', e);
                return false;
            }
        }

        // 暴露同步函数供外部调用（如定时轮询）
        window.syncAgentFlagsFromBackend = syncFlagsFromBackend;

        // 监听 Agent 弹窗打开事件 - 使用状态机控制
        window.addEventListener('live2d-agent-popup-opening', async () => {
            // 使用状态机管理弹窗状态
            agentStateMachine.openPopup();
            isAgentPopupOpen = true;

            // 【状态机控制】如果正在处理用户操作，不进行检查
            if (agentStateMachine.getState() === AgentPopupState.PROCESSING) {
                console.log('[App] 弹窗打开时状态机处于PROCESSING，跳过检查');
                return;
            }

            // 【状态机控制】转换到CHECKING状态，自动禁用所有按钮
            agentStateMachine.transition(AgentPopupState.CHECKING, 'popup opened');

            // 生成本次检查的唯一序列号，防止竞态（如打开->关闭->立即打开）
            const currentCheckSeq = agentStateMachine.nextCheckSeq();

            // 1. 极端策略：强制禁用所有按钮并提示连接中
            if (agentMasterCheckbox) {
                agentMasterCheckbox.disabled = true;
                agentMasterCheckbox.title = window.t ? window.t('settings.toggles.checking') : '查询中...';
                syncCheckboxUI(agentMasterCheckbox);
            }
            [agentKeyboardCheckbox, agentMcpCheckbox, agentUserPluginCheckbox].forEach(cb => {
                if (cb) {
                    cb.disabled = true;
                    cb.title = window.t ? window.t('settings.toggles.checking') : '查询中...';
                    syncCheckboxUI(cb);
                }
            });

            // 2. 执行第一次轮询（Gather模式）
            try {
                agentStateMachine.recordCheck();

                // 并行请求所有状态
                const [healthOk, flagsData, keyboardAvailable, mcpAvailable, userPluginAvailable] = await Promise.all([
                    checkToolServerHealth(),
                    fetch('/api/agent/flags').then(r => r.ok ? r.json() : { success: false }),
                    checkCapability('computer_use', false),
                    checkCapability('mcp', false),
                    checkCapability('user_plugin', false)
                ]);

                // 【竞态保护 1】检查序列号是否过期（防止旧请求覆盖新请求）
                if (agentStateMachine.isCheckSeqExpired(currentCheckSeq)) {
                    console.log('[App] 检查请求已过期（可能是快速重新打开），跳过UI更新');
                    return;
                }

                // 【竞态保护 2】检查完成后，验证弹窗仍打开且状态仍是CHECKING
                if (!agentStateMachine._popupOpen || agentStateMachine.getState() !== AgentPopupState.CHECKING) {
                    console.log('[App] 弹窗已关闭或状态已改变，跳过UI更新');
                    return;
                }

                // 3. 统一处理逻辑
                const analyzerEnabled = flagsData.success ? (flagsData.analyzer_enabled || false) : false;
                const flags = flagsData.success ? (flagsData.agent_flags || {}) : {};

                // 更新缓存
                agentStateMachine.updateCache(healthOk, flags);

                if (healthOk) {
                    // 服务器在线
                    agentStateMachine.transition(AgentPopupState.ONLINE, 'server online');

                    // 只有总开关开启状态下才允许其他两个开关打开
                    if (analyzerEnabled) {
                        // 总开关开启
                        agentMasterCheckbox.checked = true;
                        agentMasterCheckbox.disabled = false;
                        agentMasterCheckbox.title = window.t ? window.t('settings.toggles.agentMaster') : 'Agent总开关';
                        syncCheckboxUI(agentMasterCheckbox);

                        // 处理子开关
                        // 键鼠控制
                        if (agentKeyboardCheckbox) {
                            const shouldEnable = flags.computer_use_enabled && keyboardAvailable;
                            agentKeyboardCheckbox.checked = shouldEnable;
                            agentKeyboardCheckbox.disabled = !keyboardAvailable; // 仅当能力不可用时禁用
                            agentKeyboardCheckbox.title = keyboardAvailable ? (window.t ? window.t('settings.toggles.keyboardControl') : '键鼠控制') : (window.t ? window.t('settings.toggles.unavailable', { name: window.t('settings.toggles.keyboardControl') }) : '键鼠控制不可用');
                            syncCheckboxUI(agentKeyboardCheckbox);
                        }

                        // MCP工具
                        if (agentMcpCheckbox) {
                            const shouldEnable = flags.mcp_enabled && mcpAvailable;
                            agentMcpCheckbox.checked = shouldEnable;
                            agentMcpCheckbox.disabled = !mcpAvailable; // 仅当能力不可用时禁用
                            agentMcpCheckbox.title = mcpAvailable ? (window.t ? window.t('settings.toggles.mcpTools') : 'MCP工具') : (window.t ? window.t('settings.toggles.unavailable', { name: window.t('settings.toggles.mcpTools') }) : 'MCP工具不可用');
                            syncCheckboxUI(agentMcpCheckbox);
                        }

                        // 用户插件
                        if (agentUserPluginCheckbox) {
                            const shouldEnable = flags.user_plugin_enabled && userPluginAvailable;
                            agentUserPluginCheckbox.checked = shouldEnable;
                            agentUserPluginCheckbox.disabled = !userPluginAvailable;
                            agentUserPluginCheckbox.title = userPluginAvailable ? (window.t ? window.t('settings.toggles.userPlugin') : '用户插件') : (window.t ? window.t('settings.toggles.unavailable', { name: window.t('settings.toggles.userPlugin') }) : '用户插件不可用');
                            syncCheckboxUI(agentUserPluginCheckbox);
                        }



                        setFloatingAgentStatus(window.t ? window.t('agent.status.enabled') : 'Agent模式已开启');

                        // 只有子开关开启时才显示HUD
                        checkAndToggleTaskHUD();
                    } else {
                        // 总开关关闭
                        agentMasterCheckbox.checked = false;
                        agentMasterCheckbox.disabled = false;
                        agentMasterCheckbox.title = window.t ? window.t('settings.toggles.agentMaster') : 'Agent总开关';
                        syncCheckboxUI(agentMasterCheckbox);

                        // 强制关闭所有子开关
                        resetSubCheckboxes();

                        setFloatingAgentStatus(window.t ? window.t('agent.status.ready') : 'Agent服务器就绪');

                        // 确保HUD隐藏
                        window.stopAgentTaskPolling();

                        // 立即通知后台关闭全部flags（如果后端状态不一致）
                        if (flags.computer_use_enabled || flags.mcp_enabled || flags.user_plugin_enabled) {
                            console.log('[App] 总开关关闭但检测到子flag开启，强制同步关闭');
                            fetch('/api/agent/flags', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    lanlan_name: lanlan_config.lanlan_name,
                                    flags: { agent_enabled: false, computer_use_enabled: false, mcp_enabled: false, user_plugin_enabled: false }
                                })
                            }).catch(e => console.warn('[App] 强制关闭flags失败:', e));
                        }
                    }

                    // 4. 恢复原异步逻辑
                    window.startAgentAvailabilityCheck();

                } else {
                    // 服务器离线
                    agentStateMachine.transition(AgentPopupState.OFFLINE, 'server offline');
                    agentMasterCheckbox.checked = false;
                    agentMasterCheckbox.disabled = true; // 离线时禁用总开关
                    agentMasterCheckbox.title = window.t ? window.t('settings.toggles.serverOffline') : 'Agent服务器未启动';
                    syncCheckboxUI(agentMasterCheckbox);

                    resetSubCheckboxes();

                    setFloatingAgentStatus(window.t ? window.t('settings.toggles.serverOffline') : 'Agent服务器未启动');

                    // 离线也需要轮询（检查服务器何时上线）
                    window.startAgentAvailabilityCheck();
                }

            } catch (e) {
                console.error('[App] Agent 初始检查失败:', e);
                agentStateMachine.updateCache(false, null);

                if (agentStateMachine._popupOpen) {
                    agentStateMachine.transition(AgentPopupState.OFFLINE, 'check failed');
                    agentMasterCheckbox.checked = false;
                    resetSubCheckboxes();
                    window.startAgentAvailabilityCheck();
                }
            } finally {
                agentStateMachine.releaseCheckLock();
            }
        });

        // 监听 Agent 弹窗关闭事件 - 使用状态机控制
        window.addEventListener('live2d-agent-popup-closed', () => {
            isAgentPopupOpen = false;
            agentStateMachine.closePopup();
            console.log('[App] Agent弹窗已关闭');

            // 如果总开关未开启，停止轮询
            if (!agentMasterCheckbox || !agentMasterCheckbox.checked) {
                window.stopAgentAvailabilityCheck();
            }
        });

        console.log('[App] Agent开关事件监听器绑定完成');
    };

    // ========== Agent 任务 HUD 轮询逻辑 ==========
    let agentTaskPollingInterval = null;
    let agentTaskTimeUpdateInterval = null;

    // 启动任务状态轮询
    window.startAgentTaskPolling = function () {
        if (agentTaskPollingInterval) return; // 已经在运行

        console.log('[App] 启动 Agent 任务状态轮询');

        // 确保 HUD 已创建并显示
        if (window.live2dManager) {
            window.live2dManager.createAgentTaskHUD();
            window.live2dManager.showAgentTaskHUD();
        }

        // 立即执行一次
        fetchAndUpdateTaskStatus();

        // 每 2 秒轮询一次任务状态
        agentTaskPollingInterval = setInterval(fetchAndUpdateTaskStatus, 2000);

        // 每秒更新运行时间显示
        agentTaskTimeUpdateInterval = setInterval(updateTaskRunningTimes, 1000);
    };

    // 停止任务状态轮询
    window.stopAgentTaskPolling = function () {
        console.log('[App] 停止 Agent 任务状态轮询');

        if (agentTaskPollingInterval) {
            clearInterval(agentTaskPollingInterval);
            agentTaskPollingInterval = null;
        }

        if (agentTaskTimeUpdateInterval) {
            clearInterval(agentTaskTimeUpdateInterval);
            agentTaskTimeUpdateInterval = null;
        }

        // 隐藏 HUD
        if (window.live2dManager) {
            window.live2dManager.hideAgentTaskHUD();
        }
    };

    // 获取并更新任务状态
    async function fetchAndUpdateTaskStatus() {
        try {
            const response = await fetch('/api/agent/task_status');
            if (!response.ok) {
                console.warn('[App] 获取任务状态失败:', response.status);
                return;
            }

            const data = await response.json();
            if (data.success && window.live2dManager) {
                window.live2dManager.updateAgentTaskHUD(data);
            }
        } catch (error) {
            console.warn('[App] 任务状态轮询出错:', error);
        }
    }

    // 更新运行中任务的时间显示
    function updateTaskRunningTimes() {
        const taskList = document.getElementById('agent-task-list');
        if (!taskList) return;

        const timeElements = taskList.querySelectorAll('[id^="task-time-"]');
        timeElements.forEach(timeEl => {
            const taskId = timeEl.id.replace('task-time-', '');
            const card = document.querySelector(`.task-card[data-task-id="${taskId}"]`);
            if (!card) return;

            // 从原始 start_time 重新计算（存储在 data 属性中）
            const startTimeStr = card.dataset.startTime;
            if (startTimeStr) {
                const startTime = new Date(startTimeStr);
                const elapsed = Math.floor((Date.now() - startTime.getTime()) / 1000);
                const minutes = Math.floor(elapsed / 60);
                const seconds = elapsed % 60;
                timeEl.innerHTML = `<span style="color: #64748b;">⏱️</span> ${minutes}:${seconds.toString().padStart(2, '0')}`;
            }
        });
    }

    // 检查是否需要显示任务 HUD（总开关开启 且 键鼠或MCP任一开启）
    function checkAndToggleTaskHUD() {
        const masterCheckbox = document.getElementById('live2d-agent-master');
        const keyboardCheckbox = document.getElementById('live2d-agent-keyboard');
        const mcpCheckbox = document.getElementById('live2d-agent-mcp');
        const userPlugin = document.getElementById('live2d-agent-user-plugin');

        const masterEnabled = masterCheckbox && masterCheckbox.checked;
        const keyboardEnabled = keyboardCheckbox && keyboardCheckbox.checked;
        const mcpEnabled = mcpCheckbox && mcpCheckbox.checked;
        const userPluginEnabled = userPlugin && userPlugin.checked;

        // 【修复】只有总开关开启 且 子开关任一开启时才显示HUD
        if (masterEnabled && (keyboardEnabled || mcpEnabled || userPluginEnabled)) {
            window.startAgentTaskPolling();
        } else {
            window.stopAgentTaskPolling();
        }
    }

    // 暴露给其他模块使用
    window.checkAndToggleTaskHUD = checkAndToggleTaskHUD;

    // 监听 Agent 子开关变化来控制 HUD 显示
    window.addEventListener('live2d-floating-buttons-ready', () => {
        // 延迟确保元素已创建
        setTimeout(() => {
            const keyboardCheckbox = document.getElementById('live2d-agent-keyboard');
            const mcpCheckbox = document.getElementById('live2d-agent-mcp');
            const userPluginCheckbox = document.getElementById('live2d-agent-user-plugin');

            if (keyboardCheckbox) {
                keyboardCheckbox.addEventListener('change', checkAndToggleTaskHUD);
            }
            if (mcpCheckbox) {
                mcpCheckbox.addEventListener('change', checkAndToggleTaskHUD);
            }
            if (userPluginCheckbox) {
                userPluginCheckbox.addEventListener('change', checkAndToggleTaskHUD);
            }
            console.log('[App] Agent 任务 HUD 控制已绑定');
        }, 100);
    });
    // ========== Agent 任务 HUD 轮询逻辑结束 ==========

    // 监听浮动按钮创建完成事件
    window.addEventListener('live2d-floating-buttons-ready', () => {
        console.log('[App] 收到浮动按钮就绪事件，开始绑定Agent开关');
        setupAgentCheckboxListeners();
    }, { once: true });  // 只执行一次

    // 麦克风权限和设备列表预加载（修复 UI 2.0 中权限请求时机导致的bug）
    let micPermissionGranted = false;
    let cachedMicDevices = null;

    // 预先请求麦克风权限并缓存设备列表
    async function ensureMicrophonePermission() {
        if (micPermissionGranted && cachedMicDevices) {
            return cachedMicDevices;
        }

        try {
            // 方法1：先请求一次短暂的麦克风访问来触发权限请求
            // 这样后续 enumerateDevices() 才能返回带 label 的设备信息
            const tempStream = await navigator.mediaDevices.getUserMedia({
                audio: true
            });

            // 立即释放流，我们只是为了触发权限
            tempStream.getTracks().forEach(track => track.stop());

            micPermissionGranted = true;
            console.log('麦克风权限已获取');

            // 现在可以获取完整的设备列表（带 label）
            const devices = await navigator.mediaDevices.enumerateDevices();
            cachedMicDevices = devices.filter(device => device.kind === 'audioinput');

            return cachedMicDevices;
        } catch (error) {
            console.warn('请求麦克风权限失败:', error);
            // 即使权限失败，也尝试获取设备列表（可能没有 label）
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                cachedMicDevices = devices.filter(device => device.kind === 'audioinput');
                return cachedMicDevices;
            } catch (enumError) {
                console.error('获取设备列表失败:', enumError);
                return [];
            }
        }
    }

    // 监听设备变化，更新缓存
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
        navigator.mediaDevices.addEventListener('devicechange', async () => {
            console.log('检测到设备变化，刷新麦克风列表...');
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                cachedMicDevices = devices.filter(device => device.kind === 'audioinput');
                // 如果弹出框当前是显示的，刷新它
                const micPopup = document.getElementById('live2d-popup-mic');
                if (micPopup && micPopup.style.display === 'flex') {
                    await window.renderFloatingMicList();
                }
            } catch (error) {
                console.error('设备变化后更新列表失败:', error);
            }
        });
    }

    // 为浮动弹出框渲染麦克风列表（修复版本：确保有权限后再渲染）
    window.renderFloatingMicList = async () => {
        const micPopup = document.getElementById('live2d-popup-mic');
        if (!micPopup) {
            return false;
        }

        try {
            // 确保已经有麦克风权限，并获取设备列表
            const audioInputs = await ensureMicrophonePermission();

            micPopup.innerHTML = '';

            if (audioInputs.length === 0) {
                const noMicItem = document.createElement('div');
                noMicItem.textContent = window.t ? window.t('microphone.noDevices') : '没有检测到麦克风设备';
                noMicItem.style.padding = '8px 12px';
                noMicItem.style.color = '#666';
                noMicItem.style.fontSize = '13px';
                micPopup.appendChild(noMicItem);
                return false;
            }

            // 添加默认麦克风选项
            const defaultOption = document.createElement('button');
            defaultOption.className = 'mic-option';
            // 不设置 dataset.deviceId，让它保持 undefined（表示默认）
            defaultOption.textContent = window.t ? window.t('microphone.defaultDevice') : '系统默认麦克风';
            if (selectedMicrophoneId === null) {
                defaultOption.classList.add('selected');
            }
            Object.assign(defaultOption.style, {
                padding: '8px 12px',
                cursor: 'pointer',
                border: 'none',
                background: selectedMicrophoneId === null ? '#e6f0ff' : 'transparent',
                borderRadius: '6px',
                transition: 'background 0.2s ease',
                fontSize: '13px',
                width: '100%',
                textAlign: 'left',
                color: selectedMicrophoneId === null ? '#4f8cff' : '#333',
                fontWeight: selectedMicrophoneId === null ? '500' : '400'
            });
            defaultOption.addEventListener('mouseenter', () => {
                if (selectedMicrophoneId !== null) {
                    defaultOption.style.background = 'rgba(79, 140, 255, 0.1)';
                }
            });
            defaultOption.addEventListener('mouseleave', () => {
                if (selectedMicrophoneId !== null) {
                    defaultOption.style.background = 'transparent';
                }
            });
            defaultOption.addEventListener('click', async () => {
                await selectMicrophone(null);
                // 只更新选中状态，不重新渲染整个列表
                updateMicListSelection();
            });
            micPopup.appendChild(defaultOption);

            // 添加分隔线
            const separator = document.createElement('div');
            separator.style.height = '1px';
            separator.style.backgroundColor = '#eee';
            separator.style.margin = '5px 0';
            micPopup.appendChild(separator);

            // 添加各个麦克风设备选项
            audioInputs.forEach(device => {
                const option = document.createElement('button');
                option.className = 'mic-option';
                option.dataset.deviceId = device.deviceId; // 存储设备ID用于更新选中状态
                const micIndex = audioInputs.indexOf(device) + 1;
                option.textContent = device.label || (window.t ? window.t('microphone.deviceLabel', { index: micIndex }) : `麦克风 ${micIndex}`);
                if (selectedMicrophoneId === device.deviceId) {
                    option.classList.add('selected');
                }

                Object.assign(option.style, {
                    padding: '8px 12px',
                    cursor: 'pointer',
                    border: 'none',
                    background: selectedMicrophoneId === device.deviceId ? '#e6f0ff' : 'transparent',
                    borderRadius: '6px',
                    transition: 'background 0.2s ease',
                    fontSize: '13px',
                    width: '100%',
                    textAlign: 'left',
                    color: selectedMicrophoneId === device.deviceId ? '#4f8cff' : '#333',
                    fontWeight: selectedMicrophoneId === device.deviceId ? '500' : '400'
                });

                option.addEventListener('mouseenter', () => {
                    if (selectedMicrophoneId !== device.deviceId) {
                        option.style.background = 'rgba(79, 140, 255, 0.1)';
                    }
                });
                option.addEventListener('mouseleave', () => {
                    if (selectedMicrophoneId !== device.deviceId) {
                        option.style.background = 'transparent';
                    }
                });

                option.addEventListener('click', async () => {
                    await selectMicrophone(device.deviceId);
                    // 只更新选中状态，不重新渲染整个列表
                    updateMicListSelection();
                });

                micPopup.appendChild(option);
            });

            return true;
        } catch (error) {
            console.error('渲染麦克风列表失败:', error);
            micPopup.innerHTML = '';
            const errorItem = document.createElement('div');
            errorItem.textContent = window.t ? window.t('microphone.loadFailed') : '获取麦克风列表失败';
            errorItem.style.padding = '8px 12px';
            errorItem.style.color = '#dc3545';
            errorItem.style.fontSize = '13px';
            micPopup.appendChild(errorItem);
            return false;
        }
    };

    // 轻量级更新：仅更新麦克风列表的选中状态（不重新渲染整个列表）
    function updateMicListSelection() {
        const micPopup = document.getElementById('live2d-popup-mic');
        if (!micPopup) return;

        // 更新所有选项的选中状态
        const options = micPopup.querySelectorAll('.mic-option');
        options.forEach(option => {
            const deviceId = option.dataset.deviceId;
            const isSelected = (deviceId === undefined && selectedMicrophoneId === null) ||
                (deviceId === selectedMicrophoneId);

            if (isSelected) {
                option.classList.add('selected');
                option.style.background = '#e6f0ff';
                option.style.color = '#4f8cff';
                option.style.fontWeight = '500';
            } else {
                option.classList.remove('selected');
                option.style.background = 'transparent';
                option.style.color = '#333';
                option.style.fontWeight = '400';
            }
        });
    }

    // 页面加载后预先请求麦克风权限（修复核心bug：确保权限在用户点击前就已获取）
    setTimeout(async () => {
        console.log('[麦克风] 页面加载，预先请求麦克风权限...');
        try {
            await ensureMicrophonePermission();
            console.log('[麦克风] 权限预请求完成，设备列表已缓存');
            // 触发事件通知权限已准备好（兼容可能依赖此事件的其他代码）
            window.dispatchEvent(new CustomEvent('mic-permission-ready'));
        } catch (error) {
            console.warn('[麦克风] 预请求权限失败（用户可能拒绝）:', error);
        }
    }, 500); // 页面加载后半秒开始预请求

    // 延迟渲染麦克风列表到弹出框（确保弹出框DOM已创建）
    setTimeout(() => {
        window.renderFloatingMicList();
    }, 1500);

    // 主动搭话定时触发功能
    function scheduleProactiveChat() {
        // 清除现有定时器
        if (proactiveChatTimer) {
            clearTimeout(proactiveChatTimer);
            proactiveChatTimer = null;
        }

        // 主动搭话关闭时跳过（定时主动搭话只需要proactiveChatEnabled）
        if (!proactiveChatEnabled) {
            return;
        }

        // 如果主动搭话正在执行中，不安排新的定时器（等当前执行完成后自动安排）
        if (isProactiveChatRunning) {
            console.log('主动搭话正在执行中，延迟安排下一次');
            return;
        }

        // 只在非语音模式下执行（语音模式下不触发主动搭话）
        // 文本模式或待机模式都可以触发主动搭话
        if (isRecording) {
            console.log('语音模式中，不安排主动搭话');
            return;
        }

        // 计算延迟时间（指数退避，倍率2.5）
        const delay = PROACTIVE_CHAT_BASE_DELAY * Math.pow(2.5, proactiveChatBackoffLevel);
        console.log(`主动搭话：${delay / 1000}秒后触发（退避级别：${proactiveChatBackoffLevel}）`);

        proactiveChatTimer = setTimeout(async () => {
            // 双重检查锁：定时器触发时再次检查是否正在执行
            if (isProactiveChatRunning) {
                console.log('主动搭话定时器触发时发现正在执行中，跳过本次');
                return;
            }

            console.log('触发主动搭话...');
            isProactiveChatRunning = true; // 加锁

            try {
                await triggerProactiveChat();
            } finally {
                isProactiveChatRunning = false; // 解锁
            }

            // 增加退避级别（最多到约7分钟，即level 3：30s * 2.5^3 = 7.5min）
            if (proactiveChatBackoffLevel < 3) {
                proactiveChatBackoffLevel++;
            }

            // 安排下一次
            scheduleProactiveChat();
        }, delay);
    }

    async function triggerProactiveChat() {
        try {
            // 根据模式决定使用哪种搭话方式
            // Windows系统下支持三种模式：截图、窗口标题搜索、热门内容
            // 非Windows系统下只支持截图和热门内容
            let useScreenshot = false;
            let useWindowTitle = false;
            const isWindows = isWindowsOS();

            if (proactiveChatEnabled && proactiveVisionEnabled) {
                // 两个都开启时：
                // Windows: 1/3截图, 1/3窗口标题, 1/3热门内容
                // 非Windows: 50%截图, 50%热门内容
                if (isWindows) {
                    const rand = Math.random();
                    if (rand < 0.33) {
                        useScreenshot = true;
                        console.log('主动搭话模式：双开模式(Windows)，使用截图搭话');
                    } else if (rand < 0.66) {
                        useWindowTitle = true;
                        console.log('主动搭话模式：双开模式(Windows)，使用窗口标题搭话');
                    } else {
                        console.log('主动搭话模式：双开模式(Windows)，使用热门内容');
                    }
                } else {
                    useScreenshot = Math.random() < 0.5;
                    console.log(`主动搭话模式：双开模式，使用${useScreenshot ? '截图搭话' : '热门内容'}`);
                }
            } else if (proactiveVisionEnabled) {
                // 只开启主动视觉时：
                // Windows和非Windows都是100%截图
                useScreenshot = true;
                console.log('主动搭话模式：仅视觉模式，使用截图搭话');
            } else if (proactiveChatEnabled && isWindows) {
                // 只开启主动搭话时(Windows)：50%窗口标题, 50%热门内容
                if (Math.random() < 0.5) {
                    useWindowTitle = true;
                    console.log('主动搭话模式：仅搭话模式(Windows)，使用窗口标题搭话');
                } else {
                    console.log('主动搭话模式：仅搭话模式(Windows)，使用热门内容');
                }
            } else if (proactiveChatEnabled) {
                // 只开启主动搭话时(非Windows)：100%热门内容
                useScreenshot = false;
                useWindowTitle = false;
                console.log('主动搭话模式：仅搭话模式，使用热门内容');
            } else {
                // 两个都关闭，不执行搭话
                console.log('主动搭话模式：两个功能都关闭，跳过本次搭话');
                return;
            }

            let requestBody = {
                lanlan_name: lanlan_config.lanlan_name
            };

            if (useScreenshot) {
                // 使用截图搭话
                const screenshotDataUrl = await captureProactiveChatScreenshot();

                if (!screenshotDataUrl) {
                    console.log('主动搭话截图失败，退回使用其他方式');
                    // 截图失败时的回退策略
                    if (isWindows && proactiveChatEnabled) {
                        // Windows下回退到窗口标题
                        useScreenshot = false;
                        useWindowTitle = true;
                        console.log('已切换到窗口标题搭话模式');
                    } else if (proactiveChatEnabled) {
                        // 非Windows或不支持窗口标题时回退到热门内容
                        useScreenshot = false;
                        console.log('已切换到热门内容搭话模式');
                    } else {
                        // 如果只开启了主动视觉，没有开启主动搭话，则跳过本次搭话
                        console.log('主动视觉截图失败且未开启主动搭话，跳过本次搭话');
                        return;
                    }
                } else {
                    requestBody.screenshot_data = screenshotDataUrl;
                }
            }

            if (useWindowTitle && !useScreenshot) {
                // 使用窗口标题搭话（Windows only）
                try {
                    const titleResponse = await fetch('/api/get_window_title');
                    const titleResult = await titleResponse.json();

                    // await 期间用户可能关闭了功能，避免继续执行
                    if (!proactiveChatEnabled && !proactiveVisionEnabled) {
                        console.log('功能已关闭，取消本次搭话');
                        return;
                    }

                    if (titleResult.success && titleResult.window_title) {
                        requestBody.window_title = titleResult.window_title;
                        console.log('成功获取窗口标题:', titleResult.window_title);
                    } else {
                        console.log('获取窗口标题失败，退回使用热门内容');
                        if (proactiveChatEnabled) {
                            useWindowTitle = false;
                            console.log('已切换到热门内容搭话模式');
                        } else {
                            console.log('获取窗口标题失败且未开启主动搭话，跳过本次搭话');
                            return;
                        }
                    }
                } catch (error) {
                    console.error('获取窗口标题时出错:', error);
                    if (proactiveChatEnabled) {
                        useWindowTitle = false;
                        console.log('已切换到热门内容搭话模式');
                    } else {
                        console.log('获取窗口标题失败且未开启主动搭话，跳过本次搭话');
                        return;
                    }
                }
            }

            const response = await fetch('/api/proactive_chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            const result = await response.json();

            if (result.success) {
                if (result.action === 'chat') {
                    // 检测用户是否在20秒内有过输入
                    const timeSinceLastInput = Date.now() - lastUserInputTime;
                    if (timeSinceLastInput < 20000) {
                        console.log(`主动搭话作废：用户在${Math.round(timeSinceLastInput / 1000)}秒前有过输入`);
                        return;
                    }

                    console.log('主动搭话已发送:', result.message);
                    // 后端会直接通过session发送消息和TTS，前端无需处理显示
                } else if (result.action === 'pass') {
                    console.log('AI选择不搭话');
                }
            } else {
                console.warn('主动搭话失败:', result.error);
            }
        } catch (error) {
            console.error('主动搭话触发失败:', error);
        }
    }

    function resetProactiveChatBackoff() {
        // 重置退避级别
        proactiveChatBackoffLevel = 0;
        // 重新安排定时器
        scheduleProactiveChat();
    }

    // 发送单帧屏幕数据（优先使用已存在的 screenCaptureStream，否则临时调用 getDisplayMedia）
    async function sendOneProactiveVisionFrame() {
        try {
            if (!socket || socket.readyState !== WebSocket.OPEN) return;

            let dataUrl = null;

            if (screenCaptureStream) {
                const video = document.createElement('video');
                video.srcObject = screenCaptureStream;
                video.autoplay = true;
                video.muted = true;
                try {
                    await video.play();
                } catch (e) {
                    // 某些情况下不需要 play() 成功也能读取帧
                }
                const frame = captureCanvasFrame(video, 0.8);
                dataUrl = frame && frame.dataUrl ? frame.dataUrl : null;
                // 清理 video 元素释放资源
                video.srcObject = null;
                video.remove();
            } else {
                // 临时调用捕获函数（会弹出授权），函数内部会关闭流
                dataUrl = await captureProactiveChatScreenshot();
            }

            if (dataUrl && socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({
                    action: 'stream_data',
                    data: dataUrl,
                    input_type: isMobile() ? 'camera' : 'screen'
                }));
                console.log('[ProactiveVision] 发送单帧屏幕数据');
            }
        } catch (e) {
            console.error('sendOneProactiveVisionFrame 失败:', e);
        }
    }

    function startProactiveVisionDuringSpeech() {
        // 如果已有定时器先清理
        if (proactiveVisionFrameTimer) {
            clearInterval(proactiveVisionFrameTimer);
            proactiveVisionFrameTimer = null;
        }

        // 仅在条件满足时启动：已开启主动视觉 && 正在录音 && 未手动屏幕共享
        if (!proactiveVisionEnabled || !isRecording) return;
        if (screenButton && screenButton.classList.contains('active')) return; // 手动共享时不启动

        proactiveVisionFrameTimer = setInterval(async () => {
            // 在每次执行前再做一次检查，避免竞态
            if (!proactiveVisionEnabled || !isRecording) {
                stopProactiveVisionDuringSpeech();
                return;
            }

            // 如果手动开启了屏幕共享，重置计数器（即跳过发送）
            if (screenButton && screenButton.classList.contains('active')) {
                // do nothing this tick, just wait for next interval
                return;
            }

            await sendOneProactiveVisionFrame();
        }, PROACTIVE_VISION_FRAME_INTERVAL);
    }

    function stopProactiveVisionDuringSpeech() {
        if (proactiveVisionFrameTimer) {
            clearInterval(proactiveVisionFrameTimer);
            proactiveVisionFrameTimer = null;
        }
    }

    function stopProactiveChatSchedule() {
        if (proactiveChatTimer) {
            clearTimeout(proactiveChatTimer);
            proactiveChatTimer = null;
        }
    }

    /**
     * 安全的Windows系统检测函数
     * 优先使用 navigator.userAgentData，然后 fallback 到 navigator.userAgent，最后才用已弃用的 navigator.platform
     * @returns {boolean} 是否为Windows系统
     */
    function isWindowsOS() {
        try {
            // 优先使用现代 API（如果支持）
            if (navigator.userAgentData && navigator.userAgentData.platform) {
                const platform = navigator.userAgentData.platform.toLowerCase();
                return platform.includes('win');
            }

            // Fallback 到 userAgent 字符串检测
            if (navigator.userAgent) {
                const ua = navigator.userAgent.toLowerCase();
                return ua.includes('win');
            }

            // 最后的兼容方案：使用已弃用的 platform API
            if (navigator.platform) {
                const platform = navigator.platform.toLowerCase();
                return platform.includes('win');
            }

            // 如果所有方法都不可用，默认返回false
            return false;
        } catch (error) {
            console.error('Windows检测失败:', error);
            return false;
        }
    }

    // 主动搭话截图函数
    async function captureProactiveChatScreenshot() {
        // API 兼容性检测
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            console.warn('主动搭话截图失败：当前浏览器不支持 getDisplayMedia API');
            return null;
        }

        let captureStream = null;

        try {
            // 使用屏幕共享API进行截图
            captureStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    cursor: 'always',
                },
                audio: false,
            });

            // 创建video元素来加载流
            const video = document.createElement('video');
            video.srcObject = captureStream;
            video.autoplay = true;
            video.muted = true;

            // 等待视频加载完成
            await video.play();

            // 使用统一的截图辅助函数进行截取（使用0.85质量）
            const { dataUrl, width, height } = captureCanvasFrame(video, 0.85);

            // 清理 video 元素释放资源
            video.srcObject = null;
            video.remove();

            console.log(`主动搭话截图成功，尺寸: ${width}x${height}`);
            return dataUrl;

        } catch (err) {
            console.error('主动搭话截图失败:', err);
            return null;
        } finally {
            // 确保流被正确关闭，防止资源泄漏
            if (captureStream) {
                captureStream.getTracks().forEach(track => track.stop());
            }
        }
    }

    // 暴露函数到全局作用域，供 live2d.js 调用
    window.resetProactiveChatBackoff = resetProactiveChatBackoff;
    window.stopProactiveChatSchedule = stopProactiveChatSchedule;
    window.startProactiveVisionDuringSpeech = startProactiveVisionDuringSpeech;
    window.stopProactiveVisionDuringSpeech = stopProactiveVisionDuringSpeech;

    // 保存设置到localStorage
    function saveSettings() {
        // 从全局变量读取最新值（确保同步 live2d.js 中的更改）
        const currentProactive = typeof window.proactiveChatEnabled !== 'undefined'
            ? window.proactiveChatEnabled
            : proactiveChatEnabled;
        const currentVision = typeof window.proactiveVisionEnabled !== 'undefined'
            ? window.proactiveVisionEnabled
            : proactiveVisionEnabled;
        const currentFocus = typeof window.focusModeEnabled !== 'undefined'
            ? window.focusModeEnabled
            : focusModeEnabled;

        const settings = {
            proactiveChatEnabled: currentProactive,
            proactiveVisionEnabled: currentVision,
            focusModeEnabled: currentFocus
        };
        localStorage.setItem('project_neko_settings', JSON.stringify(settings));

        // 同步回局部变量，保持一致性
        proactiveChatEnabled = currentProactive;
        proactiveVisionEnabled = currentVision;
        focusModeEnabled = currentFocus;
    }

    // 暴露到全局作用域，供 live2d.js 等其他模块调用
    window.saveNEKOSettings = saveSettings;

    // 从localStorage加载设置
    function loadSettings() {
        try {
            const saved = localStorage.getItem('project_neko_settings');
            if (saved) {
                const settings = JSON.parse(saved);
                // 使用 ?? 运算符提供更好的默认值处理（避免将 false 误判为需要使用默认值）
                proactiveChatEnabled = settings.proactiveChatEnabled ?? false;
                window.proactiveChatEnabled = proactiveChatEnabled; // 同步到全局
                // 主动视觉：从localStorage加载设置
                proactiveVisionEnabled = settings.proactiveVisionEnabled ?? false;
                window.proactiveVisionEnabled = proactiveVisionEnabled; // 同步到全局
                // Focus模式：从localStorage加载设置
                focusModeEnabled = settings.focusModeEnabled ?? false;
                window.focusModeEnabled = focusModeEnabled; // 同步到全局

                console.log('已加载设置:', {
                    proactiveChatEnabled: proactiveChatEnabled,
                    proactiveVisionEnabled: proactiveVisionEnabled,
                    focusModeEnabled: focusModeEnabled,
                    focusModeDesc: focusModeEnabled ? 'AI说话时自动静音麦克风（不允许打断）' : '允许打断AI说话'
                });
            } else {
                // 如果没有保存的设置，也要确保全局变量被初始化
                console.log('未找到保存的设置，使用默认值');
                window.proactiveChatEnabled = proactiveChatEnabled;
                window.focusModeEnabled = focusModeEnabled;
            }
        } catch (error) {
            console.error('加载设置失败:', error);
            // 出错时也要确保全局变量被初始化
            window.proactiveChatEnabled = proactiveChatEnabled;
            window.focusModeEnabled = focusModeEnabled;
        }
    }

    // 加载设置
    loadSettings();

    // 如果已开启主动搭话，立即启动定时器
    if (proactiveChatEnabled) {
        scheduleProactiveChat();
    }

    // 猫娘切换处理函数（通过WebSocket推送触发）
    let isSwitchingCatgirl = false;  // 标记是否正在切换猫娘，防止自动重连冲突

    async function handleCatgirlSwitch(newCatgirl, oldCatgirl) {
        console.log('[猫娘切换] handleCatgirlSwitch 被调用，参数:', { newCatgirl, oldCatgirl, current: lanlan_config.lanlan_name, isSwitchingCatgirl });

        if (isSwitchingCatgirl) {
            console.log('[猫娘切换] ⚠️ 正在切换中，忽略重复的切换请求');
            return;
        }

        if (!newCatgirl) {
            console.log('[猫娘切换] ⚠️ 新猫娘名称为空，忽略');
            return;
        }

        console.log('[猫娘切换] 🚀 开始切换，从', lanlan_config.lanlan_name, '切换到', newCatgirl);

        // 显示切换提示
        showStatusToast(window.t ? window.t('app.switchingCatgirl', { name: newCatgirl }) : `正在切换到 ${newCatgirl}...`, 3000);

        // 标记正在切换，防止自动重连冲突
        isSwitchingCatgirl = true;

        // 取消之前的自动重连定时器（避免使用旧角色名重连）
        if (autoReconnectTimeoutId) {
            clearTimeout(autoReconnectTimeoutId);
            autoReconnectTimeoutId = null;
            console.log('[猫娘切换] 已取消之前的自动重连定时器');
        }

        // 清理活跃的会话状态
        if (isRecording) {
            console.log('[猫娘切换] 停止录音');
            stopRecording();
            // 同步浮动按钮状态
            syncFloatingMicButtonState(false);
            syncFloatingScreenButtonState(false);
        }

        // 清空音频队列
        if (typeof clearAudioQueue === 'function') {
            console.log('[猫娘切换] 清空音频队列');
            clearAudioQueue();
        }

        // 重置文本会话状态
        if (isTextSessionActive) {
            console.log('[猫娘切换] 结束文本会话');
            isTextSessionActive = false;
        }

        // 更新配置
        const oldCatgirlName = lanlan_config.lanlan_name;

        // 关闭旧的 WebSocket 连接
        if (socket) {
            console.log('[猫娘切换] 关闭旧的 WebSocket 连接');
            socket.close();
            socket = null;
        }

        // 清除心跳定时器
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }

        // 更新 lanlan_config.lanlan_name 为新的角色名
        lanlan_config.lanlan_name = newCatgirl;
        console.log('[猫娘切换] 已更新 lanlan_config.lanlan_name 为:', newCatgirl);

        // 等待一小段时间确保旧连接完全关闭
        await new Promise(resolve => setTimeout(resolve, 100));

        // 重新连接 WebSocket
        console.log('[猫娘切换] 重新连接 WebSocket，新猫娘:', newCatgirl);
        connectWebSocket();

        // 更新页面标题
        document.title = `${newCatgirl} Terminal - Project N.E.K.O.`;

        // 重新加载 Live2D 模型（强制重新加载，因为猫娘已切换）
        try {
            console.log('[猫娘切换] 开始重新加载 Live2D 模型...');
            const modelResponse = await fetch(`/api/characters/current_live2d_model?catgirl_name=${encodeURIComponent(newCatgirl)}`);
            const modelData = await modelResponse.json();

            console.log('[猫娘切换] Live2D 模型 API 响应:', modelData);

            if (modelData.success && modelData.model_name && modelData.model_info) {
                console.log('[猫娘切换] 检测到新猫娘的 Live2D 模型:', modelData.model_name, '路径:', modelData.model_info.path);

                // 如果是回退模型，显示提示
                if (modelData.model_info.is_fallback) {
                    console.log('[猫娘切换] ⚠️ 新猫娘未设置Live2D模型，使用默认模型 mao_pro');
                }

                // 检查 live2dManager 是否存在并已初始化
                if (!window.live2dManager) {
                    console.error('[猫娘切换] live2dManager 不存在，无法重新加载模型');
                } else if (!window.live2dManager.pixi_app) {
                    console.error('[猫娘切换] live2dManager 未初始化，无法重新加载模型');
                } else {
                    const currentModel = window.live2dManager.getCurrentModel();
                    const currentModelPath = currentModel ? (currentModel.url || '') : '';
                    const newModelPath = modelData.model_info.path;

                    console.log('[猫娘切换] 当前模型路径:', currentModelPath);
                    console.log('[猫娘切换] 新模型路径:', newModelPath);

                    // 重新加载模型（无论路径是否相同，因为猫娘已切换）
                    console.log('[猫娘切换] 重新加载 Live2D 模型，当前路径:', currentModelPath, '新路径:', newModelPath);

                    // 获取模型配置
                    const modelConfigRes = await fetch(newModelPath);
                    if (modelConfigRes.ok) {
                        const modelConfig = await modelConfigRes.json();
                        modelConfig.url = newModelPath;

                        console.log('[猫娘切换] 开始加载模型配置...');

                        // 加载用户偏好设置
                        const preferences = await window.live2dManager.loadUserPreferences();
                        let modelPreferences = null;
                        if (preferences && preferences.length > 0) {
                            modelPreferences = preferences.find(p => p && p.model_path === newModelPath);
                            if (modelPreferences) {
                                console.log('[猫娘切换] 找到模型偏好设置:', modelPreferences);
                            } else {
                                console.log('[猫娘切换] 未找到模型偏好设置，将使用默认设置');
                            }
                        }

                        // 加载新模型
                        await window.live2dManager.loadModel(modelConfig, {
                            preferences: modelPreferences,
                            isMobile: window.innerWidth <= 768
                        });

                        // 更新全局引用
                        if (window.LanLan1) {
                            window.LanLan1.live2dModel = window.live2dManager.getCurrentModel();
                            window.LanLan1.currentModel = window.live2dManager.getCurrentModel();
                            window.LanLan1.emotionMapping = window.live2dManager.getEmotionMapping();
                        }

                        console.log('[猫娘切换] Live2D 模型已重新加载完成');
                    } else {
                        console.error('[猫娘切换] 无法获取模型配置，状态:', modelConfigRes.status);
                    }
                }
            } else {
                console.warn('[猫娘切换] 无法获取新猫娘的 Live2D 模型信息，尝试加载默认模型 mao_pro:', modelData);

                // 前端回退机制：如果后端没有返回有效的模型信息，尝试直接加载mao_pro
                try {
                    console.log('[猫娘切换] 尝试回退到默认模型 mao_pro');

                    if (window.live2dManager && window.live2dManager.pixi_app) {
                        // 查找mao_pro模型
                        const modelsResponse = await fetch('/api/live2d/models');
                        if (modelsResponse.ok) {
                            const models = await modelsResponse.json();
                            const maoProModel = models.find(m => m.name === 'mao_pro');

                            if (maoProModel) {
                                console.log('[猫娘切换] 找到默认模型 mao_pro，路径:', maoProModel.path);

                                // 获取模型配置
                                const modelConfigRes = await fetch(maoProModel.path);
                                if (modelConfigRes.ok) {
                                    const modelConfig = await modelConfigRes.json();
                                    modelConfig.url = maoProModel.path;

                                    // 加载默认模型
                                    await window.live2dManager.loadModel(modelConfig, {
                                        isMobile: window.innerWidth <= 768
                                    });

                                    // 更新全局引用
                                    if (window.LanLan1) {
                                        window.LanLan1.live2dModel = window.live2dManager.getCurrentModel();
                                        window.LanLan1.currentModel = window.live2dManager.getCurrentModel();
                                        window.LanLan1.emotionMapping = window.live2dManager.getEmotionMapping();
                                    }

                                    console.log('[猫娘切换] 已成功回退到默认模型 mao_pro');
                                } else {
                                    console.error('[猫娘切换] 无法获取默认模型配置，状态:', modelConfigRes.status);
                                }
                            } else {
                                console.error('[猫娘切换] 未找到默认模型 mao_pro');
                            }
                        } else {
                            console.error('[猫娘切换] 无法获取模型列表');
                        }
                    } else {
                        console.error('[猫娘切换] live2dManager 未初始化，无法加载默认模型');
                    }
                } catch (fallbackError) {
                    console.error('[猫娘切换] 回退到默认模型失败:', fallbackError);
                }
            }
            showStatusToast(window.t ? window.t('app.switchedCatgirl', { name: newCatgirl }) : `已切换到 ${newCatgirl}`, 3000);
        } catch (error) {
            console.error('[猫娘切换] 重新加载 Live2D 模型失败:', error);
            showStatusToast(window.t ? window.t('app.switchCatgirlFailed', { name: newCatgirl }) : `切换到 ${newCatgirl} 失败`, 4000);
            console.error('[猫娘切换] 错误堆栈:', error.stack);
        } finally {
            // 在所有操作完成后重置标记
            isSwitchingCatgirl = false;
            console.log('[猫娘切换] 切换流程已完成，重置标记');
        }

        console.log('[猫娘切换] 切换完成，已重新连接 WebSocket');
    }

    // 确保原生按钮和status栏在初始化时就被强制隐藏，永不出现
    const ensureHiddenElements = () => {
        const sidebar = document.getElementById('sidebar');
        const sidebarbox = document.getElementById('sidebarbox');
        const statusElement = document.getElementById('status');

        if (sidebar) {
            sidebar.style.setProperty('display', 'none', 'important');
            sidebar.style.setProperty('visibility', 'hidden', 'important');
            sidebar.style.setProperty('opacity', '0', 'important');
        }

        if (sidebarbox) {
            sidebarbox.style.setProperty('display', 'none', 'important');
            sidebarbox.style.setProperty('visibility', 'hidden', 'important');
            sidebarbox.style.setProperty('opacity', '0', 'important');
        }

        if (statusElement) {
            statusElement.style.setProperty('display', 'none', 'important');
            statusElement.style.setProperty('visibility', 'hidden', 'important');
            statusElement.style.setProperty('opacity', '0', 'important');
        }

        const sideButtons = document.querySelectorAll('.side-btn');
        sideButtons.forEach(btn => {
            btn.style.setProperty('display', 'none', 'important');
            btn.style.setProperty('visibility', 'hidden', 'important');
            btn.style.setProperty('opacity', '0', 'important');
        });

        console.log('[初始化] 原生按钮和status栏已强制隐藏');
    };

    // 立即执行一次
    ensureHiddenElements();

    // 使用MutationObserver监听特定元素的样式变化，确保这些元素始终保持隐藏
    const observerCallback = (mutations) => {
        // 避免递归调用：只在元素变为可见时才强制隐藏
        let needsHiding = false;
        mutations.forEach(mutation => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                const target = mutation.target;
                const computedStyle = window.getComputedStyle(target);
                if (computedStyle.display !== 'none' || computedStyle.visibility !== 'hidden') {
                    needsHiding = true;
                }
            }
        });

        if (needsHiding) {
            ensureHiddenElements();
        }
    };

    const observer = new MutationObserver(observerCallback);

    // 只监听sidebar、sidebarbox和status元素的样式变化
    const elementsToObserve = [
        document.getElementById('sidebar'),
        document.getElementById('sidebarbox'),
        document.getElementById('status')
    ].filter(Boolean);

    elementsToObserve.forEach(element => {
        observer.observe(element, {
            attributes: true,
            attributeFilter: ['style']
        });
    });
} // 兼容老按钮

const ready = () => {
    if (ready._called) return;
    ready._called = true;
    init_app();
};

// 检查页面加载状态，如果已加载完成则直接执行
if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(ready, 1); // 使用setTimeout确保异步执行，避免阻塞当前脚本执行
} else {
    document.addEventListener("DOMContentLoaded", ready);
    window.addEventListener("load", ready);
}

// 页面加载后显示启动提示
window.addEventListener("load", () => {
    setTimeout(() => {
        if (typeof window.showStatusToast === 'function' && typeof lanlan_config !== 'undefined' && lanlan_config.lanlan_name) {
            window.showStatusToast(window.t ? window.t('app.started', { name: lanlan_config.lanlan_name }) : `${lanlan_config.lanlan_name}已启动`, 3000);
        }
    }, 1000);
});

// 监听voice_id更新消息
window.addEventListener('message', function (event) {
    if (event.data.type === 'voice_id_updated') {
        console.log('[Voice Clone] 收到voice_id更新消息:', event.data.voice_id);
        if (typeof window.showStatusToast === 'function' && typeof lanlan_config !== 'undefined' && lanlan_config.lanlan_name) {
            window.showStatusToast(window.t ? window.t('app.voiceUpdated', { name: lanlan_config.lanlan_name }) : `${lanlan_config.lanlan_name}的语音已更新`, 3000);
        }
    }
});

// ==================== 字幕提示框功能 ====================

// 归一化语言代码：将 BCP-47 格式（如 'zh-CN', 'en-US'）归一化为简单代码（'zh', 'en', 'ja'）
// 与 detectLanguage() 返回的格式保持一致，避免误判
function normalizeLanguageCode(lang) {
    if (!lang) return 'zh'; // 默认中文
    const langLower = lang.toLowerCase();
    if (langLower.startsWith('zh')) {
        return 'zh';
    } else if (langLower.startsWith('ja')) {
        return 'ja';
    } else if (langLower.startsWith('en')) {
        return 'en';
    }
    return 'zh'; // 默认中文
}

// 字幕开关状态
let subtitleEnabled = localStorage.getItem('subtitleEnabled') === 'true';
// 用户语言（延迟初始化，避免使用 localStorage 旧值）
// 初始化为 null，确保在使用前从 API 获取最新值
let userLanguage = null;
// Google 翻译失败标记（会话级，页面刷新后重置）
let googleTranslateFailed = false;
// 用户语言初始化 Promise（用于确保只初始化一次）
let userLanguageInitPromise = null;

// 获取用户语言（支持语言代码归一化，延迟初始化）
async function getUserLanguage() {
    // 如果已经初始化过，直接返回
    if (userLanguage !== null) {
        return userLanguage;
    }
    
    // 如果正在初始化，等待初始化完成
    if (userLanguageInitPromise) {
        return await userLanguageInitPromise;
    }
    
    // 开始初始化
    userLanguageInitPromise = (async () => {
        try {
            // 优先从API获取最新值
            const response = await fetch('/api/config/user_language');
            const data = await response.json();
            if (data.success && data.language) {
                // 归一化语言代码：将 BCP-47 格式（如 'zh-CN', 'en-US'）归一化为简单代码（'zh', 'en', 'ja'）
                // 与 detectLanguage() 返回的格式保持一致，避免误判
                userLanguage = normalizeLanguageCode(data.language);
                localStorage.setItem('userLanguage', userLanguage);
                return userLanguage;
            }
        } catch (error) {
            console.warn('从API获取用户语言失败，尝试使用缓存或浏览器语言:', error);
        }
        
        // API失败时，尝试从localStorage获取（作为回退）
        const cachedLang = localStorage.getItem('userLanguage');
        if (cachedLang) {
            userLanguage = normalizeLanguageCode(cachedLang);
            return userLanguage;
        }
        
        // 最后回退到浏览器语言
        const browserLang = navigator.language || navigator.userLanguage;
        userLanguage = normalizeLanguageCode(browserLang);
        localStorage.setItem('userLanguage', userLanguage);
        return userLanguage;
    })();
    
    return await userLanguageInitPromise;
}

// 简单的语言检测函数（客户端）
function detectLanguage(text) {
    if (!text || !text.trim()) {
        return 'unknown';
    }
    
    // 中文检测
    const chinesePattern = /[\u4e00-\u9fff]/g;
    // 日文检测（平假名、片假名）
    const japanesePattern = /[\u3040-\u309f\u30a0-\u30ff]/g;
    // 英文检测
    const englishPattern = /[a-zA-Z]/g;
    
    const chineseCount = (text.match(chinesePattern) || []).length;
    const japaneseCount = (text.match(japanesePattern) || []).length;
    const englishCount = (text.match(englishPattern) || []).length;
    
    // 如果包含日文假名，优先判断为日语
    if (japaneseCount > 0) {
        return 'ja';
    }
    
    // 判断主要语言
    if (chineseCount > englishCount && chineseCount > 0) {
        return 'zh';
    } else if (englishCount > 0) {
        return 'en';
    } else {
        return 'unknown';
    }
}

// 字幕显示相关变量
let subtitleTimeout = null;
let currentTranslateAbortController = null;
let pendingTranslation = null;
// 流式输出时字幕语言检测的防抖计时器
let subtitleCheckDebounceTimer = null;

// 翻译消息气泡（如果用户语言不是中文）
async function translateMessageBubble(text, messageElement) {
    if (!text || !text.trim() || !messageElement) {
        return;
    }
    
    if (userLanguage === null) {
        await getUserLanguage();
    }
    
    if (!userLanguage || userLanguage === 'zh') {
        return;
    }
    
    try {
        const response = await fetch('/api/translate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: text,
                target_lang: (userLanguage !== null ? userLanguage : 'zh'),
                source_lang: 'zh',
                skip_google: googleTranslateFailed
            })
        });
        
        if (!response.ok) {
            console.warn('翻译消息气泡失败:', response.status);
            return;
        }
        
        const result = await response.json();
        
        if (result.google_failed === true) {
            googleTranslateFailed = true;
            console.log('Google 翻译失败，本次会话中将跳过 Google 翻译');
        }
        
        if (result.success && result.translated_text && result.translated_text !== text) {
            const timestampMatch = messageElement.textContent.match(/^\[(\d{2}:\d{2}:\d{2})\] 🎀 /);
            if (timestampMatch) {
                messageElement.textContent = `[${timestampMatch[1]}] 🎀 ${result.translated_text}`;
                console.log('消息气泡已翻译:', result.translated_text.substring(0, 50) + '...');
            }
        }
    } catch (error) {
        console.error('翻译消息气泡异常:', error);
    }
}

// 检查并显示字幕提示框
async function checkAndShowSubtitlePrompt(text) {
    if (userLanguage === null) {
        await getUserLanguage();
    }
    
    const allGeminiMessages = document.querySelectorAll('.message.gemini');
    let hasNonUserLanguage = false;
    let latestNonUserLanguageText = '';
    
    if (allGeminiMessages.length > 0) {
        for (const msg of allGeminiMessages) {
            const msgText = msg.textContent.replace(/^\[\d{2}:\d{2}:\d{2}\] 🎀 /, '');
            if (msgText && msgText.trim()) {
                const detectedLang = detectLanguage(msgText);
                if (detectedLang !== 'unknown' && detectedLang !== userLanguage) {
                    hasNonUserLanguage = true;
                    latestNonUserLanguageText = msgText;
                }
            }
        }
    }
    
    if (hasNonUserLanguage) {
        showSubtitlePrompt();
    } else {
        hideSubtitlePrompt();
        hideSubtitle();
    }
}

// 翻译并显示字幕
async function translateAndShowSubtitle(text) {
    if (!text || !text.trim()) {
        return;
    }
    
    // 即使开关关闭，也需要检测语言来决定是否隐藏提示
    if (userLanguage === null) {
        await getUserLanguage();
    }
    
    const currentTranslationText = text;
    pendingTranslation = currentTranslationText;
    
    if (currentTranslateAbortController) {
        currentTranslateAbortController.abort();
    }
    
    currentTranslateAbortController = new AbortController();
    
    try {
        const subtitleDisplay = document.getElementById('subtitle-display');
        if (!subtitleDisplay) {
            console.warn('字幕显示元素不存在');
            return;
        }
        
        // 调用翻译API
        const response = await fetch('/api/translate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: text,
                target_lang: (userLanguage !== null ? userLanguage : 'zh'), // 确保已初始化
                source_lang: null, // 自动检测
                skip_google: googleTranslateFailed // 如果 Google 翻译失败过，跳过它
            }),
            signal: currentTranslateAbortController.signal
        });
        
        if (!response.ok) {
            console.warn('翻译请求失败:', response.status);
            if (pendingTranslation === currentTranslationText) {
                pendingTranslation = null;
            }
            console.error('字幕翻译API请求失败:', {
                status: response.status,
                statusText: response.statusText,
                text: text.substring(0, 50) + '...',
                userLanguage: userLanguage
            });
            return;
        }
        
        const result = await response.json();
        
        if (pendingTranslation !== currentTranslationText) {
            console.log('检测到更新的翻译请求，忽略旧的翻译结果');
            return;
        }
        pendingTranslation = null;
        
        if (result.google_failed === true) {
            googleTranslateFailed = true;
            console.log('Google 翻译失败，本次会话中将跳过 Google 翻译');
        }
        
        const frontendDetectedLang = detectLanguage(text);
        const isNonUserLanguage = frontendDetectedLang !== 'unknown' && frontendDetectedLang !== userLanguage;
        
        const subtitleDisplayAfter = document.getElementById('subtitle-display');
        if (!subtitleDisplayAfter) {
            console.warn('字幕显示元素在异步操作后不存在，可能已被移除');
            return;
        }
        
        if (result.success && result.translated_text && 
            result.source_lang && result.target_lang && 
            result.source_lang !== result.target_lang && 
            result.source_lang !== 'unknown') {
            showSubtitlePrompt();
            
            if (subtitleEnabled) {
                subtitleDisplayAfter.textContent = result.translated_text;
                subtitleDisplayAfter.classList.add('show');
                subtitleDisplayAfter.classList.remove('hidden');
                subtitleDisplayAfter.style.opacity = '1';
                console.log('字幕已更新（已翻译）:', result.translated_text.substring(0, 50) + '...');
                
                if (subtitleTimeout) {
                    clearTimeout(subtitleTimeout);
                    subtitleTimeout = null;
                }
                
                subtitleTimeout = setTimeout(() => {
                    const subtitleDisplayForTimeout = document.getElementById('subtitle-display');
                    if (subtitleDisplayForTimeout && subtitleDisplayForTimeout.classList.contains('show')) {
                        hideSubtitle();
                        console.log('字幕30秒后自动隐藏');
                    }
                }, 30000);
            } else {
                subtitleDisplayAfter.textContent = '';
                subtitleDisplayAfter.classList.remove('show');
                subtitleDisplayAfter.classList.add('hidden');
                subtitleDisplayAfter.style.opacity = '0';
                console.log('开关已关闭，不显示字幕');
            }
        } else {
            if (isNonUserLanguage) {
                showSubtitlePrompt();
                subtitleDisplayAfter.textContent = '';
                subtitleDisplayAfter.classList.remove('show');
                subtitleDisplayAfter.classList.add('hidden');
                subtitleDisplayAfter.style.opacity = '0';
                console.log('前端检测到非用户语言，显示提示框');
            } else {
                hideSubtitlePrompt();
                subtitleDisplayAfter.textContent = '';
                subtitleDisplayAfter.classList.remove('show');
                subtitleDisplayAfter.classList.add('hidden');
                subtitleDisplayAfter.style.opacity = '0';
                console.log('对话已是用户语言，自动隐藏字幕提示');
            }
            if (subtitleTimeout) {
                clearTimeout(subtitleTimeout);
                subtitleTimeout = null;
            }
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            if (pendingTranslation === currentTranslationText) {
                pendingTranslation = null;
            }
            return;
        }
        
        console.error('字幕翻译异常:', {
            error: error.message,
            stack: error.stack,
            name: error.name,
            text: text.substring(0, 50) + '...',
            userLanguage: userLanguage
        });
        
        if (pendingTranslation === currentTranslationText) {
            pendingTranslation = null;
        }
        
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.warn('💡 提示：字幕翻译功能暂时不可用，但对话可以正常进行');
        }
    } finally {
        currentTranslateAbortController = null;
    }
}

// 隐藏字幕
function hideSubtitle() {
    const subtitleDisplay = document.getElementById('subtitle-display');
    if (!subtitleDisplay) return;
    
    // 清除定时器
    if (subtitleTimeout) {
        clearTimeout(subtitleTimeout);
        subtitleTimeout = null;
    }
    
    subtitleDisplay.classList.remove('show');
    subtitleDisplay.style.opacity = '0';
    
    // 延迟隐藏，让淡出动画完成
    setTimeout(() => {
        const subtitleDisplayForTimeout = document.getElementById('subtitle-display');
        if (subtitleDisplayForTimeout && subtitleDisplayForTimeout.style.opacity === '0') {
            subtitleDisplayForTimeout.classList.add('hidden');
        }
    }, 300);
}

// 显示字幕提示框（参考Xiao8项目，改为系统消息形式）
function showSubtitlePrompt() {
    // 检查是否已经显示过提示（避免重复显示）
    const existingPrompt = document.getElementById('subtitle-prompt-message');
    if (existingPrompt) {
        return;
    }
    
    const textInputArea = document.getElementById('text-input-area');
    const chatContainer = document.getElementById('chat-container');
    
    // 检测是否处于语音模式（text-input-area 被隐藏）
    const isVoiceMode = textInputArea && textInputArea.classList.contains('hidden');
    
    // 确定父容器：语音模式下使用 chat-container，否则使用 text-input-area
    let parentContainer;
    if (isVoiceMode) {
        parentContainer = chatContainer;
    } else {
        parentContainer = textInputArea;
    }
    
    if (!parentContainer) {
        return;
    }
    
    // 创建提示消息（放在输入框区域中）
    const promptDiv = document.createElement('div');
    promptDiv.id = 'subtitle-prompt-message';
    promptDiv.classList.add('subtitle-prompt-message');
    
    // 如果是语音模式，添加特殊样式类
    if (isVoiceMode) {
        promptDiv.classList.add('voice-mode');
    }
    
    // 创建提示内容
    const promptContent = document.createElement('div');
    promptContent.classList.add('subtitle-prompt-content');
    
    // 创建开关容器
    const toggleWrapper = document.createElement('div');
    toggleWrapper.classList.add('subtitle-toggle-wrapper');
    
    // 创建圆形指示器
    const indicator = document.createElement('div');
    indicator.classList.add('subtitle-toggle-indicator');
    if (subtitleEnabled) {
        indicator.classList.add('active');
    }
    
    // 创建标签文本
    const labelText = document.createElement('span');
    labelText.classList.add('subtitle-toggle-label');
    labelText.setAttribute('data-i18n', 'subtitle.enable');
    // 使用i18n翻译，如果i18n未加载或翻译不存在则根据浏览器语言提供fallback
    const browserLang = normalizeLanguageCode(navigator.language);
    const fallbacks = {
        'zh': '开启字幕翻译',
        'en': 'Enable Subtitle Translation',
        'ja': '字幕翻訳を有効にする'
    };
    if (window.t) {
        const translated = window.t('subtitle.enable');
        // 如果翻译返回的是key本身（说明翻译不存在），使用浏览器语言的fallback
        labelText.textContent = (translated && translated !== 'subtitle.enable') ? translated : (fallbacks[browserLang] || fallbacks['en']);
    } else {
        // i18n未加载时，使用浏览器语言的fallback
        labelText.textContent = fallbacks[browserLang] || fallbacks['en'];
    }
    
    toggleWrapper.appendChild(indicator);
    toggleWrapper.appendChild(labelText);
    
    promptContent.appendChild(toggleWrapper);
    promptDiv.appendChild(promptContent);
    
    // 根据模式插入到不同位置
    if (isVoiceMode) {
        // 语音模式：插入到 chat-container 底部（在 text-input-area 之前）
        if (textInputArea) {
            chatContainer.insertBefore(promptDiv, textInputArea);
        } else {
            chatContainer.appendChild(promptDiv);
        }
    } else {
        // 文本模式：插入到输入框区域的最后（在text-input-row之后）
        const textInputRow = textInputArea.querySelector('#text-input-row');
        if (textInputRow && textInputRow.nextSibling) {
            textInputArea.insertBefore(promptDiv, textInputRow.nextSibling);
        } else {
            textInputArea.appendChild(promptDiv);
        }
    }

    
    // 如果i18next已加载，监听语言变化事件
    if (window.i18next) {
        window.i18next.on('languageChanged', () => {
            if (labelText && window.t) {
                const translated = window.t('subtitle.enable');
                // 如果翻译返回的是key本身（说明翻译不存在），使用当前语言的fallback
                if (translated && translated !== 'subtitle.enable') {
                    labelText.textContent = translated;
                } else {
                    // 使用与初始渲染相同的fallback逻辑
                    const currentLang = normalizeLanguageCode(window.i18next.language || navigator.language);
                    labelText.textContent = fallbacks[currentLang] || fallbacks['en'];
                }
            }
        });
    }
    
    // 更新指示器状态
    const updateIndicator = () => {
        if (subtitleEnabled) {
            indicator.classList.add('active');
        } else {
            indicator.classList.remove('active');
        }
    };
    
    // 切换开关的函数
    const handleToggle = (e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        subtitleEnabled = !subtitleEnabled;
        localStorage.setItem('subtitleEnabled', subtitleEnabled.toString());
        updateIndicator();
        console.log('字幕开关:', subtitleEnabled ? '开启' : '关闭');
        
        if (!subtitleEnabled) {
            const subtitleDisplay = document.getElementById('subtitle-display');
            if (subtitleDisplay) {
                subtitleDisplay.textContent = '';
                subtitleDisplay.classList.remove('show');
                subtitleDisplay.classList.add('hidden');
                subtitleDisplay.style.opacity = '0';
            }
            if (subtitleTimeout) {
                clearTimeout(subtitleTimeout);
                subtitleTimeout = null;
            }
        } else {
            // 如果开启，重新翻译并显示字幕
            if (currentTranslateAbortController) {
                currentTranslateAbortController.abort();
                currentTranslateAbortController = null;
            }
            pendingTranslation = null;
            
            if (window.currentGeminiMessage && 
                window.currentGeminiMessage.nodeType === Node.ELEMENT_NODE &&
                window.currentGeminiMessage.isConnected &&
                typeof window.currentGeminiMessage.textContent === 'string') {
                const fullText = window.currentGeminiMessage.textContent.replace(/^\[\d{2}:\d{2}:\d{2}\] 🎀 /, '');
                if (fullText && fullText.trim()) {
                    const subtitleDisplay = document.getElementById('subtitle-display');
                    if (!subtitleDisplay) {
                        console.error('字幕显示元素不存在，无法显示字幕');
                        return;
                    }
                    subtitleDisplay.classList.remove('hidden');
                    translateAndShowSubtitle(fullText);
                }
            } else {
                if (window.currentGeminiMessage) {
                    console.warn('currentGeminiMessage存在但不是有效的DOM元素，无法翻译字幕');
                }
            }
        }
    };
    
    // 绑定点击事件
    toggleWrapper.addEventListener('click', handleToggle);
    indicator.addEventListener('click', handleToggle);
    labelText.addEventListener('click', handleToggle);
}

// 隐藏字幕提示框
function hideSubtitlePrompt() {
    const existingPrompt = document.getElementById('subtitle-prompt-message');
    if (existingPrompt) {
        existingPrompt.remove();
        console.log('已隐藏字幕提示消息');
    }
}

// 初始化字幕开关（DOM加载完成后）
document.addEventListener('DOMContentLoaded', async function() {
    // 初始化用户语言（等待完成，确保使用最新值）
    await getUserLanguage();

    // 检查当前消息中是否有非用户语言
    // 增强null安全检查：确保currentGeminiMessage是有效的DOM元素
    if (window.currentGeminiMessage &&
        window.currentGeminiMessage.nodeType === Node.ELEMENT_NODE &&
        window.currentGeminiMessage.isConnected &&
        typeof window.currentGeminiMessage.textContent === 'string') {
        const fullText = window.currentGeminiMessage.textContent.replace(/^\[\d{2}:\d{2}:\d{2}\] 🎀 /, '');
        if (fullText && fullText.trim()) {
            checkAndShowSubtitlePrompt(fullText);
        }
    }
});
