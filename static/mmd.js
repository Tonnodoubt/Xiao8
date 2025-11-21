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
        this.cameraLookAtTarget = null; // 相机初始看向的目标点（固定，不跟随模型）
        this.cameraInitialPosition = null; // 相机初始位置（固定，不跟随模型）
        
        // 拖动渲染优化
        this._dragRenderScheduled = false;
        
        // 边界限制
        this.boundaryEnabled = true; // 是否启用边界限制
        
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
        
        // 确保渲染器正确设置 alpha 和事件接收
        if (this.renderer.domElement) {
            this.renderer.domElement.style.width = '100%';
            this.renderer.domElement.style.height = '100%';
            this.renderer.domElement.style.pointerEvents = 'auto';
            this.renderer.domElement.style.touchAction = 'none';
            this.renderer.domElement.style.zIndex = '10001';
            this.renderer.domElement.style.position = 'absolute';
            this.renderer.domElement.style.top = '0';
            this.renderer.domElement.style.left = '0';
            console.log('[MMD] Canvas 样式已设置:', {
                pointerEvents: this.renderer.domElement.style.pointerEvents,
                zIndex: this.renderer.domElement.style.zIndex,
                position: this.renderer.domElement.style.position
            });
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
        
        // 确保渲染（使用 try-catch 捕获材质错误）
        if (this.renderer && this.scene && this.camera) {
            try {
                // 相机位置和朝向在初始化时已设置，不需要每帧重置
                // 这样模型移动时，相机保持固定视角，可以看到模型移动
                
                this.renderer.render(this.scene, this.camera);
            } catch (renderError) {
                // 静默处理渲染错误，避免阻塞动画循环
                // 材质错误通常会在下次渲染时自动修复
                const errorMsg = renderError.message || '';
                // 只在非着色器错误时警告（着色器错误是兼容性问题，不影响功能）
                if (errorMsg && !errorMsg.includes('onBuild') && !errorMsg.includes('morphinstance_vertex') && !errorMsg.includes('#include')) {
                    // 只记录一次，避免刷屏
                    if (!this._renderErrorLogged) {
                        console.warn('[MMD] 渲染时出错（已记录，不再重复）:', errorMsg);
                        this._renderErrorLogged = true;
                    }
                }
            }
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
            // 注意：MMDLoader 使用 resourcePath + filePath 来加载贴图
            // 如果模型文件中贴图路径是 "textures/xxx.png"，而 resourcePath 是 "/static/mmd/"
            // 那么会查找 "/static/mmd/textures/xxx.png"
            // 但实际文件可能在 "/static/mmd/default_model (2)/xxx.png"
            
            // 如果模型文件名是 default_model.pmx，贴图文件在 default_model (2)/ 目录
            // 但模型文件中可能引用的是 "textures/xxx.png"
            // 我们需要将 resourcePath 设置为包含实际贴图文件的目录
            let resourcePathToSet = basePath.endsWith('/') ? basePath : basePath + '/';
            
            // 对于 default_model.pmx，贴图文件在 default_model (2)/ 目录
            // 如果模型文件中贴图路径是相对路径（如 "textures/xxx.png"），
            // 我们需要确保 resourcePath 指向正确的目录
            // 由于模型文件可能引用 "textures/" 子目录，我们需要创建一个符号链接
            // 或者将 resourcePath 设置为包含实际文件的目录
            
            // 尝试：如果模型文件引用 "textures/xxx.png"，但实际文件在 "default_model (2)/xxx.png"
            // 我们可以将 resourcePath 设置为 "default_model (2)/"，这样 "textures/xxx.png" 会变成
            // "default_model (2)/textures/xxx.png"，这仍然不对
            
            // 更好的方法：检查模型文件中的贴图路径格式
            // 如果路径是 "textures/xxx.png"，我们需要确保 resourcePath + "textures/" 指向正确位置
            // 或者创建一个 textures 目录的符号链接
            
            // 暂时先使用 basePath，让 MMDLoader 使用默认的路径解析
            // 如果贴图加载失败，可能需要手动创建 textures 目录或符号链接
            resourcePathToSet = basePath.endsWith('/') ? basePath : basePath + '/';
            
            if (typeof loader.setResourcePath === 'function') {
                loader.setResourcePath(resourcePathToSet);
                console.log('[MMD] 设置纹理资源路径:', resourcePathToSet);
                console.log('[MMD] 可能的纹理目录:', possibleTextureDirs);
                console.log('[MMD] 注意：如果贴图路径是 textures/xxx.png，实际文件需要在 resourcePath/textures/ 目录下');
            } else if (basePath && basePath !== '/') {
                loader.resourcePath = resourcePathToSet;
                console.log('[MMD] 设置纹理资源路径（直接属性）:', loader.resourcePath);
            }
            
            resourcePath = resourcePathToSet;
            
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
            
            // 修复 Three.js 0.160.0 兼容性问题：为 MMDToonMaterial 添加 onBuild 方法
            mesh.traverse((child) => {
                if (child.isMesh && child.material) {
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    materials.forEach((mat) => {
                        if (mat && mat.isMMDToonMaterial) {
                            // Three.js 0.160.0 期望材质有 onBuild 方法
                            if (typeof mat.onBuild !== 'function') {
                                mat.onBuild = function() {
                                    // 空函数，满足 Three.js 的要求
                                };
                                console.log('[MMD] 为 MMDToonMaterial 添加 onBuild 方法（兼容性修复）');
                            }
                        }
                    });
                }
            });

            // 设置拖动和缩放
            if (options.dragEnabled !== false) {
                this.setupDragAndDrop();
                this.setupZoom(); // 添加缩放功能
            }

            // 解锁模型（允许拖拽和交互）
            this.setLocked(false);

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
        // 首先检查根对象
        let morphDict = mesh.morphTargetDictionary;
        let foundIndex = -1;
        
        // 如果根对象没有morph，检查子对象
        if (!morphDict) {
            mesh.traverse((child) => {
                if (child.isSkinnedMesh && child.morphTargetDictionary && foundIndex === -1) {
                    morphDict = child.morphTargetDictionary;
                }
            });
        }
        
        if (!morphDict) {
            console.warn('[MMD] 模型没有 morph targets，无法进行口型同步');
            this.mouthMorphIndex = -1;
            return;
        }

        // 常见的嘴巴 morph 名称（MMD 模型常用，按优先级排序）
        const mouthNames = [
            'あ', 'い', 'う', 'え', 'お', // 日语元音（最常用）
            'A', 'I', 'U', 'E', 'O', // 英语元音
            'MouthA', 'MouthI', 'MouthU', 'MouthE', 'MouthO',
            '口あ', '口い', '口う', '口え', '口お',
            '口開', '口閉', '口開け', '口閉じ',
            'ま', 'み', 'む', 'め', 'も', // 日语辅音+元音
            'MouthOpen', 'MouthClose', 'MouthSmile', 'MouthSad'
        ];

        for (const name of mouthNames) {
            if (morphDict[name] !== undefined) {
                foundIndex = morphDict[name];
                console.log(`[MMD] 找到嘴巴 morph: "${name}", 索引: ${foundIndex}`);
                break;
            }
        }

        // 如果没找到，尝试查找包含"mouth"或"口"的morph
        if (foundIndex === -1) {
            const morphNames = Object.keys(morphDict);
            for (const name of morphNames) {
                const lowerName = name.toLowerCase();
                if (lowerName.includes('mouth') || lowerName.includes('口') || 
                    lowerName.includes('あ') || lowerName.includes('a')) {
                    foundIndex = morphDict[name];
                    console.log(`[MMD] 找到可能的嘴巴 morph: "${name}", 索引: ${foundIndex}`);
                    break;
                }
            }
        }

        // 如果还是没找到，使用第一个 morph（作为备选）
        if (foundIndex === -1) {
            const morphNames = Object.keys(morphDict);
            if (morphNames.length > 0) {
                foundIndex = morphDict[morphNames[0]];
                console.log(`[MMD] 使用第一个 morph 作为备选: "${morphNames[0]}", 索引: ${foundIndex}`);
            }
        }

        this.mouthMorphIndex = foundIndex;
        
        if (foundIndex === -1) {
            console.warn('[MMD] 无法找到嘴巴 morph，口型同步可能无法工作');
        }
    }

    // 设置嘴巴开合度（用于口型同步）
    setMouth(value) {
        this.mouthValue = Math.max(0, Math.min(1, value));
        
        if (this.currentModel) {
            // 如果模型有morphTargetInfluences，直接设置
            if (this.mouthMorphIndex >= 0 && this.currentModel.morphTargetInfluences) {
                this.currentModel.morphTargetInfluences[this.mouthMorphIndex] = this.mouthValue;
            }
            
            // 如果模型有子对象（如SkinnedMesh），也需要更新子对象的morph
            this.currentModel.traverse((child) => {
                if (child.isSkinnedMesh && child.morphTargetInfluences && this.mouthMorphIndex >= 0) {
                    if (child.morphTargetInfluences[this.mouthMorphIndex] !== undefined) {
                        child.morphTargetInfluences[this.mouthMorphIndex] = this.mouthValue;
                    }
                }
            });
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
                
                // 改进的口型同步算法
                // 使用更平滑的映射，并添加最小阈值避免微小噪音
                const threshold = 0.02; // 最小音量阈值
                const sensitivity = 10; // 灵敏度系数
                
                let mouthOpen = 0;
                if (rms > threshold) {
                    // 映射到嘴巴开合度 0~1，使用平滑曲线
                    mouthOpen = Math.min(1, (rms - threshold) * sensitivity);
                    // 添加平滑处理，避免口型变化过于剧烈
                    mouthOpen = Math.pow(mouthOpen, 0.7); // 使用幂函数平滑
                }
                
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
                const target = event.target;
                const canvas = this.renderer.domElement;
                
                // 首先检查点击位置是否在对话框区域内（即使MMD容器在上面）
                const chatContainer = document.getElementById('chat-container');
                if (chatContainer) {
                    const chatRect = chatContainer.getBoundingClientRect();
                    if (event.clientX >= chatRect.left && 
                        event.clientX <= chatRect.right &&
                        event.clientY >= chatRect.top && 
                        event.clientY <= chatRect.bottom) {
                        // 点击位置在对话框区域内，不处理拖动
                        // 手动触发对话框的点击事件，确保对话框可以响应
                        const elementBelow = document.elementFromPoint(event.clientX, event.clientY);
                        if (elementBelow && elementBelow !== target) {
                            // 如果下面有对话框元素，触发它的点击事件
                            const clickEvent = new MouseEvent('click', {
                                bubbles: true,
                                cancelable: true,
                                clientX: event.clientX,
                                clientY: event.clientY,
                                button: event.button
                            });
                            elementBelow.dispatchEvent(clickEvent);
                        }
                        // 不阻止事件，让对话框正常处理
                        return;
                    }
                }
                
                // 检查点击目标，如果是对话框或其他UI元素，不处理拖动
                // 包括缩小后的对话框（minimized状态）
                if (target && (
                    target.closest('#chat-container') ||
                    target.closest('#text-input-area') ||
                    target.closest('#textInputBox') ||
                    target.closest('#chat-content-wrapper') ||
                    target.closest('#button-group') ||
                    target.closest('#textSendButton') ||
                    target.closest('#screenshotButton') ||
                    target.closest('#toggle-chat-btn') ||
                    target.closest('#status-toast') ||
                    target.closest('#chat-header') ||
                    target.closest('#chat-tooltip') ||
                    target.tagName === 'INPUT' ||
                    target.tagName === 'TEXTAREA' ||
                    target.tagName === 'BUTTON' ||
                    target.tagName === 'IMG' // 按钮中的图标
                )) {
                    // 点击的是对话框或其他UI元素，不处理拖动
                    // 不阻止事件，让对话框正常处理点击
                    return;
                }
                
                // 确保点击的是 canvas 本身或其父容器（mmd-container）
                // 如果点击的不是canvas或其父容器，也不处理拖动
                const mmdContainer = document.getElementById('mmd-container');
                if (target !== canvas && 
                    !canvas.contains(target) && 
                    (!mmdContainer || !mmdContainer.contains(target))) {
                    return;
                }
                
                // 检查条件
                if (this.isLocked) {
                    console.warn('[MMD] 拖动被阻止: 模型已锁定');
                    return;
                }
                if (!this.currentModel) {
                    console.warn('[MMD] 拖动被阻止: 没有模型');
                    return;
                }
                if (event.button !== 0) {
                    return;
                }
                
                // 确保 dragStartPos 已初始化
                if (!this.dragStartPos) {
                    this.dragStartPos = new THREE.Vector2();
                }
                
                // 确保 modelPosition 已初始化
                if (!this.modelPosition) {
                    this.modelPosition = new THREE.Vector3();
                    this.currentModel.getWorldPosition(this.modelPosition);
                }
                
                // 立即设置拖动状态，防止悬停检测干扰
                this.isDragging = true;
                this.dragStartPos.set(event.clientX, event.clientY);
                this._dragLogCount = 0; // 重置日志计数器
                canvas.style.cursor = 'grabbing';
                
                console.log('[MMD] 开始拖动, isDragging:', this.isDragging, '位置:', event.clientX, event.clientY);
                console.log('[MMD] 当前模型位置:', this.currentModel.position.x.toFixed(2), this.currentModel.position.y.toFixed(2), this.currentModel.position.z.toFixed(2));
                
                // 绑定到 document，确保即使鼠标移出 canvas 也能继续拖动
                document.addEventListener('mousemove', this._dragHandlers.mousemove, { passive: false });
                document.addEventListener('mouseup', this._dragHandlers.mouseup, { passive: false });
                
                event.preventDefault();
                event.stopPropagation();
            },
            mousemove: (event) => {
                if (!this.isDragging) {
                    return;
                }
                
                if (this.isLocked || !this.currentModel || !this.dragStartPos) {
                    console.warn('[MMD] mousemove 被阻止:', {
                        isDragging: this.isDragging,
                        isLocked: this.isLocked,
                        hasModel: !!this.currentModel,
                        hasDragStartPos: !!this.dragStartPos
                    });
                    return;
                }
                
                // 计算移动距离
                const deltaX = event.clientX - this.dragStartPos.x;
                const deltaY = event.clientY - this.dragStartPos.y;
                
                // 如果移动距离太小，不处理（避免微小抖动）
                if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
                    return;
                }
                
                // 获取相机的右向量和上向量（用于将屏幕移动转换为3D空间移动）
                const right = new THREE.Vector3();
                const up = new THREE.Vector3();
                right.setFromMatrixColumn(this.camera.matrixWorld, 0);
                up.setFromMatrixColumn(this.camera.matrixWorld, 1);
                
                // 计算模型的世界位置和相机距离
                const modelWorldPos = new THREE.Vector3();
                this.currentModel.getWorldPosition(modelWorldPos);
                const distance = this.camera.position.distanceTo(modelWorldPos);
                
                // 计算移动速度（基于相机距离和模型缩放，使拖动更平滑）
                // 缩放越大，移动速度应该越快（因为模型变大了）
                const scaleFactor = this.modelScale || 1.0;
                const baseMoveSpeed = Math.max(0.003, Math.min(0.015, distance * 0.003));
                const moveSpeed = baseMoveSpeed * scaleFactor;
                
                // 将屏幕移动转换为3D空间移动
                const moveX = right.clone().multiplyScalar(deltaX * moveSpeed);
                const moveY = up.clone().multiplyScalar(-deltaY * moveSpeed);
                
                // 确保 modelPosition 已初始化
                if (!this.modelPosition) {
                    this.modelPosition = new THREE.Vector3();
                    this.currentModel.getWorldPosition(this.modelPosition);
                }
                
                // 更新模型位置
                this.modelPosition.add(moveX);
                this.modelPosition.add(moveY);
                
                // 应用边界限制
                if (this.boundaryEnabled && this.cameraLookAtTarget) {
                    // 计算模型的边界框（考虑缩放）
                    const box = new THREE.Box3().setFromObject(this.currentModel);
                    const size = box.getSize(new THREE.Vector3());
                    
                    // 计算屏幕可见范围（基于相机视野和距离）
                    const canvas = this.renderer.domElement;
                    const aspect = canvas.width / canvas.height;
                    const fov = this.camera.fov * (Math.PI / 180);
                    const visibleHeight = 2 * Math.tan(fov / 2) * distance;
                    const visibleWidth = visibleHeight * aspect;
                    
                    // 限制模型在可见范围内（以相机看向的点为中心）
                    // 使用更大的边距（0.45），给缩放后的模型更多空间
                    const halfVisibleWidth = visibleWidth * 0.45;
                    const halfVisibleHeight = visibleHeight * 0.45;
                    
                    const maxX = this.cameraLookAtTarget.x + halfVisibleWidth;
                    const minX = this.cameraLookAtTarget.x - halfVisibleWidth;
                    const maxY = this.cameraLookAtTarget.y + halfVisibleHeight;
                    const minY = this.cameraLookAtTarget.y - halfVisibleHeight;
                    
                    // 考虑模型大小（已包含缩放），确保整个模型都在边界内
                    const halfSizeX = size.x / 2;
                    const halfSizeY = size.y / 2;
                    
                    this.modelPosition.x = Math.max(minX + halfSizeX, Math.min(maxX - halfSizeX, this.modelPosition.x));
                    this.modelPosition.y = Math.max(minY + halfSizeY, Math.min(maxY - halfSizeY, this.modelPosition.y));
                }
                
                // 更新拖动起始位置
                this.dragStartPos.set(event.clientX, event.clientY);
                
                // 直接更新模型位置
                this.currentModel.position.copy(this.modelPosition);
                
                // 更新模型的世界矩阵
                this.currentModel.updateMatrixWorld(true);
                
                // 强制立即渲染一帧，确保看到移动效果
                // 使用节流避免过度渲染
                if (!this._dragRenderScheduled) {
                    this._dragRenderScheduled = true;
                    requestAnimationFrame(() => {
                        if (this.renderer && this.scene && this.camera) {
                            try {
                                this.renderer.render(this.scene, this.camera);
                            } catch (e) {
                                // 忽略渲染错误
                            }
                        }
                        this._dragRenderScheduled = false;
                    });
                }
                
                event.preventDefault();
                event.stopPropagation();
            },
            mouseup: (event) => {
                if (this.isDragging) {
                    this.isDragging = false;
                    canvas.style.cursor = 'grab';
                    document.removeEventListener('mousemove', this._dragHandlers.mousemove);
                    document.removeEventListener('mouseup', this._dragHandlers.mouseup);
                }
                if (event) {
                    event.preventDefault();
                    event.stopPropagation();
                }
            },
            mouseleave: () => {
                if (this.isDragging) {
                    this.isDragging = false;
                    canvas.style.cursor = 'default';
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
                    this.currentModel.position.z = this.modelPosition.z; // 确保 Z 轴也更新
                    
                    // 不需要手动渲染，动画循环会自动渲染
                    // 移除手动渲染调用，避免触发着色器错误
                    
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
        // 注意：mousemove 和 mouseup 会在 mousedown 时添加到 document，这里不需要添加到 canvas
        canvas.addEventListener('mousedown', this._dragHandlers.mousedown, { passive: false });
        canvas.addEventListener('mouseleave', this._dragHandlers.mouseleave, { passive: false });
        canvas.addEventListener('contextmenu', this._dragHandlers.contextmenu, { passive: false });
        canvas.addEventListener('touchstart', this._dragHandlers.touchstart, { passive: false });
        canvas.addEventListener('touchmove', this._dragHandlers.touchmove, { passive: false });
        canvas.addEventListener('touchend', this._dragHandlers.touchend, { passive: false });
        
        console.log('[MMD] 拖动事件监听器已绑定到 canvas');
        
        // 添加鼠标移动检测，只在模型上显示 grab 光标
        // 注意：悬停检测使用独立的 mousemove 事件，不会干扰拖动
        this._hoverHandler = (event) => {
            // 如果正在拖动，不处理悬停检测
            if (this.isDragging) {
                return;
            }
            
            if (!this.currentModel || this.isLocked) {
                canvas.style.cursor = 'default';
                return;
            }
            
            // 延迟检测，避免阻塞拖动事件
            const handler = () => {
                if (this.isDragging) {
                    return;
                }
                
                const rect = canvas.getBoundingClientRect();
                const mouse = new THREE.Vector2();
                mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
                mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
                
                const raycaster = new THREE.Raycaster();
                raycaster.setFromCamera(mouse, this.camera);
                
                const intersects = raycaster.intersectObject(this.currentModel, true);
                
                if (intersects.length > 0) {
                    canvas.style.cursor = 'grab';
                } else {
                    canvas.style.cursor = 'default';
                }
            };
            
            requestAnimationFrame(handler);
        };
        
        // 悬停检测绑定到 canvas，拖动事件绑定到 document，不会冲突
        canvas.addEventListener('mousemove', this._hoverHandler, { passive: true });
        canvas.style.cursor = 'default';
    }
    
    // 移除拖动事件监听器
    _removeDragHandlers(canvas) {
        if (!this._dragHandlers) return;
        canvas.removeEventListener('mousedown', this._dragHandlers.mousedown);
        // mousemove 和 mouseup 可能被添加到 document，需要同时移除
        document.removeEventListener('mousemove', this._dragHandlers.mousemove);
        document.removeEventListener('mouseup', this._dragHandlers.mouseup);
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
            if (this.isLocked || !this.currentModel) {
                return;
            }
            
            event.preventDefault();
            event.stopPropagation();
            
            // 使用更平滑的缩放速度
            const baseZoomSpeed = 0.02; // 减小基础速度，使缩放更平滑
            const zoomSpeed = (event.ctrlKey || event.metaKey) ? baseZoomSpeed * 1.5 : baseZoomSpeed;
            
            // 使用指数缩放，使缩放更平滑自然
            const zoomFactor = 1 + (event.deltaY > 0 ? -zoomSpeed : zoomSpeed);
            const newScale = this.modelScale * zoomFactor;
            this.modelScale = Math.max(0.1, Math.min(5.0, newScale));
            
            this.currentModel.scale.set(this.modelScale, this.modelScale, this.modelScale);
            this.currentModel.updateMatrixWorld(true);
            
            // 强制立即渲染一帧，确保看到缩放效果
            if (this.renderer && this.scene && this.camera) {
                try {
                    this.renderer.render(this.scene, this.camera);
                } catch (e) {
                    // 忽略渲染错误
                }
            }
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
                
                // 确保事件监听器已正确设置（容器显示后重新设置）
                if (options.dragEnabled !== false && this.currentModel && this.renderer) {
                    const canvas = this.renderer.domElement;
                    console.log('[MMD] ========== 容器显示后，重新设置拖动和缩放功能 ==========');
                    console.log('[MMD] Canvas 元素:', canvas);
                    console.log('[MMD] Canvas ID:', canvas.id);
                    console.log('[MMD] Canvas pointer-events:', window.getComputedStyle(canvas).pointerEvents);
                    console.log('[MMD] Canvas z-index:', window.getComputedStyle(canvas).zIndex);
                    console.log('[MMD] Container pointer-events:', mmdContainer ? window.getComputedStyle(mmdContainer).pointerEvents : 'N/A');
                    console.log('[MMD] Container z-index:', mmdContainer ? window.getComputedStyle(mmdContainer).zIndex : 'N/A');
                    console.log('[MMD] isLocked:', this.isLocked);
                    console.log('[MMD] currentModel:', !!this.currentModel);
                    
                    // 确保 canvas 和容器都可以接收事件
                    if (canvas) {
                        canvas.style.pointerEvents = 'auto';
                        canvas.style.touchAction = 'none';
                        canvas.style.zIndex = '10001';
                        console.log('[MMD] Canvas 样式已设置: pointer-events=auto, z-index=10001');
                    }
                    if (mmdContainer) {
                        mmdContainer.style.pointerEvents = 'auto';
                        mmdContainer.style.zIndex = '10000';
                        console.log('[MMD] Container 样式已设置: pointer-events=auto, z-index=10000');
                    }
                    
                    // 重新设置事件监听器
                    this.setupDragAndDrop();
                    this.setupZoom();
                    
                    // 确保模型已解锁
                    this.setLocked(false);
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
                            
                            // 保存相机初始位置和目标点（固定，不跟随模型移动）
                            this.cameraInitialPosition = new THREE.Vector3(center.x, center.y, center.z + distance);
                            this.cameraLookAtTarget = center.clone();
                            
                            // 只在首次加载时设置相机位置，之后保持固定
                            if (!this.cameraInitialPosition || !this.cameraLookAtTarget) {
                                this.cameraInitialPosition = new THREE.Vector3(center.x, center.y, center.z + distance);
                                this.cameraLookAtTarget = center.clone();
                                this.camera.position.copy(this.cameraInitialPosition);
                                this.camera.lookAt(this.cameraLookAtTarget);
                            }
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
                        
                        // 强制清除并渲染（使用 try-catch 捕获材质错误）
                        try {
                            this.renderer.clear();
                            this.renderer.render(this.scene, this.camera);
                            console.log('[MMD] 模型加载后首次渲染成功');
                        } catch (renderError) {
                            // 记录错误但不阻止后续渲染
                            const errorMsg = renderError.message || '';
                            console.warn('[MMD] 首次渲染时出错（动画循环会继续渲染）:', errorMsg);
                            // 即使出错，动画循环也会继续尝试渲染
                        }
                        console.log('MMD 模型已显示，场景对象数量:', this.scene.children.length);
                        console.log('MMD 模型位置:', this.currentModel.position.x, this.currentModel.position.y, this.currentModel.position.z);
                        console.log('MMD 模型缩放:', this.currentModel.scale.x, this.currentModel.scale.y, this.currentModel.scale.z);
                        console.log('相机位置:', this.camera.position.x, this.camera.position.y, this.camera.position.z);
                        console.log('相机看向:', center.x, center.y, center.z);
                        
                        // 检查模型是否在场景中
                        const modelInScene = this.scene.children.includes(this.currentModel);
                        console.log('模型是否在场景中:', modelInScene);
                        console.log('MMD 动画循环是否运行:', !!this.animationFrameId);
                        
                        // 检查模型是否可见
                        console.log('模型 visible:', this.currentModel.visible);
                        
                        // 确保动画循环在运行（如果因为错误停止，重新启动）
                        if (!this.animationFrameId && this.renderer && this.scene && this.camera) {
                            console.warn('[MMD] 动画循环似乎停止了，重新启动...');
                            this.animate();
                        }
                        
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
                        
                        // 不需要多次渲染，动画循环会自动渲染
                        // 移除多次渲染调用，避免触发着色器错误
                        
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
                                        
                                        // 检查材质是否有贴图（MMD材质可能有多种贴图类型）
                                        const hasMap = mat.map !== null && mat.map !== undefined;
                                        const hasToonTexture = mat.toonTexture !== null && mat.toonTexture !== undefined;
                                        const hasSphereTexture = mat.sphereTexture !== null && mat.sphereTexture !== undefined;
                                        const hasNormalTexture = mat.normalTexture !== null && mat.normalTexture !== undefined;
                                        
                                        if (hasMap || hasToonTexture || hasSphereTexture || hasNormalTexture) {
                                            const textureInfo = [];
                                            if (hasMap) textureInfo.push(`基础贴图: ${mat.map.image?.src || '已加载'}`);
                                            if (hasToonTexture) textureInfo.push(`Toon贴图: ${mat.toonTexture.image?.src || '已加载'}`);
                                            if (hasSphereTexture) textureInfo.push(`球面贴图: ${mat.sphereTexture.image?.src || '已加载'}`);
                                            if (hasNormalTexture) textureInfo.push(`法线贴图: ${mat.normalTexture.image?.src || '已加载'}`);
                                            console.log(`    贴图:`, textureInfo.join(', ') || '已加载');
                                        } else {
                                            // 没有贴图可能是正常的（纯色材质）
                                            console.log(`    贴图: 无（可能是纯色材质）`);
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
                                    
                                    // 检查材质是否有贴图（MMD材质可能有多种贴图类型）
                                    const hasMap = mat.map !== null && mat.map !== undefined;
                                    const hasToonTexture = mat.toonTexture !== null && mat.toonTexture !== undefined;
                                    const hasSphereTexture = mat.sphereTexture !== null && mat.sphereTexture !== undefined;
                                    const hasNormalTexture = mat.normalTexture !== null && mat.normalTexture !== undefined;
                                    
                                    if (hasMap || hasToonTexture || hasSphereTexture || hasNormalTexture) {
                                        const textureInfo = [];
                                        if (hasMap) textureInfo.push(`基础贴图: ${mat.map.image?.src || '已加载'}`);
                                        if (hasToonTexture) textureInfo.push(`Toon贴图: ${mat.toonTexture.image?.src || '已加载'}`);
                                        if (hasSphereTexture) textureInfo.push(`球面贴图: ${mat.sphereTexture.image?.src || '已加载'}`);
                                        if (hasNormalTexture) textureInfo.push(`法线贴图: ${mat.normalTexture.image?.src || '已加载'}`);
                                        console.log(`  贴图:`, textureInfo.join(', ') || '已加载');
                                    } else {
                                        // 没有贴图可能是正常的（纯色材质）
                                        console.log(`  贴图: 无（可能是纯色材质）`);
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
                        
                        // 再次渲染，确保材质正确显示（使用 try-catch 捕获材质错误）
                        try {
                            // 确保所有材质都已正确初始化
                            if (this.currentModel) {
                                this.currentModel.traverse((child) => {
                                    if (child.isMesh && child.material) {
                                        const materials = Array.isArray(child.material) ? child.material : [child.material];
                                        materials.forEach((mat) => {
                                            if (mat) {
                                                // 确保材质属性正确设置
                                                if (mat.needsUpdate !== undefined) {
                                                    mat.needsUpdate = true;
                                                }
                                                // 确保 uniform 已初始化
                                                if (mat.uniforms && typeof mat.uniforms === 'object') {
                                                    // uniform 已存在，材质应该正常
                                                }
                                            }
                                        });
                                    }
                                });
                            }
                            
                            // 在渲染前再次确保所有材质都有 onBuild 方法
                            if (this.currentModel) {
                                this.currentModel.traverse((child) => {
                                    if (child.isMesh && child.material) {
                                        const materials = Array.isArray(child.material) ? child.material : [child.material];
                                        materials.forEach((mat) => {
                                            if (mat && mat.isMMDToonMaterial && typeof mat.onBuild !== 'function') {
                                                mat.onBuild = function() {};
                                                mat.needsUpdate = true;
                                            }
                                        });
                                    }
                                });
                            }
                            
                            this.renderer.render(this.scene, this.camera);
                            console.log('=== 模型结构检查完成 ===');
                        } catch (renderError) {
                            // 忽略着色器兼容性错误（Three.js 版本兼容性问题，不影响功能）
                            const errorMsg = renderError.message || '';
                            if (errorMsg.includes('onBuild') || errorMsg.includes('morphinstance_vertex') || errorMsg.includes('#include')) {
                                // 这些是 Three.js 版本兼容性问题，不影响实际渲染
                                // 动画循环会继续工作
                            } else {
                                console.error('[MMD] 渲染时出错:', renderError);
                                console.error('[MMD] 错误详情:', errorMsg);
                            }
                        }
                    } catch (error) {
                        console.error('调整相机位置时出错:', error);
                        // 使用默认设置
                        this.camera.position.set(0, 0, 50);
                        this.camera.lookAt(0, 0, 0);
                        try {
                            this.renderer.render(this.scene, this.camera);
                        } catch (renderError) {
                            console.error('[MMD] 默认渲染也失败:', renderError);
                        }
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

