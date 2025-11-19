import type { Quaternion, Vector2, Vector3 } from "./Math";
export declare type ModelFormat = "pmd" | "pmx";
export declare type CorrdinateSystem = "left" | "right";
export declare type Pmd = {
    metadata: PmdMetadata;
    vertices: PmdVertexInfo[];
    faces: PmdFaceInfo[];
    materials: PmdMaterialInfo[];
    bones: PmdBoneInfo[];
    iks: PmdIkInfo[];
    morphs: PmdMorphInfo[];
    morphFrames: PmdMorphFrameInfo[];
    boneFrameNames: PmdBoneFrameNameInfo[];
    boneFrames: PmdBoneFrameInfo[];
    englishBoneNames: PmdEnglishBoneNameInfo[];
    englishMorphNames: PmdEnglishMorphNameInfo[];
    englishBoneFrameNames: PmdEnglishBoneFrameNameInfo[];
    toonTextures: PmdToonTextureInfo[];
    rigidBodies: PmdRigidBodyInfo[];
    constraints: PmdConstraintInfo[];
};
export declare type PmdMetadata = {
    format: "pmd";
    coordinateSystem: CorrdinateSystem;
    magic: string;
    version: number;
    modelName: string;
    comment: string;
    vertexCount: number;
    faceCount: number;
    materialCount: number;
    boneCount: number;
    ikCount: number;
    morphCount: number;
    morphFrameCount: number;
    boneFrameNameCount: number;
    boneFrameCount: number;
    englishCompatibility: number;
    englishModelName: string;
    englishComment: string;
    rigidBodyCount: number;
    constraintCount: number;
};
export declare type PmdVertexInfo = {
    position: Vector3;
    normal: Vector3;
    uv: Vector2;
    skinIndices: Vector2;
    skinWeights: Vector2;
    edgeFlag: number;
};
export declare type PmdFaceInfo = {
    indices: Vector3;
};
export declare type PmdMaterialInfo = {
    diffuse: [number, number, number, number];
    shininess: number;
    specular: Vector3;
    ambient: Vector3;
    toonIndex: number;
    edgeFlag: number;
    faceCount: number;
    fileName: string;
};
export declare type PmdBoneInfo = {
    name: string;
    parentIndex: number;
    tailIndex: number;
    type: number;
    ikIndex: number;
    position: Vector3;
};
export declare type PmdIkInfo = {
    target: number;
    effector: number;
    linkCount: number;
    iteration: number;
    maxAngle: number;
    links: {
        index: number;
    }[];
};
export declare type PmdMorphInfo = {
    name: string;
    elementCount: number;
    type: number;
    elements: {
        index: number;
        position: Vector3;
    }[];
};
export declare type PmdMorphFrameInfo = {
    index: number;
};
export declare type PmdBoneFrameNameInfo = {
    name: string;
};
export declare type PmdBoneFrameInfo = {
    boneIndex: number;
    frameIndex: number;
};
export declare type PmdEnglishBoneNameInfo = {
    name: string;
};
export declare type PmdEnglishMorphNameInfo = {
    name: string;
};
export declare type PmdEnglishBoneFrameNameInfo = {
    name: string;
};
export declare type PmdToonTextureInfo = {
    fileName: string;
};
export declare type PmdRigidBodyInfo = {
    name: string;
    boneIndex: number;
    groupIndex: number;
    groupTarget: number;
    shapeType: number;
    width: number;
    height: number;
    depth: number;
    position: Vector3;
    rotation: Vector3;
    weight: number;
    positionDamping: number;
    rotationDamping: number;
    restitution: number;
    friction: number;
    type: number;
};
export declare type PmdConstraintInfo = {
    name: string;
    rigidBodyIndex1: number;
    rigidBodyIndex2: number;
    position: Vector3;
    rotation: Vector3;
    translationLimitation1: Vector3;
    translationLimitation2: Vector3;
    rotationLimitation1: Vector3;
    rotationLimitation2: Vector3;
    springPosition: Vector3;
    springRotation: Vector3;
};
export declare type Pmx = {
    metadata: PmxMetadata;
    vertices: PmxVertexInfo[];
    faces: PmxFaceInfo[];
    textures: string[];
    materials: PmxMaterialInfo[];
    bones: PmxBoneInfo[];
    morphs: PmxMorphInfo[];
    frames: PmxFrameInfo[];
    rigidBodies: PmxRigidBodyInfo[];
    constraints: PmxConstraintInfo[];
};
export declare type PmxMetadata = {
    format: "pmx";
    coordinateSystem: CorrdinateSystem;
    magic: string;
    version: number;
    headerSize: number;
    encoding: number;
    additionalUvNum: number;
    vertexIndexSize: number;
    textureIndexSize: number;
    materialIndexSize: number;
    boneIndexSize: number;
    morphIndexSize: number;
    rigidBodyIndexSize: number;
    modelName: string;
    englishModelName: string;
    comment: string;
    englishComment: string;
    vertexCount: number;
    faceCount: number;
    textureCount: number;
    materialCount: number;
    boneCount: number;
    morphCount: number;
    frameCount: number;
    rigidBodyCount: number;
    constraintCount: number;
};
export declare type PmxVertexInfo = {
    position: Vector3;
    normal: Vector3;
    uv: Vector2;
    auvs: [number, number, number, number];
    type: number;
    skinIndices: number[];
    skinWeights: number[];
    skinC?: Vector3;
    skinR0?: Vector3;
    skinR1?: Vector3;
    edgeRatio: number;
};
export declare type PmxFaceInfo = {
    indices: [number, number, number];
};
export declare type PmxMaterialInfo = {
    name: string;
    englishName: string;
    diffuse: [number, number, number, number];
    specular: Vector3;
    shininess: number;
    ambient: Vector3;
    flag: number;
    edgeColor: [number, number, number, number];
    edgeSize: number;
    textureIndex: number;
    envTextureIndex: number;
    envFlag: number;
    toonFlag: number;
    toonIndex: number;
    comment: string;
    faceCount: number;
};
export declare type PmxBoneInfo = {
    name: string;
    englishName: string;
    position: Vector3;
    parentIndex: number;
    transformationClass: number;
    flag: number;
    connectIndex?: number;
    offsetPosition?: Vector3;
    grant?: {
        isLocal: boolean;
        affectRotation: boolean;
        affectPosition: boolean;
        parentIndex: number;
        ratio: number;
    };
    fixAxis?: Vector3;
    localXVector?: Vector3;
    localZVector?: Vector3;
    key?: number;
    ik?: {
        effector: number;
        target: any;
        iteration: number;
        maxAngle: number;
        linkCount: number;
        links: {
            index: number;
            angleLimitation: number;
            lowerLimitationAngle?: Vector3;
            upperLimitationAngle?: Vector3;
        }[];
    };
};
export declare type GroupMorph = {
    index: number;
    ratio: number;
};
export declare type VertexMorph = {
    index: number;
    position: Vector3;
};
export declare type BoneMorph = {
    index: number;
    position: Vector3;
    rotation: Quaternion;
};
export declare type UvMorph = {
    index: number;
    uv: [number, number, number, number];
};
export declare type MaterialMorph = {
    index: number;
    type: number;
    diffuse: [number, number, number, number];
    specular: Vector3;
    shininess: number;
    ambient: Vector3;
    edgeColor: [number, number, number, number];
    edgeSize: number;
    textureColor: [number, number, number, number];
    sphereTextureColor: [number, number, number, number];
    toonColor: [number, number, number, number];
};
export declare type PmxMorphInfo = {
    name: string;
    englishName: string;
    panel: number;
    type: number;
    elementCount: number;
    elements: (GroupMorph | VertexMorph | BoneMorph | UvMorph | MaterialMorph)[];
};
export declare type PmxFrameInfo = {
    name: string;
    englishName: string;
    type: number;
    elementCount: number;
    elements: {
        target: number;
        index: number;
    }[];
};
export declare type PmxRigidBodyInfo = {
    name: string;
    englishName: string;
    boneIndex: number;
    groupIndex: number;
    groupTarget: number;
    shapeType: number;
    width: number;
    height: number;
    depth: number;
    position: Vector3;
    rotation: Vector3;
    weight: number;
    positionDamping: number;
    rotationDamping: number;
    restitution: number;
    friction: number;
    type: number;
};
export declare type PmxConstraintInfo = {
    name: string;
    englishName: string;
    type: number;
    rigidBodyIndex1: number;
    rigidBodyIndex2: number;
    position: Vector3;
    rotation: Vector3;
    translationLimitation1: Vector3;
    translationLimitation2: Vector3;
    rotationLimitation1: Vector3;
    rotationLimitation2: Vector3;
    springPosition: Vector3;
    springRotation: Vector3;
};
export declare type Vmd = {
    metadata: VmdMetadata;
    motions: VmdMotionFrame[];
    morphs: VmdMorphFrame[];
    cameras: VmdCameraFrame[];
    lights: VmdLightFrame[];
    shadows: VmdShadowFrame[];
    properties: VmdPropertyFrame[];
};
export declare type VmdMetadata = {
    coordinateSystem: CorrdinateSystem;
    magic: string;
    name: string;
    motionCount: number;
    morphCount: number;
    cameraCount: number;
    lightCount: number;
    shadowCount: number;
    propertyCount: number;
};
export declare type VmdMotionFrame = {
    boneName: string;
    frameNum: number;
    position: Vector3;
    rotation: Quaternion;
    interpolation: [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number
    ];
};
export declare type VmdMorphFrame = {
    morphName: string;
    frameNum: number;
    weight: number;
};
export declare type VmdCameraFrame = {
    frameNum: number;
    distance: number;
    position: Vector3;
    rotation: Vector3;
    interpolation: [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number
    ];
    fov: number;
    perspective: number;
};
export declare type VmdLightFrame = {
    frameNum: number;
    color: Vector3;
    direction: Vector3;
};
export declare type VmdShadowFrame = {
    frameNum: number;
    mode: 0 | 1 | 2;
    distance: number;
};
export declare type VmdPropertyFrame = {
    frameNum: number;
    visible: boolean;
    ikStates: {
        name: string;
        enabled: boolean;
    }[];
};
export declare type Vpd = {
    metadata: VpdMetadata;
    bones: VpdBone[];
};
export declare type VpdMetadata = {
    coordinateSystem: CorrdinateSystem;
    parentFile: string;
    boneCount: number;
};
export declare type VpdBone = {
    name: string;
    translation: Vector3;
    quaternion: Quaternion;
};
export declare class Parser {
    static parsePmd(buffer: ArrayBufferLike, leftToRight: boolean): Pmd;
    static parsePmx(buffer: ArrayBufferLike, leftToRight: boolean): Pmx;
    static parseVmd(buffer: ArrayBufferLike, leftToRight: boolean): Vmd;
    static parseVpd(text: string, leftToRight: boolean): Vpd;
    static mergeVmds(vmds: Vmd[]): Vmd;
    static leftToRightModel(model: Pmd | Pmx): void;
    static leftToRightVmd(vmd: Vmd): void;
    static leftToRightVpd(vpd: Vpd): void;
}
