/**
 * VRM 动画模块
 * 负责 VRMA 动画播放和口型同步
 */

class VRMAnimation {
    constructor(manager) {
        this.manager = manager;
        
        // VRMA 动画相关
        this.vrmaMixer = null;
        this.vrmaAction = null;
        this.vrmaIsPlaying = false;
        
        // 口型同步相关
        this.lipSyncActive = false;
        this.lipSyncAnimationId = null;
        this.analyser = null;
        this.mouthExpressions = {
            'aa': null,
            'ih': null,
            'ou': null,
            'ee': null,
            'oh': null
        };
        this.currentMouthExpression = null;
        this.targetMouthWeight = 0;
        this.currentMouthWeight = 0;
    }
    
    /**
     * 更新口型表情映射（在模型加载后调用）
     */
    updateMouthExpressionMapping() {
        if (!this.manager.currentModel || !this.manager.currentModel.vrm || !this.manager.currentModel.vrm.expressionManager) {
            return;
        }

        const expressions = this.manager.currentModel.vrm.expressionManager.expressions;
        const expressionNames = Object.keys(expressions);
        
        const mouthKeywordMap = {
            'aa': ['aa', 'あ', 'ああ', 'open', 'mouthopen', 'jawopen'],
            'ih': ['ih', 'い', 'いい', 'i', 'mouthi'],
            'ou': ['ou', 'う', 'うう', 'u', 'mouthu', 'o'],
            'ee': ['ee', 'え', 'ええ', 'e', 'mouthe'],
            'oh': ['oh', 'お', 'おお', 'moutho']
        };

        Object.keys(mouthKeywordMap).forEach(targetKey => {
            const keywords = mouthKeywordMap[targetKey];
            let found = false;

            for (let i = 0; i < expressionNames.length; i++) {
                const name = expressionNames[i];
                const expr = expressions[name];
                const actualName = (expr?.name || name).toLowerCase();
                
                if (keywords.some(keyword => actualName === keyword || actualName.includes(keyword))) {
                    this.mouthExpressions[targetKey] = i;
                    found = true;
                    break;
                }
            }

            if (!found) {
                for (let i = 0; i < expressionNames.length; i++) {
                    const name = expressionNames[i];
                    const expr = expressions[name];
                    const actualName = (expr?.name || name).toLowerCase();
                    
                    if (keywords.some(keyword => actualName.includes(keyword) || keyword.includes(actualName))) {
                        this.mouthExpressions[targetKey] = i;
                        found = true;
                        break;
                    }
                }
            }
        });
    }
    
    /**
     * 检查口型同步支持
     */
    checkLipSyncSupport() {
        if (!this.manager.currentModel || !this.manager.currentModel.vrm) {
            return;
        }

        const expressions = this.manager.currentModel.vrm.expressionManager?.expressions || {};
        const expressionNames = Object.keys(expressions);
        
        const mouthKeywords = ['mouth', 'open', 'aa', 'ih', 'ou', 'ee', 'oh', 'あ', 'い', 'う', 'え', 'お', 'jaw', 'speak', 'talk', 'lip'];
        const mouthExpressions = [];
        
        expressionNames.forEach(name => {
            const expr = expressions[name];
            const actualName = (expr?.name || name).toLowerCase();
            if (mouthKeywords.some(keyword => actualName.includes(keyword))) {
                mouthExpressions.push({
                    index: name,
                    name: expr?.name || name,
                    weight: expr?.weight || 0
                });
            }
        });

        return {
            hasMouthExpressions: mouthExpressions.length > 0,
            hasMouthBlendShapes: false,
            hasJawBone: !!this.manager.currentModel.vrm.humanoid?.normalizedHumanBones?.jaw,
            mouthExpressions: mouthExpressions,
            allExpressions: expressionNames
        };
    }
    
    /**
     * 启动口型同步
     */
    startLipSync(analyser) {
        if (!this.manager.currentModel || !this.manager.currentModel.vrm || !this.manager.currentModel.vrm.expressionManager) {
            return false;
        }

        if (!analyser) {
            return false;
        }

        if (this.lipSyncActive) {
            return false;
        }

        this.updateMouthExpressionMapping();

        const hasMouthExpressions = Object.values(this.mouthExpressions).some(v => v !== null);
        if (!hasMouthExpressions) {
            return false;
        }

        this.lipSyncActive = true;
        this.analyser = analyser;

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        const frequencyData = new Uint8Array(bufferLength);

        const smoothingFactor = 0.35;
        const volumeThreshold = 0.0008;
        const volumeSensitivity = 5.5;
        const minMouthOpen = 0.05;
        const maxMouthOpen = 0.9;
        
        let smoothedVolume = 0;
        let volumeHistory = [];

        const animate = () => {
            if (!this.lipSyncActive) return;

            analyser.getByteFrequencyData(frequencyData);
            analyser.getByteTimeDomainData(dataArray);

            let sum = 0;
            let maxAmplitude = 0;
            let peakCount = 0;
            
            for (let i = 0; i < dataArray.length; i++) {
                const normalized = (dataArray[i] - 128) / 128;
                const absValue = Math.abs(normalized);
                sum += normalized * normalized;
                if (absValue > maxAmplitude) {
                    maxAmplitude = absValue;
                }
                if (absValue > 0.1) {
                    peakCount++;
                }
            }
            
            const rms = Math.sqrt(sum / dataArray.length);
            const peakDensity = peakCount / dataArray.length;
            const rawVolume = (rms * 0.6 + maxAmplitude * 0.25 + peakDensity * 0.15) * volumeSensitivity;
            
            volumeHistory.push(rawVolume);
            if (volumeHistory.length > 10) {
                volumeHistory.shift();
            }
            const avgVolume = volumeHistory.reduce((a, b) => a + b, 0) / volumeHistory.length;
            const dynamicThreshold = Math.max(volumeThreshold, avgVolume * 0.3);
            
            smoothedVolume = smoothedVolume * 0.6 + Math.min(1, rawVolume) * 0.4;
            const volume = smoothedVolume;

            if (volume < dynamicThreshold) {
                if (this.currentMouthExpression) {
                    this.targetMouthWeight = minMouthOpen;
                    this.currentMouthWeight += (this.targetMouthWeight - this.currentMouthWeight) * 0.2;
                    const expr = this.manager.currentModel.vrm.expressionManager.expressions[this.currentMouthExpression.index];
                    if (expr) {
                        expr.weight += (Math.max(minMouthOpen, this.currentMouthWeight) - expr.weight) * 0.2;
                        expr.weight = Math.max(minMouthOpen, expr.weight);
                    }
                }
                this.lipSyncAnimationId = requestAnimationFrame(animate);
                return;
            }

            const lowFreq = this.getFrequencyRange(frequencyData, 0, Math.floor(bufferLength * 0.2));
            const midFreq = this.getFrequencyRange(frequencyData, Math.floor(bufferLength * 0.2), Math.floor(bufferLength * 0.6));
            const highFreq = this.getFrequencyRange(frequencyData, Math.floor(bufferLength * 0.6), Math.floor(bufferLength * 0.85));

            const maxFreq = Math.max(lowFreq, midFreq, highFreq, 0.01);
            const normalizedLow = lowFreq / maxFreq;
            const normalizedMid = midFreq / maxFreq;
            const normalizedHigh = highFreq / maxFreq;

            let primaryExpression = null;
            let primaryWeight = 0;

            if (volume > dynamicThreshold) {
                const lowRatio = normalizedLow / (normalizedMid + normalizedHigh + 0.01);
                const highRatio = normalizedHigh / (normalizedLow + normalizedMid + 0.01);
                const midRatio = normalizedMid / (normalizedLow + normalizedHigh + 0.01);
                
                if (normalizedLow > 0.7 && lowRatio > 1.3) {
                    primaryExpression = this.mouthExpressions['aa'];
                    primaryWeight = normalizedLow;
                }
                else if (normalizedHigh > 0.65 && highRatio > 1.2) {
                    if (this.mouthExpressions['ee']) {
                        primaryExpression = this.mouthExpressions['ee'];
                    } else if (this.mouthExpressions['ih']) {
                        primaryExpression = this.mouthExpressions['ih'];
                    } else {
                        primaryExpression = this.mouthExpressions['aa'];
                    }
                    primaryWeight = normalizedHigh;
                }
                else if (normalizedMid > 0.6 && midRatio > 1.1) {
                    if (this.mouthExpressions['ou']) {
                        primaryExpression = this.mouthExpressions['ou'];
                    } else if (this.mouthExpressions['oh']) {
                        primaryExpression = this.mouthExpressions['oh'];
                    } else {
                        primaryExpression = this.mouthExpressions['aa'];
                    }
                    primaryWeight = normalizedMid;
                }
                else {
                    primaryExpression = this.mouthExpressions['aa'];
                    primaryWeight = Math.max(normalizedLow, normalizedMid, normalizedHigh, 0.4);
                }
            } else {
                primaryExpression = this.mouthExpressions['aa'];
                primaryWeight = 0.2;
            }

            if (primaryExpression !== null && primaryExpression !== undefined) {
                const normalizedVolume = Math.min(1, volume);
                const volumeCurve = Math.pow(normalizedVolume, 0.75);
                const volumeBasedWeight = minMouthOpen + (maxMouthOpen - minMouthOpen) * volumeCurve;
                
                const frequencyBoost = Math.min(0.2, primaryWeight * 0.25);
                this.targetMouthWeight = Math.min(maxMouthOpen, volumeBasedWeight + frequencyBoost);

                this.currentMouthWeight += (this.targetMouthWeight - this.currentMouthWeight) * smoothingFactor;
                this.currentMouthWeight = Math.max(minMouthOpen, Math.min(maxMouthOpen, this.currentMouthWeight));

                if (!this.currentMouthExpression || this.currentMouthExpression.index !== primaryExpression) {
                    if (this.currentMouthExpression) {
                        const oldExpr = this.manager.currentModel.vrm.expressionManager.expressions[this.currentMouthExpression.index];
                        if (oldExpr) {
                            oldExpr.weight += (0 - oldExpr.weight) * 0.35;
                            if (oldExpr.weight < 0.01) {
                                oldExpr.weight = 0;
                            }
                        }
                    }

                    this.currentMouthExpression = {
                        index: primaryExpression,
                        weight: this.currentMouthWeight
                    };
                }

                const expr = this.manager.currentModel.vrm.expressionManager.expressions[primaryExpression];
                if (expr) {
                    expr.weight += (this.currentMouthWeight - expr.weight) * smoothingFactor;
                    expr.weight = Math.max(minMouthOpen, Math.min(maxMouthOpen, expr.weight));
                }

                Object.keys(this.mouthExpressions).forEach(key => {
                    const exprIndex = this.mouthExpressions[key];
                    if (exprIndex !== null && exprIndex !== primaryExpression) {
                        const expr = this.manager.currentModel.vrm.expressionManager.expressions[exprIndex];
                        if (expr) {
                            expr.weight += (0 - expr.weight) * 0.35;
                            if (expr.weight < 0.01) {
                                expr.weight = 0;
                            }
                        }
                    }
                });
            } else {
                if (this.mouthExpressions['aa'] !== null) {
                    const defaultWeight = Math.max(minMouthOpen, Math.min(maxMouthOpen, volume * 0.8));
                    this.currentMouthWeight += (defaultWeight - this.currentMouthWeight) * smoothingFactor;
                    const defaultExpr = this.manager.currentModel.vrm.expressionManager.expressions[this.mouthExpressions['aa']];
                    if (defaultExpr) {
                        defaultExpr.weight += (this.currentMouthWeight - defaultExpr.weight) * smoothingFactor;
                        defaultExpr.weight = Math.max(minMouthOpen, Math.min(maxMouthOpen, defaultExpr.weight));
                    }
                    this.currentMouthExpression = {
                        index: this.mouthExpressions['aa'],
                        weight: this.currentMouthWeight
                    };
                }
            }

            this.lipSyncAnimationId = requestAnimationFrame(animate);
        };

        animate();
    }

    /**
     * 停止口型同步
     */
    stopLipSync() {
        if (!this.lipSyncActive) {
            return;
        }

        this.lipSyncActive = false;
        if (this.lipSyncAnimationId) {
            cancelAnimationFrame(this.lipSyncAnimationId);
            this.lipSyncAnimationId = null;
        }

        this.resetMouthExpressions();
        this.currentMouthExpression = null;
        this.targetMouthWeight = 0;
        this.currentMouthWeight = 0;
        this.analyser = null;
    }

    /**
     * 重置所有嘴巴表情
     */
    resetMouthExpressions() {
        if (!this.manager.currentModel || !this.manager.currentModel.vrm || !this.manager.currentModel.vrm.expressionManager) return;
        
        Object.values(this.mouthExpressions).forEach(index => {
            if (index !== null && index !== undefined) {
                const expr = this.manager.currentModel.vrm.expressionManager.expressions[index];
                if (expr) {
                    expr.weight = 0;
                }
            }
        });
    }

    /**
     * 获取频率范围的平均值
     */
    getFrequencyRange(frequencyData, start, end) {
        let sum = 0;
        let count = 0;
        for (let i = start; i < Math.min(end, frequencyData.length); i++) {
            sum += frequencyData[i];
            count++;
        }
        return count > 0 ? (sum / count) / 255 : 0;
    }
    
    /**
     * 更新动画（在渲染循环中调用）
     */
    update(deltaTime) {
        // 更新 VRMA 动画
        if (this.vrmaMixer && this.vrmaAction && this.vrmaIsPlaying) {
            // 确保action仍然启用
            if (!this.vrmaAction.enabled) {
                console.warn('[VRMA] 动画Action被禁用，重新启用...');
                this.vrmaAction.enabled = true;
                this.vrmaAction.play();
            }
            
            this.vrmaMixer.update(deltaTime);
            
            // 每60帧输出一次调试信息（约每秒一次）
            if (this._debugFrameCount === undefined) this._debugFrameCount = 0;
            this._debugFrameCount++;
            if (this._debugFrameCount % 60 === 0) {
                const mixerInfo = this.vrmaMixer ? {
                    mixerTime: this.vrmaMixer.time.toFixed(3),
                    mixerRoot: this.vrmaMixer.getRoot(),
                    mixerStats: this.vrmaMixer.stats
                } : 'no mixer';

                console.log('[VRMA] 动画更新中:', {
                    time: this.vrmaAction.time.toFixed(3),
                    weight: this.vrmaAction.getEffectiveWeight().toFixed(3),
                    isRunning: this.vrmaAction.isRunning(),
                    enabled: this.vrmaAction.enabled,
                    deltaTime: deltaTime.toFixed(4),
                    mixer: mixerInfo
                });
            }
            
            // 检查非循环动画是否播放完毕
            if (this.vrmaAction && !this.vrmaAction.loop) {
                const clip = this.vrmaAction.getClip();
                if (clip && this.vrmaAction.time >= clip.duration) {
                    this.stopVRMAAnimation();
                }
            }
        } else if (this.vrmaIsPlaying) {
            // 如果标记为播放但mixer或action不存在，输出警告
            console.warn('[VRMA] 动画标记为播放但mixer或action不存在:', {
                hasMixer: !!this.vrmaMixer,
                hasAction: !!this.vrmaAction,
                isPlaying: this.vrmaIsPlaying
            });
        }

        // 在渲染循环中持续更新口型表情
        if (this.lipSyncActive && this.manager.currentModel?.vrm?.expressionManager && this.currentMouthExpression) {
            const expr = this.manager.currentModel.vrm.expressionManager.expressions[this.currentMouthExpression.index];
            if (expr && this.currentMouthWeight > 0) {
                expr.weight = this.currentMouthWeight;
                
                if (typeof expr.update === 'function') {
                    try {
                        expr.update();
                    } catch (e) {}
                }
                
                if (typeof this.manager.currentModel.vrm.expressionManager.update === 'function') {
                    try {
                        this.manager.currentModel.vrm.expressionManager.update();
                    } catch (e) {}
                }
            }
        }
    }
    
    /**
     * 加载并播放 VRMA 动画
     */
    async playVRMAAnimation(vrmaPath, options = {}) {
        console.log('[VRMA] playVRMAAnimation 被调用:', {
            vrmaPath: vrmaPath,
            options: options,
            hasModel: !!this.manager.currentModel,
            hasVRM: !!(this.manager.currentModel && this.manager.currentModel.vrm),
            hasScene: !!(this.manager.currentModel && this.manager.currentModel.vrm && this.manager.currentModel.vrm.scene)
        });

        if (!this.manager.currentModel || !this.manager.currentModel.vrm || !this.manager.currentModel.vrm.scene) {
            throw new Error('VRM 模型未加载');
        }

        try {
            console.log('[VRMA] 停止之前的动画...');
            this.stopVRMAAnimation();

            // 动态导入 GLTFLoader 和 VRMLoaderPlugin
            console.log('[VRMA] 开始导入必要的模块...');
            let GLTFLoader, VRMLoaderPlugin;

            // 优先使用 ES 模块导入（更可靠）
            try {
                console.log('[VRMA] 尝试ES6模块导入...');
                const loaderModule = await import('three/addons/loaders/GLTFLoader.js');
                GLTFLoader = loaderModule.GLTFLoader;
                console.log('[VRMA] GLTFLoader导入成功');

                const vrmModule = await import('@pixiv/three-vrm');
                VRMLoaderPlugin = vrmModule.VRMLoaderPlugin;
                console.log('[VRMA] VRMLoaderPlugin导入成功');
            } catch (e) {
                console.error('[VRMA] ES6模块导入失败:', e);
                throw new Error(`无法加载必要的VRM模块: ${e.message}`);
            }

            console.log('[VRMA] 创建GLTFLoader并加载动画文件:', vrmaPath);
            const loader = new GLTFLoader();
            loader.register((parser) => {
                return new VRMLoaderPlugin(parser);
            });

            const gltf = await new Promise((resolve, reject) => {
                console.log('[VRMA] 开始加载VRMA文件...');
                loader.load(
                    vrmaPath,
                    (gltf) => {
                        console.log('[VRMA] VRMA文件加载成功:', {
                            hasAnimations: !!(gltf.animations && gltf.animations.length > 0),
                            animationCount: gltf.animations ? gltf.animations.length : 0
                        });
                        resolve(gltf);
                    },
                    (progress) => {
                        if (progress.lengthComputable) {
                            const percent = (progress.loaded / progress.total) * 100;
                            console.log(`[VRMA] 加载进度: ${percent.toFixed(1)}%`);
                        }
                    },
                    (error) => {
                        console.error('[VRMA] VRMA文件加载失败:', error);
                        reject(error);
                    }
                );
            });

            if (!gltf.animations || gltf.animations.length === 0) {
                throw new Error('VRMA 文件中没有找到动画数据');
            }

            const originalClip = gltf.animations[0];
            const vrmScene = this.manager.currentModel.vrm.scene;
            
            // 收集所有节点名称（包括骨骼节点）
            const vrmNodeNames = new Set();
            const vrmNodeMap = new Map();

            console.log('[VRMA] 收集VRM模型节点...');

            // 优先收集humanoid骨骼节点（VRM标准骨骼）
            if (this.manager.currentModel.vrm.humanoid) {
                const humanBones = this.manager.currentModel.vrm.humanoid.humanBones;
                if (humanBones) {
                    console.log('[VRMA] humanoid骨骼数量:', Object.keys(humanBones).length);
                    Object.keys(humanBones).forEach(boneName => {
                        const bone = humanBones[boneName];
                        if (bone && bone.node && bone.node.name) {
                            vrmNodeNames.add(bone.node.name);
                            vrmNodeMap.set(bone.node.name, bone.node);
                            console.log(`[VRMA] humanoid骨骼: ${boneName} -> ${bone.node.name}`);
                        }
                    });
                }
            }

            // 遍历场景收集所有节点
            vrmScene.traverse((node) => {
                if (node.name) {
                    vrmNodeNames.add(node.name);
                    vrmNodeMap.set(node.name, node);
                }
            });
            
            console.log(`[VRMA] 模型节点总数: ${vrmNodeNames.size}`);
            
            const validTracks = [];
            const skippedTracks = [];
            const trackNodeNames = new Set();
            
            // 收集动画中的所有节点名称
            console.log('[VRMA] 分析动画轨道...');
            for (const track of originalClip.tracks) {
                const match = track.name.match(/^([^.]+)\.(.+)$/);
                if (match) {
                    trackNodeNames.add(match[1]);
                    console.log(`[VRMA] 动画轨道: ${track.name} -> 节点: ${match[1]}, 属性: ${match[2]}`);
                } else {
                    console.log(`[VRMA] 无法解析的轨道: ${track.name}`);
                }
            }

            console.log(`[VRMA] 动画中的节点总数: ${trackNodeNames.size}`);
            console.log(`[VRMA] 动画轨道总数: ${originalClip.tracks.length}`);
            console.log(`[VRMA] 动画节点列表:`, Array.from(trackNodeNames));

            // 尝试映射轨道到VRM节点
            for (const track of originalClip.tracks) {
                const match = track.name.match(/^([^.]+)\.(.+)$/);
                if (match) {
                    const nodeName = match[1];
                    const property = match[2];

                    console.log(`[VRMA] 检查轨道映射: ${nodeName}.${property}`);

                    if (vrmNodeNames.has(nodeName)) {
                        validTracks.push(track);
                        console.log(`[VRMA] ✓ 轨道匹配: ${nodeName}`);
                    } else {
                        skippedTracks.push(nodeName);
                        console.log(`[VRMA] ✗ 轨道不匹配: ${nodeName} (属性: ${property})`);
                    }
                } else {
                    skippedTracks.push(track.name);
                    console.log(`[VRMA] ✗ 无效轨道格式: ${track.name}`);
                }
            }
            
            if (validTracks.length === 0) {
                // 提供更详细的错误信息
                const missingNodes = Array.from(trackNodeNames).filter(name => !vrmNodeNames.has(name));
                const modelNodes = Array.from(vrmNodeNames).slice(0, 20);
                console.error('[VRMA] 节点匹配失败详情:', {
                    动画节点数: trackNodeNames.size,
                    模型节点数: vrmNodeNames.size,
                    缺失的节点: missingNodes.slice(0, 10),
                    模型节点示例: modelNodes
                });
                throw new Error(`VRMA动画中没有找到与VRM模型匹配的节点。动画需要 ${trackNodeNames.size} 个节点，但模型只有 ${vrmNodeNames.size} 个节点。缺失的节点示例: ${missingNodes.slice(0, 5).join(', ')}`);
            }
            
            const clip = new window.THREE.AnimationClip(
                originalClip.name || 'VRMA_Animation',
                originalClip.duration,
                validTracks
            );
            
            if (skippedTracks.length > 0) {
                const uniqueSkipped = [...new Set(skippedTracks)];
                console.log(`[VRMA] 已过滤 ${skippedTracks.length} 个不匹配的轨道（${uniqueSkipped.length} 个唯一节点）`);
                console.log(`[VRMA] 有效轨道: ${validTracks.length} 个`);
            }
            
            // 创建AnimationMixer - VRM动画绑定逻辑
            if (!this.vrmaMixer) {
                // 对于VRM模型，AnimationMixer应该绑定到GLTF的scene（包含所有骨骼变换）
                // 而不是VRM的scene（可能只是一个包装器）
                const bindTarget = this.manager.currentModel.scene; // 使用GLTF的scene
                this.vrmaMixer = new window.THREE.AnimationMixer(bindTarget);
                console.log('[VRMA] 创建AnimationMixer，绑定到GLTF.scene');
                console.log('[VRMA] VRM对象结构:', {
                    hasScene: !!this.manager.currentModel.vrm.scene,
                    hasHumanoid: !!this.manager.currentModel.vrm.humanoid,
                    gltfScene: !!this.manager.currentModel.scene,
                    vrmSceneChildren: this.manager.currentModel.vrm.scene ? this.manager.currentModel.vrm.scene.children.length : 0
                });
            }

            this.vrmaAction = this.vrmaMixer.clipAction(clip);

            const loop = options.loop !== undefined ? options.loop : true;
            this.vrmaAction.setLoop(loop ? window.THREE.LoopRepeat : window.THREE.LoopOnce);

            const timeScale = options.timeScale !== undefined ? options.timeScale : 1.0;
            this.vrmaAction.timeScale = timeScale;

            // 确保动画权重设置为1.0，这样才能看到动画效果
            this.vrmaAction.setEffectiveWeight(1.0);
            this.vrmaAction.setEffectiveTimeScale(1.0);

            // 如果是非循环动画，监听播放完毕事件
            if (!loop) {
                const onFinished = () => {
                    this.stopVRMAAnimation();
                    this.vrmaAction.removeEventListener('finished', onFinished);
                };
                this.vrmaAction.addEventListener('finished', onFinished);
            }

            // 启用并播放动画
            this.vrmaAction.enabled = true;
            this.vrmaAction.play();
            this.vrmaIsPlaying = true;
            
            console.log('[VRMA] 动画Action设置:', {
                enabled: this.vrmaAction.enabled,
                isRunning: this.vrmaAction.isRunning(),
                weight: this.vrmaAction.getEffectiveWeight(),
                timeScale: this.vrmaAction.getEffectiveTimeScale(),
                loop: loop,
                clipDuration: clip.duration,
                mixer: !!this.vrmaMixer,
                tracks: validTracks.length,
                root: this.vrmaMixer ? this.vrmaMixer.getRoot() : 'none'
            });

            // 测试动画是否真的在运行
            setTimeout(() => {
                console.log('[VRMA] 动画启动后检查:', {
                    time: this.vrmaAction.time,
                    isRunning: this.vrmaAction.isRunning(),
                    enabled: this.vrmaAction.enabled,
                    mixerTime: this.vrmaMixer ? this.vrmaMixer.time : 'no mixer'
                });
            }, 100);

            console.log('[VRMA] 动画播放成功:', {
                url: vrmaPath,
                action: this.vrmaAction,
                isPlaying: this.vrmaAction.isRunning(),
                time: this.vrmaAction.time,
                weight: this.vrmaAction.getEffectiveWeight(),
                effectiveWeight: this.vrmaAction.getEffectiveWeight(),
                mixer: this.vrmaMixer,
                clip: clip,
                tracksCount: validTracks.length,
                originalTracksCount: originalClip.tracks.length
            });

        } catch (error) {
            console.error('[VRMA] 加载动画失败:', error);
            throw error;
        }
    }

    /**
     * 停止 VRMA 动画
     */
    stopVRMAAnimation() {
        if (this.vrmaAction) {
            try {
                this.vrmaAction.stop();
                this.vrmaAction.reset();
                this.vrmaAction = null;
            } catch (error) {
                console.warn('[VRMA] 停止动画时出错:', error);
                this.vrmaAction = null;
            }
        }
        this.vrmaIsPlaying = false;
        console.log('[VRMA] 动画已停止');
    }
    
    /**
     * 暂停/恢复 VRMA 动画
     */
    pauseVRMAAnimation() {
        if (this.vrmaAction) {
            if (this.vrmaIsPlaying) {
                this.vrmaAction.paused = true;
                this.vrmaIsPlaying = false;
                console.log('[VRMA] 动画已暂停');
            } else {
                this.vrmaAction.paused = false;
                this.vrmaIsPlaying = true;
                console.log('[VRMA] 动画已恢复');
            }
        }
    }
    
    /**
     * 清理动画资源
     */
    dispose() {
        this.stopLipSync();
        this.stopVRMAAnimation();
        if (this.vrmaMixer && this.manager.currentModel && this.manager.currentModel.vrm) {
            this.vrmaMixer.uncacheRoot(this.manager.currentModel.vrm.scene);
            this.vrmaMixer = null;
        }
    }
}

// 导出到全局
window.VRMAnimation = VRMAnimation;

