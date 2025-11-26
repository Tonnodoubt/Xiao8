/**
 * VMD (Vocaloid Motion Data) 加载器和动画播放器
 * 用于将 MMD 动作数据应用到 VRM 模型
 */

import * as THREE from 'three';

/**
 * VMD 文件解析器
 * 解析 VMD 二进制格式
 */
class VMDParser {
    /**
     * 解析 VMD 文件
     * @param {ArrayBuffer} buffer - VMD 文件的二进制数据
     * @returns {Object} 解析后的 VMD 数据
     */
    static parse(buffer) {
        const dataView = new DataView(buffer);
        let offset = 0;

        // 读取文件头（30字节）
        const header = this.readString(dataView, offset, 30);
        offset += 30;

        if (!header.startsWith('Vocaloid Motion Data')) {
            throw new Error('无效的 VMD 文件格式');
        }

        // 读取模型名称（20字节）
        const modelName = this.readString(dataView, offset, 20);
        offset += 20;

        // 读取骨骼动画数量（4字节）
        const boneCount = dataView.getUint32(offset, true);
        offset += 4;

        // 读取骨骼动画数据
        const boneAnimations = [];
        for (let i = 0; i < boneCount; i++) {
            const boneName = this.readString(dataView, offset, 15);
            offset += 15;
            const frameNumber = dataView.getUint32(offset, true);
            offset += 4;
            const position = new THREE.Vector3(
                dataView.getFloat32(offset, true),
                dataView.getFloat32(offset + 4, true),
                dataView.getFloat32(offset + 8, true)
            );
            offset += 12;
            const rotation = new THREE.Quaternion(
                dataView.getFloat32(offset, true),
                dataView.getFloat32(offset + 4, true),
                dataView.getFloat32(offset + 8, true),
                dataView.getFloat32(offset + 12, true)
            );
            offset += 16;

            // 读取插值数据（64字节）
            const interpolation = new Uint8Array(buffer, offset, 64);
            offset += 64;

            boneAnimations.push({
                boneName: boneName.replace(/\0/g, ''),
                frameNumber,
                position,
                rotation,
                interpolation
            });
        }

        // 读取表情动画数量
        const expressionCount = dataView.getUint32(offset, true);
        offset += 4;

        // 读取表情动画数据
        const expressionAnimations = [];
        for (let i = 0; i < expressionCount; i++) {
            const expressionName = this.readString(dataView, offset, 15);
            offset += 15;
            const frameNumber = dataView.getUint32(offset, true);
            offset += 4;
            const weight = dataView.getFloat32(offset, true);
            offset += 4;

            expressionAnimations.push({
                expressionName: expressionName.replace(/\0/g, ''),
                frameNumber,
                weight
            });
        }

        // 读取相机动画数量（可选）
        const cameraCount = dataView.getUint32(offset, true);
        offset += 4;

        return {
            header,
            modelName: modelName.replace(/\0/g, ''),
            boneAnimations,
            expressionAnimations,
            cameraCount,
            frameRate: 30 // VMD 默认帧率
        };
    }

    /**
     * 读取字符串
     */
    static readString(dataView, offset, length) {
        let str = '';
        for (let i = 0; i < length; i++) {
            const char = dataView.getUint8(offset + i);
            if (char === 0) break;
            str += String.fromCharCode(char);
        }
        return str;
    }
}

/**
 * VMD 动画转换器
 * 将 VMD 数据转换为 Three.js AnimationClip
 */
class VMDAnimationConverter {
    /**
     * 将 VMD 骨骼动画转换为 Three.js AnimationClip
     * @param {Object} vmdData - 解析后的 VMD 数据
     * @param {Object} vrm - VRM 模型实例
     * @returns {THREE.AnimationClip} Three.js 动画片段
     */
    static convertToAnimationClip(vmdData, vrm) {
        if (!vrm || !vrm.humanoid) {
            throw new Error('VRM 模型未加载或没有 Humanoid 数据');
        }

        const tracks = [];
        const boneMap = vrm.humanoid.normalizedHumanBones;
        const frameRate = vmdData.frameRate;

        // 按骨骼名称分组动画数据
        const boneAnimationMap = new Map();
        vmdData.boneAnimations.forEach(anim => {
            if (!boneAnimationMap.has(anim.boneName)) {
                boneAnimationMap.set(anim.boneName, []);
            }
            boneAnimationMap.get(anim.boneName).push(anim);
        });

        // 为每个骨骼创建动画轨道
        boneAnimationMap.forEach((animations, boneName) => {
            // 查找对应的 VRM 骨骼
            const vrmBone = this.findVRMBone(boneName, boneMap);
            if (!vrmBone || !vrmBone.node) {
                // 如果找不到对应的骨骼，跳过
                console.warn(`[VMD] 未找到骨骼: ${boneName}`);
                return;
            }

            // 按帧号排序
            animations.sort((a, b) => a.frameNumber - b.frameNumber);

            // 创建位置轨道
            const positionTimes = [];
            const positionValues = [];
            animations.forEach(anim => {
                positionTimes.push(anim.frameNumber / frameRate);
                positionValues.push(anim.position.x, anim.position.y, anim.position.z);
            });

            if (positionTimes.length > 0) {
                const positionTrack = new THREE.VectorKeyframeTrack(
                    `${vrmBone.node.name}.position`,
                    positionTimes,
                    positionValues
                );
                tracks.push(positionTrack);
            }

            // 创建旋转轨道
            const rotationTimes = [];
            const rotationValues = [];
            animations.forEach(anim => {
                rotationTimes.push(anim.frameNumber / frameRate);
                rotationValues.push(
                    anim.rotation.x,
                    anim.rotation.y,
                    anim.rotation.z,
                    anim.rotation.w
                );
            });

            if (rotationTimes.length > 0) {
                const rotationTrack = new THREE.QuaternionKeyframeTrack(
                    `${vrmBone.node.name}.quaternion`,
                    rotationTimes,
                    rotationValues
                );
                tracks.push(rotationTrack);
            }
        });

        if (tracks.length === 0) {
            throw new Error('无法创建动画轨道：没有匹配的骨骼');
        }

        // 计算动画时长
        const maxFrame = Math.max(
            ...vmdData.boneAnimations.map(a => a.frameNumber)
        );
        const duration = maxFrame / frameRate;

        // 创建动画片段
        const clip = new THREE.AnimationClip('VMDAnimation', duration, tracks);
        return clip;
    }

    /**
     * 查找对应的 VRM 骨骼
     * @param {string} mmdBoneName - MMD 骨骼名称
     * @param {Object} boneMap - VRM 骨骼映射
     * @returns {Object} VRM 骨骼对象
     */
    static findVRMBone(mmdBoneName, boneMap) {
        // MMD 到 VRM 骨骼名称映射表
        const boneNameMap = {
            'センター': 'hips',
            '上半身': 'spine',
            '下半身': 'hips',
            '首': 'neck',
            '頭': 'head',
            '左肩': 'leftShoulder',
            '左腕': 'leftUpperArm',
            '左ひじ': 'leftLowerArm',
            '左手首': 'leftHand',
            '右肩': 'rightShoulder',
            '右腕': 'rightUpperArm',
            '右ひじ': 'rightLowerArm',
            '右手首': 'rightHand',
            '左足': 'leftUpperLeg',
            '左ひざ': 'leftLowerLeg',
            '左足首': 'leftFoot',
            '右足': 'rightUpperLeg',
            '右ひざ': 'rightLowerLeg',
            '右足首': 'rightFoot',
            // 添加更多映射...
        };

        // 尝试直接匹配
        if (boneMap[mmdBoneName]) {
            return boneMap[mmdBoneName];
        }

        // 尝试通过映射表匹配
        const vrmBoneName = boneNameMap[mmdBoneName];
        if (vrmBoneName && boneMap[vrmBoneName]) {
            return boneMap[vrmBoneName];
        }

        // 尝试模糊匹配（包含关系）
        for (const [key, value] of Object.entries(boneMap)) {
            if (key.includes(mmdBoneName) || mmdBoneName.includes(key)) {
                return value;
            }
        }

        return null;
    }
}

/**
 * VMD 动画管理器
 */
class VMDAnimationManager {
    constructor(vrmManager) {
        this.vrmManager = vrmManager;
        this.mixer = null;
        this.currentAction = null;
        this.currentClip = null;
        this.isPlaying = false;
    }

    /**
     * 加载并播放 VMD 动画
     * @param {string} vmdPath - VMD 文件路径
     * @param {Object} options - 播放选项
     */
    async loadAndPlay(vmdPath, options = {}) {
        try {
            // 加载 VMD 文件
            const response = await fetch(vmdPath);
            if (!response.ok) {
                throw new Error(`无法加载 VMD 文件: ${response.statusText}`);
            }

            const buffer = await response.arrayBuffer();
            console.log('[VMD] VMD 文件加载成功，大小:', buffer.byteLength, '字节');

            // 解析 VMD 数据
            const vmdData = VMDParser.parse(buffer);
            console.log('[VMD] VMD 数据解析成功:', {
                骨骼动画: vmdData.boneAnimations.length,
                表情动画: vmdData.expressionAnimations.length,
                帧率: vmdData.frameRate
            });

            // 转换为 Three.js AnimationClip
            if (!this.vrmManager.vrm) {
                throw new Error('VRM 模型未加载');
            }

            const clip = VMDAnimationConverter.convertToAnimationClip(
                vmdData,
                this.vrmManager.vrm
            );
            console.log('[VMD] 动画片段创建成功，时长:', clip.duration, '秒');

            // 播放动画
            this.playClip(clip, options);
        } catch (error) {
            console.error('[VMD] 加载动画失败:', error);
            throw error;
        }
    }

    /**
     * 播放动画片段
     * @param {THREE.AnimationClip} clip - 动画片段
     * @param {Object} options - 播放选项
     */
    playClip(clip, options = {}) {
        if (!this.vrmManager.vrm || !this.vrmManager.vrm.scene) {
            throw new Error('VRM 模型未加载');
        }

        // 创建 AnimationMixer
        if (!this.mixer) {
            this.mixer = new THREE.AnimationMixer(this.vrmManager.vrm.scene);
        }

        // 停止当前动画
        if (this.currentAction) {
            this.currentAction.stop();
        }

        // 创建新的动画动作
        this.currentClip = clip;
        this.currentAction = this.mixer.clipAction(clip);
        
        // 设置播放选项
        if (options.loop !== undefined) {
            this.currentAction.setLoop(options.loop ? THREE.LoopRepeat : THREE.LoopOnce);
        } else {
            this.currentAction.setLoop(THREE.LoopRepeat); // 默认循环
        }

        if (options.timeScale !== undefined) {
            this.currentAction.timeScale = options.timeScale;
        }

        // 播放动画
        this.currentAction.play();
        this.isPlaying = true;

        console.log('[VMD] 动画开始播放:', {
            名称: clip.name,
            时长: clip.duration,
            循环: this.currentAction.loop === THREE.LoopRepeat
        });
    }

    /**
     * 停止动画
     */
    stop() {
        if (this.currentAction) {
            this.currentAction.stop();
            this.currentAction = null;
        }
        this.isPlaying = false;
        console.log('[VMD] 动画已停止');
    }

    /**
     * 暂停/恢复动画
     */
    pause() {
        if (this.currentAction) {
            if (this.isPlaying) {
                this.currentAction.paused = true;
                this.isPlaying = false;
                console.log('[VMD] 动画已暂停');
            } else {
                this.currentAction.paused = false;
                this.isPlaying = true;
                console.log('[VMD] 动画已恢复');
            }
        }
    }

    /**
     * 更新动画（需要在渲染循环中调用）
     * @param {number} deltaTime - 时间增量（秒）
     */
    update(deltaTime) {
        if (this.mixer && this.isPlaying) {
            this.mixer.update(deltaTime);
        }
    }

    /**
     * 清理资源
     */
    dispose() {
        this.stop();
        if (this.mixer) {
            this.mixer.uncacheRoot(this.vrmManager.vrm.scene);
            this.mixer = null;
        }
        this.currentClip = null;
    }
}

export { VMDParser, VMDAnimationConverter, VMDAnimationManager };

