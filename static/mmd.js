// MMD 管理器类
// 使用 @moeru/three-mmd 和 three.js 来加载和显示 MMD 模型
// 注意：需要先加载 three.js 和 @moeru/three-mmd

class MMDManager {
    constructor() {
        this.currentModel = null;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.isInitialized = false;
        this.isLocked = true;
        this.onModelLoaded = null;
        
        // 事件监听器引用（用于清理）
        this._resizeHandler = null;
        this._dragHandlers = null;
        this._zoomHandler = null;
        this.animationFrameId = null;
        
        // 口型同步控制
        this.mouthValue = 0; // 0~1
        this.mouthMorphIndex = -1; // MMD 模型的嘴巴 morph 索引
        this._lipSyncFrameId = null; // 口型同步的动画帧 ID
        this.analyser = null;
        
        // 拖动相关
        this.isDragging = false;
        // 延迟初始化 THREE 对象，避免在 THREE 未加载时出错
        this.dragStartPos = null;
        this.modelPosition = null;
        this.modelScale = 1.0;
        this.modelRotation = { x: 0, y: 0 }; // 模型旋转角度
        
        // 触摸缩放相关
        this.lastTouchDistance = 0;
        this.isPinching = false;
        
        // 默认模型路径（需要用户提供）
        // 注意：MMD 模型通常需要 .pmd 或 .pmx 文件，以及对应的 .vmd 动作文件
        // 这里只加载模型文件，动作文件需要单独加载
        // 优先使用 .pmx 格式（更新的格式）
        this.defaultModelPath = '/static/mmd/default_model.pmx';
    }

    // 初始化 Three.js 场景
    async initThree(canvasId, containerId, options = {}) {
        if (this.isInitialized) {
            console.warn('MMD 管理器已经初始化');
            return;
        }

        const canvas = document.getElementById(canvasId);
        if (!canvas) {
            throw new Error(`找不到 canvas 元素: ${canvasId}`);
        }

        const container = document.getElementById(containerId);
        if (!container) {
            throw new Error(`找不到容器元素: ${containerId}`);
        }

        // 检查 three.js 是否已加载
        if (typeof THREE === 'undefined') {
            throw new Error('THREE.js 未加载，请先加载 three.js 库');
        }

        // 初始化拖动相关的 THREE 对象（如果还未初始化）
        if (!this.dragStartPos) {
            this.dragStartPos = new THREE.Vector2();
        }
        if (!this.modelPosition) {
            this.modelPosition = new THREE.Vector3(0, 0, 0);
        }
        if (!this.modelRotation) {
            this.modelRotation = { x: 0, y: 0 };
        }

        // 创建场景
        this.scene = new THREE.Scene();
        // 设置背景色为透明（如果需要背景色，可以设置为 new THREE.Color(0x000000)）
        this.scene.background = null; // 透明背景

        // 创建相机
        const width = container.clientWidth || window.innerWidth;
        const height = container.clientHeight || window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
        // 调整相机位置，确保模型在视野内（MMD 模型通常在原点附近）
        this.camera.position.set(0, 0, 50);
        this.camera.lookAt(0, 0, 0);

        // 创建渲染器
        this.renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            alpha: true,
            antialias: true,
            preserveDrawingBuffer: true  // 保留绘制缓冲区，用于调试
        });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        
        // 设置清除颜色为透明（alpha: true 时默认就是透明）
        // 注意：alpha: true 时，清除颜色的 alpha 值会被忽略，背景总是透明的
        this.renderer.setClearColor(0x000000, 0);  // 黑色，完全透明
        this.renderer.clear();  // 立即清除一次
        
        // 确保渲染器正确设置 alpha
        if (this.renderer.domElement) {
            this.renderer.domElement.style.width = '100%';
            this.renderer.domElement.style.height = '100%';
        }
        
        console.log('[MMD] 渲染器初始化完成');
        console.log('[MMD] Canvas 尺寸:', width, 'x', height);
        console.log('[MMD] Canvas 实际尺寸:', canvas.width, 'x', canvas.height);
        console.log('[MMD] 容器尺寸:', container.clientWidth, 'x', container.clientHeight);
        console.log('[MMD] 容器显示状态:', window.getComputedStyle(container).display);
        console.log('[MMD] Canvas 显示状态:', window.getComputedStyle(canvas).display);

        // 添加灯光
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(1, 1, 1);
        directionalLight.castShadow = true;
        this.scene.add(directionalLight);

        // 处理窗口大小变化
        this._resizeHandler = () => {
            // 使用防抖，避免频繁调整
            if (this._resizeTimeout) {
                clearTimeout(this._resizeTimeout);
            }
            this._resizeTimeout = setTimeout(() => {
                const newWidth = container.clientWidth > 0 ? container.clientWidth : window.innerWidth;
                const newHeight = container.clientHeight > 0 ? container.clientHeight : window.innerHeight;
                if (newWidth > 0 && newHeight > 0) {
                    console.log('[MMD] 窗口尺寸变化，调整渲染器:', newWidth, 'x', newHeight);
                    this.camera.aspect = newWidth / newHeight;
                    this.camera.updateProjectionMatrix();
                    this.renderer.setSize(newWidth, newHeight);
                    // 强制渲染一帧
                    if (this.scene && this.camera) {
                        this.renderer.render(this.scene, this.camera);
                    }
                }
            }, 100);
        };
        window.addEventListener('resize', this._resizeHandler);

        // 启动渲染循环
        this.animate();

        this.isInitialized = true;
    }

    // 渲染循环
    animate() {
        // 检查是否已销毁
        if (!this.renderer || !this.scene || !this.camera) {
            return;
        }
        
        // 检查容器是否可见，如果隐藏则不渲染（节省资源）
        const container = document.getElementById('mmd-container');
        if (container) {
            const computedStyle = window.getComputedStyle(container);
            const isHidden = computedStyle.display === 'none' || 
                           computedStyle.visibility === 'hidden' || 
                           computedStyle.opacity === '0' ||
                           !container.offsetParent;
            
            if (isHidden) {
                // 容器隐藏，延迟下一帧检查
                this.animationFrameId = requestAnimationFrame(() => this.animate());
                return;
            }
            
            // 检查 canvas 尺寸，如果为 0 则重新设置
            const canvas = this.renderer.domElement;
            if (canvas.width === 0 || canvas.height === 0) {
                const newWidth = container.clientWidth || window.innerWidth;
                const newHeight = container.clientHeight || window.innerHeight;
                if (newWidth > 0 && newHeight > 0) {
                    console.warn('[MMD] Canvas 尺寸为 0，重新设置为:', newWidth, 'x', newHeight);
                    this.renderer.setSize(newWidth, newHeight);
                    this.camera.aspect = newWidth / newHeight;
                    this.camera.updateProjectionMatrix();
                }
            }
        }
        
        this.animationFrameId = requestAnimationFrame(() => this.animate());
        
        if (this.currentModel && this.currentModel.mixer) {
            this.currentModel.mixer.update(0.016);
        }
        
        // 确保渲染器尺寸正确（每次渲染都检查，确保窗口尺寸变化时及时更新）
        if (this.renderer && container) {
            const currentWidth = container.clientWidth > 0 ? container.clientWidth : window.innerWidth;
            const currentHeight = container.clientHeight > 0 ? container.clientHeight : window.innerHeight;
            if (currentWidth > 0 && currentHeight > 0) {
                const canvas = this.renderer.domElement;
                // 检查是否需要更新尺寸（容差 1px，避免频繁更新）
                if (Math.abs(canvas.width - currentWidth) > 1 || Math.abs(canvas.height - currentHeight) > 1) {
                    console.log('[MMD] 检测到尺寸变化，更新渲染器:', currentWidth, 'x', currentHeight, '(Canvas:', canvas.width, 'x', canvas.height, ')');
                    this.renderer.setSize(currentWidth, currentHeight);
                    this.camera.aspect = currentWidth / currentHeight;
                    this.camera.updateProjectionMatrix();
                }
            }
        }
        
        // 确保渲染
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    // 加载 MMD 模型
    async loadModel(modelPath, options = {}) {
        if (!this.scene) {
            throw new Error('Three.js 场景未初始化，请先调用 initThree()');
        }

        // 移除当前模型
        if (this.currentModel) {
            this.scene.remove(this.currentModel);
            if (this.currentModel.geometry) this.currentModel.geometry.dispose();
            if (this.currentModel.material) {
                if (Array.isArray(this.currentModel.material)) {
                    this.currentModel.material.forEach(mat => mat.dispose());
                } else {
                    this.currentModel.material.dispose();
                }
            }
            this.currentModel = null;
        }

        try {
            // 检查 MMDLoader 是否可用
            let MMDLoaderClass = null;
            if (typeof window !== 'undefined' && window.MMDLoader) {
                MMDLoaderClass = window.MMDLoader;
            } else if (typeof MMDLoader !== 'undefined') {
                MMDLoaderClass = MMDLoader;
            } else if (typeof window !== 'undefined' && window.moeru && window.moeru.MMDLoader) {
                MMDLoaderClass = window.moeru.MMDLoader;
            } else if (typeof THREE !== 'undefined' && THREE.MMDLoader) {
                MMDLoaderClass = THREE.MMDLoader;
            } else {
                throw new Error('MMDLoader 未加载，请先加载 @moeru/three-mmd 库');
            }

            // 创建 MMD 加载器
            let loader;
            try {
                loader = new MMDLoaderClass();
            } catch (e) {
                try {
                    if (typeof THREE !== 'undefined' && THREE.LoadingManager) {
                        const manager = new THREE.LoadingManager();
                        loader = new MMDLoaderClass(manager);
                    } else {
                        throw new Error('THREE.LoadingManager 不可用');
                    }
                } catch (e2) {
                    throw new Error(`无法创建 MMDLoader: ${e2.message}`);
                }
            }
            
            // 解析路径：分离目录和文件名
            if (!modelPath || typeof modelPath !== 'string') {
                throw new Error('模型路径无效');
            }
            const pathParts = modelPath.split('/').filter(p => p);
            if (pathParts.length === 0) {
                throw new Error('模型路径无效');
            }
            const fileName = pathParts.pop();
            const basePath = '/' + pathParts.join('/');
            
            // 设置加载器路径（用于加载模型文件）
            // path 用于 FileLoader 加载模型文件本身
            if (typeof loader.setPath === 'function' && basePath && basePath !== '/') {
                const pathToSet = basePath.endsWith('/') ? basePath : basePath + '/';
                loader.setPath(pathToSet);
                console.log('[MMD] 设置模型文件路径:', pathToSet);
            }
            
            // 设置资源路径（用于加载纹理文件）
            // resourcePath 用于 MaterialBuilder 加载纹理文件
            // MMD 模型的纹理文件通常在模型文件所在目录或其子目录中
            let resourcePath = basePath;
            
            // 检查是否有同名的纹理文件夹（例如 default_model.pmx 对应 default_model/ 文件夹）
            const modelNameWithoutExt = fileName.replace(/\.(pmx|pmd)$/i, '');
            const possibleTextureDirs = [
                basePath + '/' + modelNameWithoutExt + '/',  // default_model/
                basePath + '/' + modelNameWithoutExt + ' (2)/',  // default_model (2)/
                basePath + '/tex/',  // tex/ 子目录
                basePath + '/'  // 直接在模型目录
            ];
            
            // 尝试设置 resourcePath，优先使用可能的纹理目录
            // 注意：实际的纹理路径会在模型文件中指定，这里只是设置基础路径
            if (typeof loader.setResourcePath === 'function') {
                // 使用模型文件所在目录作为基础路径
                // 如果纹理在子目录中，模型文件中的路径会包含子目录名
                const resourcePathToSet = basePath.endsWith('/') ? basePath : basePath + '/';
                loader.setResourcePath(resourcePathToSet);
                console.log('[MMD] 设置纹理资源路径:', resourcePathToSet);
                console.log('[MMD] 可能的纹理目录:', possibleTextureDirs);
            } else if (basePath && basePath !== '/') {
                loader.resourcePath = basePath.endsWith('/') ? basePath : basePath + '/';
                console.log('[MMD] 设置纹理资源路径（直接属性）:', loader.resourcePath);
            }
            
            resourcePath = basePath.endsWith('/') ? basePath : basePath + '/';
            
            // 注意：MMDLoader 内部会使用 resolveResourcePath 来确定最终的 resourcePath
            // 它会优先使用 loader.resourcePath，然后是 loader.path，最后是 URL 的基础路径
            // 我们已经设置了 loader.setResourcePath，所以应该会使用我们设置的路径
            
            const mesh = await new Promise((resolve, reject) => {
                try {
                    const urlToLoad = (typeof loader.setPath === 'function' && basePath && basePath !== '/') 
                        ? fileName 
                        : modelPath;
                    console.log('[MMD] ========== 模型加载信息 ==========');
                    console.log('[MMD] 原始模型路径:', modelPath);
                    console.log('[MMD] 实际加载URL:', urlToLoad);
                    console.log('[MMD] 基础路径:', basePath);
                    console.log('[MMD] 文件名:', fileName);
                    console.log('[MMD] 资源路径:', resourcePath);
                    console.log('[MMD] ====================================');
                    
                    if (typeof loader.load === 'function') {
                        loader.load(
                            urlToLoad,
                            (mesh) => {
                                console.log('[MMD] 模型加载成功');
                                console.log('[MMD] 加载的 mesh 类型:', mesh.constructor.name);
                                console.log('[MMD] mesh 子对象数量:', mesh.children.length);
                                console.log('[MMD] mesh 是否有材质:', !!mesh.material);
                                console.log('[MMD] mesh 是否有几何体:', !!mesh.geometry);
                                
                                // 检查 mesh 的完整性
                                if (mesh.geometry) {
                                    const geometry = mesh.geometry;
                                    if (geometry.attributes && geometry.attributes.position) {
                                        const vertexCount = geometry.attributes.position.count;
                                        console.log('[MMD] 几何体顶点数量:', vertexCount);
                                        
                                        // 检查顶点数量是否合理（MMD 模型通常有数千到数万个顶点）
                                        if (vertexCount < 100) {
                                            console.warn('[MMD] 警告：顶点数量过少，可能模型加载不完整');
                                        }
                                    }
                                }
                                
                                // 检查材质和纹理
                                if (mesh.material) {
                                    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                                    console.log('[MMD] 材质数量:', materials.length);
                                    materials.forEach((mat, idx) => {
                                        console.log(`[MMD] 材质 ${idx}:`, {
                                            type: mat.type,
                                            name: mat.name,
                                            map: mat.map ? mat.map.image?.src || '有纹理但路径未知' : '无纹理',
                                            normalMap: mat.normalMap ? '有法线贴图' : '无法线贴图',
                                            emissiveMap: mat.emissiveMap ? '有发光贴图' : '无发光贴图'
                                        });
                                    });
                                    console.log('[MMD] 材质数量:', materials.length);
                                    materials.forEach((mat, i) => {
                                        if (mat) {
                                            console.log(`[MMD] 材质 ${i}:`, mat.type, '可见:', mat.visible !== false);
                                        }
                                    });
                                }
                                
                                resolve(mesh);
                            },
                            (progress) => {
                                // 进度回调
                                if (progress && progress.total > 0) {
                                    const percent = (progress.loaded / progress.total) * 100;
                                    console.log(`[MMD] 加载进度: ${percent.toFixed(1)}%`);
                                }
                            },
                            (error) => {
                                console.error('[MMD] 模型加载失败:', error);
                                if (error && error.message) {
                                    console.error('[MMD] 错误信息:', error.message);
                                    if (error.message.includes('texture') || error.message.includes('404')) {
                                        console.warn('[MMD] 纹理文件加载失败，请确保纹理文件在模型文件目录下');
                                    }
                                    if (error.message.includes('parse') || error.message.includes('format')) {
                                        console.warn('[MMD] 模型文件解析失败，可能是文件格式问题或文件损坏');
                                    }
                                }
                                reject(error);
                            }
                        );
                    } else {
                        throw new Error('MMDLoader 没有 load 方法');
                    }
                } catch (error) {
                    console.error('[MMD] 加载过程出错:', error);
                    reject(error);
                }
            });

            // 设置模型位置和缩放
            mesh.position.copy(this.modelPosition);
            mesh.scale.set(this.modelScale, this.modelScale, this.modelScale);

            // 添加到场景
            this.scene.add(mesh);
            this.currentModel = mesh;

            // 查找嘴巴 morph 索引（用于口型同步）
            this.findMouthMorphIndex(mesh);

            // 初始化模型位置和缩放
            if (!this.modelPosition) {
                this.modelPosition = new THREE.Vector3(0, 0, 0);
            }
            if (!this.modelRotation) {
                this.modelRotation = { x: 0, y: 0 };
            }
            mesh.position.copy(this.modelPosition);
            mesh.scale.set(this.modelScale, this.modelScale, this.modelScale);
            
            // 设置拖动和缩放
            if (options.dragEnabled !== false) {
                this.setupDragAndDrop();
                this.setupZoom(); // 添加缩放功能
            }

            // 解锁模型（允许拖拽和交互）
            this.setLocked(false);
            console.log('[MMD] 模型已解锁，isLocked:', this.isLocked);

            // 调用回调函数
            if (this.onModelLoaded) {
                this.onModelLoaded(mesh, modelPath);
            }

            return mesh;
        } catch (error) {
            console.error('加载 MMD 模型失败:', error);
            throw error;
        }
    }

    // 查找嘴巴 morph 索引
    findMouthMorphIndex(mesh) {
        if (!mesh.morphTargetDictionary) {
            console.warn('模型没有 morph targets，无法进行口型同步');
            this.mouthMorphIndex = -1;
            return;
        }

        // 常见的嘴巴 morph 名称（MMD 模型常用）
        const mouthNames = [
            'あ', 'い', 'う', 'え', 'お', // 日语元音
            'A', 'I', 'U', 'E', 'O', // 英语元音
            'MouthA', 'MouthI', 'MouthU', 'MouthE', 'MouthO',
            '口あ', '口い', '口う', '口え', '口お',
            '口開', '口閉'
        ];

        for (const name of mouthNames) {
            if (mesh.morphTargetDictionary[name] !== undefined) {
                this.mouthMorphIndex = mesh.morphTargetDictionary[name];
                return;
            }
        }

        // 如果没找到，尝试使用第一个 morph（作为备选）
        const morphNames = Object.keys(mesh.morphTargetDictionary);
        if (morphNames.length > 0) {
            this.mouthMorphIndex = mesh.morphTargetDictionary[morphNames[0]];
        } else {
            this.mouthMorphIndex = -1;
        }
    }

    // 设置嘴巴开合度（用于口型同步）
    setMouth(value) {
        this.mouthValue = Math.max(0, Math.min(1, value));
        
        if (this.currentModel && this.mouthMorphIndex >= 0) {
            if (this.currentModel.morphTargetInfluences) {
                this.currentModel.morphTargetInfluences[this.mouthMorphIndex] = this.mouthValue;
            }
        }
    }

    // 启动口型同步
    startLipSync(analyser) {
        if (!analyser) return;
        
        // 检查 MMD 容器是否可见，如果隐藏则不启动口型同步
        const container = document.getElementById('mmd-container');
        if (container && (container.style.display === 'none' || !container.offsetParent)) {
            return; // MMD 未显示，不启动口型同步
        }
        
        // 检查是否有当前模型
        if (!this.currentModel) {
            return; // 没有模型，不启动口型同步
        }

        // 如果已经在运行，先停止
        if (this.analyser) {
            this.stopLipSync();
        }

        this.analyser = analyser;
        const dataArray = new Uint8Array(analyser.fftSize);

        const updateLipSync = () => {
            if (!this.analyser) return;
            
            // 再次检查容器是否可见
            const container = document.getElementById('mmd-container');
            if (container && (container.style.display === 'none' || !container.offsetParent)) {
                // 容器已隐藏，停止口型同步
                this.stopLipSync();
                return;
            }

            try {
                analyser.getByteTimeDomainData(dataArray);
                
                // 计算 RMS（均方根）值
                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) {
                    const val = (dataArray[i] - 128) / 128; // 归一化到 -1~1
                    sum += val * val;
                }
                const rms = Math.sqrt(sum / dataArray.length);
                
                // 映射到嘴巴开合度 0~1
                const mouthOpen = Math.min(1, rms * 8);
                this.setMouth(mouthOpen);
            } catch (error) {
                // 静默处理错误，避免控制台噪音
            }

            // 使用独立的 requestAnimationFrame，不干扰主渲染循环
            this._lipSyncFrameId = requestAnimationFrame(updateLipSync);
        };

        updateLipSync();
    }

    // 停止口型同步
    stopLipSync() {
        this.analyser = null;
        if (this._lipSyncFrameId) {
            cancelAnimationFrame(this._lipSyncFrameId);
            this._lipSyncFrameId = null;
        }
        this.setMouth(0);
    }

    // 设置拖动功能
    setupDragAndDrop() {
        const canvas = this.renderer.domElement;
        
        if (!canvas) {
            console.error('[MMD] 无法获取 canvas 元素，拖动功能无法启用');
            return;
        }
        
        console.log('[MMD] 设置拖动功能，canvas:', canvas);
        console.log('[MMD] isLocked:', this.isLocked);
        console.log('[MMD] currentModel:', this.currentModel);
        
        // 移除旧的事件监听器（如果存在）
        if (this._dragHandlers) {
            this._removeDragHandlers(canvas);
        }
        
        // 确保 canvas 可以接收鼠标事件
        canvas.style.pointerEvents = 'auto';
        canvas.style.touchAction = 'none';
        canvas.style.zIndex = '10001'; // 确保在最上层
        
        // 计算两点之间的距离（用于双指缩放）
        const getTouchDistance = (touch1, touch2) => {
            const dx = touch1.clientX - touch2.clientX;
            const dy = touch1.clientY - touch2.clientY;
            return Math.sqrt(dx * dx + dy * dy);
        };
        
        // 创建事件处理器对象
        this._dragHandlers = {
            mousedown: (event) => {
                console.log('[MMD] mousedown 事件触发, isLocked:', this.isLocked, 'currentModel:', !!this.currentModel);
                if (this.isLocked) {
                    console.warn('[MMD] 模型已锁定，无法拖动');
                    return;
                }
                if (!this.currentModel) {
                    console.warn('[MMD] 当前没有模型，无法拖动');
                    return;
                }
                // 左键拖动位置，右键拖动旋转
                const isRightButton = event.button === 2 || event.ctrlKey || event.metaKey;
                if (isRightButton) {
                    // 右键旋转功能（可选，暂时禁用）
                    return;
                }
                this.isDragging = true;
                this.dragStartPos.set(event.clientX, event.clientY);
                canvas.style.cursor = 'grabbing';
                console.log('[MMD] 开始拖动');
                event.preventDefault();
            },
            mousemove: (event) => {
                if (!this.isDragging || this.isLocked || !this.currentModel) {
                    if (this.isDragging) {
                        console.log('[MMD] mousemove 被阻止, isDragging:', this.isDragging, 'isLocked:', this.isLocked, 'currentModel:', !!this.currentModel);
                    }
                    return;
                }
                
                const deltaX = event.clientX - this.dragStartPos.x;
                const deltaY = event.clientY - this.dragStartPos.y;
                
                // 改进拖动：使用更平滑的移动速度
                const moveSpeed = 0.015; // 调整移动速度
                const moveX = deltaX * moveSpeed;
                const moveY = -deltaY * moveSpeed; // Y轴反转
                
                this.modelPosition.x += moveX;
                this.modelPosition.y += moveY;
                
                // 应用位置到模型
                this.currentModel.position.x = this.modelPosition.x;
                this.currentModel.position.y = this.modelPosition.y;
                
                this.dragStartPos.set(event.clientX, event.clientY);
            },
            mouseup: () => {
                if (this.isDragging) {
                    this.isDragging = false;
                    canvas.style.cursor = 'grab';
                }
            },
            mouseleave: () => {
                if (this.isDragging) {
                    this.isDragging = false;
                    canvas.style.cursor = 'grab';
                }
            },
            contextmenu: (event) => {
                // 禁用右键菜单，避免干扰拖动
                event.preventDefault();
            },
            touchstart: (event) => {
                if (this.isLocked) return;
                
                if (event.touches.length === 2) {
                    // 双指缩放
                    this.isPinching = true;
                    this.isDragging = false;
                    const touch1 = event.touches[0];
                    const touch2 = event.touches[1];
                    this.lastTouchDistance = getTouchDistance(touch1, touch2);
                    event.preventDefault();
                } else if (event.touches.length === 1) {
                    // 单指拖动
                    this.isDragging = true;
                    this.isPinching = false;
                    const touch = event.touches[0];
                    this.dragStartPos.set(touch.clientX, touch.clientY);
                    event.preventDefault();
                }
            },
            touchmove: (event) => {
                if (this.isLocked || !this.currentModel) return;
                
                if (event.touches.length === 2 && this.isPinching) {
                    // 双指缩放
                    const touch1 = event.touches[0];
                    const touch2 = event.touches[1];
                    const currentDistance = getTouchDistance(touch1, touch2);
                    
                    if (this.lastTouchDistance > 0) {
                        const scaleFactor = currentDistance / this.lastTouchDistance;
                        const newScale = this.modelScale * scaleFactor;
                        this.modelScale = Math.max(0.1, Math.min(5.0, newScale));
                        this.currentModel.scale.set(this.modelScale, this.modelScale, this.modelScale);
                    }
                    
                    this.lastTouchDistance = currentDistance;
                    event.preventDefault();
                } else if (event.touches.length === 1 && this.isDragging) {
                    // 单指拖动
                    const touch = event.touches[0];
                    const deltaX = touch.clientX - this.dragStartPos.x;
                    const deltaY = touch.clientY - this.dragStartPos.y;
                    
                    const moveSpeed = 0.015;
                    const moveX = deltaX * moveSpeed;
                    const moveY = -deltaY * moveSpeed;
                    
                    this.modelPosition.x += moveX;
                    this.modelPosition.y += moveY;
                    
                    this.currentModel.position.x = this.modelPosition.x;
                    this.currentModel.position.y = this.modelPosition.y;
                    
                    this.dragStartPos.set(touch.clientX, touch.clientY);
                    event.preventDefault();
                }
            },
            touchend: (event) => {
                if (event.touches.length === 0) {
                    // 所有手指都离开
                    this.isDragging = false;
                    this.isPinching = false;
                    this.lastTouchDistance = 0;
                } else if (event.touches.length === 1) {
                    // 从双指变为单指，切换到拖动模式
                    this.isPinching = false;
                    this.isDragging = true;
                    const touch = event.touches[0];
                    this.dragStartPos.set(touch.clientX, touch.clientY);
                }
                event.preventDefault();
            }
        };
        
        // 添加所有事件监听器
        canvas.addEventListener('mousedown', this._dragHandlers.mousedown, { passive: false });
        canvas.addEventListener('mousemove', this._dragHandlers.mousemove, { passive: false });
        canvas.addEventListener('mouseup', this._dragHandlers.mouseup, { passive: false });
        canvas.addEventListener('mouseleave', this._dragHandlers.mouseleave, { passive: false });
        canvas.addEventListener('contextmenu', this._dragHandlers.contextmenu, { passive: false });
        canvas.addEventListener('touchstart', this._dragHandlers.touchstart, { passive: false });
        canvas.addEventListener('touchmove', this._dragHandlers.touchmove, { passive: false });
        canvas.addEventListener('touchend', this._dragHandlers.touchend, { passive: false });
        
        canvas.style.cursor = 'grab';
        console.log('[MMD] 拖动事件监听器已添加');
    }
    
    // 移除拖动事件监听器
    _removeDragHandlers(canvas) {
        if (!this._dragHandlers) return;
        canvas.removeEventListener('mousedown', this._dragHandlers.mousedown);
        canvas.removeEventListener('mousemove', this._dragHandlers.mousemove);
        canvas.removeEventListener('mouseup', this._dragHandlers.mouseup);
        canvas.removeEventListener('mouseleave', this._dragHandlers.mouseleave);
        canvas.removeEventListener('contextmenu', this._dragHandlers.contextmenu);
        canvas.removeEventListener('touchstart', this._dragHandlers.touchstart);
        canvas.removeEventListener('touchmove', this._dragHandlers.touchmove);
        canvas.removeEventListener('touchend', this._dragHandlers.touchend);
        this._dragHandlers = null;
    }

    // 设置缩放功能（鼠标滚轮）
    setupZoom() {
        const canvas = this.renderer.domElement;
        
        if (!canvas) {
            console.error('[MMD] 无法获取 canvas 元素，缩放功能无法启用');
            return;
        }
        
        console.log('[MMD] 设置缩放功能，canvas:', canvas);
        console.log('[MMD] isLocked:', this.isLocked);
        console.log('[MMD] currentModel:', this.currentModel);
        
        // 移除旧的事件监听器（如果存在）
        if (this._zoomHandler) {
            canvas.removeEventListener('wheel', this._zoomHandler);
        }
        
        canvas.style.pointerEvents = 'auto';
        
        this._zoomHandler = (event) => {
            console.log('[MMD] wheel 事件触发, isLocked:', this.isLocked, 'currentModel:', !!this.currentModel);
            if (this.isLocked || !this.currentModel) {
                console.warn('[MMD] 缩放被阻止, isLocked:', this.isLocked, 'currentModel:', !!this.currentModel);
                return;
            }
            
            event.preventDefault();
            event.stopPropagation();
            
            // 改进缩放：使用更平滑的缩放速度，支持 Ctrl/Cmd 键加速
            const baseZoomSpeed = 0.05;
            const zoomSpeed = (event.ctrlKey || event.metaKey) ? baseZoomSpeed * 2 : baseZoomSpeed;
            
            // 根据滚轮方向缩放
            const delta = event.deltaY > 0 ? -zoomSpeed : zoomSpeed;
            const newScale = this.modelScale + delta;
            this.modelScale = Math.max(0.1, Math.min(5.0, newScale));
            
            // 应用缩放
            this.currentModel.scale.set(this.modelScale, this.modelScale, this.modelScale);
            console.log('[MMD] 缩放完成，新缩放值:', this.modelScale);
            
            // 可选：缩放时调整位置，使缩放中心在鼠标位置
            // 这里暂时使用模型中心作为缩放中心
        };
        
        canvas.addEventListener('wheel', this._zoomHandler, { passive: false });
        console.log('[MMD] 缩放事件监听器已添加');
    }

    // 获取当前模型
    getCurrentModel() {
        return this.currentModel;
    }

    // 设置锁定状态
    setLocked(locked) {
        this.isLocked = locked;
    }

    // 加载并显示 MMD 模型（隐藏 Live2D）
    async loadAndShowModel(modelPath, options = {}) {
        console.log('[MMD] loadAndShowModel 被调用，模型路径:', modelPath);
        console.log('[MMD] 完整模型路径:', modelPath);
        console.log('[MMD] 当前工作目录:', window.location.pathname);
        try {
            await this.loadModel(modelPath, options);
            
            // 显示 MMD 容器，隐藏 Live2D 容器
            const mmdContainer = document.getElementById('mmd-container');
            const live2dContainer = document.getElementById('live2d-container');
            const mmdCanvas = document.getElementById('mmd-canvas');
            
            if (mmdContainer) {
                mmdContainer.style.display = 'block';
                mmdContainer.style.visibility = 'visible';
                mmdContainer.style.opacity = '1';
            }
            if (mmdCanvas) {
                mmdCanvas.style.display = 'block';
                mmdCanvas.style.visibility = 'visible';
                mmdCanvas.style.opacity = '1';
            }
            if (live2dContainer) {
                live2dContainer.style.display = 'none';
            }
            
            // 等待一帧，确保容器已正确显示并计算尺寸
            requestAnimationFrame(() => {
                // 确保渲染器大小正确
                if (this.renderer && mmdContainer) {
                    // 优先使用容器尺寸，如果为0则使用窗口尺寸
                    const width = mmdContainer.clientWidth > 0 ? mmdContainer.clientWidth : window.innerWidth;
                    const height = mmdContainer.clientHeight > 0 ? mmdContainer.clientHeight : window.innerHeight;
                    console.log('[MMD] 设置渲染器尺寸:', width, 'x', height, '(容器尺寸:', mmdContainer.clientWidth, 'x', mmdContainer.clientHeight, ')');
                    this.renderer.setSize(width, height);
                    if (this.camera) {
                        this.camera.aspect = width / height;
                        this.camera.updateProjectionMatrix();
                    }
                }
                
                // 强制渲染一帧，确保模型显示
                if (this.renderer && this.scene && this.camera && this.currentModel) {
                    // 再等待一帧，确保模型几何体已完全加载
                    requestAnimationFrame(() => {
                        try {
                        // 检查模型边界，调整相机位置
                        const box = new THREE.Box3().setFromObject(this.currentModel);
                        const center = box.getCenter(new THREE.Vector3());
                        const size = box.getSize(new THREE.Vector3());
                        const maxDim = Math.max(size.x, size.y, size.z);
                        
                        console.log('MMD 模型边界框中心:', center);
                        console.log('MMD 模型边界框大小:', size);
                        console.log('MMD 模型最大尺寸:', maxDim);
                        
                        // 如果边界框有效
                        if (maxDim > 0 && isFinite(maxDim)) {
                            // 调整相机位置，确保模型在视野内
                            const distance = Math.max(maxDim * 2.5, 50);
                            this.camera.position.set(center.x, center.y, center.z + distance);
                            this.camera.lookAt(center);
                            this.camera.updateProjectionMatrix();
                            
                            // 如果模型太小，增加缩放
                            if (maxDim < 10) {
                                const scaleFactor = 20 / maxDim;
                                this.modelScale = scaleFactor;
                                this.currentModel.scale.set(scaleFactor, scaleFactor, scaleFactor);
                                console.log('模型太小，已自动缩放:', scaleFactor);
                            }
                            
                            console.log('相机位置:', this.camera.position);
                            console.log('相机看向:', center);
                        } else {
                            // 边界框无效，使用默认设置
                            console.warn('无法计算模型边界框，使用默认相机位置');
                            this.camera.position.set(0, 0, 50);
                            this.camera.lookAt(0, 0, 0);
                        }
                        
                        // 检查 canvas 和容器
                        const canvas = this.renderer.domElement;
                        const container = document.getElementById('mmd-container');
                        console.log('Canvas 尺寸:', canvas.width, 'x', canvas.height);
                        console.log('Canvas 显示:', window.getComputedStyle(canvas).display);
                        console.log('Canvas 可见性:', window.getComputedStyle(canvas).visibility);
                        console.log('Canvas 透明度:', window.getComputedStyle(canvas).opacity);
                        console.log('Canvas z-index:', window.getComputedStyle(canvas).zIndex);
                        if (container) {
                            console.log('容器尺寸:', container.clientWidth, 'x', container.clientHeight);
                            console.log('容器 z-index:', window.getComputedStyle(container).zIndex);
                        }
                        
                        // 渲染
                        // 确保渲染器尺寸正确（container 已在上面声明）
                        if (container) {
                            const containerWidth = container.clientWidth || window.innerWidth;
                            const containerHeight = container.clientHeight || window.innerHeight;
                            if (containerWidth > 0 && containerHeight > 0) {
                                const canvas = this.renderer.domElement;
                                if (canvas.width !== containerWidth || canvas.height !== containerHeight) {
                                    console.log('[MMD] 调整 Canvas 尺寸:', containerWidth, 'x', containerHeight);
                                    this.renderer.setSize(containerWidth, containerHeight);
                                    this.camera.aspect = containerWidth / containerHeight;
                                    this.camera.updateProjectionMatrix();
                                }
                            }
                        }
                        
                        // 强制清除并渲染
                        this.renderer.clear();
                        this.renderer.render(this.scene, this.camera);
                        console.log('MMD 模型已显示，场景对象数量:', this.scene.children.length);
                        console.log('MMD 模型位置:', this.currentModel.position.x, this.currentModel.position.y, this.currentModel.position.z);
                        console.log('MMD 模型缩放:', this.currentModel.scale.x, this.currentModel.scale.y, this.currentModel.scale.z);
                        console.log('相机位置:', this.camera.position.x, this.camera.position.y, this.camera.position.z);
                        console.log('相机看向:', center.x, center.y, center.z);
                        
                        // 检查模型是否在场景中
                        const modelInScene = this.scene.children.includes(this.currentModel);
                        console.log('模型是否在场景中:', modelInScene);
                        
                        // 检查模型是否可见
                        console.log('模型 visible:', this.currentModel.visible);
                        
                        // 检查是否有其他元素覆盖了 MMD 容器
                        const mmdContainer = document.getElementById('mmd-container');
                        if (mmdContainer) {
                            const rect = mmdContainer.getBoundingClientRect();
                            const elementAtPoint = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                            console.log('MMD 容器中心点的元素:', elementAtPoint?.id || elementAtPoint?.tagName);
                            if (elementAtPoint && elementAtPoint !== mmdContainer && !mmdContainer.contains(elementAtPoint)) {
                                console.warn('警告：可能有其他元素覆盖了 MMD 容器:', elementAtPoint);
                            }
                        }
                        
                        // 强制渲染多次，确保显示
                        for (let i = 0; i < 3; i++) {
                            requestAnimationFrame(() => {
                                this.renderer.render(this.scene, this.camera);
                            });
                        }
                        
                        // 测试立方体已确认渲染正常，移除它
                        // 注意：测试立方体会在下次加载模型时自动移除（因为场景会被清空）
                        
                        // 检查模型的完整结构
                        console.log('=== 模型结构检查 ===');
                        console.log('模型类型:', this.currentModel.constructor.name);
                        console.log('模型子对象数量:', this.currentModel.children.length);
                        console.log('模型是否可见:', this.currentModel.visible);
                        
                        // 检查所有子对象
                        this.currentModel.traverse((child) => {
                            if (child.isMesh) {
                                console.log(`Mesh: ${child.name || '未命名'}`, {
                                    visible: child.visible,
                                    materialCount: Array.isArray(child.material) ? child.material.length : 1,
                                    geometry: child.geometry ? child.geometry.type : '无',
                                    position: { x: child.position.x, y: child.position.y, z: child.position.z },
                                    scale: { x: child.scale.x, y: child.scale.y, z: child.scale.z }
                                });
                                
                                // 确保所有 mesh 可见
                                child.visible = true;
                                
                                // 检查材质
                                const materials = Array.isArray(child.material) ? child.material : [child.material];
                                materials.forEach((mat, i) => {
                                    if (mat) {
                                        console.log(`  材质 ${i}:`, mat.type, '可见:', mat.visible !== false);
                                        // 检查材质是否有贴图
                                        if (mat.map) {
                                            console.log(`    贴图:`, mat.map.image?.src || '已加载');
                                        } else {
                                            console.warn(`    无贴图`);
                                        }
                                        // 确保材质可见
                                        mat.visible = true;
                                    }
                                });
                            }
                        });
                        
                        // 检查模型是否有材质
                        if (this.currentModel.material) {
                            const materials = Array.isArray(this.currentModel.material) 
                                ? this.currentModel.material 
                                : [this.currentModel.material];
                            console.log('根对象材质数量:', materials.length);
                            materials.forEach((mat, i) => {
                                if (mat) {
                                    console.log(`根材质 ${i}:`, mat.type, '可见:', mat.visible !== false);
                                    // 检查材质是否有贴图
                                    if (mat.map) {
                                        console.log(`  贴图:`, mat.map.image?.src || '已加载');
                                    } else {
                                        console.warn(`  无贴图`);
                                    }
                                    // 确保材质可见
                                    mat.visible = true;
                                }
                            });
                        }
                        
                        // 确保模型可见
                        this.currentModel.visible = true;
                        
                        // 重新计算边界框，确保包含所有子对象
                        const fullBox = new THREE.Box3().setFromObject(this.currentModel);
                        const fullCenter = fullBox.getCenter(new THREE.Vector3());
                        const fullSize = fullBox.getSize(new THREE.Vector3());
                        const fullMaxDim = Math.max(fullSize.x, fullSize.y, fullSize.z);
                        console.log('完整模型边界框:');
                        console.log('  中心:', `X: ${fullCenter.x.toFixed(2)}, Y: ${fullCenter.y.toFixed(2)}, Z: ${fullCenter.z.toFixed(2)}`);
                        console.log('  尺寸:', `X: ${fullSize.x.toFixed(2)}, Y: ${fullSize.y.toFixed(2)}, Z: ${fullSize.z.toFixed(2)}`);
                        console.log('  最大尺寸:', fullMaxDim.toFixed(2));
                        console.log('  最小点:', `X: ${fullBox.min.x.toFixed(2)}, Y: ${fullBox.min.y.toFixed(2)}, Z: ${fullBox.min.z.toFixed(2)}`);
                        console.log('  最大点:', `X: ${fullBox.max.x.toFixed(2)}, Y: ${fullBox.max.y.toFixed(2)}, Z: ${fullBox.max.z.toFixed(2)}`);
                        
                        // 检查模型的几何体顶点分布
                        this.currentModel.traverse((child) => {
                            if (child.isMesh && child.geometry) {
                                const geometry = child.geometry;
                                if (geometry.attributes && geometry.attributes.position) {
                                    const positions = geometry.attributes.position;
                                    const vertexCount = positions.count;
                                    console.log(`几何体顶点数量: ${vertexCount}`);
                                    
                                    // 采样一些顶点位置
                                    const sampleCount = Math.min(10, vertexCount);
                                    console.log(`采样前 ${sampleCount} 个顶点位置:`);
                                    for (let i = 0; i < sampleCount; i++) {
                                        const x = positions.getX(i);
                                        const y = positions.getY(i);
                                        const z = positions.getZ(i);
                                        console.log(`  顶点 ${i}: X: ${x.toFixed(2)}, Y: ${y.toFixed(2)}, Z: ${z.toFixed(2)}`);
                                    }
                                }
                            }
                        });
                        
                        // 检查相机设置
                        console.log('相机设置:');
                        console.log('  FOV:', this.camera.fov);
                        console.log('  Aspect:', this.camera.aspect.toFixed(2));
                        console.log('  Near:', this.camera.near);
                        console.log('  Far:', this.camera.far);
                        console.log('  位置:', `X: ${this.camera.position.x.toFixed(2)}, Y: ${this.camera.position.y.toFixed(2)}, Z: ${this.camera.position.z.toFixed(2)}`);
                        
                        // 调整相机位置，确保看到整个模型
                        if (fullMaxDim > 0 && isFinite(fullMaxDim)) {
                            // 计算合适的距离，确保模型完全在视野内
                            // 使用更大的倍数，确保能看到整个模型
                            const distance = Math.max(fullMaxDim * 3.5, 80);
                            this.camera.position.set(fullCenter.x, fullCenter.y, fullCenter.z + distance);
                            this.camera.lookAt(fullCenter);
                            
                            // 确保相机 far 平面足够远
                            if (this.camera.far < distance + fullMaxDim) {
                                this.camera.far = (distance + fullMaxDim) * 2;
                                console.log('相机 far 平面已调整到:', this.camera.far);
                            }
                            
                            this.camera.updateProjectionMatrix();
                            console.log('相机已调整到:');
                            console.log('  位置:', `X: ${this.camera.position.x.toFixed(2)}, Y: ${this.camera.position.y.toFixed(2)}, Z: ${this.camera.position.z.toFixed(2)}`);
                            console.log('  看向:', `X: ${fullCenter.x.toFixed(2)}, Y: ${fullCenter.y.toFixed(2)}, Z: ${fullCenter.z.toFixed(2)}`);
                            console.log('  距离:', distance.toFixed(2));
                            
                            // 计算视野范围
                            const fovRad = (this.camera.fov * Math.PI) / 180;
                            const viewHeight = 2 * Math.tan(fovRad / 2) * distance;
                            const viewWidth = viewHeight * this.camera.aspect;
                            console.log('  视野范围:', `宽度: ${viewWidth.toFixed(2)}, 高度: ${viewHeight.toFixed(2)}`);
                            console.log('  模型尺寸:', `宽度: ${fullSize.x.toFixed(2)}, 高度: ${fullSize.y.toFixed(2)}, 深度: ${fullSize.z.toFixed(2)}`);
                        }
                        
                        // 检查是否有材质使用了透明度，可能导致部分不可见
                        let transparentCount = 0;
                        this.currentModel.traverse((child) => {
                            if (child.isMesh && child.material) {
                                const materials = Array.isArray(child.material) ? child.material : [child.material];
                                materials.forEach((mat) => {
                                    if (mat && mat.transparent) {
                                        transparentCount++;
                                        console.log('发现透明材质:', mat.type, '透明度:', mat.opacity);
                                    }
                                });
                            }
                        });
                        if (transparentCount > 0) {
                            console.log(`警告：发现 ${transparentCount} 个透明材质，可能影响显示`);
                        }
                        
                        // 再次渲染，确保材质正确显示
                        this.renderer.render(this.scene, this.camera);
                        console.log('=== 模型结构检查完成 ===');
                    } catch (error) {
                        console.error('调整相机位置时出错:', error);
                        // 使用默认设置
                        this.camera.position.set(0, 0, 50);
                        this.camera.lookAt(0, 0, 0);
                        this.renderer.render(this.scene, this.camera);
                    }
                    });
                }
            });
            
            return true;
        } catch (error) {
            console.error('加载 MMD 模型失败:', error);
            throw error;
        }
    }

    // 隐藏 MMD 模型（显示 Live2D）
    hideModel() {
        // 停止口型同步
        this.stopLipSync();
        
        const mmdContainer = document.getElementById('mmd-container');
        const live2dContainer = document.getElementById('live2d-container');
        if (mmdContainer) {
            mmdContainer.style.display = 'none';
        }
        if (live2dContainer) {
            live2dContainer.style.display = '';
        }
    }

    // 清理资源
    dispose() {
        this.stopLipSync();
        
        // 取消动画帧
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        
        // 移除事件监听器
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
            this._resizeHandler = null;
        }
        
        if (this._dragHandlers && this.renderer) {
            this._removeDragHandlers(this.renderer.domElement);
        }
        
        if (this._zoomHandler && this.renderer) {
            this.renderer.domElement.removeEventListener('wheel', this._zoomHandler);
            this._zoomHandler = null;
        }
        
        // 清理模型
        if (this.currentModel) {
            if (this.scene) {
                this.scene.remove(this.currentModel);
            }
            if (this.currentModel.geometry) this.currentModel.geometry.dispose();
            if (this.currentModel.material) {
                if (Array.isArray(this.currentModel.material)) {
                    this.currentModel.material.forEach(mat => mat.dispose());
                } else {
                    this.currentModel.material.dispose();
                }
            }
            this.currentModel = null;
        }

        // 清理渲染器
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
        }

        this.scene = null;
        this.camera = null;
        this.isInitialized = false;
    }
}

// 延迟创建全局实例，确保 THREE 已加载
// 不在文件加载时立即创建，而是在 THREE 加载完成后创建
if (typeof window !== 'undefined') {
    // 等待 THREE 加载完成后再创建实例
    let retryCount = 0;
    const maxRetries = 300; // 最多重试 30 秒（300 * 100ms）
    
    (function checkThreeAndCreate() {
        if (typeof THREE !== 'undefined' && typeof window.THREE !== 'undefined') {
            // 确保使用 window.THREE（可能是 ES 模块导出的）
            window.mmdManager = new MMDManager();
        } else {
            retryCount++;
            if (retryCount >= maxRetries) {
                console.error('等待 THREE 加载超时，MMDManager 无法创建');
                return;
            }
            setTimeout(checkThreeAndCreate, 100);
        }
    })();
}

