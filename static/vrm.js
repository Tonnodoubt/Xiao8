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
    }

    async init() {
        try {
            // Three.js 已通过 ES 模块导入，直接使用
            console.log('THREE.js 已就绪，开始初始化场景...');

            // 创建场景
            this.scene = new THREE.Scene();
            this.scene.background = null; // 透明背景

            // 创建相机
            const width = this.container.clientWidth || window.innerWidth;
            const height = this.container.clientHeight || window.innerHeight;
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
            const canvas = this.renderer.domElement;
            canvas.style.pointerEvents = 'auto';
            canvas.style.touchAction = 'none';
            canvas.style.userSelect = 'none';
            canvas.style.cursor = 'grab';
            
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

            console.log('VRM 管理器初始化成功');
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
                            console.log(`VRM 加载进度: ${percent.toFixed(1)}%`);
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

            // 调整模型位置和大小（居中显示）
            this.vrm.scene.position.set(0, 0, 0);
            // 旋转模型180度，确保正面显示（如果模型默认面向Z轴负方向）
            this.vrm.scene.rotation.set(0, Math.PI, 0);
            this.vrm.scene.scale.set(1, 1, 1);
            this.modelScale = 1.0;
            this.modelRotation = { x: 0, y: Math.PI }; // 初始旋转也要设置为180度
            this.modelPosition = { x: 0, y: 0, z: 0 }; // 重置位置
            
            // 调整相机位置，确保模型在视野内（从正面看）
            this.camera.position.set(0, 1.2, 1.8);
            this.camera.lookAt(0, 1, 0);

            // 添加到场景
            this.scene.add(this.vrm.scene);

            // SpringBone（物理骨骼）会在 animate() 循环中通过 update() 方法更新
            // 不需要手动初始化，three-vrm 会自动处理

            // 确保拖拽和缩放功能已初始化（如果之前没有初始化）
            if (this.renderer && !this.dragHandler) {
                this.initDragAndZoom();
            }

            console.log('VRM 模型加载成功');
            const availableExpressions = Object.keys(this.vrm.expressionManager?.expressions || {});
            console.log('模型信息:', {
                expressions: availableExpressions,
                springBones: this.vrm.springBoneManager?.springBoneGroups?.length || 0
            });

            return this.vrm;
        } catch (error) {
            console.error('加载 VRM 模型失败:', error);
            throw error;
        }
    }

    // 设置表情
    setExpression(expressionName, weight) {
        if (!this.vrm || !this.vrm.expressionManager) {
            console.warn('VRM 模型未加载或没有表情管理器');
            return false;
        }

        const expression = this.vrm.expressionManager.expressions[expressionName];
        if (expression) {
            expression.weight = Math.max(0, Math.min(1, weight));
            return true;
        } else {
            console.warn(`表情 "${expressionName}" 不存在`);
            return false;
        }
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

    // 启用/禁用鼠标跟踪
    enableMouseTracking(enabled = true) {
        this.mouseTrackingEnabled = enabled;

        if (enabled) {
            this.mouseMoveHandler = this.onMouseMove.bind(this);
            document.addEventListener('mousemove', this.mouseMoveHandler);
        } else {
            if (this.mouseMoveHandler) {
                document.removeEventListener('mousemove', this.mouseMoveHandler);
                this.mouseMoveHandler = null;
            }
        }
    }

    onMouseMove(event) {
        if (!this.vrm || !this.vrm.humanoid) return;

        // 简单的鼠标跟踪实现
        const x = (event.clientX / window.innerWidth) * 2 - 1;
        const y = -(event.clientY / window.innerHeight) * 2 + 1;

        // 调整头部朝向
        const headBone = this.vrm.humanoid.getNormalizedBoneNode('head');
        if (headBone) {
            // 限制旋转角度
            headBone.rotation.y = Math.max(-0.5, Math.min(0.5, x * 0.3));
            headBone.rotation.x = Math.max(-0.3, Math.min(0.3, y * 0.2));
        }
    }

    // 设置模型位置
    setPosition(x, y, z) {
        if (this.vrm) {
            this.vrm.scene.position.set(x, y, z);
        }
    }

    // 设置模型缩放
    setScale(scale) {
        if (this.vrm) {
            this.vrm.scene.scale.set(scale, scale, scale);
        }
    }

    // 获取当前模型
    getCurrentModel() {
        return this.vrm;
    }

    // 初始化拖拽和缩放功能
    initDragAndZoom() {
        if (!this.renderer) return;

        const canvas = this.renderer.domElement;
        
        // 先清理旧的事件监听器（防止重复初始化）
        this.cleanupDragAndZoom();
        
        // 确保 canvas 可以接收指针事件
        canvas.style.pointerEvents = 'auto';
        canvas.style.userSelect = 'none';

        // 鼠标按下事件
        this.mouseDownHandler = (e) => {
            if (e.button === 0) { // 左键：旋转
                e.preventDefault();
                e.stopPropagation();
                this.isDragging = true;
                this.dragMode = 'rotate';
                this.previousMousePosition = {
                    x: e.clientX,
                    y: e.clientY
                };
                canvas.style.cursor = 'grabbing';
            } else if (e.button === 1) { // 中键：平移
                e.preventDefault();
                e.stopPropagation();
                this.isDragging = true;
                this.dragMode = 'pan';
                this.previousMousePosition = {
                    x: e.clientX,
                    y: e.clientY
                };
                canvas.style.cursor = 'move';
            }
        };
        canvas.addEventListener('mousedown', this.mouseDownHandler);

        // 鼠标移动事件
        this.dragHandler = (e) => {
            if (!this.isDragging || !this.dragMode) return;
            if (!this.vrm) return;

            e.preventDefault();
            e.stopPropagation();

            const deltaX = e.clientX - this.previousMousePosition.x;
            const deltaY = e.clientY - this.previousMousePosition.y;

            if (this.dragMode === 'rotate') {
                // 左键：旋转模型（Y轴水平旋转，X轴垂直旋转）
                this.modelRotation.y += deltaX * 0.01;
                this.modelRotation.x -= deltaY * 0.01;

                // 限制垂直旋转角度
                this.modelRotation.x = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, this.modelRotation.x));

                // 应用旋转
                this.vrm.scene.rotation.y = this.modelRotation.y;
                this.vrm.scene.rotation.x = this.modelRotation.x;
            } else if (this.dragMode === 'pan') {
                // 中键：平移模型（在屏幕空间中移动）
                // 将屏幕坐标转换为世界坐标的移动
                const panSpeed = 0.01;
                this.modelPosition.x += deltaX * panSpeed;
                this.modelPosition.y -= deltaY * panSpeed; // Y轴反转

                // 应用平移
                this.vrm.scene.position.x = this.modelPosition.x;
                this.vrm.scene.position.y = this.modelPosition.y;
            }

            this.previousMousePosition = {
                x: e.clientX,
                y: e.clientY
            };
        };
        document.addEventListener('mousemove', this.dragHandler);

        // 鼠标释放事件
        this.mouseUpHandler = (e) => {
            if (e.button === 0 || e.button === 1) {
                this.isDragging = false;
                this.dragMode = null;
                canvas.style.cursor = 'grab';
            }
        };
        document.addEventListener('mouseup', this.mouseUpHandler);

        // 鼠标离开画布时也释放
        this.mouseLeaveHandler = () => {
            this.isDragging = false;
            this.dragMode = null;
            canvas.style.cursor = 'grab';
        };
        canvas.addEventListener('mouseleave', this.mouseLeaveHandler);
        
        // 阻止中键的默认行为（打开新标签页等）
        this.auxClickHandler = (e) => {
            if (e.button === 1) {
                e.preventDefault();
                e.stopPropagation();
            }
        };
        canvas.addEventListener('auxclick', this.auxClickHandler);

        // 鼠标进入画布时改变光标
        this.mouseEnterHandler = () => {
            if (!this.isDragging) {
                canvas.style.cursor = 'grab';
            }
        };
        canvas.addEventListener('mouseenter', this.mouseEnterHandler);

        // 鼠标滚轮缩放
        this.wheelHandler = (e) => {
            if (!this.vrm) return;

            e.preventDefault();
            e.stopPropagation();

            // 计算缩放增量
            const zoomSpeed = 0.1;
            const delta = e.deltaY > 0 ? -zoomSpeed : zoomSpeed;
            this.modelScale = Math.max(0.3, Math.min(3.0, this.modelScale + delta));

            // 应用缩放
            this.vrm.scene.scale.set(this.modelScale, this.modelScale, this.modelScale);
        };
        canvas.addEventListener('wheel', this.wheelHandler, { passive: false });
    }

    // 渲染循环
    animate() {
        this.animationId = requestAnimationFrame(() => this.animate());

        const deltaTime = this.clock ? this.clock.getDelta() : 0.016;

        // 更新 SpringBone（物理骨骼）
        if (this.vrm?.springBoneManager) {
            this.vrm.springBoneManager.update(deltaTime);
        }

        // 渲染场景
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
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
}

// 导出到全局
if (typeof window !== 'undefined') {
    window.VRMManager = VRMManager;
}

// ES 模块导出
export default VRMManager;
export { VRMManager };

