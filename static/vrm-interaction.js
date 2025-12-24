/**
 * VRM 交互模块
 * 负责拖拽、缩放、鼠标跟踪等交互功能
 */
import * as THREE from 'three';

export class VRMInteraction {
    constructor(vrmCore) {
        this.core = vrmCore;
        
        // 拖拽和缩放相关
        this.isDragging = false;
        this.dragMode = null; // 'rotate' 或 'pan'
        this.previousMousePosition = { x: 0, y: 0 };
        this.isLocked = false;
        
        // 拖拽相关事件处理器引用（用于清理）
        this.mouseDownHandler = null;
        this.mouseUpHandler = null;
        this.mouseLeaveHandler = null;
        this.auxClickHandler = null;
        this.mouseEnterHandler = null;
        this.dragHandler = null;
        this.wheelHandler = null;
        
        // 鼠标跟踪相关
        this.mouseTrackingEnabled = false;
        this.mouseMoveHandler = null;
    }
    
    /**
     * 初始化拖拽和缩放功能
     */
    initDragAndZoom() {
        if (!this.core.renderer) return;
        
        const canvas = this.core.renderer.domElement;
        
        // 鼠标按下事件
        this.mouseDownHandler = (e) => {
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
            if (this.checkLocked()) {
                if (this.isDragging) {
                    this.isDragging = false;
                    this.dragMode = null;
                    canvas.style.cursor = 'grab';
                }
                return;
            }
            
            if (!this.isDragging || !this.core.vrm) return;

            const deltaX = e.clientX - this.previousMousePosition.x;
            const deltaY = e.clientY - this.previousMousePosition.y;

            if (this.dragMode === 'rotate') {
                const rotationSpeed = 0.01;
                this.core.modelRotation.y += deltaX * rotationSpeed;
                this.core.modelRotation.x += deltaY * rotationSpeed;
                
                this.core.modelRotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.core.modelRotation.x));
                
                this.core.vrm.scene.rotation.set(this.core.modelRotation.x, this.core.modelRotation.y, 0);
            } else if (this.dragMode === 'pan') {
                const panSpeed = 0.01;
                const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.core.camera.quaternion);
                const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.core.camera.quaternion);
                
                this.core.modelPosition.x += (right.x * deltaX - right.x * deltaY) * panSpeed;
                this.core.modelPosition.y += (up.y * deltaY) * panSpeed;
                this.core.modelPosition.z += (right.z * deltaX - right.z * deltaY) * panSpeed;
                
                this.core.vrm.scene.position.add(
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
            if (this.checkLocked() || !this.core.vrm) {
                return;
            }
            
            e.preventDefault();
            e.stopPropagation();
            
            const zoomSpeed = 0.1;
            const zoomDelta = e.deltaY > 0 ? -zoomSpeed : zoomSpeed;
            
            this.core.modelScale = Math.max(0.1, Math.min(3.0, this.core.modelScale + zoomDelta));
            this.core.vrm.scene.scale.set(this.core.modelScale, this.core.modelScale, this.core.modelScale);
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
     */
    checkLocked() {
        if (window.live2dManager && typeof window.live2dManager.isLocked !== 'undefined') {
            this.isLocked = window.live2dManager.isLocked;
        }
        return this.isLocked;
    }
    
    /**
     * 清理拖拽和缩放相关事件监听器
     */
    cleanupDragAndZoom() {
        if (!this.core.renderer) return;
        
        const canvas = this.core.renderer.domElement;
        
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
    
    /**
     * 启用/禁用鼠标跟踪
     */
    enableMouseTracking(enabled) {
        this.mouseTrackingEnabled = enabled;
        
        if (enabled && !this.mouseMoveHandler) {
            this.mouseMoveHandler = (e) => {
                if (!this.core.vrm || !this.core.vrm.scene) return;
                
                const rect = this.core.renderer.domElement.getBoundingClientRect();
                const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                
                if (this.core.vrm.humanoid?.normalizedHumanBones?.head) {
                    const headBone = this.core.vrm.humanoid.normalizedHumanBones.head.node;
                    if (headBone) {
                        headBone.rotation.y = x * 0.1;
                        headBone.rotation.x = y * 0.1;
                    }
                }
            };
            
            this.core.renderer.domElement.addEventListener('mousemove', this.mouseMoveHandler);
        } else if (!enabled && this.mouseMoveHandler) {
            this.core.renderer.domElement.removeEventListener('mousemove', this.mouseMoveHandler);
            this.mouseMoveHandler = null;
        }
    }
    
    /**
     * 清理交互资源
     */
    dispose() {
        this.enableMouseTracking(false);
        this.cleanupDragAndZoom();
    }
}
