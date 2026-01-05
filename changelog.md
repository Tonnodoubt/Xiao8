# 修改记录

## 2026-01-05 - VRM 动画播放优化

##问题一：如何解决“胳膊肘往外拐/扭曲”的问题？

原因分析： 从你提供的图片来看，左臂发生了严重的扭曲（Mesh Deformation artifact）。结合你的代码，我发现你的 _strictRetargetClip 方法中的白名单（WhiteList）缺少了“Twist Bones”（扭转骨）。

在 VRM 标准中，为了防止手臂旋转时模型像“糖纸”一样拧巴，通常会将权重分散给 UpperArmTwist 和 LowerArmTwist。

如果你的动作文件旋转了 LowerArm 90度。

但是 LowerArmTwist 被你的白名单过滤掉了（保持 0度）。

结果就是：胳膊的一半网格转了，另一半没转，导致关节处（胳膊肘）看起来像折断或反向扭曲。

✅ 解决方案：将 Twist 骨骼加入白名单

请修改 _strictRetargetClip 中的 standardBones 数组，加入扭转骨：
// 在 _strictRetargetClip 方法内
const standardBones = [
    'hips','spine','chest','upperChest','neck','head',
    'leftEye','rightEye',
    'leftShoulder','rightShoulder',
    'leftUpperArm','rightUpperArm',
    // ⬇️【新增】加入 Twist 骨骼，解决胳膊肘扭曲问题
    'leftUpperArmTwist', 'rightUpperArmTwist', 
    'leftLowerArm', 'rightLowerArm',
    // ⬇️【新增】加入 Twist 骨骼
    'leftLowerArmTwist', 'rightLowerArmTwist',
    'leftHand','rightHand',
    // ... (腿部骨骼保持不变，如果腿部也有扭曲，同样加上 Twist)
    // ... (手指骨骼保持不变)
];



