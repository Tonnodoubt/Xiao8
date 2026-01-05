/**
 * VRM 动画模块 - 终极修复版 (数据清洗 + 可视化诊断)
 * 1. 新增：四元数连续性修复 (解决旋转抽搐的数学根源)
 * 2. 新增：调试模式 (显示骨骼辅助线)
 * 3. 优化：严格的骨骼白名单
 */
class VRMAnimation {
    constructor(manager) {
        this.manager = manager;
        this.vrmaMixer = null;
        this.currentAction = null;
        this.vrmaIsPlaying = false;
        this._loaderPromise = null;
        this._springBoneTimer = null;

        // 播放速度
        this.playbackSpeed = 1.0; 
        
        // 调试辅助
        this.skeletonHelper = null;
        this.debug = false; // 默认关闭，可调用 toggleDebug() 开启

        // 口型同步
        this.lipSyncActive = false;
        this.analyser = null;
        this.mouthExpressions = { 'aa': null, 'ih': null, 'ou': null, 'ee': null, 'oh': null };
        this.currentMouthWeight = 0;
        this.frequencyData = null;
    }

    update(delta) {
        if (this.vrmaIsPlaying && this.vrmaMixer) {
            // 强制接管时间增量，确保速度控制绝对准确
            const safeDelta = (delta <= 0 || delta > 0.1) ? 0.016 : delta;
            this.vrmaMixer.update(safeDelta * this.playbackSpeed);

            
            // 必须在动画更新后立即更新矩阵，确保骨骼状态同步
            const vrm = this.manager.currentModel?.vrm;
            if (vrm?.scene) {
                // 先更新所有骨骼的本地变换
                vrm.scene.traverse((object) => {
                    if (object.isBone || object.type === 'Bone') {
                        object.updateMatrix();
                    }
                });
                // 然后更新世界矩阵
                vrm.scene.updateMatrixWorld(true);
            }
        }
        if (this.lipSyncActive && this.analyser) {
            this._updateLipSync(delta);
        }
    }

    async _getLoaderAndUtils() {
        if (this._loaderPromise) return this._loaderPromise;
        this._loaderPromise = (async () => {
            const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
            const { VRMLoaderPlugin } = await import('@pixiv/three-vrm'); // 简化导入
            const loader = new GLTFLoader();
            loader.register((parser) => new VRMLoaderPlugin(parser));
            return loader;
        })();
        return this._loaderPromise;
    }

    async playVRMAAnimation(vrmaPath, options = {}) {
        const vrm = this.manager.currentModel?.vrm;
        if (!vrm) return;

        try {
            // 物理防抖：暂时关闭 SpringBone
            if (this.manager.toggleSpringBone) {
                this.manager.toggleSpringBone(false);
            }

            // 清理旧 Mixer
            if (this.manager.animationMixer) {
                this.manager.animationMixer.stopAllAction();
                this.manager.animationMixer.uncacheRoot(vrm.scene);
                this.manager.animationMixer = null;
            }

            const loader = await this._getLoaderAndUtils();
            const gltf = await new Promise((resolve, reject) => loader.load(vrmaPath, resolve, undefined, reject));
            const originalClip = gltf.animations[0];

            // 针对【当前模型】创建新的 Mixer
            if (this.vrmaMixer) {
                this.vrmaMixer.stopAllAction();
                this.vrmaMixer.uncacheRoot(this.vrmaMixer.getRoot()); // 清理旧绑定
                this.vrmaMixer = null;
            }
            
            // 创建绑定到【当前新模型】(vrm.scene) 的混合器
            this.vrmaMixer = new window.THREE.AnimationMixer(vrm.scene);

            // 1. 严格映射重定向
            let clip = this._strictRetargetClip(originalClip, vrm);
            
            // 检查是否有有效的动画轨道
            if (!clip || !clip.tracks || clip.tracks.length === 0) {
                console.warn('[VRM Animation] 重定向后没有有效的动画轨道，可能骨骼映射失败');
                throw new Error('动画重定向失败：没有找到匹配的骨骼');
            }
            
            // 2. 数据清洗：修复四元数跳变
            // 这步操作会修改 clip 内部的数据，消除数学上的"翻转"
            this._ensureQuaternionContinuity(clip);

            const newAction = this.vrmaMixer.clipAction(clip);
            if (!newAction) {
                throw new Error('无法创建动画动作');
            }
            
            newAction.setLoop(options.loop ? window.THREE.LoopRepeat : window.THREE.LoopOnce);
            newAction.clampWhenFinished = true;

            // 强制设置旋转轨道的插值模式
            clip.tracks.forEach(track => {
                if (track.name.endsWith('.quaternion')) {
                    // 四元数轨道必须使用线性插值（Three.js 限制）
                    track.setInterpolation(window.THREE.InterpolateLinear);
                }
            });
            
            // 设置速度 (优先使用传入参数，否则用默认)
            this.playbackSpeed = (options.timeScale !== undefined) ? options.timeScale : 1.0;
            newAction.timeScale = 1.0; // Mixer 内部保持 1，我们在 update 里控制

            // 处理“立即播放”逻辑

            const fadeDuration = options.fadeDuration !== undefined ? options.fadeDuration : 0.4;
            const isImmediate = options.immediate === true; // 新增参数控制

            if (isImmediate) {
                // 【方案】如果要求立即播放（如初始加载）
                if (this.currentAction) this.currentAction.stop(); // 停止旧的
                
                newAction.reset();
                newAction.play(); // 直接播放，不使用 fadeIn
                
                // ⚡️ 核心魔法：强制 Mixer 立即计算第 0 帧的数据
                this.vrmaMixer.update(0);
                
                // ⚡️ 核心魔法：强制应用骨骼变换到场景中
                // 这样浏览器渲染第一帧画面时，已经是动作姿态，而不是 T-Pose
                if (vrm.scene) {
                    vrm.scene.updateMatrixWorld(true);
                }
            } else {
                // 【方案】如果是切换动作（保持原有的丝滑过渡）
                if (this.currentAction && this.currentAction !== newAction) {
                    // 同步旧状态防止跳变
                    this.vrmaMixer.update(0); 
                    if (vrm.scene) vrm.scene.updateMatrixWorld(true);
                    
                    this.currentAction.fadeOut(fadeDuration);
                    if (options.noReset) {
                        newAction.fadeIn(fadeDuration).play();
                    } else {
                        newAction.reset().fadeIn(fadeDuration).play();
                    }
                } else {
                    // 首次播放但非强制立即 (保留一点淡入)
                    newAction.reset().fadeIn(fadeDuration).play();
                }
            }

            this.currentAction = newAction;
            this.vrmaIsPlaying = true;

            // 如果开启了调试，更新骨骼辅助线
            if (this.debug) this._updateSkeletonHelper();

        } catch (error) {
            console.error('[VRM Animation] 播放失败:', error);
            this.vrmaIsPlaying = false;
        }
    }

    stopVRMAAnimation() {
        // 清理之前的定时器，防止冲突
        if (this._springBoneTimer) {
            clearTimeout(this._springBoneTimer);
            this._springBoneTimer = null;
        }

        if (this.currentAction) {
            this.currentAction.fadeOut(0.5);
            // 这里的定时器也要保存引用
            this._springBoneTimer = setTimeout(() => {
                if (this.vrmaMixer) this.vrmaMixer.stopAllAction();
                this.currentAction = null;
                this.vrmaIsPlaying = false;

                // 再次延迟启用物理
                setTimeout(() => {
                    if (this.manager.toggleSpringBone) {
                        this.manager.toggleSpringBone(true);
                    }
                }, 100);
            }, 500);
        } else {
            if (this.vrmaMixer) this.vrmaMixer.stopAllAction();
            this.vrmaIsPlaying = false;

            // 立即重新启用 SpringBone
            if (this.manager.toggleSpringBone) {
                this.manager.toggleSpringBone(true);
            }
        }
    }

    /**
     * 【核心修复算法】四元数连续性清洗 - 增强版
     * 遍历所有旋转轨道，确保相邻帧的旋转路径最短。
     * 解决"手指乱跳"和"手臂反转"的数学根源。
     * 新增：对手臂骨骼的特殊处理，使用更严格的连续性检查
     */
    _ensureQuaternionContinuity(clip) {
        const THREE = window.THREE;
        
        // 识别手臂相关骨骼（需要更严格的连续性处理）
        const armBoneNames = ['shoulder', 'upperarm', 'lowerarm', 'hand'];
        
        clip.tracks.forEach(track => {
            // 只处理旋转轨道 (quaternion)
            if (!track.name.endsWith('.quaternion')) return;

            const values = track.values; // flat array [x, y, z, w, x, y, z, w...]
            const numKeys = values.length / 4;
            
            // 检查是否是手臂骨骼
            const isArmBone = armBoneNames.some(name => track.name.toLowerCase().includes(name));
            // 手臂骨骼使用更严格的阈值（0.1而不是0），避免微小跳变
            const dotThreshold = isArmBone ? 0.1 : 0;
            
            // 临时变量
            const prevQuat = new THREE.Quaternion();
            const currQuat = new THREE.Quaternion();
            const smoothedQuat = new THREE.Quaternion();

            // 从第二帧开始检查
            for (let i = 1; i < numKeys; i++) {
                // 读取前一帧
                prevQuat.fromArray(values, (i - 1) * 4);
                // 读取当前帧
                currQuat.fromArray(values, i * 4);

                // 计算点积。如果点积 < 阈值，说明两个四元数虽然代表相同/相似的角度，
                // 但是处于四维球面的对面（导致插值时会绕地球一圈）。
                const dot = prevQuat.dot(currQuat);
                if (dot < dotThreshold) {
                    // 修复：将当前四元数所有分量取反
                    // (q 和 -q 代表相同的旋转，但取反后离前一帧更近)
                    values[i * 4]     = -values[i * 4];     // x
                    values[i * 4 + 1] = -values[i * 4 + 1]; // y
                    values[i * 4 + 2] = -values[i * 4 + 2]; // z
                    values[i * 4 + 3] = -values[i * 4 + 3]; // w
                    
                    // 更新currQuat以用于下一次检查
                    currQuat.fromArray(values, i * 4);
                }
                
                // 【新增】对于手臂骨骼，额外检查角度变化是否过大
                // 如果旋转角度超过阈值，可能是数据错误，进行平滑处理
                if (isArmBone && i > 1) {
                    const angle = prevQuat.angleTo(currQuat);
                    // 如果单帧旋转超过90度，可能是数据异常，进行平滑
                    // 使用更保守的阈值（90度而不是120度）来避免突然的大幅旋转
                    if (angle > Math.PI / 2) {
                        // 使用球面线性插值来平滑过渡，插值系数0.3让变化更渐进
                        smoothedQuat.slerpQuaternions(prevQuat, currQuat, 0.3);
                        smoothedQuat.normalize();
                        smoothedQuat.toArray(values, i * 4);
                    }
                }
            }
        });
    }

    /**
     * 严格白名单重定向 (含手指保护)
     */
    _strictRetargetClip(originalClip, vrm) {
        const tracks = [];
        const validBoneMap = new Map();
        
        if (vrm.humanoid) {
             const getBoneNode = (name) => {
                 return vrm.humanoid.getRawBoneNode ? vrm.humanoid.getRawBoneNode(name) : 
                        (vrm.humanoid.humanBones?.[name]?.node || vrm.humanoid.humanBones?.[name]);
             };

             // 仅允许标准骨骼 (不包含 Twist/Metacarpal)
             const standardBones = [
                 'hips','spine','chest','upperChest','neck','head',
                 'leftEye','rightEye',
                 'leftShoulder','rightShoulder','leftUpperArm','rightUpperArm',
                 'leftUpperArmTwist', 'rightUpperArmTwist', 
                 'leftLowerArm', 'rightLowerArm',
                 'leftLowerArmTwist', 'rightLowerArmTwist',
                 'leftHand', 'rightHand',
                 'leftUpperLeg','rightUpperLeg','leftLowerLeg','rightLowerLeg','leftFoot','rightFoot','leftToes','rightToes',
                 // 手指 (仅 3 节，过滤掌骨 Metacarpal 以防手掌变形)
                 'leftThumbProximal', 'leftThumbIntermediate', 'leftThumbDistal',
                 'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
                 'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
                 'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
                 'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',
                 'rightThumbProximal', 'rightThumbIntermediate', 'rightThumbDistal',
                 'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
                 'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
                 'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
                 'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal'
             ];
             
             standardBones.forEach(boneName => {
                 const node = getBoneNode(boneName);
                 if (node) validBoneMap.set(node.name.toLowerCase(), { node, type: boneName });
             });
        }

        originalClip.tracks.forEach((track) => {
            //允许动作文件控制表情
            //if (track.name.toLowerCase().includes('expression') || track.name.toLowerCase().includes('blendshape')) return;
            const lastDotIndex = track.name.lastIndexOf('.');
            const property = track.name.substring(lastDotIndex + 1);
            let nodeName = track.name.substring(0, lastDotIndex);

            if (property === 'scale') return; // 禁止缩放

            const targetEntry = validBoneMap.get(nodeName.toLowerCase());
            if (targetEntry) {
                const { node, type } = targetEntry;
                // 仅 Hips 允许位移，防止手指脱臼
                if (property === 'position' && type !== 'hips') return;

                const newTrack = track.clone();
                newTrack.name = `${node.name}.${property}`;

                tracks.push(newTrack);
            } else if (this.debug && (nodeName.toLowerCase().includes('arm') || nodeName.toLowerCase().includes('hand'))) {
                console.warn(`[VRM Animation] 未映射的手臂骨骼: ${nodeName} (${property})`);
            }
        });

        const THREE = window.THREE;
        return new THREE.AnimationClip(originalClip.name, originalClip.duration, tracks);
    }

    // --- 调试工具 ---
    /**
     * 开启/关闭骨骼显示
     * 在浏览器控制台输入: vrmManager.animation.toggleDebug() 即可看到骨骼
     */
    toggleDebug() {
        this.debug = !this.debug;
        if (this.debug) {
            this._updateSkeletonHelper();
        } else {
            if (this.skeletonHelper) {
                this.manager.scene.remove(this.skeletonHelper);
                this.skeletonHelper = null;
            }
        }
    }

    _updateSkeletonHelper() {
        const vrm = this.manager.currentModel?.vrm;
        if (!vrm || !this.manager.scene) return;

        if (this.skeletonHelper) this.manager.scene.remove(this.skeletonHelper);
        
        this.skeletonHelper = new window.THREE.SkeletonHelper(vrm.scene);
        this.skeletonHelper.visible = true;
        this.manager.scene.add(this.skeletonHelper);
    }

    //口型同步代码
    startLipSync(analyser) {
        this.analyser = analyser;
        this.lipSyncActive = true;
        this.updateMouthExpressionMapping();
        if (this.analyser) {
            this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
        } else {
            console.warn('[VRM LipSync] analyser为空，无法启动口型同步');
        }
    }
    stopLipSync() {
        this.lipSyncActive = false;
        this.resetMouthExpressions();
        this.analyser = null;
        this.currentMouthWeight = 0;
    }
    updateMouthExpressionMapping() {
        const vrm = this.manager.currentModel?.vrm;
        if (!vrm?.expressionManager) return;

        // 获取所有表情名称（兼容Map和Object）
        let expressionNames = [];
        const exprs = vrm.expressionManager.expressions;
        if (exprs instanceof Map) {
            expressionNames = Array.from(exprs.keys());
        } else if (Array.isArray(exprs)) {
            expressionNames = exprs.map(e => e.expressionName || e.name || e.presetName).filter(n => n);
        } else if (typeof exprs === 'object') {
            expressionNames = Object.keys(exprs);
        }

        // 映射口型表情
        ['aa', 'ih', 'ou', 'ee', 'oh'].forEach(vowel => {
            const match = expressionNames.find(name => name.toLowerCase() === vowel || name.toLowerCase().includes(vowel));
            if (match) this.mouthExpressions[vowel] = match;
        });

        console.log('[VRM LipSync] 口型表情映射:', this.mouthExpressions);
    }
    resetMouthExpressions() {
        const vrm = this.manager.currentModel?.vrm;
        if (!vrm?.expressionManager) return;

        // 重置所有已映射的口型表情
        Object.values(this.mouthExpressions).forEach(name => {
            if (name) {
                try {
                    vrm.expressionManager.setValue(name, 0);
                } catch (e) {
                    console.warn(`[VRM LipSync] 重置表情失败: ${name}`, e);
                }
            }
        });

        console.log('[VRM LipSync] 已重置所有口型表情');
    }
    _updateLipSync(delta) {
        if (!this.manager.currentModel?.vrm?.expressionManager) return;
        
        // 确保 analyser 存在，否则无法获取数据
        if (!this.analyser) return;

        // 检查数组是否存在，或者长度是否匹配
        // 如果 AudioContext 发生变化（如切换设备），frequencyBinCount 可能会变
        // 如果数组没初始化，或者长度不对，就立即重建一个正确的数组
        if (!this.frequencyData || this.frequencyData.length !== this.analyser.frequencyBinCount) {
            console.log('[VRM Animation] 自动修正口型同步数组长度');
            this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
        }
        // 获取频率数据进行音频分析
        this.analyser.getByteFrequencyData(this.frequencyData);

        // 计算低频能量 (人声主要在低频段)
        let lowFreqEnergy = 0;
        let midFreqEnergy = 0;
        const lowEnd = Math.floor(this.frequencyData.length * 0.1); // 前10%为低频
        const midEnd = Math.floor(this.frequencyData.length * 0.3); // 前30%为中频

        for(let i = 0; i < lowEnd; i++) lowFreqEnergy += this.frequencyData[i];
        for(let i = lowEnd; i < midEnd; i++) midFreqEnergy += this.frequencyData[i];

        lowFreqEnergy /= lowEnd;
        midFreqEnergy /= (midEnd - lowEnd);

        // 使用低频能量作为嘴巴开合的主要指标 (人声能量主要集中在低频)
        const volume = Math.max(lowFreqEnergy, midFreqEnergy * 0.5);
        const targetWeight = Math.min(1.0, volume / 128.0); // 0-255范围，128为中等音量

        // 平滑插值
        this.currentMouthWeight += (targetWeight - this.currentMouthWeight) * (12.0 * delta);

        // 使用平滑后的权重，允许完全闭合
        const finalWeight = Math.max(0, this.currentMouthWeight);

        // 获取嘴巴张开表情名称
        const mouthOpenName = this.mouthExpressions.aa || 'aa';

        try {
            this.manager.currentModel.vrm.expressionManager.setValue(mouthOpenName, finalWeight);
        } catch (e) {
            console.warn(`[VRM LipSync] 设置表情失败: ${mouthOpenName}`, e);
        }
    }

    dispose() {
        this.stopVRMAAnimation();
        this.stopLipSync();
        this.vrmaMixer = null;
        if (this.skeletonHelper) {
            this.manager.scene.remove(this.skeletonHelper);
        }
    }
}

window.VRMAnimation = VRMAnimation;