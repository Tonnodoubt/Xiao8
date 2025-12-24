/**
 * VRM 表情模块
 * 负责表情管理和设置
 */
export class VRMExpression {
    constructor(vrmCore) {
        this.core = vrmCore;
    }
    
    /**
     * 设置表情
     */
    setExpression(expressionName, weight) {
        if (!this.core.vrm || !this.core.vrm.expressionManager) {
            return false;
        }

        const clampedWeight = Math.max(0, Math.min(1, weight));
        
        const expression = this.core.vrm.expressionManager.expressions[expressionName];
        if (!expression) {
            console.warn(`表情 "${expressionName}" 不存在，可用表情:`, Object.keys(this.core.vrm.expressionManager.expressions));
            return false;
        }
        
        expression.weight = clampedWeight;
        
        return true;
    }

    /**
     * 获取所有可用表情
     */
    getAvailableExpressions() {
        if (!this.core.vrm || !this.core.vrm.expressionManager) {
            return [];
        }
        return Object.keys(this.core.vrm.expressionManager.expressions);
    }

    /**
     * 重置所有表情
     */
    resetExpressions() {
        if (!this.core.vrm || !this.core.vrm.expressionManager) return;
        
        Object.keys(this.core.vrm.expressionManager.expressions).forEach(name => {
            this.setExpression(name, 0);
        });
    }
    
    /**
     * 检查模型是否包含动画
     */
    checkAnimations() {
        if (!this.core.vrm) {
            return null;
        }

        let gltf = null;
        
        if (this.core.vrm.userData && this.core.vrm.userData.gltf) {
            gltf = this.core.vrm.userData.gltf;
        }
        
        if (!gltf && this.core.vrm.scene && this.core.vrm.scene.userData && this.core.vrm.scene.userData.gltf) {
            gltf = this.core.vrm.scene.userData.gltf;
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
            
            return {
                hasAnimations: true,
                count: gltf.animations.length,
                animations: animations
            };
        } else {
            return {
                hasAnimations: false,
                message: '模型文件中没有找到动画数据'
            };
        }
    }
}
