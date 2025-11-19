import { DataCreationHelper } from "./DataCreationHelper.js";
import { DataViewEx } from "./DataViewEx.js";
// #endregion
export class Parser {
    static parsePmd(buffer, leftToRight) {
        const pmd = {};
        const dv = new DataViewEx(buffer);
        const metadata = {
            format: "pmd",
            coordinateSystem: "left"
        };
        pmd.metadata = metadata;
        // parseHeader
        {
            metadata.magic = dv.getChars(3);
            if (metadata.magic !== "Pmd") {
                throw "PMD file magic is not Pmd, but " + metadata.magic;
            }
            metadata.version = dv.getFloat32();
            metadata.modelName = dv.getSjisStringsAsUnicode(20);
            metadata.comment = dv.getSjisStringsAsUnicode(256);
        }
        // parseVertices
        {
            function parseVertex() {
                const position = dv.getFloat32Array(3);
                const normal = dv.getFloat32Array(3);
                const uv = dv.getFloat32Array(2);
                const skinIndices = dv.getUint16Array(2);
                const skinWeights = [dv.getUint8() / 100];
                skinWeights.push(1.0 - skinWeights[0]);
                const edgeFlag = dv.getUint8();
                return {
                    position: position,
                    normal: normal,
                    uv: uv,
                    skinIndices: skinIndices,
                    skinWeights: skinWeights,
                    edgeFlag
                };
            }
            metadata.vertexCount = dv.getUint32();
            pmd.vertices = [];
            for (let i = 0; i < metadata.vertexCount; i++) {
                pmd.vertices.push(parseVertex());
            }
        }
        // parseFaces
        {
            function parseFace() {
                const p = {
                    indices: dv.getUint16Array(3)
                };
                return p;
            }
            metadata.faceCount = dv.getUint32() / 3;
            pmd.faces = [];
            for (let i = 0; i < metadata.faceCount; i++) {
                pmd.faces.push(parseFace());
            }
        }
        // parseMaterials
        {
            function parseMaterial() {
                const p = {};
                p.diffuse = dv.getFloat32Array(4);
                p.shininess = dv.getFloat32();
                p.specular = dv.getFloat32Array(3);
                p.ambient = dv.getFloat32Array(3);
                p.toonIndex = dv.getInt8();
                p.edgeFlag = dv.getUint8();
                p.faceCount = dv.getUint32() / 3;
                p.fileName = dv.getSjisStringsAsUnicode(20);
                return p;
            }
            metadata.materialCount = dv.getUint32();
            pmd.materials = [];
            for (let i = 0; i < metadata.materialCount; i++) {
                pmd.materials.push(parseMaterial());
            }
        }
        // parseBones
        {
            function parseBone() {
                const p = {};
                p.name = dv.getSjisStringsAsUnicode(20);
                p.parentIndex = dv.getInt16();
                p.tailIndex = dv.getInt16();
                p.type = dv.getUint8();
                p.ikIndex = dv.getInt16();
                p.position = dv.getFloat32Array(3);
                return p;
            }
            metadata.boneCount = dv.getUint16();
            pmd.bones = [];
            for (let i = 0; i < metadata.boneCount; i++) {
                pmd.bones.push(parseBone());
            }
        }
        // parseIks
        {
            function parseIk() {
                const p = {};
                p.target = dv.getUint16();
                p.effector = dv.getUint16();
                p.linkCount = dv.getUint8();
                p.iteration = dv.getUint16();
                p.maxAngle = dv.getFloat32();
                p.links = [];
                for (let i = 0; i < p.linkCount; i++) {
                    const link = {};
                    link.index = dv.getUint16();
                    p.links.push(link);
                }
                return p;
            }
            metadata.ikCount = dv.getUint16();
            pmd.iks = [];
            for (let i = 0; i < metadata.ikCount; i++) {
                pmd.iks.push(parseIk());
            }
        }
        // parseMorphs
        {
            function parseMorph() {
                const p = {};
                p.name = dv.getSjisStringsAsUnicode(20);
                p.elementCount = dv.getUint32();
                p.type = dv.getUint8();
                p.elements = [];
                for (let i = 0; i < p.elementCount; i++) {
                    p.elements.push({
                        index: dv.getUint32(),
                        position: dv.getFloat32Array(3)
                    });
                }
                return p;
            }
            metadata.morphCount = dv.getUint16();
            pmd.morphs = [];
            for (let i = 0; i < metadata.morphCount; i++) {
                pmd.morphs.push(parseMorph());
            }
        }
        // parseMorphFrames
        {
            function parseMorphFrame() {
                const p = {};
                p.index = dv.getUint16();
                return p;
            }
            metadata.morphFrameCount = dv.getUint8();
            pmd.morphFrames = [];
            for (let i = 0; i < metadata.morphFrameCount; i++) {
                pmd.morphFrames.push(parseMorphFrame());
            }
        }
        // parseBoneFrameNames
        {
            function parseBoneFrameName() {
                const p = {};
                p.name = dv.getSjisStringsAsUnicode(50);
                return p;
            }
            metadata.boneFrameNameCount = dv.getUint8();
            pmd.boneFrameNames = [];
            for (let i = 0; i < metadata.boneFrameNameCount; i++) {
                pmd.boneFrameNames.push(parseBoneFrameName());
            }
        }
        // parseBoneFrames
        {
            function parseBoneFrame() {
                const p = {};
                p.boneIndex = dv.getInt16();
                p.frameIndex = dv.getUint8();
                return p;
            }
            metadata.boneFrameCount = dv.getUint32();
            pmd.boneFrames = [];
            for (let i = 0; i < metadata.boneFrameCount; i++) {
                pmd.boneFrames.push(parseBoneFrame());
            }
        }
        // parseEnglishHeader
        {
            metadata.englishCompatibility = dv.getUint8();
            if (metadata.englishCompatibility > 0) {
                metadata.englishModelName = dv.getSjisStringsAsUnicode(20);
                metadata.englishComment = dv.getSjisStringsAsUnicode(256);
            }
        }
        // parseEnglishBoneNames
        {
            function parseEnglishBoneName() {
                const p = {};
                p.name = dv.getSjisStringsAsUnicode(20);
                return p;
            }
            if (metadata.englishCompatibility !== 0) {
                pmd.englishBoneNames = [];
                for (let i = 0; i < metadata.boneCount; i++) {
                    pmd.englishBoneNames.push(parseEnglishBoneName());
                }
            }
        }
        // parseEnglishMorphNames
        {
            function parseEnglishMorphName() {
                const p = {};
                p.name = dv.getSjisStringsAsUnicode(20);
                return p;
            }
            if (metadata.englishCompatibility !== 0) {
                pmd.englishMorphNames = [];
                for (let i = 0; i < metadata.morphCount - 1; i++) {
                    pmd.englishMorphNames.push(parseEnglishMorphName());
                }
            }
        }
        // parseEnglishBoneFrameNames
        {
            function parseEnglishBoneFrameName() {
                const p = {};
                p.name = dv.getSjisStringsAsUnicode(50);
                return p;
            }
            if (metadata.englishCompatibility !== 0) {
                pmd.englishBoneFrameNames = [];
                for (let i = 0; i < metadata.boneFrameNameCount; i++) {
                    pmd.englishBoneFrameNames.push(parseEnglishBoneFrameName());
                }
            }
        }
        // parseToonTextures
        {
            function parseToonTexture() {
                const p = {};
                p.fileName = dv.getSjisStringsAsUnicode(100);
                return p;
            }
            pmd.toonTextures = [];
            for (let i = 0; i < 10; i++) {
                pmd.toonTextures.push(parseToonTexture());
            }
        }
        // parseRigidBodies
        {
            function parseRigidBody() {
                const p = {};
                p.name = dv.getSjisStringsAsUnicode(20);
                p.boneIndex = dv.getInt16();
                p.groupIndex = dv.getUint8();
                p.groupTarget = dv.getUint16();
                p.shapeType = dv.getUint8();
                p.width = dv.getFloat32();
                p.height = dv.getFloat32();
                p.depth = dv.getFloat32();
                p.position = dv.getFloat32Array(3);
                p.rotation = dv.getFloat32Array(3);
                p.weight = dv.getFloat32();
                p.positionDamping = dv.getFloat32();
                p.rotationDamping = dv.getFloat32();
                p.restitution = dv.getFloat32();
                p.friction = dv.getFloat32();
                p.type = dv.getUint8();
                return p;
            }
            metadata.rigidBodyCount = dv.getUint32();
            pmd.rigidBodies = [];
            for (let i = 0; i < metadata.rigidBodyCount; i++) {
                pmd.rigidBodies.push(parseRigidBody());
            }
        }
        // parseConstraints
        {
            function parseConstraint() {
                const p = {};
                p.name = dv.getSjisStringsAsUnicode(20);
                p.rigidBodyIndex1 = dv.getUint32();
                p.rigidBodyIndex2 = dv.getUint32();
                p.position = dv.getFloat32Array(3);
                p.rotation = dv.getFloat32Array(3);
                p.translationLimitation1 = dv.getFloat32Array(3);
                p.translationLimitation2 = dv.getFloat32Array(3);
                p.rotationLimitation1 = dv.getFloat32Array(3);
                p.rotationLimitation2 = dv.getFloat32Array(3);
                p.springPosition = dv.getFloat32Array(3);
                p.springRotation = dv.getFloat32Array(3);
                return p;
            }
            metadata.constraintCount = dv.getUint32();
            pmd.constraints = [];
            for (let i = 0; i < metadata.constraintCount; i++) {
                pmd.constraints.push(parseConstraint());
            }
        }
        if (leftToRight === true)
            this.leftToRightModel(pmd);
        return pmd;
    }
    static parsePmx(buffer, leftToRight) {
        const pmx = {};
        const dv = new DataViewEx(buffer);
        const metadata = {
            format: "pmx",
            coordinateSystem: "left"
        };
        pmx.metadata = metadata;
        // parseHeader
        {
            metadata.magic = dv.getChars(4);
            // Note: don't remove the last blank space.
            if (metadata.magic !== "PMX ") {
                throw "PMX file magic is not PMX , but " + metadata.magic;
            }
            metadata.version = dv.getFloat32();
            if (metadata.version !== 2.0 && metadata.version !== 2.1) {
                throw "PMX version " + metadata.version + " is not supported.";
            }
            metadata.headerSize = dv.getUint8();
            metadata.encoding = dv.getUint8();
            metadata.additionalUvNum = dv.getUint8();
            metadata.vertexIndexSize = dv.getUint8();
            metadata.textureIndexSize = dv.getUint8();
            metadata.materialIndexSize = dv.getUint8();
            metadata.boneIndexSize = dv.getUint8();
            metadata.morphIndexSize = dv.getUint8();
            metadata.rigidBodyIndexSize = dv.getUint8();
            metadata.modelName = dv.getTextBuffer();
            metadata.englishModelName = dv.getTextBuffer();
            metadata.comment = dv.getTextBuffer();
            metadata.englishComment = dv.getTextBuffer();
        }
        // parseVertices
        {
            function parseVertex() {
                const p = {};
                p.position = dv.getFloat32Array(3);
                p.normal = dv.getFloat32Array(3);
                p.uv = dv.getFloat32Array(2);
                const auvs = [];
                for (let i = 0; i < metadata.additionalUvNum; i++) {
                    auvs.push(dv.getFloat32Array(4));
                }
                p.type = dv.getUint8();
                const indexSize = metadata.boneIndexSize;
                if (p.type === 0) { // BDEF1
                    p.skinIndices = dv.getIndexArray(indexSize, 1, false);
                    p.skinWeights = [1.0];
                }
                else if (p.type === 1) { // BDEF2
                    p.skinIndices = dv.getIndexArray(indexSize, 2, false);
                    p.skinWeights = dv.getFloat32Array(1);
                    p.skinWeights.push(1.0 - p.skinWeights[0]);
                }
                else if (p.type === 2) { // BDEF4
                    p.skinIndices = dv.getIndexArray(indexSize, 4, false);
                    p.skinWeights = dv.getFloat32Array(4);
                }
                else if (p.type === 3) { // SDEF
                    p.skinIndices = dv.getIndexArray(indexSize, 2, false);
                    p.skinWeights = dv.getFloat32Array(1);
                    p.skinWeights.push(1.0 - p.skinWeights[0]);
                    p.skinC = dv.getFloat32Array(3);
                    p.skinR0 = dv.getFloat32Array(3);
                    p.skinR1 = dv.getFloat32Array(3);
                    // SDEF is not supported yet and is handled as BDEF2 so far.
                    // TODO: SDEF support
                    p.type = 1;
                }
                else {
                    throw "unsupport bone type " + p.type + " exception.";
                }
                p.edgeRatio = dv.getFloat32();
                return p;
            }
            metadata.vertexCount = dv.getUint32();
            pmx.vertices = [];
            for (let i = 0; i < metadata.vertexCount; i++) {
                pmx.vertices.push(parseVertex());
            }
        }
        // parseFaces
        {
            function parseFace() {
                const p = {};
                p.indices = dv.getIndexArray(metadata.vertexIndexSize, 3, true);
                return p;
            }
            metadata.faceCount = dv.getUint32() / 3;
            pmx.faces = [];
            for (let i = 0; i < metadata.faceCount; i++) {
                pmx.faces.push(parseFace());
            }
        }
        // parseTextures
        {
            function parseTexture() {
                return dv.getTextBuffer();
            }
            metadata.textureCount = dv.getUint32();
            pmx.textures = [];
            for (let i = 0; i < metadata.textureCount; i++) {
                pmx.textures.push(parseTexture());
            }
        }
        // parseMaterials
        {
            function parseMaterial() {
                const p = {};
                p.name = dv.getTextBuffer();
                p.englishName = dv.getTextBuffer();
                p.diffuse = dv.getFloat32Array(4);
                p.specular = dv.getFloat32Array(3);
                p.shininess = dv.getFloat32();
                p.ambient = dv.getFloat32Array(3);
                p.flag = dv.getUint8();
                p.edgeColor = dv.getFloat32Array(4);
                p.edgeSize = dv.getFloat32();
                p.textureIndex = dv.getIndex(metadata.textureIndexSize, false);
                p.envTextureIndex = dv.getIndex(metadata.textureIndexSize, false);
                p.envFlag = dv.getUint8();
                p.toonFlag = dv.getUint8();
                if (p.toonFlag === 0) {
                    p.toonIndex = dv.getIndex(metadata.textureIndexSize, false);
                }
                else if (p.toonFlag === 1) {
                    p.toonIndex = dv.getInt8();
                }
                else {
                    throw "unknown toon flag " + p.toonFlag + " exception.";
                }
                p.comment = dv.getTextBuffer();
                p.faceCount = dv.getUint32() / 3;
                return p;
            }
            metadata.materialCount = dv.getUint32();
            pmx.materials = [];
            for (let i = 0; i < metadata.materialCount; i++) {
                pmx.materials.push(parseMaterial());
            }
        }
        // parseBones
        {
            function parseBone() {
                const p = {};
                p.name = dv.getTextBuffer();
                p.englishName = dv.getTextBuffer();
                p.position = dv.getFloat32Array(3);
                p.parentIndex = dv.getIndex(metadata.boneIndexSize, false);
                p.transformationClass = dv.getUint32();
                p.flag = dv.getUint16();
                if (p.flag & 0x1) {
                    p.connectIndex = dv.getIndex(metadata.boneIndexSize, false);
                }
                else {
                    p.offsetPosition = dv.getFloat32Array(3);
                }
                if (p.flag & 0x100 || p.flag & 0x200) {
                    const grant = {};
                    grant.isLocal = (p.flag & 0x80) !== 0 ? true : false;
                    grant.affectRotation = (p.flag & 0x100) !== 0 ? true : false;
                    grant.affectPosition = (p.flag & 0x200) !== 0 ? true : false;
                    grant.parentIndex = dv.getIndex(metadata.boneIndexSize, false);
                    grant.ratio = dv.getFloat32();
                    p.grant = grant;
                }
                if (p.flag & 0x400) {
                    p.fixAxis = dv.getFloat32Array(3);
                }
                if (p.flag & 0x800) {
                    p.localXVector = dv.getFloat32Array(3);
                    p.localZVector = dv.getFloat32Array(3);
                }
                if (p.flag & 0x2000) {
                    p.key = dv.getUint32();
                }
                if (p.flag & 0x20) {
                    const ik = {};
                    ik.effector = dv.getIndex(metadata.boneIndexSize, false);
                    ik.target = null;
                    ik.iteration = dv.getUint32();
                    ik.maxAngle = dv.getFloat32();
                    ik.linkCount = dv.getUint32();
                    ik.links = [];
                    for (let i = 0; i < ik.linkCount; i++) {
                        const link = {};
                        link.index = dv.getIndex(metadata.boneIndexSize, false);
                        link.angleLimitation = dv.getUint8();
                        if (link.angleLimitation === 1) {
                            link.lowerLimitationAngle = dv.getFloat32Array(3);
                            link.upperLimitationAngle = dv.getFloat32Array(3);
                        }
                        ik.links.push(link);
                    }
                    p.ik = ik;
                }
                return p;
            }
            metadata.boneCount = dv.getUint32();
            pmx.bones = [];
            for (let i = 0; i < metadata.boneCount; i++) {
                pmx.bones.push(parseBone());
            }
        }
        // parseMorphs
        {
            function parseMorph() {
                const p = {};
                p.name = dv.getTextBuffer();
                p.englishName = dv.getTextBuffer();
                p.panel = dv.getUint8();
                p.type = dv.getUint8();
                p.elementCount = dv.getUint32();
                p.elements = [];
                for (let i = 0; i < p.elementCount; i++) {
                    if (p.type === 0) { // group morph
                        const m = {};
                        m.index = dv.getIndex(metadata.morphIndexSize, false);
                        m.ratio = dv.getFloat32();
                        p.elements.push(m);
                    }
                    else if (p.type === 1) { // vertex morph
                        const m = {};
                        m.index = dv.getIndex(metadata.vertexIndexSize, true);
                        m.position = dv.getFloat32Array(3);
                        p.elements.push(m);
                    }
                    else if (p.type === 2) { // bone morph
                        const m = {};
                        m.index = dv.getIndex(metadata.boneIndexSize, false);
                        m.position = dv.getFloat32Array(3);
                        m.rotation = dv.getFloat32Array(4);
                        p.elements.push(m);
                    }
                    else if (p.type === 3) { // uv morph
                        const m = {};
                        m.index = dv.getIndex(metadata.vertexIndexSize, true);
                        m.uv = dv.getFloat32Array(4);
                        p.elements.push(m);
                    }
                    else if (p.type === 4) { // additional uv1
                        // TODO: implement
                    }
                    else if (p.type === 5) { // additional uv2
                        // TODO: implement
                    }
                    else if (p.type === 6) { // additional uv3
                        // TODO: implement
                    }
                    else if (p.type === 7) { // additional uv4
                        // TODO: implement
                    }
                    else if (p.type === 8) { // material morph
                        const m = {};
                        m.index = dv.getIndex(metadata.materialIndexSize, false);
                        m.type = dv.getUint8();
                        m.diffuse = dv.getFloat32Array(4);
                        m.specular = dv.getFloat32Array(3);
                        m.shininess = dv.getFloat32();
                        m.ambient = dv.getFloat32Array(3);
                        m.edgeColor = dv.getFloat32Array(4);
                        m.edgeSize = dv.getFloat32();
                        m.textureColor = dv.getFloat32Array(4);
                        m.sphereTextureColor = dv.getFloat32Array(4);
                        m.toonColor = dv.getFloat32Array(4);
                        p.elements.push(m);
                    }
                }
                return p;
            }
            const metadata = pmx.metadata;
            metadata.morphCount = dv.getUint32();
            pmx.morphs = [];
            for (let i = 0; i < metadata.morphCount; i++) {
                pmx.morphs.push(parseMorph());
            }
        }
        // parseFrames
        {
            function parseFrame() {
                const p = {};
                p.name = dv.getTextBuffer();
                p.englishName = dv.getTextBuffer();
                p.type = dv.getUint8();
                p.elementCount = dv.getUint32();
                p.elements = [];
                for (let i = 0; i < p.elementCount; i++) {
                    const e = {};
                    e.target = dv.getUint8();
                    e.index = (e.target === 0)
                        ? dv.getIndex(metadata.boneIndexSize, false)
                        : dv.getIndex(metadata.morphIndexSize, false);
                    p.elements.push(e);
                }
                return p;
            }
            metadata.frameCount = dv.getUint32();
            pmx.frames = [];
            for (let i = 0; i < metadata.frameCount; i++) {
                pmx.frames.push(parseFrame());
            }
        }
        // parseRigidBodies
        {
            function parseRigidBody() {
                const p = {};
                p.name = dv.getTextBuffer();
                p.englishName = dv.getTextBuffer();
                p.boneIndex = dv.getIndex(metadata.boneIndexSize, false);
                p.groupIndex = dv.getUint8();
                p.groupTarget = dv.getUint16();
                p.shapeType = dv.getUint8();
                p.width = dv.getFloat32();
                p.height = dv.getFloat32();
                p.depth = dv.getFloat32();
                p.position = dv.getFloat32Array(3);
                p.rotation = dv.getFloat32Array(3);
                p.weight = dv.getFloat32();
                p.positionDamping = dv.getFloat32();
                p.rotationDamping = dv.getFloat32();
                p.restitution = dv.getFloat32();
                p.friction = dv.getFloat32();
                p.type = dv.getUint8();
                return p;
            }
            const metadata = pmx.metadata;
            metadata.rigidBodyCount = dv.getUint32();
            pmx.rigidBodies = [];
            for (let i = 0; i < metadata.rigidBodyCount; i++) {
                pmx.rigidBodies.push(parseRigidBody());
            }
        }
        // parseConstraints
        {
            function parseConstraint() {
                const p = {};
                p.name = dv.getTextBuffer();
                p.englishName = dv.getTextBuffer();
                p.type = dv.getUint8();
                p.rigidBodyIndex1 = dv.getIndex(metadata.rigidBodyIndexSize, false);
                p.rigidBodyIndex2 = dv.getIndex(metadata.rigidBodyIndexSize, false);
                p.position = dv.getFloat32Array(3);
                p.rotation = dv.getFloat32Array(3);
                p.translationLimitation1 = dv.getFloat32Array(3);
                p.translationLimitation2 = dv.getFloat32Array(3);
                p.rotationLimitation1 = dv.getFloat32Array(3);
                p.rotationLimitation2 = dv.getFloat32Array(3);
                p.springPosition = dv.getFloat32Array(3);
                p.springRotation = dv.getFloat32Array(3);
                return p;
            }
            const metadata = pmx.metadata;
            metadata.constraintCount = dv.getUint32();
            pmx.constraints = [];
            for (let i = 0; i < metadata.constraintCount; i++) {
                pmx.constraints.push(parseConstraint());
            }
        }
        if (leftToRight === true)
            this.leftToRightModel(pmx);
        return pmx;
    }
    static parseVmd(buffer, leftToRight) {
        const vmd = {};
        const dv = new DataViewEx(buffer);
        const metadata = {
            coordinateSystem: "left"
        };
        vmd.metadata = metadata;
        // parseHeader
        {
            metadata.magic = dv.getChars(30);
            if (metadata.magic !== "Vocaloid Motion Data 0002") {
                throw "VMD file magic is not Vocaloid Motion Data 0002, but " + metadata.magic;
            }
            metadata.name = dv.getSjisStringsAsUnicode(20);
        }
        // parseMotions
        {
            function parseMotion() {
                const p = {};
                p.boneName = dv.getSjisStringsAsUnicode(15);
                p.frameNum = dv.getUint32();
                p.position = dv.getFloat32Array(3);
                p.rotation = dv.getFloat32Array(4);
                p.interpolation = dv.getUint8Array(64);
                return p;
            }
            metadata.motionCount = dv.getUint32();
            vmd.motions = [];
            for (let i = 0; i < metadata.motionCount; i++) {
                vmd.motions.push(parseMotion());
            }
        }
        // parseMorphs
        {
            function parseMorph() {
                const p = {};
                p.morphName = dv.getSjisStringsAsUnicode(15);
                p.frameNum = dv.getUint32();
                p.weight = dv.getFloat32();
                return p;
            }
            metadata.morphCount = dv.getUint32();
            vmd.morphs = [];
            for (let i = 0; i < metadata.morphCount; i++) {
                vmd.morphs.push(parseMorph());
            }
        }
        // parseCameras
        if (4 <= buffer.byteLength - dv.offset) {
            function parseCamera() {
                const p = {};
                p.frameNum = dv.getUint32();
                p.distance = dv.getFloat32();
                p.position = dv.getFloat32Array(3);
                p.rotation = dv.getFloat32Array(3);
                p.interpolation = dv.getUint8Array(24);
                p.fov = dv.getUint32();
                p.perspective = dv.getUint8();
                return p;
            }
            metadata.cameraCount = dv.getUint32();
            vmd.cameras = [];
            for (let i = 0; i < metadata.cameraCount; i++) {
                vmd.cameras.push(parseCamera());
            }
        }
        // parseLights
        if (4 <= buffer.byteLength - dv.offset) {
            function parseLight() {
                const p = {};
                p.frameNum = dv.getUint32();
                p.color = dv.getFloat32Array(3);
                p.direction = dv.getFloat32Array(3);
                return p;
            }
            metadata.lightCount = dv.getUint32();
            vmd.lights = [];
            for (let i = 0; i < metadata.lightCount; i++) {
                vmd.lights.push(parseLight());
            }
        }
        // parseShadows
        if (4 <= buffer.byteLength - dv.offset) {
            function parseShadow() {
                const p = {};
                p.frameNum = dv.getUint32();
                p.mode = dv.getInt8();
                p.distance = dv.getFloat32();
                return p;
            }
            metadata.shadowCount = dv.getUint32();
            vmd.shadows = [];
            for (let i = 0; i < metadata.shadowCount; i++) {
                vmd.shadows.push(parseShadow());
            }
        }
        // parseProperties
        if (4 <= buffer.byteLength - dv.offset) {
            function parseProperty() {
                const p = {};
                p.frameNum = dv.getUint32();
                p.visible = dv.getInt8() === 1;
                const ikStateCount = dv.getUint32();
                p.ikStates = [];
                for (let i = 0; i < ikStateCount; i++) {
                    const ikName = dv.getSjisStringsAsUnicode(20);
                    const ikState = dv.getInt8() === 1;
                    p.ikStates.push({ name: ikName, enabled: ikState });
                }
                return p;
            }
            metadata.propertyCount = dv.getUint32();
            vmd.properties = [];
            for (let i = 0; i < metadata.propertyCount; i++) {
                vmd.properties.push(parseProperty());
            }
        }
        if (leftToRight === true)
            this.leftToRightVmd(vmd);
        return vmd;
    }
    static parseVpd(text, leftToRight) {
        const vpd = {};
        const metadata = {
            coordinateSystem: "left"
        };
        vpd.metadata = metadata;
        vpd.bones = [];
        const commentPatternG = /\/\/\w*(\r|\n|\r\n)/g;
        const newlinePattern = /\r|\n|\r\n/;
        const lines = text.replace(commentPatternG, "").split(newlinePattern);
        function throwError() {
            throw "the file seems not vpd file.";
        }
        // checkMagic
        {
            if (lines[0] !== "Vocaloid Pose Data file") {
                throwError();
            }
        }
        // parseHeader
        {
            if (lines.length < 4) {
                throwError();
            }
            vpd.metadata.parentFile = lines[2];
            vpd.metadata.boneCount = parseInt(lines[3]);
        }
        // parseBones
        {
            const boneHeaderPattern = /^\s*(Bone[0-9]+)\s*\{\s*(.*)$/;
            const boneVectorPattern = /^\s*(-?[0-9]+\.[0-9]+)\s*,\s*(-?[0-9]+\.[0-9]+)\s*,\s*(-?[0-9]+\.[0-9]+)\s*;/;
            const boneQuaternionPattern = /^\s*(-?[0-9]+\.[0-9]+)\s*,\s*(-?[0-9]+\.[0-9]+)\s*,\s*(-?[0-9]+\.[0-9]+)\s*,\s*(-?[0-9]+\.[0-9]+)\s*;/;
            const boneFooterPattern = /^\s*}/;
            const bones = vpd.bones;
            let n = null;
            let v = null;
            let q = null;
            for (let i = 4; i < lines.length; i++) {
                const line = lines[i];
                let result;
                result = line.match(boneHeaderPattern);
                if (result !== null) {
                    if (n !== null) {
                        throwError();
                    }
                    n = result[2];
                }
                result = line.match(boneVectorPattern);
                if (result !== null) {
                    if (v !== null) {
                        throwError();
                    }
                    v = [
                        parseFloat(result[1]),
                        parseFloat(result[2]),
                        parseFloat(result[3])
                    ];
                }
                result = line.match(boneQuaternionPattern);
                if (result !== null) {
                    if (q !== null) {
                        throwError();
                    }
                    q = [
                        parseFloat(result[1]),
                        parseFloat(result[2]),
                        parseFloat(result[3]),
                        parseFloat(result[4])
                    ];
                }
                result = line.match(boneFooterPattern);
                if (result !== null) {
                    if (n === null || v === null || q === null) {
                        throwError();
                    }
                    bones.push({
                        name: n,
                        translation: v,
                        quaternion: q
                    });
                    n = null;
                    v = null;
                    q = null;
                }
            }
            if (n !== null || v !== null || q !== null) {
                throwError();
            }
        }
        if (leftToRight === true)
            this.leftToRightVpd(vpd);
        return vpd;
    }
    static mergeVmds(vmds) {
        const metadata = {
            coordinateSystem: vmds[0].metadata.coordinateSystem,
            magic: vmds[0].metadata.magic,
            name: vmds[0].metadata.name,
            motionCount: 0,
            morphCount: 0,
            cameraCount: 0,
            lightCount: 0,
            shadowCount: 0,
            propertyCount: 0
        };
        const motions = [];
        const morphs = [];
        const cameras = [];
        const lights = [];
        const shadows = [];
        const properties = [];
        for (let i = 0; i < vmds.length; i++) {
            const v2 = vmds[i];
            metadata.motionCount += v2.metadata.motionCount;
            metadata.morphCount += v2.metadata.morphCount;
            metadata.cameraCount += v2.metadata.cameraCount;
            metadata.lightCount += v2.metadata.lightCount;
            metadata.shadowCount += v2.metadata.shadowCount;
            metadata.propertyCount += v2.metadata.propertyCount;
            for (let j = 0; j < v2.metadata.motionCount; j++) {
                motions.push(v2.motions[j]);
            }
            for (let j = 0; j < v2.metadata.morphCount; j++) {
                morphs.push(v2.morphs[j]);
            }
            for (let j = 0; j < v2.metadata.cameraCount; j++) {
                cameras.push(v2.cameras[j]);
            }
            for (let j = 0; j < v2.metadata.lightCount; j++) {
                lights.push(v2.lights[j]);
            }
            for (let j = 0; j < v2.metadata.shadowCount; j++) {
                shadows.push(v2.shadows[j]);
            }
            for (let j = 0; j < v2.metadata.propertyCount; j++) {
                properties.push(v2.properties[j]);
            }
        }
        return {
            metadata: metadata,
            motions: motions,
            morphs: morphs,
            cameras: cameras,
            lights: lights,
            shadows: shadows,
            properties: properties
        };
    }
    static leftToRightModel(model) {
        if (model.metadata.coordinateSystem === "right") {
            return;
        }
        model.metadata.coordinateSystem = "right";
        for (let i = 0; i < model.metadata.vertexCount; i++) {
            DataCreationHelper.leftToRightVector3(model.vertices[i].position);
            DataCreationHelper.leftToRightVector3(model.vertices[i].normal);
        }
        for (let i = 0; i < model.metadata.faceCount; i++) {
            DataCreationHelper.leftToRightIndexOrder(model.faces[i].indices);
        }
        for (let i = 0; i < model.metadata.boneCount; i++) {
            DataCreationHelper.leftToRightVector3(model.bones[i].position);
        }
        // TODO: support other morph for PMX
        for (let i = 0; i < model.metadata.morphCount; i++) {
            const m = model.morphs[i];
            if (model.metadata.format === "pmx" && m.type !== 1) {
                // TODO: implement
                continue;
            }
            for (let j = 0; j < m.elements.length; j++) {
                DataCreationHelper.leftToRightVector3(m.elements[j].position);
            }
        }
        for (let i = 0; i < model.metadata.rigidBodyCount; i++) {
            DataCreationHelper.leftToRightVector3(model.rigidBodies[i].position);
            DataCreationHelper.leftToRightEuler(model.rigidBodies[i].rotation);
        }
        for (let i = 0; i < model.metadata.constraintCount; i++) {
            DataCreationHelper.leftToRightVector3(model.constraints[i].position);
            DataCreationHelper.leftToRightEuler(model.constraints[i].rotation);
            DataCreationHelper.leftToRightVector3Range(model.constraints[i].translationLimitation1, model.constraints[i].translationLimitation2);
            DataCreationHelper.leftToRightEulerRange(model.constraints[i].rotationLimitation1, model.constraints[i].rotationLimitation2);
        }
    }
    static leftToRightVmd(vmd) {
        if (vmd.metadata.coordinateSystem === "right") {
            return;
        }
        vmd.metadata.coordinateSystem = "right";
        for (let i = 0; i < vmd.metadata.motionCount; i++) {
            DataCreationHelper.leftToRightVector3(vmd.motions[i].position);
            DataCreationHelper.leftToRightQuaternion(vmd.motions[i].rotation);
        }
        for (let i = 0; i < vmd.metadata.cameraCount; i++) {
            DataCreationHelper.leftToRightVector3(vmd.cameras[i].position);
            DataCreationHelper.leftToRightEuler(vmd.cameras[i].rotation);
        }
        for (let i = 0; i < vmd.metadata.lightCount; i++) {
            DataCreationHelper.leftToRightVector3(vmd.lights[i].direction); // TODO: check
        }
    }
    static leftToRightVpd(vpd) {
        if (vpd.metadata.coordinateSystem === "right") {
            return;
        }
        vpd.metadata.coordinateSystem = "right";
        for (let i = 0; i < vpd.bones.length; i++) {
            DataCreationHelper.leftToRightVector3(vpd.bones[i].translation);
            DataCreationHelper.leftToRightQuaternion(vpd.bones[i].quaternion);
        }
    }
}
