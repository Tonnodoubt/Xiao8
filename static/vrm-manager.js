/**
 * VRM Manager - 管理VRM模型的加载和渲染
 * 使用Three.js和@pixiv/three-vrm库
 */

class VRMManager {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.currentModel = null;
        this.animationMixer = null;
        this.clock = null;
        this.container = null;
        this.canvas = null;
        this.controls = null; // OrbitControls
        this.currentAnimationAction = null; // 当前播放的动画动作
    }

    /**
     * 初始化Three.js场景
     * @param {string} canvasId - Canvas元素的ID
     * @param {string} containerId - 容器元素的ID
     */
    async initThreeJS(canvasId, containerId) {
        try {
            // 确保THREE已加载
            if (typeof window.THREE === 'undefined') {
                throw new Error('Three.js库未加载，请确保已引入three.js');
            }
            
            const THREE = window.THREE;
            
            this.container = document.getElementById(containerId);
            this.canvas = document.getElementById(canvasId);
            
            if (!this.container || !this.canvas) {
                throw new Error(`找不到容器或Canvas元素: ${containerId} / ${canvasId}`);
            }

            // 初始化时钟
            this.clock = new THREE.Clock();

            // 创建场景
            this.scene = new THREE.Scene();
            // 设置透明背景
            this.scene.background = null;

            // 创建相机
            const width = this.container.clientWidth;
            const height = this.container.clientHeight;
            this.camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 1000);
            this.camera.position.set(0, 1.2, 2.5);

            // 创建渲染器（优化质量和性能）
            this.renderer = new THREE.WebGLRenderer({
                canvas: this.canvas,
                alpha: true,
                antialias: true,
                powerPreference: "high-performance", // 优先使用高性能GPU
                stencil: false, // 禁用模板缓冲区以提升性能
                depth: true
            });
            this.renderer.setSize(width, height);
            // 限制像素比以提升性能，但保持质量
            const pixelRatio = Math.min(window.devicePixelRatio, 2); // 最多2倍像素比
            this.renderer.setPixelRatio(pixelRatio);
            
            // 优化阴影设置（禁用阴影以提升性能）
            this.renderer.shadowMap.enabled = false;
            
            // 优化渲染设置
            this.renderer.outputEncoding = THREE.sRGBEncoding;
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = 1.0;
            
            // 启用物理正确光照
            this.renderer.useLegacyLights = false;

            // 添加轨道控制器（优化响应速度）
            if (typeof window.OrbitControls !== 'undefined') {
                this.controls = new window.OrbitControls(this.camera, this.renderer.domElement);
                this.controls.target.set(0, 1, 0); // 设置焦点在模型中心
                this.controls.enableDamping = true; // 启用阻尼
                this.controls.dampingFactor = 0.1; // 增加阻尼因子以提升响应速度
                this.controls.enablePan = true;
                this.controls.enableZoom = true;
                this.controls.enableRotate = true;
                this.controls.minDistance = 0.5;
                this.controls.maxDistance = 10;
                this.controls.rotateSpeed = 1.0; // 旋转速度
                this.controls.zoomSpeed = 1.0; // 缩放速度
                this.controls.panSpeed = 1.0; // 平移速度
                this.controls.update();
            }

            // 优化光照设置（提升性能和视觉效果）
            // 使用半球光以获得更自然的光照（增强强度）
            const hemiLight = new THREE.HemisphereLight(0xffffff, 0x666666, 1.2);
            hemiLight.position.set(0, 1, 0);
            this.scene.add(hemiLight);

            // 主正面方向光（从相机方向照射，强度更高）
            const mainLight = new THREE.DirectionalLight(0xffffff, 1.2);
            mainLight.position.set(0, 1.2, 2.5); // 从正面照射，位置接近相机
            mainLight.castShadow = false; // 禁用阴影以提升性能
            this.scene.add(mainLight);

            // 右侧补光
            const rightLight = new THREE.DirectionalLight(0xffffff, 0.6);
            rightLight.position.set(1.5, 1.5, 1);
            rightLight.castShadow = false;
            this.scene.add(rightLight);

            // 左侧补光
            const leftLight = new THREE.DirectionalLight(0xffffff, 0.5);
            leftLight.position.set(-1.5, 1, 1);
            leftLight.castShadow = false;
            this.scene.add(leftLight);

            // 顶部补光（增强整体亮度）
            const topLight = new THREE.DirectionalLight(0xffffff, 0.4);
            topLight.position.set(0, 3, 0);
            topLight.castShadow = false;
            this.scene.add(topLight);

            // 处理窗口大小变化
            window.addEventListener('resize', () => this.onWindowResize());

            // 开始渲染循环
            this.animate();

            console.log('Three.js场景初始化完成');
            return true;
        } catch (error) {
            console.error('初始化Three.js场景失败:', error);
            throw error;
        }
    }

    /**
     * 处理窗口大小变化
     */
    onWindowResize() {
        if (!this.container || !this.camera || !this.renderer) return;

        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
        
        // 限制像素比以保持性能
        const pixelRatio = Math.min(window.devicePixelRatio, 2);
        this.renderer.setPixelRatio(pixelRatio);
    }

    /**
     * 渲染循环
     */
    animate() {
        requestAnimationFrame(() => this.animate());

        const delta = this.clock.getDelta();

        // 更新控制器
        if (this.controls) {
            this.controls.update();
        }

        // 更新动画
        if (this.animationMixer) {
            this.animationMixer.update(delta);
        }

        // 更新VRM模型（如果有）
        if (this.currentModel && this.currentModel.vrm) {
            this.currentModel.vrm.update(delta);
        }

        // 只在需要时渲染（如果控制器正在更新，说明用户在交互）
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    /**
     * 加载VRM模型
     * @param {string} modelUrl - VRM模型文件的URL
     * @param {object} options - 加载选项
     */
    async loadModel(modelUrl, options = {}) {
        try {
            console.log('开始加载VRM模型:', modelUrl);

            // 如果已有模型，先移除
            if (this.currentModel) {
                this.removeModel();
            }

            // 检查three-vrm是否已加载
            if (typeof window.THREE === 'undefined') {
                throw new Error('Three.js库未加载，请确保已引入three.js');
            }
            
            if (typeof window.VRMLoaderPlugin === 'undefined') {
                throw new Error('three-vrm库未加载，请确保已引入@pixiv/three-vrm');
            }

            // 创建GLTFLoader
            if (typeof window.GLTFLoader === 'undefined') {
                throw new Error('GLTFLoader未加载，请确保已引入three/addons/loaders/GLTFLoader.js');
            }
            const loader = new window.GLTFLoader();
            
            // 注册VRM扩展（使用新版本API）
            loader.register((parser) => {
                return new window.VRMLoaderPlugin(parser);
            });

            // 加载模型
            const gltf = await new Promise((resolve, reject) => {
                loader.load(
                    modelUrl,
                    (gltf) => resolve(gltf),
                    (progress) => {
                        if (options.onProgress) {
                            options.onProgress(progress);
                        }
                    },
                    (error) => reject(error)
                );
            });

            // 获取VRM对象
            const vrm = gltf.userData.vrm;
            if (!vrm) {
                throw new Error('加载的模型不是有效的VRM文件');
            }

            // 设置模型位置和缩放
            const vrmScene = gltf.scene;
            
            // 计算模型的边界框以自动调整位置
            const box = new window.THREE.Box3().setFromObject(vrmScene);
            const center = box.getCenter(new window.THREE.Vector3());
            const size = box.getSize(new window.THREE.Vector3());
            
            // 将模型居中
            vrmScene.position.x = -center.x;
            vrmScene.position.y = -center.y;
            vrmScene.position.z = -center.z;
            
            // 根据模型大小调整缩放（可选）
            if (options.scale) {
                vrmScene.scale.set(options.scale.x || 1, options.scale.y || 1, options.scale.z || 1);
            } else {
                // 自动缩放以适应视图
                const maxDim = Math.max(size.x, size.y, size.z);
                if (maxDim > 0) {
                    const targetSize = 1.5; // 目标大小
                    const scale = targetSize / maxDim;
                    vrmScene.scale.multiplyScalar(scale);
                }
            }

            // 添加到场景
            this.scene.add(vrmScene);
            
            // 优化VRM材质和渲染质量
            vrmScene.traverse((object) => {
                if (object.isMesh) {
                    // 优化材质设置以提升渲染质量
                    if (object.material) {
                        const materials = Array.isArray(object.material) ? object.material : [object.material];
                        materials.forEach(material => {
                            if (material) {
                                // 确保材质更新
                                material.needsUpdate = true;
                                // 优化纹理
                                if (material.map) {
                                    material.map.needsUpdate = true;
                                    material.map.generateMipmaps = true;
                                    material.map.minFilter = THREE.LinearMipmapLinearFilter;
                                    material.map.magFilter = THREE.LinearFilter;
                                }
                                // 优化材质属性
                                if (material.roughness !== undefined) {
                                    material.roughness = Math.max(0.1, material.roughness || 0.9);
                                }
                            }
                        });
                    }
                    // 优化几何体
                    if (object.geometry) {
                        object.geometry.computeBoundingSphere();
                    }
                }
            });
            
            // 调整相机位置以更好地查看模型
            if (this.controls) {
                // 重新计算边界框（考虑缩放后）
                const newBox = new window.THREE.Box3().setFromObject(vrmScene);
                const newSize = newBox.getSize(new window.THREE.Vector3());
                const maxSize = Math.max(newSize.x, newSize.y, newSize.z);
                
                // 设置相机距离
                const distance = maxSize * 2.5;
                this.camera.position.set(0, maxSize * 0.6, distance);
                this.controls.target.set(0, maxSize * 0.3, 0);
                this.controls.update();
            }
            
            // 强制渲染一次以确保立即显示
            if (this.renderer && this.scene && this.camera) {
                this.renderer.render(this.scene, this.camera);
            }

            // 设置动画混合器
            this.animationMixer = new window.THREE.AnimationMixer(vrmScene);

            // 播放默认动画（如果有）
            if (gltf.animations && gltf.animations.length > 0) {
                const action = this.animationMixer.clipAction(gltf.animations[0]);
                action.play();
            }

            // 保存当前模型
            this.currentModel = {
                vrm: vrm,
                gltf: gltf,
                scene: vrmScene,
                url: modelUrl
            };

            console.log('VRM模型加载成功:', modelUrl);
            return this.currentModel;
        } catch (error) {
            console.error('加载VRM模型失败:', error);
            throw error;
        }
    }

    /**
     * 移除当前模型
     */
    removeModel() {
        if (this.currentModel && this.currentModel.scene) {
            this.scene.remove(this.currentModel.scene);
            
            // 清理资源
            this.currentModel.scene.traverse((object) => {
                if (object.geometry) object.geometry.dispose();
                if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach(material => material.dispose());
                    } else {
                        object.material.dispose();
                    }
                }
            });

            this.currentModel = null;
        }

        if (this.animationMixer) {
            this.animationMixer = null;
        }
    }

    /**
     * 获取当前模型
     */
    getCurrentModel() {
        return this.currentModel;
    }

    /**
     * 设置模型位置
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @param {number} z - Z坐标
     */
    setModelPosition(x, y, z) {
        if (this.currentModel && this.currentModel.scene) {
            this.currentModel.scene.position.set(x, y, z);
        }
    }

    /**
     * 设置模型缩放
     * @param {number} x - X缩放
     * @param {number} y - Y缩放
     * @param {number} z - Z缩放
     */
    setModelScale(x, y, z) {
        if (this.currentModel && this.currentModel.scene) {
            this.currentModel.scene.scale.set(x, y, z);
        }
    }

    /**
     * 设置相机位置
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @param {number} z - Z坐标
     */
    setCameraPosition(x, y, z) {
        if (this.camera) {
            this.camera.position.set(x, y, z);
            this.camera.lookAt(0, 1, 0);
        }
    }

    /**
     * 加载并播放VRM动画（VRMA文件）
     * @param {string} animationUrl - 动画文件的URL
     * @param {object} options - 播放选项
     */
    async loadAndPlayAnimation(animationUrl, options = {}) {
        try {
            if (!this.currentModel || !this.currentModel.vrm) {
                throw new Error('请先加载VRM模型');
            }

            console.log('开始加载VRM动画:', animationUrl);

            // 停止当前动画
            if (this.currentAnimationAction) {
                this.currentAnimationAction.stop();
                this.currentAnimationAction = null;
            }

            // 创建GLTFLoader加载动画
            const loader = new window.GLTFLoader();
            loader.register((parser) => {
                return new window.VRMLoaderPlugin(parser);
            });

            // 加载动画文件
            const gltf = await new Promise((resolve, reject) => {
                loader.load(
                    animationUrl,
                    (gltf) => resolve(gltf),
                    (progress) => {
                        if (options.onProgress) {
                            options.onProgress(progress);
                        }
                    },
                    (error) => reject(error)
                );
            });

            // 获取动画
            if (!gltf.animations || gltf.animations.length === 0) {
                throw new Error('动画文件中没有找到动画');
            }

            // 确保animationMixer存在，并绑定到当前模型场景
            // 重要：每次加载新动画时，确保mixer绑定到正确的场景对象
            if (!this.animationMixer || this.animationMixer.getRoot() !== this.currentModel.scene) {
                // 如果mixer不存在或绑定到错误的根对象，重新创建
                if (this.animationMixer) {
                    // 清理旧的mixer
                    this.animationMixer.stopAllAction();
                }
                this.animationMixer = new window.THREE.AnimationMixer(this.currentModel.scene);
                console.log('创建新的AnimationMixer，绑定到场景:', this.currentModel.scene);
            }

            // 停止所有现有动画
            this.animationMixer.stopAllAction();

            // 使用第一个动画
            const animationClip = gltf.animations[0];
            console.log('找到动画clip:', animationClip.name, '时长:', animationClip.duration);
            console.log('动画tracks数量:', animationClip.tracks.length);
            
            // 对于VRM动画，需要将tracks重新映射到当前模型的骨骼
            // 创建一个新的AnimationClip，将tracks映射到当前模型的节点
            const vrm = this.currentModel.vrm;
            const vrmScene = this.currentModel.scene;
            
            // 创建映射后的tracks
            const mappedTracks = [];
            for (const track of animationClip.tracks) {
                // 解析track名称：格式通常是 "NodeName.property" 或 "NodeName.property.subproperty"
                const dotIndex = track.name.indexOf('.');
                if (dotIndex === -1) {
                    console.warn('Track名称格式不正确，缺少属性路径:', track.name);
                    continue; // 跳过格式不正确的track
                }
                
                const nodeName = track.name.substring(0, dotIndex);
                const propertyPath = track.name.substring(dotIndex + 1); // 包含点号后的所有内容
                
                // 尝试在当前VRM场景中找到对应的节点
                let targetNode = vrmScene.getObjectByName(nodeName);
                let finalTrackName = track.name; // 默认使用原始名称
                
                // 如果找不到，尝试通过VRM的humanoid系统查找
                if (!targetNode && vrm.humanoid) {
                    try {
                        // 方法1: 尝试使用getNormalizedBoneNode（新版本API）
                        if (typeof vrm.humanoid.getNormalizedBoneNode === 'function') {
                            const humanBone = vrm.humanoid.getNormalizedBoneNode(nodeName);
                            if (humanBone && humanBone.node) {
                                targetNode = humanBone.node;
                                finalTrackName = humanBone.node.name + '.' + propertyPath;
                            }
                        }
                        
                        // 方法2: 直接访问humanBones对象（如果方法1失败）
                        if (!targetNode && vrm.humanoid.humanBones) {
                            const humanBones = vrm.humanoid.humanBones;
                            if (humanBones[nodeName] && humanBones[nodeName].node) {
                                targetNode = humanBones[nodeName].node;
                                finalTrackName = humanBones[nodeName].node.name + '.' + propertyPath;
                            }
                        }
                    } catch (e) {
                        // 忽略错误，继续尝试其他方法
                        console.log('通过humanoid查找节点失败:', nodeName, e.message);
                    }
                }
                
                // 如果找到了节点
                if (targetNode) {
                    // 如果节点名称完全匹配，直接使用原始track（不需要映射）
                    if (targetNode.name === nodeName) {
                        mappedTracks.push(track);
                        console.log('直接使用原始track（节点名称匹配）:', track.name);
                    } else {
                        // 节点名称不匹配，需要映射
                        const newTrackName = targetNode.name + '.' + propertyPath;
                        const newTrack = track.clone();
                        newTrack.name = newTrackName;
                        mappedTracks.push(newTrack);
                        console.log('成功映射track:', track.name, '->', newTrackName);
                    }
                } else {
                    // 对于表情、lookAt和VRMRoot等特殊节点，跳过（这些需要通过VRM API处理，或模型结构不同）
                    if (nodeName.startsWith('expressions_') || nodeName === 'lookAt' || nodeName === 'VRMRoot') {
                        console.log('跳过VRM特殊节点track:', track.name, '(这些节点在当前模型中不存在)');
                        // 不添加到mappedTracks，直接跳过
                    } else {
                        // 尝试通过遍历场景查找（可能节点名称不完全匹配）
                        let found = false;
                        vrmScene.traverse((node) => {
                            if (node.name && (node.name === nodeName || node.name.includes(nodeName))) {
                                const newTrackName = node.name + '.' + propertyPath;
                                const newTrack = track.clone();
                                newTrack.name = newTrackName;
                                mappedTracks.push(newTrack);
                                console.log('通过遍历找到节点，映射track:', track.name, '->', newTrackName);
                                found = true;
                                return; // 找到第一个匹配的节点就停止
                            }
                        });
                        if (!found) {
                            console.warn('无法找到节点:', nodeName, '，跳过此track:', track.name);
                        }
                    }
                }
            }
            
            // 如果没有任何有效的tracks，使用原始tracks
            const finalTracks = mappedTracks.length > 0 ? mappedTracks : animationClip.tracks;
            
            // 创建新的AnimationClip
            const mappedClip = new window.THREE.AnimationClip(
                animationClip.name,
                animationClip.duration,
                finalTracks
            );
            
            // 创建并播放动画动作
            // 注意：对于VRM动画，需要确保action绑定到正确的根对象
            // 尝试直接使用原始clip（如果节点名称匹配），否则使用映射后的clip
            let action;
            let usedClip;
            
            // 检查是否所有tracks都直接匹配（不需要映射）
            const allTracksMatch = mappedTracks.length === animationClip.tracks.length && 
                                   mappedTracks.every((t, i) => {
                                       const originalTrack = animationClip.tracks[i];
                                       return t.name === originalTrack.name || 
                                              (t.name && originalTrack.name && t.name === originalTrack.name);
                                   });
            
            if (allTracksMatch && mappedTracks.length > 0) {
                // 所有tracks都直接匹配，使用原始clip
                console.log('所有tracks直接匹配，使用原始clip');
                usedClip = animationClip;
                action = this.animationMixer.clipAction(animationClip, vrmScene);
            } else {
                // 需要映射，使用映射后的clip
                console.log('使用映射后的clip，tracks数量:', finalTracks.length, '原始tracks数量:', animationClip.tracks.length);
                usedClip = mappedClip;
                action = this.animationMixer.clipAction(mappedClip, vrmScene);
            }
            
            // 设置动画选项
            if (options.loop !== undefined) {
                action.setLoop(options.loop ? window.THREE.LoopRepeat : window.THREE.LoopOnce);
            } else {
                action.setLoop(window.THREE.LoopRepeat); // 默认循环
            }
            
            if (options.timeScale !== undefined) {
                action.timeScale = options.timeScale;
            } else {
                action.timeScale = 1.0;
            }

            // 设置权重，确保动画可见
            action.setEffectiveWeight(1.0);
            action.setEffectiveTimeScale(1.0);

            // 重置并播放动画
            action.reset();
            action.play();
            this.currentAnimationAction = action;

            console.log('VRM动画播放成功:', {
                url: animationUrl,
                action: action,
                isPlaying: action.isRunning(),
                time: action.time,
                weight: action.getEffectiveWeight(),
                effectiveWeight: action.getEffectiveWeight(),
                mixer: this.animationMixer,
                clip: usedClip,
                tracksCount: finalTracks.length,
                originalTracksCount: animationClip.tracks.length
            });
            
            // 验证action是否真的在运行
            setTimeout(() => {
                if (this.currentAnimationAction) {
                    console.log('动画状态检查:', {
                        isRunning: this.currentAnimationAction.isRunning(),
                        time: this.currentAnimationAction.time,
                        weight: this.currentAnimationAction.getEffectiveWeight(),
                        paused: this.currentAnimationAction.paused
                    });
                }
            }, 100);
            
            // 强制更新一次以确保动画立即生效
            if (this.animationMixer && this.clock) {
                const delta = this.clock.getDelta();
                this.animationMixer.update(delta);
                console.log('强制更新动画，delta:', delta);
            }

            return action;
        } catch (error) {
            console.error('加载VRM动画失败:', error);
            throw error;
        }
    }

    /**
     * 停止当前动画
     */
    stopAnimation() {
        if (this.currentAnimationAction) {
            this.currentAnimationAction.fadeOut(0.3);
            setTimeout(() => {
                if (this.currentAnimationAction) {
                    this.currentAnimationAction.stop();
                    this.currentAnimationAction = null;
                }
            }, 300);
        }
    }
}

// 导出到全局
window.VRMManager = VRMManager;

