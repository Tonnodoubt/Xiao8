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
            // 保存骨骼名称的原始字节位置
            const boneNameOffset = offset;
            const boneName = this.readString(dataView, offset, 15);
            offset += 15;
            
            // 提取骨骼名称的原始字节（用于 Shift-JIS 匹配）
            const boneNameBytes = new Uint8Array(15);
            for (let j = 0; j < 15; j++) {
                boneNameBytes[j] = dataView.getUint8(boneNameOffset + j);
            }
            
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
                interpolation,
                rawBoneNameBytes: boneNameBytes // 保存原始字节用于 Shift-JIS 匹配
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
     * 读取字符串（支持 Shift-JIS 编码）
     */
    static readString(dataView, offset, length) {
        // 找到字符串的实际长度（遇到 0 字节为止）
        let actualLength = 0;
        for (let i = 0; i < length; i++) {
            if (dataView.getUint8(offset + i) === 0) {
                actualLength = i;
                break;
            }
            actualLength = i + 1;
        }
        
        if (actualLength === 0) return '';
        
        // 提取字节数组
        const bytes = new Uint8Array(actualLength);
        for (let i = 0; i < actualLength; i++) {
            bytes[i] = dataView.getUint8(offset + i);
        }
        
        // 尝试使用 TextDecoder 解码 Shift-JIS
        // 注意：大多数浏览器不支持 Shift-JIS，会回退到原始方法
        // 我们会在 findVRMBone 中通过字节模式匹配来处理
        try {
            // 尝试使用 'shift-jis'
            const decoder = new TextDecoder('shift-jis');
            const decoded = decoder.decode(bytes);
            // 检查解码结果是否包含乱码字符（控制字符）
            if (!/[\x00-\x08\x0B-\x0C\x0E-\x1F]/.test(decoded)) {
                return decoded;
            }
        } catch (e) {
            // 忽略错误，继续尝试其他方法
        }
        
        try {
            // 尝试使用 'shift_jis'
            const decoder = new TextDecoder('shift_jis');
            const decoded = decoder.decode(bytes);
            if (!/[\x00-\x08\x0B-\x0C\x0E-\x1F]/.test(decoded)) {
                return decoded;
            }
        } catch (e2) {
            // 忽略错误，继续尝试其他方法
        }
        
        // 如果浏览器不支持 Shift-JIS，回退到原始方法
        // 虽然会显示乱码，但我们可以通过字节模式匹配来识别常见骨骼
        let str = '';
        for (let i = 0; i < actualLength; i++) {
            str += String.fromCharCode(bytes[i]);
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
            // 如果有原始字节数据，也传递给匹配函数
            const firstAnim = animations[0];
            const rawBytes = firstAnim.rawBoneNameBytes;
            const vrmBone = this.findVRMBone(boneName, boneMap, rawBytes);
            if (!vrmBone || !vrmBone.node) {
                // 如果找不到对应的骨骼，跳过（不输出警告，因为很多 MMD 特定骨骼无法映射到 VRM 是正常的）
                skippedBones++;
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

        // 如果没有任何匹配的骨骼，尝试使用场景中的骨骼节点进行直接匹配
        if (tracks.length === 0) {
            // 尝试直接从场景中查找骨骼节点
            const scene = vrm.scene;
            if (scene) {
                scene.traverse((node) => {
                    if (node.isBone && boneAnimationMap.has(node.name)) {
                        const animations = boneAnimationMap.get(node.name);
                        animations.sort((a, b) => a.frameNumber - b.frameNumber);
                        
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
                                `${node.name}.quaternion`,
                                rotationTimes,
                                rotationValues
                            );
                            tracks.push(rotationTrack);
                        }
                    }
                });
            }
        }
        
        // 即使只有部分骨骼匹配，也允许播放动画
        // 很多 MMD 特定骨骼（如手指、IK等）无法映射到 VRM 是正常的
        if (tracks.length === 0) {
            throw new Error(`无法创建动画轨道：没有匹配的骨骼 (已尝试匹配 ${matchedBones + skippedBones} 个骨骼，成功 ${matchedBones} 个)`);
        }
        
        // 输出匹配统计（仅在开发时有用）
        if (matchedBones > 0) {
            // 静默成功，不输出日志
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
     * @param {Uint8Array} rawBytes - 原始字节数据（用于 Shift-JIS 匹配）
     * @returns {Object} VRM 骨骼对象
     */
    static findVRMBone(mmdBoneName, boneMap, rawBytes = null) {
        // MMD 到 VRM 骨骼名称映射表（更完整的映射，包含日文和英文）
        const boneNameMap = {
            // 核心骨骼（日文）
            'センター': 'hips',
            '上半身': 'spine',
            '下半身': 'hips',
            '首': 'neck',
            '頭': 'head',
            // 左臂（日文）
            '左肩': 'leftShoulder',
            '左腕': 'leftUpperArm',
            '左ひじ': 'leftLowerArm',
            '左手首': 'leftHand',
            // 右臂（日文）
            '右肩': 'rightShoulder',
            '右腕': 'rightUpperArm',
            '右ひじ': 'rightLowerArm',
            '右手首': 'rightHand',
            // 左腿（日文）
            '左足': 'leftUpperLeg',
            '左ひざ': 'leftLowerLeg',
            '左足首': 'leftFoot',
            // 右腿（日文）
            '右足': 'rightUpperLeg',
            '右ひざ': 'rightLowerLeg',
            '右足首': 'rightFoot',
            // 英文名称映射
            'center': 'hips',
            'upper body': 'spine',
            'lower body': 'hips',
            'neck': 'neck',
            'head': 'head',
            'left shoulder': 'leftShoulder',
            'left arm': 'leftUpperArm',
            'left elbow': 'leftLowerArm',
            'left hand': 'leftHand',
            'right shoulder': 'rightShoulder',
            'right arm': 'rightUpperArm',
            'right elbow': 'rightLowerArm',
            'right hand': 'rightHand',
            'left leg': 'leftUpperLeg',
            'left knee': 'leftLowerLeg',
            'left foot': 'leftFoot',
            'right leg': 'rightUpperLeg',
            'right knee': 'rightLowerLeg',
            'right foot': 'rightFoot',
        };
        
        // Shift-JIS 编码的常见骨骼名称字节模式映射
        // 这些是 Shift-JIS 编码的日文骨骼名称的字节序列
        const shiftJISBonePatterns = {
            // センター (0x83 0x5A 0x83 0x93 0x83 0x5E 0x81 0x5B)
            '\x83\x5A\x83\x93\x83\x5E\x81\x5B': 'hips',
            // 上半身 (0x8F 0xE3 0x94 0xBC 0x90 0x67)
            '\x8F\xE3\x94\xBC\x90\x67': 'spine',
            // 下半身 (0x89 0xBA 0x94 0xBC 0x90 0x67)
            '\x89\xBA\x94\xBC\x90\x67': 'hips',
            // 首 (0x8E 0x80)
            '\x8E\x80': 'neck',
            // 頭 (0x93 0xAA)
            '\x93\xAA': 'head',
            // 左肩 (0x8D 0xB6 0x8C 0xA8)
            '\x8D\xB6\x8C\xA8': 'leftShoulder',
            // 左腕 (0x8D 0xB6 0x94 0x5C)
            '\x8D\xB6\x94\x5C': 'leftUpperArm',
            // 左ひじ (0x8D 0xB6 0x82 0xD0 0x82 0xB6)
            '\x8D\xB6\x82\xD0\x82\xB6': 'leftLowerArm',
            // 左手首 (0x8D 0xB6 0x8E 0xE8 0x8E 0xF0)
            '\x8D\xB6\x8E\xE8\x8E\xF0': 'leftHand',
            // 右肩 (0x89 0x45 0x8C 0xA8)
            '\x89\x45\x8C\xA8': 'rightShoulder',
            // 右腕 (0x89 0x45 0x94 0x5C)
            '\x89\x45\x94\x5C': 'rightUpperArm',
            // 右ひじ (0x89 0x45 0x82 0xD0 0x82 0xB6)
            '\x89\x45\x82\xD0\x82\xB6': 'rightLowerArm',
            // 右手首 (0x89 0x45 0x8E 0xE8 0x8E 0xF0)
            '\x89\x45\x8E\xE8\x8E\xF0': 'rightHand',
            // 左足 (0x8D 0xB6 0x91 0xAB)
            '\x8D\xB6\x91\xAB': 'leftUpperLeg',
            // 左ひざ (0x8D 0xB6 0x82 0xD0 0x82 0xB4)
            '\x8D\xB6\x82\xD0\x82\xB4': 'leftLowerLeg',
            // 左足首 (0x8D 0xB6 0x91 0xAB 0x8E 0xF0)
            '\x8D\xB6\x91\xAB\x8E\xF0': 'leftFoot',
            // 右足 (0x89 0x45 0x91 0xAB)
            '\x89\x45\x91\xAB': 'rightUpperLeg',
            // 右ひざ (0x89 0x45 0x82 0xD0 0x82 0xB4)
            '\x89\x45\x82\xD0\x82\xB4': 'rightLowerLeg',
            // 右足首 (0x89 0x45 0x91 0xAB 0x8E 0xF0)
            '\x89\x45\x91\xAB\x8E\xF0': 'rightFoot',
        };
        
        // 清理骨骼名称（移除可能的乱码字符和尾随字符）
        const cleanName = mmdBoneName.replace(/\0/g, '').trim();
        
        // 如果名称看起来是 Shift-JIS 编码的乱码，尝试通过字节模式匹配
        if (/[\x80-\xFF]/.test(cleanName) && !/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(cleanName)) {
            // 尝试匹配 Shift-JIS 字节模式
            for (const [pattern, vrmBoneName] of Object.entries(shiftJISBonePatterns)) {
                if (cleanName.includes(pattern) || cleanName === pattern) {
                    if (boneMap[vrmBoneName]) {
                        return boneMap[vrmBoneName];
                    }
                }
            }
        }
        
        // 如果名称包含乱码，尝试提取可读部分
        let normalizedName = cleanName;
        if (/[\x00-\x1F\x7F-\xFF]/.test(cleanName)) {
            // 尝试提取日文字符部分
            const japaneseMatch = cleanName.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]+/);
            if (japaneseMatch) {
                normalizedName = japaneseMatch[0];
            }
        }

        // 尝试直接匹配（精确匹配）
        if (boneMap[mmdBoneName]) {
            return boneMap[mmdBoneName];
        }
        
        // 尝试使用清理后的名称匹配
        if (normalizedName !== mmdBoneName && boneMap[normalizedName]) {
            return boneMap[normalizedName];
        }

        // 尝试通过映射表匹配（原始名称）
        let vrmBoneName = boneNameMap[mmdBoneName];
        if (vrmBoneName && boneMap[vrmBoneName]) {
            return boneMap[vrmBoneName];
        }
        
        // 尝试通过映射表匹配（清理后的名称）
        if (normalizedName !== mmdBoneName) {
            vrmBoneName = boneNameMap[normalizedName];
            if (vrmBoneName && boneMap[vrmBoneName]) {
                return boneMap[vrmBoneName];
            }
        }

        // 尝试不区分大小写的匹配
        const mmdBoneNameLower = mmdBoneName.toLowerCase();
        for (const [key, value] of Object.entries(boneMap)) {
            if (key.toLowerCase() === mmdBoneNameLower) {
                return value;
            }
        }

        // 尝试模糊匹配（包含关系，不区分大小写）
        for (const [key, value] of Object.entries(boneMap)) {
            const keyLower = key.toLowerCase();
            const mmdLower = mmdBoneNameLower;
            if (keyLower.includes(mmdLower) || mmdLower.includes(keyLower)) {
                return value;
            }
        }
        
        // 尝试部分匹配（移除常见前缀/后缀）
        const cleanMmdName = mmdBoneName.replace(/^[左右]/, '').replace(/[首腕足]$/, '');
        for (const [key, value] of Object.entries(boneMap)) {
            const cleanKey = key.replace(/^(left|right)/i, '').toLowerCase();
            const cleanMmd = cleanMmdName.toLowerCase();
            if (cleanKey === cleanMmd || cleanKey.includes(cleanMmd) || cleanMmd.includes(cleanKey)) {
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

