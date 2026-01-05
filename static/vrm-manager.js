/**
 * VRM Manager - 物理控制版 (修复更新顺序)
 */
class VRMManager {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.currentModel = null;
        this.animationMixer = null;
        
        this.clock = (typeof window.THREE !== 'undefined') ? new window.THREE.Clock() : null;
        this.container = null;
        this._animationFrameId = null;
        this.enablePhysics = true; 
        
        this._initModules();
    }

    _initModules() {
        if (!this.core && typeof window.VRMCore !== 'undefined') this.core = new window.VRMCore(this);
        if (!this.expression && typeof window.VRMExpression !== 'undefined') this.expression = new window.VRMExpression(this);
        if (!this.animation && typeof window.VRMAnimation !== 'undefined') {
            this.animation = new window.VRMAnimation(this);
        }
        if (!this.interaction && typeof window.VRMInteraction !== 'undefined') this.interaction = new window.VRMInteraction(this);
    }
    /**
     * 创建一个圆形渐变纹理 (Blob Shadow)
     */
    _createBlobShadowTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        
        // 创建径向渐变 (从中心向外)
        const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        gradient.addColorStop(0, 'rgba(0, 0, 0, 0.6)'); // 中心：黑色，60%透明度
        gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.3)'); // 中间：过渡
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');   // 边缘：完全透明
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 64, 64);
        
        const texture = new window.THREE.CanvasTexture(canvas);
        return texture;
    }
    async initThreeJS(canvasId, containerId) {
        if (this.scene) return true;
        if (!this.clock && window.THREE) this.clock = new window.THREE.Clock();
        this._initModules();
        if (!this.core) throw new Error("VRMCore 尚未加载");
        await this.core.init(canvasId, containerId);
        if (this.interaction) this.interaction.initDragAndZoom();
        this.startAnimateLoop();
        return true;
    }
    
    // ... 在 VRMManager 类中 ...

    startAnimateLoop() {
        if (this._animationFrameId) cancelAnimationFrame(this._animationFrameId);

        const animateLoop = () => {
            if (!this.renderer) return;

            this._animationFrameId = requestAnimationFrame(animateLoop);
            const delta = this.clock ? this.clock.getDelta() : 0.016;

            if (!this.animation && typeof window.VRMAnimation !== 'undefined') this._initModules();

            if (this.currentModel && this.currentModel.vrm) {
                // 1. 表情更新
                if (this.expression) {
                    this.expression.update(delta);
                }

                // 2. 视线更新
                if (this.currentModel.vrm.lookAt) {
                    this.currentModel.vrm.lookAt.target = this.camera;
                }
                
                // 3. 物理更新
                if (this.enablePhysics) {
                    this.currentModel.vrm.update(delta);
                } else {
                    if (this.currentModel.vrm.lookAt) this.currentModel.vrm.lookAt.update(delta);
                    if (this.currentModel.vrm.expressionManager) this.currentModel.vrm.expressionManager.update(delta);
                }

                
                
            }

            // 4. 交互系统更新（浮动按钮跟随等）
            if (this.interaction) {
                this.interaction.update(delta);
            }

            // 5. 动画更新
            if (this.animation) {
                this.animation.update(delta);
            }

            // 6. 更新控制器
            if (this.controls) {
                this.controls.update();
            }

            // 7. 渲染场景
            this.renderer.render(this.scene, this.camera);
        };

        this._animationFrameId = requestAnimationFrame(animateLoop);
    }

    toggleSpringBone(enable) {
        this.enablePhysics = enable;
    }

    async loadModel(modelUrl, options = {}) {
        this._initModules();
        if (!this.core) this.core = new window.VRMCore(this);
        
        // 确保场景已初始化
        if (!this.scene || !this.camera || !this.renderer) {
            const canvasId = options.canvasId || 'vrm-canvas';
            const containerId = options.containerId || 'vrm-container';
            
            const canvas = document.getElementById(canvasId);
            const container = document.getElementById(containerId);
            
            if (canvas && container) {
                console.log(`[VRM Manager] 自动初始化场景`);
                await this.initThreeJS(canvasId, containerId);
            } else {
                throw new Error(`无法加载模型：场景未初始化。`);
            }
        }

        
        // 设置画布初始状态为透明，并添加 CSS 过渡效果
        if (this.renderer && this.renderer.domElement) {
            this.renderer.domElement.style.opacity = '0';
            // 这里的 1.0s 是淡入时间，你可以改成 0.5s 或 2.0s
            this.renderer.domElement.style.transition = 'opacity 1.0s ease-in-out';
        }

        // 加载模型
        const result = await this.core.loadModel(modelUrl, options);

        // 动态计算阴影位置和大小
        if (options.addShadow !== false && result && result.vrm && result.vrm.scene) {
            // 1. 可调节参数 (在这里微调)
            const SHADOW_OPACITY_CENTER = 0.6; // 阴影中心黑度 (0~1)
            const SHADOW_SCALE_MULT = 0.5;     // 大小倍率：数字越大阴影越大 (建议 1.2 ~ 1.8)
            const SHADOW_Y_OFFSET = 0.85;      // 高度偏移：防止阴影和地面重叠闪烁 (Z-fighting)
            const FIX_CENTER_XZ = true;        // true: 强制阴影在两脚中间(0,0); false: 跟随模型几何中心
            

            // 2. 计算模型的包围盒
            // 这能拿到模型在空间中的实际边界：{min: {x,y,z}, max: {x,y,z}}
            const box = new window.THREE.Box3().setFromObject(result.vrm.scene);
            
            // 获取尺寸
            const size = new window.THREE.Vector3();
            box.getSize(size); // 自动计算出长宽高: size.x, size.y, size.z
            
            // 获取中心点
            const center = new window.THREE.Vector3();
            box.getCenter(center);

            // 3. 动态计算阴影直径
            // 逻辑：取模型的“宽度”和“深度”中较大的一个，作为基准，然后乘以倍率
            // Math.max(0.3, ...) 是保底机制，防止太小的模型阴影消失
            let shadowDiameter = Math.max(size.x, size.z) * SHADOW_SCALE_MULT;
            shadowDiameter = Math.max(0.3, shadowDiameter); 

            // 4. 创建纹理和材质
            const shadowTexture = this._createBlobShadowTexture(); 
            const shadowMaterial = new window.THREE.MeshBasicMaterial({
                map: shadowTexture,
                transparent: true,
                opacity: 1.0, // 纹理本身带透明度，这里设1即可
                depthWrite: false, // 关键：不遮挡模型
                side: window.THREE.DoubleSide
            });
            
            // 5. 创建网格 (使用 PlaneGeometry，默认宽高为 1x1，后面通过 scale 缩放)
            const shadowGeo = new window.THREE.PlaneGeometry(1, 1);
            const shadowMesh = new window.THREE.Mesh(shadowGeo, shadowMaterial);
            
            // 6. 姿态与缩放应用
            shadowMesh.rotation.x = -Math.PI / 2; // 躺平
            shadowMesh.scale.set(shadowDiameter, shadowDiameter, 1); // 应用计算出的大小
            
            // 7. 位置计算 (关键)
            // Y轴：取包围盒的最低点 (min.y) + 微小偏移量
            const targetY = box.min.y + SHADOW_Y_OFFSET;

            // X/Z轴：
            // 如果模型制作规范，(0,0)通常是两脚之间。
            // 如果模型有长头发或拿着武器，几何中心(center)可能会偏。
            // 推荐：X/Z 保持在 0 (局部坐标)，只改 Y。这样阴影永远跟随着“角色中心”。
            if (FIX_CENTER_XZ) {
                // 相对于父级(vrm.scene)的 0,0 位置，只调整高度
                shadowMesh.position.set(0, targetY, 0);
            } else {
                // 如果你想让阴影跟随模型的几何中心 (比如模型本身是歪的)
                // 注意：这可能会导致阴影偏向长头发那一侧
                shadowMesh.position.set(center.x, targetY, center.z);
            }

            // 8. 添加到模型场景中
            result.vrm.scene.add(shadowMesh);
            
            // 隐藏模型等待动画就绪
            result.vrm.scene.visible = false; 
        }
        
        // 加载完保持 3D 对象不可见 (防 T-Pose)
        if (result && result.vrm && result.vrm.scene) {
            result.vrm.scene.visible = false; 
        }

        if (!this._animationFrameId) this.startAnimateLoop();

        const DEFAULT_LOOP_ANIMATION = '/static/vrm/animation/wait03.vrma';

        if (!this.animation) {
            this._initModules();
        }

        // 辅助函数：显示模型并淡入画布
        const showAndFadeIn = () => {
            if (this.currentModel?.vrm?.scene) {
                // 强制重置物理骨骼状态
                if (this.currentModel.vrm.springBoneManager) {
                    this.currentModel.vrm.springBoneManager.reset();
                }
                // 先让 3D 物体可见
                this.currentModel.vrm.scene.visible = true;
                console.log('[VRM Manager] 模型姿势已就绪，开始淡入显示...');
                // 下一帧将画布透明度设为 1，触发 CSS 淡入动画
                requestAnimationFrame(() => {
                    if (this.renderer && this.renderer.domElement) {
                        this.renderer.domElement.style.opacity = '1';
                    }
                });
            }
        };

        if (options.autoPlay !== false && this.animation) {
            setTimeout(() => {
                this.playVRMAAnimation(DEFAULT_LOOP_ANIMATION, { 
                    loop: true,
                    immediate: true 
                }).then(() => {
                    // 动画应用成功，执行淡入
                    showAndFadeIn();
                }).catch(err => {
                    console.warn('[VRM Manager] 自动播放失败，强制显示:', err);
                    showAndFadeIn();
                });
            }, 100);
        } else {
            // 不自动播放，直接淡入
            showAndFadeIn();
        }
        
        // 设置初始表情
        if (this.expression) {
            this.expression.setMood('neutral'); 
        }
        if (this.setupFloatingButtons) {
            this.setupFloatingButtons();
        }
        return result;
    }

    async playVRMAAnimation(url, opts) {
        if (!this.animation) this._initModules();
        if (this.animation) return this.animation.playVRMAAnimation(url, opts);
    }
    
    
    stopVRMAAnimation() {
        if (this.animation) this.animation.stopVRMAAnimation();
    }
    onWindowResize() { 
        if (this.camera && this.renderer) {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        }
    }
    getCurrentModel() { 
        return this.currentModel; 
    }
    setModelPosition(x,y,z) { 
        if(this.currentModel?.scene) this.currentModel.scene.position.set(x,y,z); 
    }
    setModelScale(x,y,z) { 
        if(this.currentModel?.scene) this.currentModel.scene.scale.set(x,y,z); 
    }
}

window.VRMManager = VRMManager;