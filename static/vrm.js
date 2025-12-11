/**
 * VRM 模型管理器
 * 基于 @pixiv/three-vrm 实现
 */

// 导入 Three.js ES 模块
import * as THREE from 'three';

class VRMManager {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error(`容器元素 "${containerId}" 未找到`);
            return;
        }

        // 性能模式配置
        this.performanceMode = options.performanceMode || this.detectPerformanceMode();
        this.targetFPS = this.performanceMode === 'low' ? 30 : (this.performanceMode === 'medium' ? 45 : 60);
        this.frameTime = 1000 / this.targetFPS;
        this.lastFrameTime = 0;
        
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
        this.isLocked = false; // 锁定状态，锁定时不响应拖拽和缩放
        
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
        
        // VRMA 动画相关
        this.vrmaMixer = null;
        this.vrmaAction = null;
        this.vrmaIsPlaying = false;
        
        // VRM 模型版本（0.0 或 1.0）
        this.vrmVersion = null;
        
        // 性能监控
        this.frameCount = 0;
        this.lastFPSUpdate = 0;
        this.currentFPS = 0;
    }
    
    /**
     * 检测 VRM 模型版本
     * @returns {string} '0.0' 或 '1.0'
     */
    detectVRMVersion(vrm) {
        try {
            // VRM 1.0 有 meta 对象，且可能有 version 字段
            // VRM 0.0 的 meta 结构不同
            if (vrm.meta) {
                // 检查是否有 VRM 1.0 的特征
                // VRM 1.0 通常有 meta.vrmVersion 或通过其他方式标识
                if (vrm.meta.vrmVersion || vrm.meta.metaVersion) {
                    // 检查版本号
                    const version = vrm.meta.vrmVersion || vrm.meta.metaVersion;
                    if (version && (version.startsWith('1') || version.includes('1.0'))) {
                        return '1.0';
                    }
                }
                
                // VRM 1.0 通常有 expressionManager 和 humanoid
                // 检查是否有 VRM 1.0 特有的字段
                if (vrm.humanoid && vrm.humanoid.humanBones) {
                    // 检查 humanBones 的结构
                    // VRM 1.0 的 humanBones 结构更规范
                    const boneNames = Object.keys(vrm.humanoid.humanBones);
                    // VRM 1.0 通常有更多的标准骨骼
                    if (boneNames.length > 50) {
                        return '1.0';
                    }
                }
                
                // 检查表达式数量，VRM 1.0 通常支持更多表达式
                if (vrm.expressionManager && vrm.expressionManager.expressions) {
                    const exprCount = Object.keys(vrm.expressionManager.expressions).length;
                    if (exprCount > 10) {
                        return '1.0';
                    }
                }
            }
            
            // 如果无法确定，默认返回 '0.0'（更保守的选择）
            return '0.0';
        } catch (error) {
            console.warn('[VRM] 检测模型版本时出错，默认使用 0.0:', error);
            return '0.0';
        }
    }
    
    /**
     * 检测设备性能模式
     * 根据硬件信息自动选择性能模式
     */
    detectPerformanceMode() {
        // 检查是否已保存用户设置
        const savedMode = localStorage.getItem('vrm_performance_mode');
        if (savedMode && ['low', 'medium', 'high'].includes(savedMode)) {
            return savedMode;
        }
        
        // 自动检测
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            
            if (!gl) {
                return 'low'; // 没有 WebGL 支持，使用最低性能模式
            }
            
            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (debugInfo) {
                const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
                const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
                
                // 检测集成显卡或低端显卡
                const isLowEndGPU = 
                    renderer.includes('Intel') && 
                    (renderer.includes('HD Graphics') || renderer.includes('Iris') || renderer.includes('UHD'));
                
                // 检测移动设备或低端设备
                const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                const isLowEndMobile = isMobile && navigator.hardwareConcurrency <= 4;
                
                if (isLowEndGPU || isLowEndMobile) {
                    console.log('[VRM] 检测到低端设备，使用性能模式');
                    return 'low';
                }
            }
            
            // 检测 CPU 核心数
            const cores = navigator.hardwareConcurrency || 4;
            if (cores <= 2) {
                return 'low';
            } else if (cores <= 4) {
                return 'medium';
            }
            
            return 'high'; // 默认高性能模式
        } catch (e) {
            console.warn('[VRM] 性能检测失败，使用中等性能模式:', e);
            return 'medium';
        }
    }
    
    /**
     * 设置性能模式
     */
    setPerformanceMode(mode) {
        if (!['low', 'medium', 'high'].includes(mode)) {
            console.warn('[VRM] 无效的性能模式:', mode);
            return;
        }
        
        this.performanceMode = mode;
        localStorage.setItem('vrm_performance_mode', mode);
        this.targetFPS = mode === 'low' ? 30 : (mode === 'medium' ? 45 : 60);
        this.frameTime = 1000 / this.targetFPS;
        
        // 重新应用渲染设置
        if (this.renderer) {
            this.applyPerformanceSettings();
        }
        
        console.log(`[VRM] 性能模式已设置为: ${mode} (目标FPS: ${this.targetFPS})`);
    }
    
    /**
     * 应用性能设置
     */
    applyPerformanceSettings() {
        if (!this.renderer) return;
        
        // 根据性能模式调整像素比（提高最小像素比以提高清晰度）
        let pixelRatio = window.devicePixelRatio || 1;
        if (this.performanceMode === 'low') {
            pixelRatio = Math.max(1.5, Math.min(pixelRatio, 2.0)); // 低性能模式：至少1.5倍，最多2倍像素比
        } else if (this.performanceMode === 'medium') {
            pixelRatio = Math.max(2.0, Math.min(pixelRatio, 2.5)); // 中等性能模式：至少2倍，最多2.5倍像素比
        } else {
            // 高性能模式：至少2倍像素比，或使用完整设备像素比
            pixelRatio = Math.max(2.0, pixelRatio);
        }
        
        this.renderer.setPixelRatio(pixelRatio);
        console.log(`[VRM] 像素比设置为: ${pixelRatio} (设备像素比: ${window.devicePixelRatio || 1})`);
    }
    
    /**
     * 优化材质设置（根据性能模式）
     */
    optimizeMaterials() {
        if (!this.vrm || !this.vrm.scene) return;
        
        // 遍历模型中的所有材质，根据性能模式优化
        this.vrm.scene.traverse((object) => {
            if (object.material) {
                const materials = Array.isArray(object.material) ? object.material : [object.material];
                
                materials.forEach(material => {
                    // 禁用阴影以提高性能
                    material.castShadow = false;
                    material.receiveShadow = false;
                    
                    // 根据性能模式调整材质设置
                    if (this.performanceMode === 'low') {
                        // 低性能模式：简化材质
                        if (material.map) {
                            // 可以降低纹理分辨率或禁用某些纹理
                            // 这里暂时只禁用阴影
                        }
                    }
                });
            }
        });
        
        console.log('[VRM] 材质优化完成');
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

            // 创建渲染器 - 提高渲染质量设置
            // 始终启用抗锯齿以提高清晰度
            const antialias = true;
            // 始终使用高精度以提高渲染质量
            const precision = 'highp';
            this.renderer = new THREE.WebGLRenderer({ 
                alpha: true, 
                antialias: antialias,
                powerPreference: 'high-performance', // 优先使用独立显卡
                precision: precision,
                preserveDrawingBuffer: false, // 不保留绘制缓冲区以提高性能
                stencil: false // 不使用模板缓冲区以提高性能
            });
            this.renderer.setSize(width, height);
            this.applyPerformanceSettings(); // 应用性能设置（像素比等）
            this.renderer.shadowMap.enabled = false; // 关闭阴影以提高性能
            
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

            // 添加灯光 - 根据性能模式调整灯光数量
            // 环境光：提供整体基础照明，增强亮度
            const ambientIntensity = this.performanceMode === 'low' ? 1.5 : 1.2; // 低性能模式增强环境光以减少方向光需求
            const ambientLight = new THREE.AmbientLight(0xffffff, ambientIntensity);
            this.scene.add(ambientLight);
            
            // 主方向光：从前方和上方照射，模拟自然光
            const directionalLight1 = new THREE.DirectionalLight(0xffffff, 1.0);
            directionalLight1.position.set(0, 2, 2);
            directionalLight1.castShadow = false;
            this.scene.add(directionalLight1);
            
            // 中等和高性能模式：添加额外的灯光
            if (this.performanceMode !== 'low') {
                // 辅助方向光：从侧面补充照明
                const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.6);
                directionalLight2.position.set(-1, 1, 1);
                directionalLight2.castShadow = false;
                this.scene.add(directionalLight2);
                
                // 高性能模式：添加补光
                if (this.performanceMode === 'high') {
                    const directionalLight3 = new THREE.DirectionalLight(0xffffff, 0.4);
                    directionalLight3.position.set(0, 0.5, -2);
                    directionalLight3.castShadow = false;
                    this.scene.add(directionalLight3);
                }
            }

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
            
            // 检测 VRM 模型版本（0.0 或 1.0）
            this.vrmVersion = this.detectVRMVersion(this.vrm);
            console.log(`[VRM] 检测到模型版本: ${this.vrmVersion}`);
            
            // 检测 VRM 模型版本（0.0 或 1.0）
            this.vrmVersion = this.detectVRMVersion(this.vrm);
            console.log(`[VRM] 检测到模型版本: ${this.vrmVersion}`);

            // 计算模型的边界框，用于确定合适的初始大小
            const box = new THREE.Box3().setFromObject(this.vrm.scene);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            
            // 调整模型位置（居中）
            this.vrm.scene.position.set(-center.x, -center.y, -center.z);
            
            // 确保模型正面朝向相机
            // 方法1：使用VRM humanoid骨骼来确定正面方向
            let needsRotation = false;
            if (this.vrm.humanoid && this.vrm.humanoid.humanBones) {
                // 获取头部骨骼位置（通常头部在模型前方）
                const headBone = this.vrm.humanoid.humanBones.head?.node;
                const chestBone = this.vrm.humanoid.humanBones.chest?.node || 
                                 this.vrm.humanoid.humanBones.spine?.node;
                
                if (headBone && chestBone) {
                    // 计算从胸部到头部的向量（应该指向前方）
                    const headWorldPos = new THREE.Vector3();
                    const chestWorldPos = new THREE.Vector3();
                    headBone.getWorldPosition(headWorldPos);
                    chestBone.getWorldPosition(chestWorldPos);
                    
                    const forwardVec = new THREE.Vector3().subVectors(headWorldPos, chestWorldPos);
                    forwardVec.normalize();
                    
                    // 如果forward向量指向Z轴负方向（朝向相机），说明是正面
                    // 如果指向Z轴正方向（远离相机），说明是背面，需要旋转
                    if (forwardVec.z > 0.3) {
                        console.log('[VRM] 检测到模型朝向为背面（通过骨骼检测），旋转180度使其正面朝向');
                        needsRotation = true;
                    }
                }
            }
            
            // 方法2：如果无法通过骨骼检测，使用bounding box
            if (!needsRotation) {
                // 检查bounding box的前后方向
                // 通常模型的正面（脸部）在bounding box的某个特定位置
                // 这里我们假设如果模型的某些特征在Z轴正方向，可能是背面
                const frontFace = new THREE.Vector3(center.x, center.y, box.max.z);
                const backFace = new THREE.Vector3(center.x, center.y, box.min.z);
                
                // 简单判断：如果max.z > min.z的绝对值，可能需要旋转
                // 但这个方法不够准确，优先使用骨骼检测
            }
            
            // 重置旋转并应用必要的旋转
            this.vrm.scene.rotation.set(0, needsRotation ? Math.PI : 0, 0);
            this.modelRotation = { x: 0, y: needsRotation ? Math.PI : 0 };
            
            if (needsRotation) {
                console.log('[VRM] 模型已旋转180度，确保正面朝向相机');
            }
            
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
            // 确保相机从正面（Z轴正方向）看向模型
            const cameraY = center.y + (isMobile ? modelHeight * 0.2 : modelHeight * 0.1);
            const cameraZ = Math.abs(distance); // 确保相机在Z轴正方向（正面）
            this.camera.position.set(0, cameraY, cameraZ);
            this.camera.lookAt(0, center.y, 0);
            
            // 如果模型被旋转了180度（背面朝向），调整相机位置到另一侧
            if (Math.abs(this.modelRotation.y - Math.PI) < 0.1) {
                // 模型已旋转180度，相机应该从Z轴负方向看（但模型已旋转，所以实际看到的是正面）
                // 实际上不需要调整，因为模型已经旋转了
                console.log('[VRM] 模型已旋转180度，相机位置保持不变');
            }
            
            // 重置位置
            this.modelPosition = { x: 0, y: 0, z: 0 };

            // 添加到场景
            this.scene.add(this.vrm.scene);

            // 优化材质设置（根据性能模式）
            this.optimizeMaterials();

            // SpringBone（物理骨骼）会在 animate() 循环中通过 update() 方法更新
            // 不需要手动初始化，three-vrm 会自动处理
            // 低性能模式：降低物理更新频率
            if (this.performanceMode === 'low' && this.vrm.springBoneManager) {
                // 可以通过降低更新频率来优化性能
                console.log('[VRM] 低性能模式：已启用物理骨骼优化');
            }

            // 确保拖拽和缩放功能已初始化（如果之前没有初始化）
            if (this.renderer && !this.dragHandler) {
                this.initDragAndZoom();
            }

            // 更新口型表情映射（确保口型同步能正常工作）
            this.updateMouthExpressionMapping();
            
            // 输出口型同步支持信息（用于调试）
            const lipSyncInfo = this.checkLipSyncSupport();
            if (lipSyncInfo.supported) {
                console.log('[VRM] 口型同步已就绪:', {
                    找到表情数: lipSyncInfo.mouthExpressions.length,
                    已映射表情: Object.values(this.mouthExpressions).filter(v => v !== null).length
                });
            } else {
                console.warn('[VRM] 口型同步可能不可用，模型可能没有嘴巴相关表情');
            }

            // 自动播放wait03.vrma动作
            setTimeout(async () => {
                try {
                    const wait03Path = '/static/models/vrm/animations/wait03.vrma';
                    await this.playVRMAAnimation(wait03Path, {
                        loop: true,
                        timeScale: 1.0
                    });
                    console.log('[VRM] 已自动播放wait03.vrma动作');
                } catch (animError) {
                    console.warn('[VRM] 播放wait03.vrma动作失败:', animError.message);
                }
            }, 100);


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
            // 检查锁定状态（同步Live2D管理器的锁定状态）
            if (this.checkLocked()) {
                return;
            }
            
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
            // 如果锁定，停止拖拽
            if (this.checkLocked()) {
                if (this.isDragging) {
                    this.isDragging = false;
                    this.dragMode = null;
                    canvas.style.cursor = 'grab';
                }
                return;
            }
            
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
            // 如果锁定，不响应缩放
            if (this.checkLocked() || !this.vrm) {
                return;
            }
            
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
    
    /**
     * 检查锁定状态（同步Live2D管理器的锁定状态）
     * @returns {boolean} 是否锁定
     */
    checkLocked() {
        // 同步Live2D管理器的锁定状态
        if (window.live2dManager && typeof window.live2dManager.isLocked !== 'undefined') {
            this.isLocked = window.live2dManager.isLocked;
        }
        return this.isLocked;
    }

    // 渲染循环 - 带帧率限制
    animate() {
        this.animationId = requestAnimationFrame(() => this.animate());

        // 帧率限制：低性能模式限制帧率以节省资源
        const now = performance.now();
        const elapsed = now - this.lastFrameTime;
        
        if (elapsed < this.frameTime) {
            return; // 跳过这一帧以限制帧率
        }
        
        this.lastFrameTime = now;
        
        // 更新 FPS 计数（每秒更新一次）
        this.frameCount++;
        if (now - this.lastFPSUpdate >= 1000) {
            this.currentFPS = this.frameCount;
            this.frameCount = 0;
            this.lastFPSUpdate = now;
            // 如果 FPS 过低，自动降级性能模式
            if (this.performanceMode !== 'low' && this.currentFPS < 20) {
                console.warn(`[VRM] FPS过低 (${this.currentFPS})，自动降级性能模式`);
                this.setPerformanceMode('low');
            }
        }

        const deltaTime = this.clock ? this.clock.getDelta() : 0.016;

        // 更新 SpringBone（物理骨骼）
        if (this.vrm?.springBoneManager) {
            this.vrm.springBoneManager.update(deltaTime);
        }

        // 更新 VMD 动画
        if (this.vmdAnimationManager) {
            this.vmdAnimationManager.update(deltaTime);
        }

        // 更新 VRMA 动画
        if (this.vrmaMixer && this.vrmaIsPlaying) {
            this.vrmaMixer.update(deltaTime);
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

        // 更新浮动按钮位置（跟随模型）
        this.updateFloatingButtonsPosition();

        // 渲染场景
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    /**
     * 更新浮动按钮位置，使其跟随VRM模型
     */
    updateFloatingButtonsPosition() {
        try {
            // 检查是否在主页面（有chat-container）
            if (!document.getElementById('chat-container')) {
                return;
            }

            // 检查是否有VRM模型
            if (!this.vrm || !this.vrm.scene || !this.camera || !this.renderer) {
                return;
            }

            // 获取浮动按钮容器
            const floatingButtons = document.getElementById('live2d-floating-buttons');
            if (!floatingButtons) {
                return;
            }

            // 移动端固定位置，不随模型移动
            const isMobile = window.innerWidth <= 768;
            if (isMobile) {
                return;
            }

            // 计算模型的边界框（使用世界坐标）
            const box = new THREE.Box3().setFromObject(this.vrm.scene);
            
            // 获取边界框的8个顶点（局部坐标）
            const localCorners = [
                new THREE.Vector3(box.min.x, box.min.y, box.min.z),
                new THREE.Vector3(box.max.x, box.min.y, box.min.z),
                new THREE.Vector3(box.min.x, box.max.y, box.min.z),
                new THREE.Vector3(box.max.x, box.max.y, box.min.z),
                new THREE.Vector3(box.min.x, box.min.y, box.max.z),
                new THREE.Vector3(box.max.x, box.min.y, box.max.z),
                new THREE.Vector3(box.min.x, box.max.y, box.max.z),
                new THREE.Vector3(box.max.x, box.max.y, box.max.z)
            ];

            // 将3D坐标转换为屏幕坐标
            const screenCorners = localCorners.map(localCorner => {
                // 转换为世界坐标
                const worldPos = localCorner.clone();
                this.vrm.scene.localToWorld(worldPos);
                
                // 投影到屏幕坐标（NDC坐标，范围-1到1）
                const screenPos = worldPos.clone().project(this.camera);
                
                // 转换为像素坐标（屏幕坐标）
                const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
                const y = (-screenPos.y * 0.5 + 0.5) * window.innerHeight;
                
                return { x, y };
            });

            // 计算屏幕边界框
            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;
            screenCorners.forEach(corner => {
                minX = Math.min(minX, corner.x);
                maxX = Math.max(maxX, corner.x);
                minY = Math.min(minY, corner.y);
                maxY = Math.max(maxY, corner.y);
            });

            // 计算模型实际高度（屏幕像素）
            const modelHeight = maxY - minY;

            // 基准按钮尺寸和工具栏高度（用于计算缩放）
            const baseButtonSize = 48;
            const baseGap = 12;
            const buttonCount = 5;
            const baseToolbarHeight = baseButtonSize * buttonCount + baseGap * (buttonCount - 1); // 288px

            // 计算目标工具栏高度（模型高度的一半）
            const targetToolbarHeight = modelHeight / 2;

            // 计算缩放比例（限制在合理范围内，防止按钮太小或太大）
            const minScale = 0.5;  // 最小缩放50%
            const maxScale = 1.0;  // 最大缩放100%
            const rawScale = targetToolbarHeight / baseToolbarHeight;
            const scale = Math.max(minScale, Math.min(maxScale, rawScale));

            // 应用缩放到容器（使用 transform-origin: left top 确保从左上角缩放）
            floatingButtons.style.transformOrigin = 'left top';
            floatingButtons.style.transform = `scale(${scale})`;

            // X轴：定位在角色右侧（与Live2D类似的横向位置）
            const screenWidth = window.innerWidth;
            const targetX = maxX * 0.8 + minX * 0.2;

            // Y轴：工具栏中心与模型中心对齐
            const modelCenterY = (minY + maxY) / 2;
            // 使用缩放后的实际工具栏高度
            const actualToolbarHeight = baseToolbarHeight * scale;
            // 让工具栏的中心位于模型中间，所以top = 中间 - 高度/2
            const targetY = modelCenterY - actualToolbarHeight / 2;

            // 边界限制：确保不超出屏幕顶部和底部
            const screenHeight = window.innerHeight;
            const minYBound = 20; // 距离屏幕顶部的最小距离
            const maxYBound = screenHeight - actualToolbarHeight - 20; // 距离屏幕底部的最小距离
            const boundedY = Math.max(minYBound, Math.min(targetY, maxYBound));

            floatingButtons.style.left = `${Math.min(targetX, screenWidth - 80 * scale)}px`;
            floatingButtons.style.top = `${boundedY}px`;
        } catch (error) {
            // 忽略单帧异常，避免影响渲染循环
            // console.warn('[VRM] 更新浮动按钮位置失败:', error);
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

        // 优化后的口型同步参数 - 更自然、更快速响应的对口型
        const smoothingFactor = 0.35; // 权重平滑因子（提高响应速度，同时保持平滑）
        const volumeThreshold = 0.0008; // 音量阈值（降低，更敏感）
        const volumeSensitivity = 5.5; // 音量敏感度（提高，更明显）
        const minMouthOpen = 0.05; // 最小嘴巴张开度（降低，更自然）
        const maxMouthOpen = 0.9; // 最大嘴巴张开度（提高，更明显）
        
        // 音量平滑处理（使用更快的响应）
        let smoothedVolume = 0;
        let volumeHistory = []; // 音量历史记录（用于动态阈值）

        const animate = () => {
            if (!this.lipSyncActive) return;

            // 获取音频数据
            analyser.getByteFrequencyData(frequencyData);
            analyser.getByteTimeDomainData(dataArray);

            // 改进的音量计算 - 更准确、更快速响应
            let sum = 0;
            let maxAmplitude = 0;
            let peakCount = 0; // 峰值计数，用于检测语音活动
            
            for (let i = 0; i < dataArray.length; i++) {
                const normalized = (dataArray[i] - 128) / 128;
                const absValue = Math.abs(normalized);
                sum += normalized * normalized;
                if (absValue > maxAmplitude) {
                    maxAmplitude = absValue;
                }
                // 检测峰值（超过阈值的样本）
                if (absValue > 0.1) {
                    peakCount++;
                }
            }
            
            const rms = Math.sqrt(sum / dataArray.length);
            // 结合RMS、最大振幅和峰值密度，更准确地反映音量
            const peakDensity = peakCount / dataArray.length; // 峰值密度（0-1）
            const rawVolume = (rms * 0.6 + maxAmplitude * 0.25 + peakDensity * 0.15) * volumeSensitivity;
            
            // 动态音量阈值（基于历史音量）
            volumeHistory.push(rawVolume);
            if (volumeHistory.length > 10) {
                volumeHistory.shift(); // 保持最近10帧
            }
            const avgVolume = volumeHistory.reduce((a, b) => a + b, 0) / volumeHistory.length;
            const dynamicThreshold = Math.max(volumeThreshold, avgVolume * 0.3);
            
            // 对音量进行平滑处理（使用更快的响应速度）
            smoothedVolume = smoothedVolume * 0.6 + Math.min(1, rawVolume) * 0.4;
            const volume = smoothedVolume;

            // 如果音量太低，逐渐关闭嘴巴（但保持最小张开度）
            if (volume < dynamicThreshold) {
                if (this.currentMouthExpression) {
                    this.targetMouthWeight = minMouthOpen;
                    // 使用更快的衰减速度
                    this.currentMouthWeight += (this.targetMouthWeight - this.currentMouthWeight) * 0.2;
                    const expr = this.vrm.expressionManager.expressions[this.currentMouthExpression.index];
                    if (expr) {
                        // 平滑过渡到最小张开度
                        expr.weight += (Math.max(minMouthOpen, this.currentMouthWeight) - expr.weight) * 0.2;
                        expr.weight = Math.max(minMouthOpen, expr.weight);
                    }
                }
                this.lipSyncAnimationId = requestAnimationFrame(animate);
                return;
            }

            // 简化口型同步逻辑 - 主要基于音量，频率分析作为辅助
            // 这样可以避免过于复杂的判断，让口型更自然
            
            // 分析频率，确定主要元音（简化判断逻辑）
            const lowFreq = this.getFrequencyRange(frequencyData, 0, Math.floor(bufferLength * 0.2)); // 低频（0-20%）
            const midFreq = this.getFrequencyRange(frequencyData, Math.floor(bufferLength * 0.2), Math.floor(bufferLength * 0.6)); // 中频（20-60%）
            const highFreq = this.getFrequencyRange(frequencyData, Math.floor(bufferLength * 0.6), Math.floor(bufferLength * 0.85)); // 高频（60-85%）

            // 归一化频率值（0-1范围）
            const maxFreq = Math.max(lowFreq, midFreq, highFreq, 0.01);
            const normalizedLow = lowFreq / maxFreq;
            const normalizedMid = midFreq / maxFreq;
            const normalizedHigh = highFreq / maxFreq;

            // 简化判断逻辑 - 主要基于音量，频率作为辅助
            let primaryExpression = null;
            let primaryWeight = 0;

            // 改进的频率分析 - 更准确地识别元音
            // 优先使用音量来决定口型张开度，频率只用于选择表情类型
            if (volume > dynamicThreshold) {
                // 改进的元音判断逻辑
                const lowRatio = normalizedLow / (normalizedMid + normalizedHigh + 0.01);
                const highRatio = normalizedHigh / (normalizedLow + normalizedMid + 0.01);
                const midRatio = normalizedMid / (normalizedLow + normalizedHigh + 0.01);
                
                // 根据频率特征判断元音（更精确的判断）
                if (normalizedLow > 0.7 && lowRatio > 1.3) {
                    // 'aa' (あ) - 低频明显占优
                    primaryExpression = this.mouthExpressions['aa'];
                    primaryWeight = normalizedLow;
                }
                else if (normalizedHigh > 0.65 && highRatio > 1.2) {
                    // 'ee' (え) 或 'ih' (い) - 高频明显占优
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
                    // 'ou' (う) 或 'oh' (お) - 中频占优
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
                    // 默认使用'aa'（嘴巴张开），但根据音量调整
                    primaryExpression = this.mouthExpressions['aa'];
                    primaryWeight = Math.max(normalizedLow, normalizedMid, normalizedHigh, 0.4);
                }
            } else {
                // 音量太低，使用默认表情但保持最小张开度
                primaryExpression = this.mouthExpressions['aa'];
                primaryWeight = 0.2;
            }

            // 如果找到了主要表情
            if (primaryExpression !== null && primaryExpression !== undefined) {
                // 改进的权重计算 - 更精确的音量到嘴巴张开度映射
                // 使用非线性映射，让低音量更敏感，高音量更平滑
                const normalizedVolume = Math.min(1, volume);
                const volumeCurve = Math.pow(normalizedVolume, 0.75); // 非线性曲线，低音量更敏感
                const volumeBasedWeight = minMouthOpen + (maxMouthOpen - minMouthOpen) * volumeCurve;
                
                // 结合频率强度（影响适中）
                const frequencyBoost = Math.min(0.2, primaryWeight * 0.25);
                this.targetMouthWeight = Math.min(maxMouthOpen, volumeBasedWeight + frequencyBoost);

                // 使用更快的响应速度，同时保持平滑
                this.currentMouthWeight += (this.targetMouthWeight - this.currentMouthWeight) * smoothingFactor;
                this.currentMouthWeight = Math.max(minMouthOpen, Math.min(maxMouthOpen, this.currentMouthWeight));

                // 如果切换到新的表情，快速平滑关闭其他表情
                if (!this.currentMouthExpression || this.currentMouthExpression.index !== primaryExpression) {
                    // 快速关闭之前的表情
                    if (this.currentMouthExpression) {
                        const oldExpr = this.vrm.expressionManager.expressions[this.currentMouthExpression.index];
                        if (oldExpr) {
                            // 更快的衰减速度
                            oldExpr.weight += (0 - oldExpr.weight) * 0.35;
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

                // 应用权重到当前表情（使用更快的响应速度）
                const expr = this.vrm.expressionManager.expressions[primaryExpression];
                if (expr) {
                    // 快速过渡到目标权重
                    expr.weight += (this.currentMouthWeight - expr.weight) * smoothingFactor;
                    expr.weight = Math.max(minMouthOpen, Math.min(maxMouthOpen, expr.weight));
                }

                // 快速关闭其他表情
                Object.keys(this.mouthExpressions).forEach(key => {
                    const exprIndex = this.mouthExpressions[key];
                    if (exprIndex !== null && exprIndex !== primaryExpression) {
                        const expr = this.vrm.expressionManager.expressions[exprIndex];
                        if (expr) {
                            // 更快的衰减速度
                            expr.weight += (0 - expr.weight) * 0.35;
                            if (expr.weight < 0.01) {
                                expr.weight = 0;
                            }
                        }
                    }
                });
            } else {
                // 如果没有找到匹配的表情，使用默认张开（基于音量）
                if (this.mouthExpressions['aa'] !== null) {
                    const defaultWeight = Math.max(minMouthOpen, Math.min(maxMouthOpen, volume * 0.8));
                    this.currentMouthWeight += (defaultWeight - this.currentMouthWeight) * smoothingFactor;
                    const defaultExpr = this.vrm.expressionManager.expressions[this.mouthExpressions['aa']];
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

    /**
     * 加载并播放 VRMA 动画
     * VRMA是VRM官方格式，可以直接作用于VRM模型，无需任何映射或转换
     * @param {string} vrmaPath - VRMA 文件路径
     * @param {Object} options - 播放选项 { loop, timeScale }
     */
    async playVRMAAnimation(vrmaPath, options = {}) {
        if (!this.vrm || !this.vrm.scene) {
            throw new Error('VRM 模型未加载');
        }

        try {
            // 停止当前动画
            this.stopVRMAAnimation();

            // 加载 GLTFLoader
            const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
            const loader = new GLTFLoader();

            // 直接加载 VRMA 文件（VRMA本质上是包含动画的GLB文件）
            const gltf = await new Promise((resolve, reject) => {
                loader.load(
                    vrmaPath,
                    (gltf) => resolve(gltf),
                    (progress) => {
                        if (progress.lengthComputable) {
                            const percent = (progress.loaded / progress.total) * 100;
                            console.log(`[VRMA] 加载进度: ${percent.toFixed(1)}%`);
                        }
                    },
                    (error) => reject(error)
                );
            });

            // 检查动画数据
            if (!gltf.animations || gltf.animations.length === 0) {
                throw new Error('VRMA 文件中没有找到动画数据');
            }

            // VRMA文件可能包含一些VRM模型中不存在的节点（如手指骨骼等）
            // 需要过滤掉这些不存在的节点，只保留VRM模型中实际存在的节点的tracks
            const originalClip = gltf.animations[0];
            const vrmScene = this.vrm.scene;
            
            // 创建VRM模型中所有节点的名称集合（用于快速查找）
            const vrmNodeNames = new Set();
            vrmScene.traverse((node) => {
                if (node.name) {
                    vrmNodeNames.add(node.name);
                }
            });
            
            // 过滤tracks：只保留VRM模型中存在的节点
            const validTracks = [];
            const skippedTracks = [];
            
            for (const track of originalClip.tracks) {
                // track.name格式通常是 "NodeName.property" 或 "NodeName.property[index]"
                const match = track.name.match(/^([^.]+)\.(.+)$/);
                if (match) {
                    const nodeName = match[1];
                    const property = match[2];
                    
                    // 检查节点是否存在于VRM模型中
                    if (vrmNodeNames.has(nodeName)) {
                        validTracks.push(track);
                    } else {
                        skippedTracks.push(nodeName);
                    }
                } else {
                    // 无法解析的track，跳过
                    skippedTracks.push(track.name);
                }
            }
            
            if (validTracks.length === 0) {
                throw new Error('VRMA动画中没有找到与VRM模型匹配的节点');
            }
            
            // 创建新的动画clip，只包含有效的tracks
            const clip = new THREE.AnimationClip(
                originalClip.name || 'VRMA_Animation',
                originalClip.duration,
                validTracks
            );
            
            // 输出统计信息
            if (skippedTracks.length > 0) {
                const uniqueSkipped = [...new Set(skippedTracks)];
                console.log(`[VRMA] 已过滤 ${skippedTracks.length} 个不匹配的轨道（${uniqueSkipped.length} 个唯一节点）`);
                console.log(`[VRMA] 有效轨道: ${validTracks.length} 个`);
            }
            
            // 创建或复用 AnimationMixer（绑定到VRM场景）
            if (!this.vrmaMixer) {
                this.vrmaMixer = new THREE.AnimationMixer(this.vrm.scene);
            }

            // 创建动画动作（现在只包含有效的tracks，不会有警告）
            this.vrmaAction = this.vrmaMixer.clipAction(clip);

            // 设置播放选项
            const loop = options.loop !== undefined ? options.loop : true;
            this.vrmaAction.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce);

            const timeScale = options.timeScale !== undefined ? options.timeScale : 1.0;
            this.vrmaAction.timeScale = timeScale;

            // 播放动画
            this.vrmaAction.play();
            this.vrmaIsPlaying = true;

            console.log('[VRMA] 动画播放成功:', {
                文件: vrmaPath,
                名称: clip.name,
                时长: clip.duration.toFixed(2) + '秒',
                循环: loop,
                速度: timeScale
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
            this.vrmaAction.stop();
            this.vrmaAction = null;
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

    // 清理 VRM 资源
    disposeVRM() {
        if (!this.vrm) return;
        
        // 清理 VMD 动画
        if (this.vmdAnimationManager) {
            this.vmdAnimationManager.dispose();
            this.vmdAnimationManager = null;
        }

        // 清理 VRMA 动画
        this.stopVRMAAnimation();
        if (this.vrmaMixer) {
            this.vrmaMixer.uncacheRoot(this.vrm.scene);
            this.vrmaMixer = null;
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
