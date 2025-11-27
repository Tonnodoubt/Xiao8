/**
 * VRM 模型管理器
 * 基于 @pixiv/three-vrm 实现
 */

// 导入 Three.js ES 模块
import * as THREE from 'three';

class VRMManager {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error(`容器元素 "${containerId}" 未找到`);
            return;
        }

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.vrm = null;
        this.animationId = null;
        this.clock = null; // 将在 init 中初始化
        this.mouseTrackingEnabled = false;
        this.mouseMoveHandler = null;
        
        // 拖拽和缩放相关
        this.isDragging = false;
        this.dragMode = null; // 'rotate' 或 'pan'
        this.previousMousePosition = { x: 0, y: 0 };
        this.modelRotation = { x: 0, y: 0 };
        this.modelPosition = { x: 0, y: 0, z: 0 };
        this.modelScale = 1.0;
        this.dragHandler = null;
        this.wheelHandler = null;
        
        // 拖拽相关事件处理器引用（用于清理）
        this.mouseDownHandler = null;
        this.mouseUpHandler = null;
        this.mouseLeaveHandler = null;
        this.auxClickHandler = null;
        this.mouseEnterHandler = null;
        this.resizeHandler = null;
        
        // 口型同步相关
        this.lipSyncActive = false;
        this.lipSyncAnimationId = null;
        this.analyser = null;
        // 口型表情映射 - 在模型加载后根据实际表情名称更新
        this.mouthExpressions = {
            'aa': null,  // 将在模型加载后设置
            'ih': null,
            'ou': null,
            'ee': null,
            'oh': null
        };
        this.currentMouthExpression = null; // 当前激活的嘴巴表情 {index, weight}
        this.targetMouthWeight = 0; // 目标权重（用于平滑过渡）
        this.currentMouthWeight = 0; // 当前权重（实际应用的值）
        
        // VMD 动画相关
        this.vmdAnimationManager = null;
    }

    async init() {
        try {
            // Three.js 已通过 ES 模块导入，直接使用
            console.log('THREE.js 已就绪，开始初始化场景...');
            
            // 确保容器可见且有大小
            if (!this.container) {
                throw new Error('容器元素不存在');
            }
            
            // 确保容器可见
            this.container.style.display = 'block';
            this.container.style.visibility = 'visible';
            this.container.style.opacity = '1';
            this.container.style.width = '100%';
            this.container.style.height = '100%';
            this.container.style.position = 'fixed';
            this.container.style.top = '0';
            this.container.style.left = '0';

            // 创建场景
            this.scene = new THREE.Scene();
            this.scene.background = null; // 透明背景

            // 创建相机 - 如果容器大小为0，使用窗口大小
            let width = this.container.clientWidth || this.container.offsetWidth;
            let height = this.container.clientHeight || this.container.offsetHeight;
            
            if (width === 0 || height === 0) {
                width = window.innerWidth;
                height = window.innerHeight;
            }
            this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
            // 调整相机位置，从正面看模型
            this.camera.position.set(0, 1.2, 1.8);
            this.camera.lookAt(0, 1, 0);

            // 创建渲染器
            this.renderer = new THREE.WebGLRenderer({ 
                alpha: true, 
                antialias: true 
            });
            this.renderer.setSize(width, height);
            this.renderer.setPixelRatio(window.devicePixelRatio);
            this.renderer.shadowMap.enabled = true;
            
            // 确保容器和 canvas 可以接收事件
            this.container.style.pointerEvents = 'auto';
            this.container.style.display = 'block';
            this.container.style.visibility = 'visible';
            this.container.style.opacity = '1';
            
            const canvas = this.renderer.domElement;
            canvas.style.pointerEvents = 'auto';
            canvas.style.touchAction = 'none';
            canvas.style.userSelect = 'none';
            canvas.style.cursor = 'grab';
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            canvas.style.display = 'block';
            
            // 清空容器并添加 canvas
            this.container.innerHTML = '';
            this.container.appendChild(canvas);

            // 添加灯光
            const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
            this.scene.add(ambientLight);
            
            const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
            directionalLight.position.set(1, 1, 1);
            directionalLight.castShadow = true;
            this.scene.add(directionalLight);

            // 初始化时钟
            this.clock = new THREE.Clock();

            // 处理窗口大小变化
            this.resizeHandler = () => this.onWindowResize();
            window.addEventListener('resize', this.resizeHandler);

            // 初始化拖拽和缩放功能
            this.initDragAndZoom();

            // 开始渲染循环
            this.animate();

        } catch (error) {
            console.error('VRM 管理器初始化失败:', error);
            throw error;
        }
    }


    async loadModel(modelPath) {
        try {
            // 动态导入 GLTFLoader 和 VRMLoaderPlugin
            // 使用 importmap 中定义的路径
            const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
            const { VRMLoaderPlugin } = await import('@pixiv/three-vrm');

            // 创建加载器
            const loader = new GLTFLoader();
            loader.register((parser) => new VRMLoaderPlugin(parser));

            // 加载 VRM 模型
            const gltf = await new Promise((resolve, reject) => {
                loader.load(
                    modelPath,
                    (gltf) => resolve(gltf),
                    (progress) => {
                        if (progress.total > 0) {
                            const percent = (progress.loaded / progress.total) * 100;
                        }
                    },
                    (error) => reject(error)
                );
            });

            // 如果已有模型，先移除
            if (this.vrm) {
                this.scene.remove(this.vrm.scene);
                this.disposeVRM();
            }

            // 获取 VRM 实例
            this.vrm = gltf.userData.vrm;

            if (!this.vrm) {
                throw new Error('加载的模型不是有效的 VRM 格式');
            }

            // 计算模型的边界框，用于确定合适的初始大小
            const box = new THREE.Box3().setFromObject(this.vrm.scene);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            
            // 调整模型位置（居中）
            this.vrm.scene.position.set(-center.x, -center.y, -center.z);
            // 旋转模型180度，确保正面显示
            this.vrm.scene.rotation.set(0, Math.PI, 0);
            this.modelRotation = { x: 0, y: Math.PI };
            
            // 计算合适的初始缩放（参考Live2D的默认大小计算）
            // Live2D: scale = Math.min(0.5, (window.innerHeight * 0.75) / 7000, (window.innerWidth * 0.6) / 7000)
            const isMobile = window.innerWidth <= 768;
            let targetScale;
            
            if (isMobile) {
                // 移动端：较小
                targetScale = Math.min(
                    0.5,
                    window.innerHeight * 1.3 / 4000,
                    window.innerWidth * 1.2 / 2000
                );
            } else {
                // 桌面端：参考Live2D的计算方式
                targetScale = Math.min(
                    0.5,
                    (window.innerHeight * 0.75) / 7000,
                    (window.innerWidth * 0.6) / 7000
                );
            }
            
            // 根据模型大小和屏幕大小计算合适的相机距离
            // 使用模型的最大尺寸（通常是高度）来计算
            const modelHeight = size.y;
            const screenHeight = window.innerHeight;
            const screenWidth = window.innerWidth;
            
            // 目标：让模型在屏幕上的高度约为屏幕高度的0.4-0.5倍（类似Live2D）
            const targetScreenHeight = screenHeight * 0.45;
            const fov = this.camera.fov * (Math.PI / 180);
            const distance = (modelHeight / 2) / Math.tan(fov / 2) / targetScreenHeight * screenHeight;
            
            // 设置模型初始缩放
            this.vrm.scene.scale.set(1, 1, 1);
            this.modelScale = 1.0;
            
            // 调整相机位置，使模型在屏幕中央合适的位置
            // 相机位置：稍微偏上，类似Live2D的anchor (0.65, 0.75)
            const cameraY = center.y + (isMobile ? modelHeight * 0.2 : modelHeight * 0.1);
            const cameraZ = distance;
            this.camera.position.set(0, cameraY, cameraZ);
            this.camera.lookAt(0, center.y, 0);
            
            // 重置位置
            this.modelPosition = { x: 0, y: 0, z: 0 };

            // 添加到场景
            this.scene.add(this.vrm.scene);

            // SpringBone（物理骨骼）会在 animate() 循环中通过 update() 方法更新
            // 不需要手动初始化，three-vrm 会自动处理

            // 确保拖拽和缩放功能已初始化（如果之前没有初始化）
            if (this.renderer && !this.dragHandler) {
                this.initDragAndZoom();
            }


            return this.vrm;
        } catch (error) {
            console.error('加载 VRM 模型失败:', error);
            throw error;
        }
    }

    // 设置表情
    setExpression(expressionName, weight) {
        if (!this.vrm || !this.vrm.expressionManager) {
            return false;
        }

        const clampedWeight = Math.max(0, Math.min(1, weight));
        
        // 直接设置 expression.weight (主要方法)
        const expression = this.vrm.expressionManager.expressions[expressionName];
        if (!expression) {
            console.warn(`表情 "${expressionName}" 不存在，可用表情:`, Object.keys(this.vrm.expressionManager.expressions));
            return false;
        }
        
        const oldWeight = expression.weight;
        
        // 直接设置权重
        expression.weight = clampedWeight;
        
        
        return true;
    }

    // 获取所有可用表情
    getAvailableExpressions() {
        if (!this.vrm || !this.vrm.expressionManager) {
            return [];
        }
        return Object.keys(this.vrm.expressionManager.expressions);
    }

    // 重置所有表情
    resetExpressions() {
        if (!this.vrm || !this.vrm.expressionManager) return;
        
        Object.keys(this.vrm.expressionManager.expressions).forEach(name => {
            this.setExpression(name, 0);
        });
    }

    // 检查口型同步支持
    checkLipSyncSupport() {
        if (!this.vrm) {
            return;
        }

        console.log('\n=== 口型同步支持检查 ===');
        
        // 1. 检查表情（Expression）
        const expressions = this.vrm.expressionManager?.expressions || {};
        const expressionNames = Object.keys(expressions);
        console.log(`表情数量: ${expressionNames.length}`);
        
        // 查找嘴巴相关的表情
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
        
        if (mouthExpressions.length > 0) {
            console.log('✓ 找到嘴巴相关表情:', mouthExpressions);
        } else {
            console.log('⚠ 未在表情中找到嘴巴相关项');
        }

        // 2. 检查 BlendShape（如果有）
        if (this.vrm.blendShapeProxy) {
        }

        // 3. 检查 Humanoid 骨骼（下巴）
        if (this.vrm.humanoid?.normalizedHumanBones?.jaw) {
            console.log('✓ 找到下巴骨骼');
        } else {
            console.log('⚠ 未找到下巴骨骼');
        }

        // 输出所有表情列表（用于调试）
        console.log('\n所有表情列表:');
        expressionNames.forEach((name, index) => {
            const expr = expressions[name];
            console.log(`  [${index}] ${name} -> "${expr?.name || name}"`);
        });

        console.log('\n=== 检查总结 ===');
        const hasMouthExpressions = mouthExpressions.length > 0;
        const hasMouthBlendShapes = this.vrm.blendShapeProxy && 
            this.vrm.blendShapeProxy.blendShapeGroups?.some(bs => {
                const name = (bs.name || bs.preset || '').toLowerCase();
                return mouthKeywords.some(keyword => name.includes(keyword));
            });
        const hasJawBone = !!this.vrm.humanoid?.normalizedHumanBones?.jaw;
        
        if (hasMouthExpressions || hasMouthBlendShapes || hasJawBone) {
        }
        console.log('==================\n');
        
        // 返回检查结果
        return {
            hasMouthExpressions,
            hasMouthBlendShapes,
            hasJawBone,
            mouthExpressions,
            allExpressions: expressionNames
        };
    }

    // 检查模型是否包含动画
    checkAnimations() {
        if (!this.vrm) {
            return null;
        }

        console.log('\n=== 动画检查 ===');
        
        // VRM 文件本身可能包含 GLTF 动画
        // 尝试从 userData 中获取原始 GLTF 数据
        let gltf = null;
        
        // 方法1: 从 vrm.userData 获取
        if (this.vrm.userData && this.vrm.userData.gltf) {
            gltf = this.vrm.userData.gltf;
        }
        
        // 方法2: 从场景的 userData 获取
        if (!gltf && this.vrm.scene && this.vrm.scene.userData && this.vrm.scene.userData.gltf) {
            gltf = this.vrm.scene.userData.gltf;
        }

        if (gltf && gltf.animations && gltf.animations.length > 0) {
            const animations = gltf.animations.map((clip, index) => {
                return {
                    index: index,
                    name: clip.name || `Animation_${index}`,
                    duration: clip.duration,
                    tracks: clip.tracks.length
                };
            });
            
            console.log('==================\n');
            return {
                hasAnimations: true,
                count: gltf.animations.length,
                animations: animations
            };
        } else {
            console.log('==================\n');
            return {
                hasAnimations: false,
                message: '模型文件中没有找到动画数据'
            };
        }
    }

    // 更新口型表情映射（在模型加载后调用）
    updateMouthExpressionMapping() {
        if (!this.vrm || !this.vrm.expressionManager) {
            return;
        }

        const expressions = this.vrm.expressionManager.expressions;
        const expressionNames = Object.keys(expressions);
        
        // 扩展的匹配关键词（支持多种命名方式）
        const mouthKeywordMap = {
            'aa': ['aa', 'あ', 'ああ', 'open', 'mouthopen', 'jawopen'],
            'ih': ['ih', 'い', 'いい', 'i', 'mouthi'],
            'ou': ['ou', 'う', 'うう', 'u', 'mouthu', 'o'],
            'ee': ['ee', 'え', 'ええ', 'e', 'mouthe'],
            'oh': ['oh', 'お', 'おお', 'moutho']
        };

        // 为每个目标表情查找匹配
        Object.keys(mouthKeywordMap).forEach(targetKey => {
            const keywords = mouthKeywordMap[targetKey];
            let found = false;

            // 首先尝试精确匹配（通过索引）
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

            // 如果没找到，尝试部分匹配
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

            if (!found) {
            }
        });

        // 检查是否有任何映射成功
        const hasAnyMapping = Object.values(this.mouthExpressions).some(v => v !== null);
        if (!hasAnyMapping) {
        } else {
            const mappedCount = Object.values(this.mouthExpressions).filter(v => v !== null).length;
        }
    }

    initDragAndZoom() {
        if (!this.renderer) return;
        
        const canvas = this.renderer.domElement;
        
        // 鼠标按下事件
        this.mouseDownHandler = (e) => {
            if (e.button === 0) { // 左键：旋转
                this.isDragging = true;
                this.dragMode = 'rotate';
                this.previousMousePosition = { x: e.clientX, y: e.clientY };
                canvas.style.cursor = 'grabbing';
                e.preventDefault();
                e.stopPropagation();
            } else if (e.button === 1) { // 中键：平移
                this.isDragging = true;
                this.dragMode = 'pan';
                this.previousMousePosition = { x: e.clientX, y: e.clientY };
                canvas.style.cursor = 'move';
                e.preventDefault();
                e.stopPropagation();
            }
        };

        // 鼠标移动事件
        this.dragHandler = (e) => {
            if (!this.isDragging || !this.vrm) return;

            const deltaX = e.clientX - this.previousMousePosition.x;
            const deltaY = e.clientY - this.previousMousePosition.y;

            if (this.dragMode === 'rotate') {
                // 旋转模型
                const rotationSpeed = 0.01;
                this.modelRotation.y += deltaX * rotationSpeed;
                this.modelRotation.x += deltaY * rotationSpeed;
                
                // 限制 X 轴旋转角度（避免翻转）
                this.modelRotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.modelRotation.x));
                
                this.vrm.scene.rotation.set(this.modelRotation.x, this.modelRotation.y, 0);
            } else if (this.dragMode === 'pan') {
                // 平移模型
                const panSpeed = 0.01;
                const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
                const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
                
                this.modelPosition.x += (right.x * deltaX - right.x * deltaY) * panSpeed;
                this.modelPosition.y += (up.y * deltaY) * panSpeed;
                this.modelPosition.z += (right.z * deltaX - right.z * deltaY) * panSpeed;
                
                this.vrm.scene.position.add(
                    right.multiplyScalar(deltaX * panSpeed)
                        .add(up.multiplyScalar(-deltaY * panSpeed))
                );
            }

            this.previousMousePosition = { x: e.clientX, y: e.clientY };
            e.preventDefault();
            e.stopPropagation();
        };

        // 鼠标释放事件
        this.mouseUpHandler = (e) => {
            if (this.isDragging) {
                this.isDragging = false;
                this.dragMode = null;
                canvas.style.cursor = 'grab';
                e.preventDefault();
                e.stopPropagation();
            }
        };

        // 鼠标离开画布
        this.mouseLeaveHandler = () => {
            if (this.isDragging) {
                this.isDragging = false;
                this.dragMode = null;
                canvas.style.cursor = 'grab';
            }
        };

        // 鼠标进入画布
        this.mouseEnterHandler = () => {
            canvas.style.cursor = 'grab';
        };

        // 滚轮缩放
        this.wheelHandler = (e) => {
            if (!this.vrm) return;
            
            e.preventDefault();
            e.stopPropagation();
            
            const zoomSpeed = 0.1;
            const zoomDelta = e.deltaY > 0 ? -zoomSpeed : zoomSpeed;
            
            // 更新模型缩放
            this.modelScale = Math.max(0.1, Math.min(3.0, this.modelScale + zoomDelta));
            this.vrm.scene.scale.set(this.modelScale, this.modelScale, this.modelScale);
        };

        // 中键点击事件（防止默认行为）
        this.auxClickHandler = (e) => {
            if (e.button === 1) {
                e.preventDefault();
                e.stopPropagation();
            }
        };

        // 绑定事件
        canvas.addEventListener('mousedown', this.mouseDownHandler);
        document.addEventListener('mousemove', this.dragHandler);
        document.addEventListener('mouseup', this.mouseUpHandler);
        canvas.addEventListener('mouseleave', this.mouseLeaveHandler);
        canvas.addEventListener('mouseenter', this.mouseEnterHandler);
        canvas.addEventListener('wheel', this.wheelHandler, { passive: false });
        canvas.addEventListener('auxclick', this.auxClickHandler);
    }

    // 渲染循环
    animate() {
        this.animationId = requestAnimationFrame(() => this.animate());

        const deltaTime = this.clock ? this.clock.getDelta() : 0.016;

        // 更新 SpringBone（物理骨骼）
        if (this.vrm?.springBoneManager) {
            this.vrm.springBoneManager.update(deltaTime);
        }

        // 更新 VMD 动画
        if (this.vmdAnimationManager) {
            this.vmdAnimationManager.update(deltaTime);
        }

        // 在渲染循环中持续更新口型表情（防止被重置）
        if (this.lipSyncActive && this.vrm?.expressionManager && this.currentMouthExpression) {
            // 如果口型同步正在运行，确保当前表情的权重被保持
            const expr = this.vrm.expressionManager.expressions[this.currentMouthExpression.index];
            if (expr && this.currentMouthWeight > 0) {
                // 每帧都重新设置权重，确保不被其他逻辑重置
                expr.weight = this.currentMouthWeight;
                
                // 尝试调用 update 方法（如果存在）
                if (typeof expr.update === 'function') {
                    try {
                        expr.update();
                    } catch (e) {}
                }
                
                // 尝试调用 expressionManager.update（如果存在）
                if (typeof this.vrm.expressionManager.update === 'function') {
                    try {
                        this.vrm.expressionManager.update();
                    } catch (e) {}
                }
            }
        }

        // 渲染场景
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    // 启动口型同步
    startLipSync(analyser) {
        if (!this.vrm || !this.vrm.expressionManager) {
            return false;
        }

        if (!analyser) {
            return false;
        }

        if (this.lipSyncActive) {
            return false;
        }

        // 更新口型表情映射
        this.updateMouthExpressionMapping();

        // 检查是否有可用的口型表情
        const hasMouthExpressions = Object.values(this.mouthExpressions).some(v => v !== null);
        if (!hasMouthExpressions) {
        }

        this.lipSyncActive = true;
        this.analyser = analyser;

        // 初始化缓冲区
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        const frequencyData = new Uint8Array(bufferLength);

        // 平滑参数 - 调整为更明显、更直接的口型
        const smoothingFactor = 0.4; // 权重平滑因子（增大，让变化更快更明显）
        const volumeThreshold = 0.002; // 音量阈值（进一步降低，避免在音频块间隙时关闭）
        const volumeSensitivity = 3.5; // 音量敏感度（提高，让嘴巴更容易张开）
        const silenceDecayRate = 0.95; // 静音时的衰减率（降低衰减速度，保持嘴巴稍微张开）

        const animate = () => {
            if (!this.lipSyncActive) return;

            // 获取音频数据
            analyser.getByteFrequencyData(frequencyData);
            analyser.getByteTimeDomainData(dataArray);

            // 计算 RMS（均方根）音量
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                const normalized = (dataArray[i] - 128) / 128;
                sum += normalized * normalized;
            }
            const rms = Math.sqrt(sum / dataArray.length);
            const volume = Math.min(1, rms * volumeSensitivity);

            // 如果音量太低，逐渐关闭嘴巴（但不要完全关闭，保持轻微张开）
            if (volume < volumeThreshold) {
                if (this.currentMouthExpression) {
                    // 平滑关闭，但保持最小张开度
                    this.targetMouthWeight = 0.1; // 保持最小张开度，而不是完全关闭
                    this.currentMouthWeight += (this.targetMouthWeight - this.currentMouthWeight) * 0.1; // 缓慢衰减
                    const expr = this.vrm.expressionManager.expressions[this.currentMouthExpression.index];
                    if (expr) {
                        expr.weight = Math.max(0.1, this.currentMouthWeight); // 保持最小权重
                    }
                }
                this.lipSyncAnimationId = requestAnimationFrame(animate);
                return;
            }

            // 分析频率，确定主要元音
            const lowFreq = this.getFrequencyRange(frequencyData, 0, Math.floor(bufferLength * 0.1)); // 低频（0-10%）
            const midFreq = this.getFrequencyRange(frequencyData, Math.floor(bufferLength * 0.1), Math.floor(bufferLength * 0.4)); // 中频（10-40%）
            const highFreq = this.getFrequencyRange(frequencyData, Math.floor(bufferLength * 0.4), Math.floor(bufferLength * 0.7)); // 高频（40-70%）

            // 根据频率特征判断元音
            let primaryExpression = null;
            let primaryWeight = 0;

            // 'aa' (あ) - 低频为主
            if (lowFreq > midFreq * 0.8 && lowFreq > highFreq * 0.8) {
                primaryExpression = this.mouthExpressions['aa'];
                primaryWeight = lowFreq;
            }
            // 'ih' (い) - 中高频
            else if (midFreq > lowFreq * 1.2 && midFreq > highFreq * 0.9) {
                primaryExpression = this.mouthExpressions['ih'];
                primaryWeight = midFreq;
            }
            // 'ou' (う) - 中频为主
            else if (midFreq > lowFreq && midFreq > highFreq) {
                primaryExpression = this.mouthExpressions['ou'];
                primaryWeight = midFreq;
            }
            // 'ee' (え) - 中高频
            else if (highFreq > midFreq * 0.9 && highFreq > lowFreq * 1.1) {
                primaryExpression = this.mouthExpressions['ee'];
                primaryWeight = highFreq;
            }
            // 'oh' (お) - 中低频
            else if (midFreq > lowFreq * 0.8 && midFreq > highFreq * 0.9) {
                primaryExpression = this.mouthExpressions['oh'];
                primaryWeight = midFreq;
            }

            // 如果找到了主要表情
            if (primaryExpression !== null && primaryExpression !== undefined) {
                // 计算最终权重（结合音量和频率强度）- 调整为更明显的口型
                const finalWeight = Math.max(0.5, Math.min(1.2, primaryWeight * 1.2)); // 提高最小值和最大值
                this.targetMouthWeight = finalWeight * volume * 1.2; // 增加音量影响

                // 平滑过渡到新权重
                this.currentMouthWeight += (this.targetMouthWeight - this.currentMouthWeight) * smoothingFactor;

                // 如果切换到新的表情，平滑关闭其他表情
                if (!this.currentMouthExpression || this.currentMouthExpression.index !== primaryExpression) {
                    // 关闭之前的表情
                    if (this.currentMouthExpression) {
                        const oldExpr = this.vrm.expressionManager.expressions[this.currentMouthExpression.index];
                        if (oldExpr) {
                            oldExpr.weight *= 0.9; // 逐渐衰减
                            if (oldExpr.weight < 0.01) {
                                oldExpr.weight = 0;
                            }
                        }
                    }

                    // 设置新表情
                    this.currentMouthExpression = {
                        index: primaryExpression,
                        weight: this.currentMouthWeight
                    };
                }

                // 应用权重到当前表情
                const expr = this.vrm.expressionManager.expressions[primaryExpression];
                if (expr) {
                    expr.weight = this.currentMouthWeight;
                }

                // 平滑关闭其他表情
                Object.keys(this.mouthExpressions).forEach(key => {
                    const exprIndex = this.mouthExpressions[key];
                    if (exprIndex !== null && exprIndex !== primaryExpression) {
                        const expr = this.vrm.expressionManager.expressions[exprIndex];
                        if (expr) {
                            expr.weight *= 0.9;
                            if (expr.weight < 0.01) {
                                expr.weight = 0;
                            }
                        }
                    }
                });
            } else {
                // 如果没有找到匹配的表情，保持当前表情但降低权重（不完全关闭）
                if (this.currentMouthExpression) {
                    // 保持最小张开度，而不是完全关闭
                    this.targetMouthWeight = Math.max(0.15, this.currentMouthWeight * 0.95); // 缓慢衰减，保持最小张开
                    this.currentMouthWeight += (this.targetMouthWeight - this.currentMouthWeight) * 0.1;
                    const expr = this.vrm.expressionManager.expressions[this.currentMouthExpression.index];
                    if (expr) {
                        expr.weight = Math.max(0.15, this.currentMouthWeight); // 保持最小权重
                    }
                }
            }

            this.lipSyncAnimationId = requestAnimationFrame(animate);
        };

        animate();
    }

    // 停止口型同步
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
        this.currentMouthExpression = null; // 清除当前表情
        this.targetMouthWeight = 0;
        this.currentMouthWeight = 0;
        this.analyser = null;
    }

    // 重置所有嘴巴表情
    resetMouthExpressions() {
        if (!this.vrm || !this.vrm.expressionManager) return;
        
        // 直接设置权重为0，不使用 setExpression（避免触发日志）
        Object.values(this.mouthExpressions).forEach(index => {
            if (index !== null && index !== undefined) {
                const expr = this.vrm.expressionManager.expressions[index];
                if (expr) {
                    expr.weight = 0;
                }
            }
        });
    }

    // 获取频率范围的平均值
    getFrequencyRange(frequencyData, start, end) {
        let sum = 0;
        let count = 0;
        for (let i = start; i < Math.min(end, frequencyData.length); i++) {
            sum += frequencyData[i];
            count++;
        }
        return count > 0 ? (sum / count) / 255 : 0; // 归一化到 0-1
    }

    // 处理窗口大小变化
    onWindowResize() {
        if (!this.container || !this.camera || !this.renderer) return;

        const width = this.container.clientWidth || window.innerWidth;
        const height = this.container.clientHeight || window.innerHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    /**
     * 加载并播放 VMD 动画
     * @param {string} vmdPath - VMD 文件路径
     * @param {Object} options - 播放选项 { loop, timeScale }
     */
    async playVMDAnimation(vmdPath, options = {}) {
        if (!this.vmdAnimationManager) {
            try {
                const { VMDAnimationManager } = await import('./vmd-loader.js');
                this.vmdAnimationManager = new VMDAnimationManager(this);
            } catch (error) {
                console.error('[VRM] 无法加载 VMD 动画管理器:', error);
                throw error;
            }
        }
        
        return await this.vmdAnimationManager.loadAndPlay(vmdPath, options);
    }

    /**
     * 停止 VMD 动画
     */
    stopVMDAnimation() {
        if (this.vmdAnimationManager) {
            this.vmdAnimationManager.stop();
        }
    }

    /**
     * 暂停/恢复 VMD 动画
     */
    pauseVMDAnimation() {
        if (this.vmdAnimationManager) {
            this.vmdAnimationManager.pause();
        }
    }

    // 清理 VRM 资源
    disposeVRM() {
        if (!this.vrm) return;
        
        // 清理 VMD 动画
        if (this.vmdAnimationManager) {
            this.vmdAnimationManager.dispose();
            this.vmdAnimationManager = null;
        }

        if (this.vrm.scene) {
            this.vrm.scene.traverse((object) => {
                if (object.geometry) object.geometry.dispose();
                if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach(m => m.dispose());
                    } else {
                        object.material.dispose();
                    }
                }
            });
        }
    }

    // 清理拖拽和缩放相关事件监听器
    cleanupDragAndZoom() {
        if (!this.renderer) return;
        
        const canvas = this.renderer.domElement;
        
        // 移除所有事件监听器
        if (this.mouseDownHandler) {
            canvas.removeEventListener('mousedown', this.mouseDownHandler);
            this.mouseDownHandler = null;
        }
        if (this.dragHandler) {
            document.removeEventListener('mousemove', this.dragHandler);
            this.dragHandler = null;
        }
        if (this.mouseUpHandler) {
            document.removeEventListener('mouseup', this.mouseUpHandler);
            this.mouseUpHandler = null;
        }
        if (this.mouseLeaveHandler) {
            canvas.removeEventListener('mouseleave', this.mouseLeaveHandler);
            this.mouseLeaveHandler = null;
        }
        if (this.auxClickHandler) {
            canvas.removeEventListener('auxclick', this.auxClickHandler);
            this.auxClickHandler = null;
        }
        if (this.mouseEnterHandler) {
            canvas.removeEventListener('mouseenter', this.mouseEnterHandler);
            this.mouseEnterHandler = null;
        }
        if (this.wheelHandler) {
            canvas.removeEventListener('wheel', this.wheelHandler);
            this.wheelHandler = null;
        }
    }

    // 清理所有资源
    dispose() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        // 禁用鼠标跟踪
        this.enableMouseTracking(false);

        // 清理拖拽和缩放事件监听
        this.cleanupDragAndZoom();

        // 移除窗口大小变化监听
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }

        // 清理 VRM 资源
        if (this.vrm) {
            this.scene.remove(this.vrm.scene);
            this.disposeVRM();
            this.vrm = null;
        }

        // 清理渲染器
        if (this.renderer) {
            this.renderer.dispose();
            if (this.container && this.renderer.domElement) {
                try {
                    this.container.removeChild(this.renderer.domElement);
                } catch (e) {
                    // 元素可能已经被移除
                }
            }
            this.renderer = null;
        }

        // 移除事件监听
        window.removeEventListener('resize', this.onWindowResize);
    }

    // 启用/禁用鼠标跟踪
    enableMouseTracking(enabled) {
        this.mouseTrackingEnabled = enabled;
        
        if (enabled && !this.mouseMoveHandler) {
            this.mouseMoveHandler = (e) => {
                if (!this.vrm || !this.vrm.scene) return;
                
                // 计算鼠标在画布上的归一化坐标 (-1 到 1)
                const rect = this.renderer.domElement.getBoundingClientRect();
                const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                
                // 简单的头部跟随（可以扩展）
                if (this.vrm.humanoid?.normalizedHumanBones?.head) {
                    const headBone = this.vrm.humanoid.normalizedHumanBones.head.node;
                    if (headBone) {
                        // 轻微的头部旋转（可以根据需要调整）
                        headBone.rotation.y = x * 0.1;
                        headBone.rotation.x = y * 0.1;
                    }
                }
            };
            
            this.renderer.domElement.addEventListener('mousemove', this.mouseMoveHandler);
        } else if (!enabled && this.mouseMoveHandler) {
            this.renderer.domElement.removeEventListener('mousemove', this.mouseMoveHandler);
            this.mouseMoveHandler = null;
        }
    }
}

// 导出到全局
if (typeof window !== 'undefined') {
    window.VRMManager = VRMManager;
}

// ES 模块导出
export default VRMManager;
export { VRMManager };
