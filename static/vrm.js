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
        
        // 锁定功能
        this.isLocked = true; // 默认锁定
        this.lockIconElement = null;
        this.lockIconShowHandler = null;
        this.lockIconHideHandler = null;
        this.lockIconMouseEnterHandler = null;
        this.lockIconMouseLeaveHandler = null;
        this.lockIconHideTimeout = null;
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

            // 初始化锁图标
            this.setupLockIcon();

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

    // 设置锁图标
    setupLockIcon() {
        // 在非主页面不显示
        if (!document.getElementById('chat-container')) {
            this.isLocked = false;
            return;
        }

        // 如果锁图标已存在，先移除
        if (this.lockIconElement && this.lockIconElement.parentNode) {
            this.lockIconElement.parentNode.removeChild(this.lockIconElement);
        }

        const lockIcon = document.createElement('div');
        lockIcon.id = 'vrm-lock-icon';
        lockIcon.innerText = this.isLocked ? '🔒' : '🔓';
        Object.assign(lockIcon.style, {
            position: 'fixed',
            zIndex: '9999', // 确保在最上层
            fontSize: '24px',
            cursor: 'pointer',
            userSelect: 'none',
            textShadow: '0 0 4px black',
            pointerEvents: 'auto',
            display: 'block', // 先显示，让用户能看到
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            backgroundColor: 'rgba(0, 0, 0, 0.5)', // 添加背景以便看到
            borderRadius: '8px',
            padding: '8px 12px'
        });

        document.body.appendChild(lockIcon);
        this.lockIconElement = lockIcon;

        // 点击切换锁定状态
        lockIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            this.isLocked = !this.isLocked;
            lockIcon.innerText = this.isLocked ? '🔒' : '🔓';
            this.updateLockState();
        });

        // 初始状态
        this.updateLockState();

        // 鼠标跟踪显示/隐藏锁图标
        this.setupLockIconVisibility();
    }

    // 更新锁定状态
    updateLockState() {
        if (!this.renderer || !this.container) return;
        
        const canvas = this.renderer.domElement;
        
        if (this.isLocked) {
            // 锁定：禁用交互
            canvas.style.pointerEvents = 'none';
            canvas.style.cursor = 'default';
            this.container.style.pointerEvents = 'none';
            // 停止当前拖拽
            this.isDragging = false;
            this.dragMode = null;
        } else {
            // 解锁：启用交互
            canvas.style.pointerEvents = 'auto';
            canvas.style.cursor = 'grab';
            this.container.style.pointerEvents = 'auto';
        }
    }

    // 计算模型在屏幕上的投影位置
    getModelScreenBounds() {
        if (!this.vrm || !this.camera || !this.renderer) return null;
        
        const box = new THREE.Box3().setFromObject(this.vrm.scene);
        const corners = [
            new THREE.Vector3(box.min.x, box.min.y, box.min.z),
            new THREE.Vector3(box.max.x, box.min.y, box.min.z),
            new THREE.Vector3(box.min.x, box.max.y, box.min.z),
            new THREE.Vector3(box.max.x, box.max.y, box.min.z),
            new THREE.Vector3(box.min.x, box.min.y, box.max.z),
            new THREE.Vector3(box.max.x, box.min.y, box.max.z),
            new THREE.Vector3(box.min.x, box.max.y, box.max.z),
            new THREE.Vector3(box.max.x, box.max.y, box.max.z)
        ];
        
        const width = this.renderer.domElement.width || this.container.clientWidth;
        const height = this.renderer.domElement.height || this.container.clientHeight;
        
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        
        corners.forEach(corner => {
            const vector = corner.clone();
            vector.applyMatrix4(this.vrm.scene.matrixWorld);
            vector.project(this.camera);
            
            const x = (vector.x * 0.5 + 0.5) * width;
            const y = (-vector.y * 0.5 + 0.5) * height;
            
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        });
        
        return {
            left: minX,
            right: maxX,
            top: minY,
            bottom: maxY,
            width: maxX - minX,
            height: maxY - minY
        };
    }

    // 设置锁图标显示/隐藏逻辑（类似Live2D的鼠标跟踪）
    setupLockIconVisibility() {
        if (!this.renderer || !this.lockIconElement) return;

        const canvas = this.renderer.domElement;
        let hideButtonsTimer = null;
        const threshold = 70; // 与Live2D相同的阈值

        // 鼠标移动跟踪
        const mouseMoveHandler = (e) => {
            if (!this.vrm || !this.lockIconElement) return;
            
            // 如果正在拖拽，隐藏图标
            if (this.isDragging) {
                this.lockIconElement.style.display = 'none';
                return;
            }
            
            const bounds = this.getModelScreenBounds();
            if (!bounds) {
                // 如果无法获取边界，使用容器位置作为备选
                const rect = this.container.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    // 使用容器的中心位置
                    const targetX = rect.left + rect.width * 0.7;
                    const targetY = rect.top + rect.height * 0.7;
                    this.lockIconElement.style.left = `${targetX}px`;
                    this.lockIconElement.style.top = `${targetY}px`;
                    this.lockIconElement.style.transform = 'none';
                    this.lockIconElement.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
                    this.lockIconElement.style.display = 'block';
                }
                return;
            }
            
            // 计算鼠标到模型边界的距离
            const mouseX = e.clientX;
            const mouseY = e.clientY;
            
            const dx = Math.max(
                bounds.left - mouseX,
                0,
                mouseX - bounds.right
            );
            const dy = Math.max(
                bounds.top - mouseY,
                0,
                mouseY - bounds.bottom
            );
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            // 更新锁图标位置（类似Live2D：bounds.right * 0.7 + bounds.left * 0.3）
            const targetX = bounds.right * 0.7 + bounds.left * 0.3;
            const targetY = bounds.top * 0.3 + bounds.bottom * 0.7;
            const screenWidth = window.innerWidth;
            const screenHeight = window.innerHeight;
            
            this.lockIconElement.style.left = `${Math.min(targetX, screenWidth - 40)}px`;
            this.lockIconElement.style.top = `${Math.min(targetY, screenHeight - 40)}px`;
            this.lockIconElement.style.transform = 'none';
            this.lockIconElement.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
            
            if (distance < threshold) {
                // 鼠标靠近模型，显示锁图标
                if (hideButtonsTimer) {
                    clearTimeout(hideButtonsTimer);
                    hideButtonsTimer = null;
                }
                
                this.lockIconElement.style.display = 'block';
            } else {
                // 鼠标远离模型，延迟隐藏
                if (!hideButtonsTimer) {
                    hideButtonsTimer = setTimeout(() => {
                        if (this.lockIconElement) {
                            this.lockIconElement.style.display = 'none';
                        }
                        hideButtonsTimer = null;
                    }, 1000);
                }
            }
        };
        
        // 锁图标本身也要监听，防止鼠标移到图标上时隐藏
        const lockIconMouseEnter = () => {
            if (hideButtonsTimer) {
                clearTimeout(hideButtonsTimer);
                hideButtonsTimer = null;
            }
        };
        
        const lockIconMouseLeave = () => {
            if (!hideButtonsTimer) {
                hideButtonsTimer = setTimeout(() => {
                    if (this.lockIconElement) {
                        this.lockIconElement.style.display = 'none';
                    }
                    hideButtonsTimer = null;
                }, 1000);
            }
        };
        
        // 保存处理器引用
        this.lockIconShowHandler = mouseMoveHandler;
        this.lockIconHideHandler = lockIconMouseLeave;
        this.lockIconMouseEnterHandler = lockIconMouseEnter;
        this.lockIconMouseLeaveHandler = lockIconMouseLeave;
        
        // 添加事件监听
        canvas.addEventListener('mousemove', mouseMoveHandler);
        if (this.lockIconElement) {
            this.lockIconElement.addEventListener('mouseenter', lockIconMouseEnter);
            this.lockIconElement.addEventListener('mouseleave', lockIconMouseLeave);
        }
    }

    // 清理锁图标相关事件监听器
    cleanupLockIcon() {
        if (this.lockIconHideTimeout) {
            clearTimeout(this.lockIconHideTimeout);
            this.lockIconHideTimeout = null;
        }

        if (this.renderer && this.container) {
            const canvas = this.renderer.domElement;
            
            if (this.lockIconShowHandler) {
                canvas.removeEventListener('mousemove', this.lockIconShowHandler);
                this.lockIconShowHandler = null;
            }
            if (this.lockIconHideHandler) {
                this.lockIconElement?.removeEventListener('mouseleave', this.lockIconHideHandler);
                this.lockIconHideHandler = null;
            }
            if (this.lockIconMouseEnterHandler && this.lockIconElement) {
                this.lockIconElement.removeEventListener('mouseenter', this.lockIconMouseEnterHandler);
                this.lockIconMouseEnterHandler = null;
            }
        }
    }

    // 初始化拖拽和缩放功能
    initDragAndZoom() {
        if (!this.renderer) return;

        const canvas = this.renderer.domElement;
        
        // 先清理旧的事件监听器（防止重复初始化）
        this.cleanupDragAndZoom();
        
        // 确保容器和 canvas 可以接收指针事件
        this.container.style.pointerEvents = this.isLocked ? 'none' : 'auto';
        canvas.style.pointerEvents = this.isLocked ? 'none' : 'auto';
        canvas.style.userSelect = 'none';

        // 鼠标按下事件
        this.mouseDownHandler = (e) => {
            // 如果锁定，不允许拖拽
            if (this.isLocked) return;
            
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
            // 如果锁定，不允许缩放
            if (this.isLocked || !this.vrm) return;

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

    // 更新浮动按钮位置（类似Live2D）
    updateFloatingButtonsPosition() {
        const floatingButtons = document.getElementById('live2d-floating-buttons');
        if (!floatingButtons || !this.vrm) return;
        
        const bounds = this.getModelScreenBounds();
        if (!bounds) return;
        
        // 计算按钮位置（模型左侧，垂直居中）
        const buttonX = bounds.left - 80; // 按钮在模型左侧80px
        const buttonY = bounds.top + bounds.height / 2; // 垂直居中
        
        // 确保按钮不超出屏幕
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;
        
        floatingButtons.style.left = `${Math.max(10, Math.min(buttonX, screenWidth - 100))}px`;
        floatingButtons.style.top = `${Math.max(10, Math.min(buttonY, screenHeight - 300))}px`;
        floatingButtons.style.right = 'auto';
        floatingButtons.style.bottom = 'auto';
    }

    // 渲染循环
    animate() {
        this.animationId = requestAnimationFrame(() => this.animate());

        const deltaTime = this.clock ? this.clock.getDelta() : 0.016;

        // 更新 SpringBone（物理骨骼）
        if (this.vrm?.springBoneManager) {
            this.vrm.springBoneManager.update(deltaTime);
        }

        // 更新浮动按钮位置
        this.updateFloatingButtonsPosition();

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

        // 清理锁图标
        this.cleanupLockIcon();
        if (this.lockIconElement && this.lockIconElement.parentNode) {
            this.lockIconElement.parentNode.removeChild(this.lockIconElement);
            this.lockIconElement = null;
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

