/**
 * VRM 核心模块
 * 负责场景初始化、模型加载、性能管理等核心功能
 */
import * as THREE from 'three';

class VRMCore {
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
        this.clock = null;
        
        // VRM 模型版本（0.0 或 1.0）
        this.vrmVersion = null;
        
        // 性能监控
        this.frameCount = 0;
        this.lastFPSUpdate = 0;
        this.currentFPS = 0;
        
        // 模型变换属性（供 interaction 模块使用）
        this.modelRotation = { x: 0, y: 0 };
        this.modelPosition = { x: 0, y: 0, z: 0 };
        this.modelScale = 1.0;
    }
    
    /**
     * 检测 VRM 模型版本
     * @returns {string} '0.0' 或 '1.0'
     */
    detectVRMVersion(vrm) {
        try {
            if (vrm.meta) {
                if (vrm.meta.vrmVersion || vrm.meta.metaVersion) {
                    const version = vrm.meta.vrmVersion || vrm.meta.metaVersion;
                    if (version && (version.startsWith('1') || version.includes('1.0'))) {
                        return '1.0';
                    }
                }
                
                if (vrm.humanoid && vrm.humanoid.humanBones) {
                    const boneNames = Object.keys(vrm.humanoid.humanBones);
                    if (boneNames.length > 50) {
                        return '1.0';
                    }
                }
                
                if (vrm.expressionManager && vrm.expressionManager.expressions) {
                    const exprCount = Object.keys(vrm.expressionManager.expressions).length;
                    if (exprCount > 10) {
                        return '1.0';
                    }
                }
            }
            
            return '0.0';
        } catch (error) {
            console.warn('[VRM] 检测模型版本时出错，默认使用 0.0:', error);
            return '0.0';
        }
    }
    
    /**
     * 检测设备性能模式
     */
    detectPerformanceMode() {
        const savedMode = localStorage.getItem('vrm_performance_mode');
        if (savedMode && ['low', 'medium', 'high'].includes(savedMode)) {
            return savedMode;
        }
        
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            
            if (!gl) {
                return 'low';
            }
            
            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (debugInfo) {
                const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
                
                const isLowEndGPU = 
                    renderer.includes('Intel') && 
                    (renderer.includes('HD Graphics') || renderer.includes('Iris') || renderer.includes('UHD'));
                
                const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                const isLowEndMobile = isMobile && navigator.hardwareConcurrency <= 4;
                
                if (isLowEndGPU || isLowEndMobile) {
                    console.log('[VRM] 检测到低端设备，使用性能模式');
                    return 'low';
                }
            }
            
            const cores = navigator.hardwareConcurrency || 4;
            if (cores <= 2) {
                return 'low';
            } else if (cores <= 4) {
                return 'medium';
            }
            
            return 'high';
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
        
        let pixelRatio = window.devicePixelRatio || 1;
        if (this.performanceMode === 'low') {
            pixelRatio = Math.max(1.5, Math.min(pixelRatio, 2.0));
        } else if (this.performanceMode === 'medium') {
            pixelRatio = Math.max(2.0, Math.min(pixelRatio, 2.5));
        } else {
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
        
        this.vrm.scene.traverse((object) => {
            if (object.material) {
                const materials = Array.isArray(object.material) ? object.material : [object.material];
                
                materials.forEach(material => {
                    material.castShadow = false;
                    material.receiveShadow = false;
                });
            }
        });
        
        console.log('[VRM] 材质优化完成');
    }

    async init() {
        try {
            console.log('THREE.js 已就绪，开始初始化场景...');
            
            if (!this.container) {
                throw new Error('容器元素不存在');
            }
            
            this.container.style.display = 'block';
            this.container.style.visibility = 'visible';
            this.container.style.opacity = '1';
            this.container.style.width = '100%';
            this.container.style.height = '100%';
            this.container.style.position = 'fixed';
            this.container.style.top = '0';
            this.container.style.left = '0';

            this.scene = new THREE.Scene();
            this.scene.background = null;

            let width = this.container.clientWidth || this.container.offsetWidth;
            let height = this.container.clientHeight || this.container.offsetHeight;
            
            if (width === 0 || height === 0) {
                width = window.innerWidth;
                height = window.innerHeight;
            }
            this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
            this.camera.position.set(0, 1.2, 1.8);
            this.camera.lookAt(0, 1, 0);

            const antialias = true;
            const precision = 'highp';
            this.renderer = new THREE.WebGLRenderer({ 
                alpha: true, 
                antialias: antialias,
                powerPreference: 'high-performance',
                precision: precision,
                preserveDrawingBuffer: false,
                stencil: false
            });
            this.renderer.setSize(width, height);
            this.applyPerformanceSettings();
            this.renderer.shadowMap.enabled = false;
            
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
            
            this.container.innerHTML = '';
            this.container.appendChild(canvas);

            const ambientIntensity = this.performanceMode === 'low' ? 1.5 : 1.2;
            const ambientLight = new THREE.AmbientLight(0xffffff, ambientIntensity);
            this.scene.add(ambientLight);
            
            const directionalLight1 = new THREE.DirectionalLight(0xffffff, 1.0);
            directionalLight1.position.set(0, 2, 2);
            directionalLight1.castShadow = false;
            this.scene.add(directionalLight1);
            
            if (this.performanceMode !== 'low') {
                const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.6);
                directionalLight2.position.set(-1, 1, 1);
                directionalLight2.castShadow = false;
                this.scene.add(directionalLight2);
                
                if (this.performanceMode === 'high') {
                    const directionalLight3 = new THREE.DirectionalLight(0xffffff, 0.4);
                    directionalLight3.position.set(0, 0.5, -2);
                    directionalLight3.castShadow = false;
                    this.scene.add(directionalLight3);
                }
            }

            this.clock = new THREE.Clock();

            this.resizeHandler = () => this.onWindowResize();
            window.addEventListener('resize', this.resizeHandler);

        } catch (error) {
            console.error('VRM 核心初始化失败:', error);
            throw error;
        }
    }

    async loadModel(modelPath) {
        try {
            // 验证和规范化模型路径
            if (!modelPath) {
                throw new Error('模型路径不能为空');
            }
            
            // 确保路径是绝对路径（以 / 开头）
            let normalizedPath = modelPath.trim();
            if (!normalizedPath.startsWith('/') && !normalizedPath.startsWith('http://') && !normalizedPath.startsWith('https://')) {
                normalizedPath = '/' + normalizedPath;
            }
            
            // 移除路径中的双斜杠（除了 http:// 或 https://）
            normalizedPath = normalizedPath.replace(/([^:])\/\/+/g, '$1/');
            
            console.log('[VRM] 准备加载模型，原始路径:', modelPath, '规范化路径:', normalizedPath);
            
            // 尝试先验证文件是否存在（使用 fetch HEAD 请求）
            try {
                const checkResponse = await fetch(normalizedPath, { 
                    method: 'HEAD',
                    cache: 'no-cache'
                });
                if (!checkResponse.ok) {
                    console.warn(`[VRM] 模型文件可能不存在或无法访问: ${normalizedPath} (状态码: ${checkResponse.status})`);
                    // 不直接抛出错误，让 GLTFLoader 尝试加载，因为它可能有更好的错误信息
                } else {
                    console.log(`[VRM] 模型文件验证成功: ${normalizedPath}`);
                }
            } catch (checkError) {
                console.warn(`[VRM] 无法验证模型文件（可能是CORS限制，继续尝试加载）: ${normalizedPath}`, checkError);
                // 继续尝试加载，可能是 CORS 问题，但 GLTFLoader 可能可以加载
            }
            
            const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
            const { VRMLoaderPlugin } = await import('@pixiv/three-vrm');

            const loader = new GLTFLoader();
            loader.register((parser) => new VRMLoaderPlugin(parser));

            const gltf = await new Promise((resolve, reject) => {
                // 设置超时（30秒）
                const timeoutId = setTimeout(() => {
                    reject(new Error(`加载 VRM 模型超时: ${normalizedPath}。请检查文件是否存在，网络连接是否正常。`));
                }, 30000);
                
                loader.load(
                    normalizedPath,
                    (gltf) => {
                        clearTimeout(timeoutId);
                        resolve(gltf);
                    },
                    (progress) => {
                        if (progress.total > 0) {
                            const percent = (progress.loaded / progress.total) * 100;
                            console.log(`[VRM] 加载进度: ${percent.toFixed(1)}%`);
                        }
                    },
                    (error) => {
                        clearTimeout(timeoutId);
                        console.error('[VRM] GLTFLoader 加载失败:', error);
                        console.error('[VRM] 错误详情:', {
                            路径: normalizedPath,
                            原始路径: modelPath,
                            错误类型: error.constructor.name,
                            错误消息: error.message,
                            错误堆栈: error.stack
                        });
                        
                        // 提供更详细的错误信息
                        let errorMessage = `加载 VRM 模型失败`;
                        if (error.message) {
                            if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                                errorMessage = `无法获取文件 ${normalizedPath}。请检查：\n1. 文件路径是否正确\n2. 文件是否存在\n3. 服务器是否正常运行\n4. 是否有网络连接问题`;
                            } else {
                                errorMessage = `${error.message} (路径: ${normalizedPath})`;
                            }
                        } else {
                            errorMessage = `无法获取文件 ${normalizedPath}。请检查文件路径是否正确，文件是否存在。`;
                        }
                        reject(new Error(errorMessage));
                    }
                );
            });

            if (this.vrm) {
                this.scene.remove(this.vrm.scene);
                this.disposeVRM();
            }

            this.vrm = gltf.userData.vrm;

            if (!this.vrm) {
                throw new Error('加载的模型不是有效的 VRM 格式');
            }
            
            this.vrmVersion = this.detectVRMVersion(this.vrm);
            console.log(`[VRM] 检测到模型版本: ${this.vrmVersion}`);

            const box = new THREE.Box3().setFromObject(this.vrm.scene);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            
            this.vrm.scene.position.set(-center.x, -center.y, -center.z);
            
            let needsRotation = false;
            if (this.vrm.humanoid && this.vrm.humanoid.humanBones) {
                const headBone = this.vrm.humanoid.humanBones.head?.node;
                const chestBone = this.vrm.humanoid.humanBones.chest?.node || 
                                 this.vrm.humanoid.humanBones.spine?.node;
                
                if (headBone && chestBone) {
                    const headWorldPos = new THREE.Vector3();
                    const chestWorldPos = new THREE.Vector3();
                    headBone.getWorldPosition(headWorldPos);
                    chestBone.getWorldPosition(chestWorldPos);
                    
                    const forwardVec = new THREE.Vector3().subVectors(headWorldPos, chestWorldPos);
                    forwardVec.normalize();
                    
                    if (forwardVec.z > 0.3) {
                        console.log('[VRM] 检测到模型朝向为背面（通过骨骼检测），旋转180度使其正面朝向');
                        needsRotation = true;
                    }
                }
            }
            
            this.vrm.scene.rotation.set(0, needsRotation ? Math.PI : 0, 0);
            this.modelRotation = { x: 0, y: needsRotation ? Math.PI : 0 };
            
            if (needsRotation) {
                console.log('[VRM] 模型已旋转180度，确保正面朝向相机');
            }
            
            const isMobile = window.innerWidth <= 768;
            let targetScale;
            
            if (isMobile) {
                targetScale = Math.min(
                    0.5,
                    window.innerHeight * 1.3 / 4000,
                    window.innerWidth * 1.2 / 2000
                );
            } else {
                targetScale = Math.min(
                    0.5,
                    (window.innerHeight * 0.75) / 7000,
                    (window.innerWidth * 0.6) / 7000
                );
            }
            
            const modelHeight = size.y;
            const screenHeight = window.innerHeight;
            const screenWidth = window.innerWidth;
            
            const targetScreenHeight = screenHeight * 0.45;
            const fov = this.camera.fov * (Math.PI / 180);
            const distance = (modelHeight / 2) / Math.tan(fov / 2) / targetScreenHeight * screenHeight;
            
            this.vrm.scene.scale.set(1, 1, 1);
            this.modelScale = 1.0;
            
            const cameraY = center.y + (isMobile ? modelHeight * 0.2 : modelHeight * 0.1);
            const cameraZ = Math.abs(distance);
            this.camera.position.set(0, cameraY, cameraZ);
            this.camera.lookAt(0, center.y, 0);
            
            if (Math.abs(this.modelRotation.y - Math.PI) < 0.1) {
                console.log('[VRM] 模型已旋转180度，相机位置保持不变');
            }
            
            this.modelPosition = { x: 0, y: 0, z: 0 };

            this.scene.add(this.vrm.scene);

            this.optimizeMaterials();

            if (this.performanceMode === 'low' && this.vrm.springBoneManager) {
                console.log('[VRM] 低性能模式：已启用物理骨骼优化');
            }

            return this.vrm;
        } catch (error) {
            console.error('加载 VRM 模型失败:', error);
            throw error;
        }
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

    // 清理 VRM 资源
    disposeVRM() {
        if (!this.vrm) return;
        
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

    // 清理所有资源
    dispose() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }

        if (this.vrm) {
            this.scene.remove(this.vrm.scene);
            this.disposeVRM();
            this.vrm = null;
        }

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
    }
}

export default VRMCore;
